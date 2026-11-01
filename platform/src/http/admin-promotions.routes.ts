import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { envelope } from "./errors";
import { adminAuthPreHandler } from "./admin.routes";
import { can, resolveOperatorScope, type AdminClaims } from "../modules/admin/admin-auth";
import { promoState, type PrizeDrop, type PromoWin, type Tournament, type TournamentMetric } from "../modules/promotions/promotions";

/**
 * Promotions (both consoles; same permissions as Free Rounds: campaigns.read / .write).
 *   GET  /admin/v1/tournaments              list (state, prize pool, winners)
 *   POST /admin/v1/tournaments              create
 *   GET  /admin/v1/tournaments/:id          one, with its live leaderboard and prizes
 *   POST /admin/v1/tournaments/:id/cancel   cancel (prizes already won stand)
 *   GET  /admin/v1/prize-drops (+ POST, GET /:id, POST /:id/cancel)  the same for Prize Drops
 *   GET  /admin/v1/promo-wins               Promo Win Search (player, type, status, dates)
 *   POST /admin/v1/promo-wins/:id/retry     pay a prize whose credit failed, now
 * Tenant isolation as in Campaigns: an operator admin sees only its own; another
 * operator's promotion answers 404.
 */
interface PromoBody {
  operator_id?: string;
  name?: string;
  game_codes?: string[];
  currency?: string;
  min_bet?: number;
  starts_at?: string;
  ends_at?: string;
  metric?: string;
  odds?: number;
  prizes?: unknown;
}

const ERRORS: Record<string, string> = {
  PROMO_NAME_INVALID: "name: 1–120 characters",
  PROMO_CURRENCY_INVALID: "currency: a 3-letter code",
  PROMO_GAMES_INVALID: "game_codes: at least one game",
  PROMO_MIN_BET_INVALID: "min_bet: a non-negative amount with at most 2 decimals",
  PROMO_WINDOW_INVALID: "starts_at / ends_at: ends after it starts, and in the future",
  PROMO_PRIZES_INVALID: "prizes: 1–500 positive amounts with at most 2 decimals",
  TOURNAMENT_METRIC_INVALID: "metric: max_multiplier, total_win or turnover",
  PRIZE_DROP_ODDS_INVALID: "odds: a whole number from 1 to 1,000,000"
};

const sum = (xs: number[]) => Number(xs.reduce((s, x) => s + x, 0).toFixed(2));

const adminPromotionsRoutes: FastifyPluginAsync = async (app) => {
  const auth = adminAuthPreHandler(app.container);
  const repo = app.container.promotions;

  const guard = (req: FastifyRequest, reply: FastifyReply, permission: string): AdminClaims | null => {
    const claims = req.adminClaims as AdminClaims;
    if (!can(claims, permission)) { reply.code(403).send(envelope("FORBIDDEN", `missing permission: ${permission}`, req.id)); return null; }
    return claims;
  };
  const owned = <T extends { operator_id: string }>(claims: AdminClaims, p: T | null): T | null =>
    p && !(claims.scope === "operator" && claims.operator_id !== p.operator_id) ? p : null;
  const audit = (claims: AdminClaims, operatorId: string, action: string, type: string, id: string) =>
    app.container.auditRepo.append({ operator_id: operatorId, actor_type: "admin", actor_id: claims.admin_id, action, target_type: type, target_id: id });

  /** Shared create checks: scope, and every game enabled for this operator in this currency. */
  const prepare = (req: FastifyRequest, reply: FastifyReply, claims: AdminClaims): { operatorId: string; body: PromoBody } | null => {
    const body = (req.body ?? {}) as PromoBody;
    const operatorId = resolveOperatorScope(claims, body.operator_id);
    if (!operatorId) { reply.code(422).send(envelope("VALIDATION", "operator_id required", req.id)); return null; }
    const currency = String(body.currency ?? "").trim().toUpperCase();
    const games = Array.isArray(body.game_codes) ? body.game_codes.map(String) : [];
    const missing = games.filter((g) => !app.container.mgmt.findOperatorGame(operatorId, g, currency));
    if (missing.length) { reply.code(422).send(envelope("GAME_NOT_ASSIGNED", `not enabled for this operator in ${currency || "that currency"}: ${missing.join(", ")}`, req.id)); return null; }
    return { operatorId, body: { ...body, currency, game_codes: games } };
  };
  const domainError = (req: FastifyRequest, reply: FastifyReply, err: unknown) => {
    const code = err instanceof Error ? err.message : "VALIDATION";
    return reply.code(422).send(envelope(code in ERRORS ? code : "VALIDATION", ERRORS[code] ?? code, req.id));
  };

  const tournamentSummary = (t: Tournament, wins: PromoWin[]) => ({
    ...t, state: promoState(t, new Date().toISOString()), prize_pool: sum(t.prizes), places: t.prizes.length,
    winners: wins.length, paid: sum(wins.filter((w) => w.status === "paid").map((w) => w.amount))
  });

  app.get("/admin/v1/tournaments", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const op = resolveOperatorScope(claims, (req.query as { operator_id?: string }).operator_id);
    const list = repo.listTournaments(op).map((t) => tournamentSummary(t, repo.listWins({ promo_id: t.id })));
    return { tournaments: list, count: list.length };
  });

  app.post("/admin/v1/tournaments", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const ok = prepare(req, reply, claims);
    if (!ok) return reply;
    const { operatorId, body } = ok;
    try {
      const t = repo.createTournament({
        operator_id: operatorId, name: String(body.name ?? ""), game_codes: body.game_codes ?? [], currency: body.currency ?? "",
        min_bet: body.min_bet, starts_at: String(body.starts_at ?? new Date().toISOString()), ends_at: String(body.ends_at ?? ""),
        metric: body.metric as TournamentMetric, prizes: Array.isArray(body.prizes) ? (body.prizes as number[]) : [], created_by: claims.admin_id
      });
      audit(claims, operatorId, "tournament.create", "tournament", t.id);
      return reply.code(201).send({ tournament: tournamentSummary(t, []) });
    } catch (err) { return domainError(req, reply, err); }
  });

  app.get("/admin/v1/tournaments/:id", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const t = owned(claims, repo.getTournament((req.params as { id: string }).id));
    if (!t) return reply.code(404).send(envelope("PROMO_NOT_FOUND", "no such tournament", req.id));
    const wins = repo.listWins({ promo_id: t.id }).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    // Closed: the board IS the prizes. Otherwise: live, from the round ledger.
    const board = t.status === "closed"
      ? wins.map((w) => ({ rank: w.rank!, operator_player_id: w.operator_player_id, score: w.score ?? 0, rounds: null, achieved_at: null }))
      : await app.container.history.tournamentBoard(t, Math.max(50, t.prizes.length));
    return { tournament: tournamentSummary(t, wins), board, wins };
  });

  app.post("/admin/v1/tournaments/:id/cancel", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const t = owned(claims, repo.getTournament((req.params as { id: string }).id));
    if (!t) return reply.code(404).send(envelope("PROMO_NOT_FOUND", "no such tournament", req.id));
    if (t.status === "closed") return reply.code(409).send(envelope("PROMO_CLOSED", "a closed tournament has paid its prizes", req.id));
    const after = repo.cancelTournament(t.id);
    if (t.status === "open") audit(claims, t.operator_id, "tournament.cancel", "tournament", t.id);
    return { tournament: tournamentSummary(after, repo.listWins({ promo_id: t.id })), already_cancelled: t.status === "cancelled" };
  });

  const dropSummary = (d: PrizeDrop, wins: PromoWin[]) => ({
    ...d, state: promoState(d, new Date().toISOString()), prize_pool: sum(d.prizes.map((p) => p.amount * p.count)),
    prizes_total: d.prizes.reduce((s, p) => s + p.count, 0), winners: wins.length, paid: sum(wins.filter((w) => w.status === "paid").map((w) => w.amount))
  });

  app.get("/admin/v1/prize-drops", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const op = resolveOperatorScope(claims, (req.query as { operator_id?: string }).operator_id);
    const list = repo.listPrizeDrops(op).map((d) => dropSummary(d, repo.listWins({ promo_id: d.id })));
    return { prize_drops: list, count: list.length };
  });

  app.post("/admin/v1/prize-drops", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const ok = prepare(req, reply, claims);
    if (!ok) return reply;
    const { operatorId, body } = ok;
    try {
      const d = repo.createPrizeDrop({
        operator_id: operatorId, name: String(body.name ?? ""), game_codes: body.game_codes ?? [], currency: body.currency ?? "",
        min_bet: body.min_bet, starts_at: String(body.starts_at ?? new Date().toISOString()), ends_at: String(body.ends_at ?? ""),
        odds: Number(body.odds), prizes: Array.isArray(body.prizes) ? (body.prizes as Array<{ amount: number; count: number }>) : [], created_by: claims.admin_id
      });
      audit(claims, operatorId, "prize_drop.create", "prize_drop", d.id);
      return reply.code(201).send({ prize_drop: dropSummary(d, []) });
    } catch (err) { return domainError(req, reply, err); }
  });

  app.get("/admin/v1/prize-drops/:id", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const d = owned(claims, repo.getPrizeDrop((req.params as { id: string }).id));
    if (!d) return reply.code(404).send(envelope("PROMO_NOT_FOUND", "no such prize drop", req.id));
    const wins = repo.listWins({ promo_id: d.id });
    return { prize_drop: dropSummary(d, wins), wins };
  });

  app.post("/admin/v1/prize-drops/:id/cancel", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const d = owned(claims, repo.getPrizeDrop((req.params as { id: string }).id));
    if (!d) return reply.code(404).send(envelope("PROMO_NOT_FOUND", "no such prize drop", req.id));
    if (d.status === "closed") return reply.code(409).send(envelope("PROMO_CLOSED", "this prize drop has already closed", req.id));
    const after = repo.cancelPrizeDrop(d.id);
    if (d.status === "open") audit(claims, d.operator_id, "prize_drop.cancel", "prize_drop", d.id);
    return { prize_drop: dropSummary(after, repo.listWins({ promo_id: d.id })), already_cancelled: d.status === "cancelled" };
  });

  app.get("/admin/v1/promo-wins", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string; player?: string; type?: string; status?: string; promo_id?: string; from?: string; to?: string; limit?: string };
    if (q.type && q.type !== "tournament" && q.type !== "prize_drop") return reply.code(422).send(envelope("VALIDATION", "type: tournament or prize_drop", req.id));
    if (q.status && !["pending", "paid", "failed"].includes(q.status)) return reply.code(422).send(envelope("VALIDATION", "status: pending, paid or failed", req.id));
    for (const k of ["from", "to"] as const) if (q[k] && !Number.isFinite(Date.parse(q[k]!))) return reply.code(422).send(envelope("VALIDATION", `${k} must be an ISO date-time`, req.id));
    const all = repo.listWins({
      operator_id: resolveOperatorScope(claims, q.operator_id), operator_player_id: q.player || undefined,
      promo_type: (q.type || undefined) as PromoWin["promo_type"] | undefined, status: (q.status || undefined) as PromoWin["status"] | undefined,
      promo_id: q.promo_id || undefined, from: q.from ? new Date(q.from).toISOString() : undefined, to: q.to ? new Date(q.to).toISOString() : undefined
    });
    const limit = Math.min(Math.max(Number(q.limit) || 500, 1), 5000);
    const totals = new Map<string, number>();
    for (const w of all) totals.set(w.currency, (totals.get(w.currency) ?? 0) + w.amount);
    return { wins: all.slice(0, limit), count: Math.min(all.length, limit), total: all.length, totals: [...totals].map(([currency, amount]) => ({ currency, amount: Number(amount.toFixed(2)) })) };
  });

  app.post("/admin/v1/promo-wins/:id/retry", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "campaigns.write");
    if (!claims) return reply;
    const w = owned(claims, repo.getWin((req.params as { id: string }).id));
    if (!w) return reply.code(404).send(envelope("PROMO_WIN_NOT_FOUND", "no such prize", req.id));
    const result = await app.container.promoPayouts.payOne(w);
    audit(claims, w.operator_id, "promo_win.retry", "promo_win", w.id);
    return { result, win: repo.getWin(w.id) };
  });
};

export default adminPromotionsRoutes;