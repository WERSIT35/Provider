import type { FastifyPluginAsync, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { envelope, sendDomainError } from "./errors";
import { can, resolveOperatorScope, type AdminClaims } from "../modules/admin/admin-auth";
import type { Container } from "../container";

/** Admin API (plan §4/§7). RBAC + tenant scoping enforced per route. */
const adminRoutes: FastifyPluginAsync = async (app) => {
  const auth = adminAuthPreHandler(app.container);

  const guard = (req: FastifyRequest, reply: FastifyReply, permission: string): AdminClaims | null => {
    const claims = req.adminClaims as AdminClaims;
    if (!can(claims, permission)) {
      reply.code(403).send(envelope("FORBIDDEN", `missing permission: ${permission}`, req.id));
      return null;
    }
    return claims;
  };

  const requireProvider = (req: FastifyRequest, reply: FastifyReply): AdminClaims | null => {
    const claims = req.adminClaims as AdminClaims;
    if (claims.scope !== "provider") {
      reply.code(403).send(envelope("FORBIDDEN", "provider scope required", req.id));
      return null;
    }
    return claims;
  };

  // Provider-only: list operators.
  app.get("/admin/v1/operators", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "operators.read");
    if (!claims) return reply;
    if (claims.scope !== "provider") {
      return reply.code(403).send(envelope("FORBIDDEN", "provider scope required", req.id));
    }
    return { operators: app.container.mgmt.listOperators() };
  });

  // Rounds (tenant-scoped). Operator admins always see only their own operator.
  app.get("/admin/v1/rounds", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "rounds.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string; from?: string; to?: string };
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    const rounds = app.container.reporting
      .listRounds(operatorId, { from: q.from, to: q.to })
      .map((r) => ({
        round_ref: r.round_ref,
        operator_id: r.operator_id,
        bet_amount: r.bet_amount,
        bet_charged: r.bet_charged,
        total_win: r.total_win,
        is_free_spin: r.is_free_spin,
        status: r.status,
        outcome_hash: r.outcome_hash,
        created_at: r.created_at
      }));
    return { rounds, count: rounds.length };
  });

  // Round Inspector — single round by ref with the full stored outcome.
  // Operator admins are forced to their own operator_id and get 404 for others
  // (never leak the existence of cross-tenant rounds).
  app.get("/admin/v1/rounds/:roundRef", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "rounds.read");
    if (!claims) return reply;
    const { roundRef } = req.params as { roundRef: string };
    const round = app.container.ledger.getRound(roundRef);
    if (!round) {
      return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    }
    if (claims.scope === "operator" && claims.operator_id !== round.operator_id) {
      return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    }

    // Enrich with related catalog data so the inspector can render without extra calls.
    let operator: { id: string; slug: string; name: string } | null = null;
    try {
      const op = app.container.mgmt.getOperator(round.operator_id);
      operator = { id: op.id, slug: op.slug, name: op.name };
    } catch {
      operator = null;
    }

    let game: { id: string; code: string; title: string } | null = null;
    let mathConfig: { id: string; version: string; theoretical_rtp: number; status: string } | null = null;
    try {
      const catalog = app.container.mgmt.getGameAndConfig(round.game_id, round.math_config_id);
      game = catalog.game ? { id: catalog.game.id, code: catalog.game.code, title: catalog.game.title } : null;
      mathConfig = catalog.config
        ? {
            id: catalog.config.id,
            version: catalog.config.version,
            theoretical_rtp: catalog.config.theoretical_rtp,
            status: catalog.config.status
          }
        : null;
    } catch {
      /* catalog optional */
    }

    return {
      round_ref: round.round_ref,
      operator_id: round.operator_id,
      operator,
      game_id: round.game_id,
      game,
      math_config_id: round.math_config_id,
      math_config: mathConfig,
      session_id: round.session_id,
      currency: app.container.sessions.tryGet(round.session_id)?.currency ?? null,
      bet_amount: round.bet_amount,
      bet_charged: round.bet_charged,
      is_free_spin: round.is_free_spin,
      ante_enabled: round.ante_enabled,
      total_win: round.total_win,
      multiplier_applied: round.multiplier_applied,
      status: round.status,
      created_at: round.created_at,
      outcome_hash: round.outcome_hash,
      rng_algo: round.rng_algo,
      rng_seed_hex: round.rng_seed_hex,
      rng_bytes_drawn: round.rng_bytes_drawn,
      chain: { seq: round.seq, prev_hash: round.prev_hash, payload_hash: round.payload_hash, chain_hash: round.chain_hash },
      outcome: round.outcome
    };
  });

  // Reports.
  app.get("/admin/v1/reports/summary", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "reports.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string; from?: string; to?: string };
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    return app.container.reporting.roundsSummary(operatorId, { from: q.from, to: q.to });
  });

  app.get("/admin/v1/reports/rtp", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "reports.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    return app.container.reporting.rtpReport(resolveOperatorScope(claims, q.operator_id));
  });

  app.get("/admin/v1/reports/ggr", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "reports.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    return { ggr_by_day: app.container.reporting.ggrByDay(resolveOperatorScope(claims, q.operator_id)) };
  });

  app.get("/admin/v1/reports/reconciliation", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "reports.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    return app.container.reporting.reconcile(resolveOperatorScope(claims, q.operator_id));
  });

  // Failed-settlement queue.
  app.get("/admin/v1/transactions/failed", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "transactions.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    const failed = app.container.reporting.failedSettlements(resolveOperatorScope(claims, q.operator_id));
    return { failed_settlements: failed, count: failed.length };
  });

  // ── Provisioning (provider-only) ────────────────────────────────────────────
  // Mirrors what scripts/dev-seed.ts does in code, but exposed so an operator
  // can be onboarded from the portal. Every action is audited via the mgmt service.

  // List the global game catalog + math configs so the portal can render the
  // assignment step without poking at internal state.
  app.get("/admin/v1/games", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "games.read");
    if (!claims) return reply;
    return {
      games: app.container.mgmt.listGames(),
      math_configs: app.container.mgmt.listMathConfigs()
    };
  });

  app.post("/admin/v1/operators", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const body = (req.body ?? {}) as { name?: string; slug?: string; default_currency?: string };
    if (!body.name || !body.slug) {
      return reply.code(422).send(envelope("VALIDATION", "name + slug required", req.id));
    }
    try {
      const op = app.container.mgmt.createOperator({
        name: body.name,
        slug: body.slug,
        default_currency: body.default_currency
      });
      return { operator: op };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/operators/:operatorId/domains", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId } = req.params as { operatorId: string };
    const body = (req.body ?? {}) as { domain?: string; environment?: "sandbox" | "prod" };
    if (!body.domain || !body.environment) {
      return reply.code(422).send(envelope("VALIDATION", "domain + environment required", req.id));
    }
    try {
      const d = app.container.mgmt.addDomain(operatorId, body.domain, body.environment);
      return { domain: d };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/operators/:operatorId/credentials", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId } = req.params as { operatorId: string };
    const body = (req.body ?? {}) as { environment?: "sandbox" | "prod"; ip_allowlist?: string[] };
    if (!body.environment) {
      return reply.code(422).send(envelope("VALIDATION", "environment required", req.id));
    }
    try {
      const issued = app.container.mgmt.issueCredential(operatorId, body.environment, body.ip_allowlist ?? []);
      // The raw secret is shown once; the caller must capture it now.
      return {
        credential: issued.credential,
        api_secret: issued.api_secret,
        notice: "The api_secret is shown exactly once. Store it now."
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/games", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const body = (req.body ?? {}) as { code?: string; title?: string };
    if (!body.code || !body.title) {
      return reply.code(422).send(envelope("VALIDATION", "code + title required", req.id));
    }
    try {
      const g = app.container.mgmt.registerGame({ code: body.code, title: body.title });
      return { game: g };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/math-configs", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const body = (req.body ?? {}) as {
      game_id?: string;
      version?: string;
      rtp_profile_key?: string;
      theoretical_rtp?: number;
      config_hash?: string;
    };
    if (
      !body.game_id ||
      !body.version ||
      !body.rtp_profile_key ||
      typeof body.theoretical_rtp !== "number" ||
      !body.config_hash
    ) {
      return reply.code(422).send(envelope("VALIDATION", "game_id, version, rtp_profile_key, theoretical_rtp, config_hash required", req.id));
    }
    try {
      const cfg = app.container.mgmt.createMathConfig({
        game_id: body.game_id,
        version: body.version,
        rtp_profile_key: body.rtp_profile_key,
        theoretical_rtp: body.theoretical_rtp,
        config_hash: body.config_hash
      });
      return { math_config: cfg };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/math-configs/:configId/approve", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { configId } = req.params as { configId: string };
    const body = (req.body ?? {}) as { approver?: string };
    const approver = body.approver ?? ((req.adminClaims as AdminClaims).admin_id);
    try {
      const submitted = app.container.mgmt.submitMathConfigForReview(configId);
      const approved = app.container.mgmt.approveMathConfig(submitted.id, approver);
      return { math_config: approved };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/operators/:operatorId/assignments", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId } = req.params as { operatorId: string };
    const body = (req.body ?? {}) as {
      game_id?: string;
      math_config_id?: string;
      currency?: string;
      jurisdiction?: string;
      allowed_bets?: number[];
    };
    if (!body.game_id || !body.math_config_id || !body.currency || !Array.isArray(body.allowed_bets)) {
      return reply.code(422).send(envelope("VALIDATION", "game_id, math_config_id, currency, allowed_bets required", req.id));
    }
    try {
      const og = app.container.mgmt.assignGame({
        operator_id: operatorId,
        game_id: body.game_id,
        math_config_id: body.math_config_id,
        currency: body.currency,
        jurisdiction: body.jurisdiction,
        allowed_bets: body.allowed_bets
      });
      return { operator_game: og };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Demo helper: open a launch URL for a player so a portal admin can sanity-check
  // an operator end-to-end without having to write a signed launch request.
  app.post("/admin/v1/operators/:operatorId/launch-demo", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId } = req.params as { operatorId: string };
    const body = (req.body ?? {}) as {
      game_code?: string;
      operator_player_id?: string;
      currency?: string;
      origin?: string;
    };
    if (!body.game_code || !body.operator_player_id || !body.currency || !body.origin) {
      return reply.code(422).send(envelope("VALIDATION", "game_code, operator_player_id, currency, origin required", req.id));
    }
    try {
      // Demo launch links are opened by hand, so give them an hour rather than
      // the 60s production single-use default (otherwise the link is dead before
      // the admin can click it).
      const token = app.container.sessions.createLaunchToken(
        {
          operator_id: operatorId,
          game_code: body.game_code,
          operator_player_id: body.operator_player_id,
          currency: body.currency,
          origin: body.origin
        },
        3600
      );
      return { launch_token: token, launch_url: `/play?lt=${token}` };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // ── Identity ────────────────────────────────────────────────────────────────
  // Lets the console know who is signed in (scope + role) so it can show/hide
  // provider-only vs operator actions without decoding the token itself.
  app.get("/admin/v1/me", { preHandler: auth }, async (req) => {
    const claims = req.adminClaims as AdminClaims;
    return {
      admin_id: claims.admin_id,
      scope: claims.scope,
      operator_id: claims.operator_id,
      role: claims.role
    };
  });

  // ── Round verification (dispute backbone) ─────────────────────────────────────
  // Recompute the round from its stored seed and check chain integrity → verdict.
  app.get("/admin/v1/rounds/:roundRef/verify", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "rounds.verify");
    if (!claims) return reply;
    const { roundRef } = req.params as { roundRef: string };
    const round = app.container.ledger.getRound(roundRef);
    if (!round) return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    if (claims.scope === "operator" && claims.operator_id !== round.operator_id) {
      return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    }
    const result = app.container.verification.verify(roundRef);
    if (!result) return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    return result;
  });

  // Full money-movement timeline for one round (the "why wasn't the player paid?" view).
  app.get("/admin/v1/rounds/:roundRef/transactions", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "transactions.read");
    if (!claims) return reply;
    const { roundRef } = req.params as { roundRef: string };
    const round = app.container.ledger.getRound(roundRef);
    if (!round) return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    if (claims.scope === "operator" && claims.operator_id !== round.operator_id) {
      return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    }
    const adjustments = app.container.adjustments.list({ round_ref: roundRef });
    return {
      round_ref: roundRef,
      recorded_status: round.status,
      effective_status: app.container.adjustments.effectiveStatus(roundRef, round.status),
      transactions: app.container.reporting.transactionsForRound(roundRef),
      adjustments
    };
  });

  // Player lookup: every round for one player (support / dispute triage).
  app.get("/admin/v1/players/:playerId/rounds", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "players.read");
    if (!claims) return reply;
    const { playerId } = req.params as { playerId: string };
    const q = req.query as { operator_id?: string };
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    if (!operatorId) {
      return reply.code(422).send(envelope("VALIDATION", "operator_id required", req.id));
    }
    const rounds = app.container.reporting.listRoundsByPlayer(operatorId, playerId).map((r) => ({
      round_ref: r.round_ref,
      operator_id: r.operator_id,
      bet_amount: r.bet_amount,
      bet_charged: r.bet_charged,
      total_win: r.total_win,
      is_free_spin: r.is_free_spin,
      status: r.status,
      effective_status: app.container.adjustments.effectiveStatus(r.round_ref, r.status),
      created_at: r.created_at
    }));
    return { player_id: playerId, operator_id: operatorId, rounds, count: rounds.length };
  });

  // ── Manual round lifecycle (provider only; operators go via disputes) ─────────
  app.post("/admin/v1/rounds/:roundRef/void", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    if (!guard(req, reply, "rounds.write")) return reply;
    const { roundRef } = req.params as { roundRef: string };
    const body = (req.body ?? {}) as { reason?: string };
    if (!body.reason?.trim()) return reply.code(422).send(envelope("VALIDATION", "reason required", req.id));
    try {
      return await app.container.lifecycle.voidRound(roundRef, (req.adminClaims as AdminClaims).admin_id, body.reason.trim());
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/rounds/:roundRef/settle", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    if (!guard(req, reply, "rounds.write")) return reply;
    const { roundRef } = req.params as { roundRef: string };
    const body = (req.body ?? {}) as { reason?: string };
    if (!body.reason?.trim()) return reply.code(422).send(envelope("VALIDATION", "reason required", req.id));
    try {
      return await app.container.lifecycle.settleRound(roundRef, (req.adminClaims as AdminClaims).admin_id, body.reason.trim());
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // ── Disputes ──────────────────────────────────────────────────────────────────
  app.get("/admin/v1/disputes", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "disputes.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string; status?: "open" | "approved" | "rejected" };
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    const disputes = app.container.disputes.list({ operator_id: operatorId, status: q.status });
    return { disputes, count: disputes.length };
  });

  // Operator raises a dispute against one of their rounds.
  app.post("/admin/v1/disputes", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "disputes.raise");
    if (!claims) return reply;
    const body = (req.body ?? {}) as { round_ref?: string; kind?: "void" | "settle"; reason?: string; operator_id?: string };
    if (!body.round_ref || !body.kind || !body.reason?.trim()) {
      return reply.code(422).send(envelope("VALIDATION", "round_ref, kind, reason required", req.id));
    }
    const operatorId = resolveOperatorScope(claims, body.operator_id);
    if (!operatorId) return reply.code(422).send(envelope("VALIDATION", "operator_id required", req.id));
    try {
      const dispute = app.container.disputes.raise({
        operator_id: operatorId,
        round_ref: body.round_ref,
        kind: body.kind,
        reason: body.reason.trim(),
        requested_by: claims.admin_id
      });
      return { dispute };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/disputes/:id/approve", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    if (!guard(req, reply, "disputes.resolve")) return reply;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { note?: string };
    try {
      const dispute = await app.container.disputes.approve(id, (req.adminClaims as AdminClaims).admin_id, body.note ?? "");
      return { dispute };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/disputes/:id/reject", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    if (!guard(req, reply, "disputes.resolve")) return reply;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { note?: string };
    if (!body.note?.trim()) return reply.code(422).send(envelope("VALIDATION", "note required", req.id));
    try {
      const dispute = app.container.disputes.reject(id, (req.adminClaims as AdminClaims).admin_id, body.note.trim());
      return { dispute };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // ── Operator lifecycle (provider only) ────────────────────────────────────────
  app.post("/admin/v1/operators/:operatorId/status", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId } = req.params as { operatorId: string };
    const body = (req.body ?? {}) as { status?: "sandbox" | "live" | "suspended" };
    if (!body.status) return reply.code(422).send(envelope("VALIDATION", "status required", req.id));
    try {
      return { operator: app.container.mgmt.setOperatorStatus(operatorId, body.status) };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // List an operator's credentials (secrets never returned) so the portal can manage them.
  app.get("/admin/v1/operators/:operatorId/credentials", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "operators.read");
    if (!claims) return reply;
    if (claims.scope !== "provider") {
      return reply.code(403).send(envelope("FORBIDDEN", "provider scope required", req.id));
    }
    const { operatorId } = req.params as { operatorId: string };
    return { credentials: app.container.mgmt.listCredentials(operatorId) };
  });

  app.post("/admin/v1/operators/:operatorId/credentials/:apiKeyId/revoke", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId, apiKeyId } = req.params as { operatorId: string; apiKeyId: string };
    try {
      return { credential: app.container.mgmt.revokeCredential(operatorId, apiKeyId) };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/admin/v1/operators/:operatorId/credentials/:apiKeyId/rotate", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    const { operatorId, apiKeyId } = req.params as { operatorId: string; apiKeyId: string };
    try {
      const issued = app.container.mgmt.rotateCredential(operatorId, apiKeyId);
      return { credential: issued.credential, api_secret: issued.api_secret, notice: "The api_secret is shown exactly once. Store it now." };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // ── Game on/off ───────────────────────────────────────────────────────────────
  // List assignments (both scopes; operators forced to their own operator).
  app.get("/admin/v1/operator-games", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "games.read");
    if (!claims) return reply;
    const q = req.query as { operator_id?: string };
    const operatorId = resolveOperatorScope(claims, q.operator_id);
    if (!operatorId) return reply.code(422).send(envelope("VALIDATION", "operator_id required", req.id));
    return { operator_games: app.container.mgmt.listOperatorGames(operatorId) };
  });

  // Toggle a game on/off. Operators may toggle their OWN assignments; provider any.
  app.post("/admin/v1/operator-games/:id/status", { preHandler: auth }, async (req, reply) => {
    const claims = guard(req, reply, "games.toggle");
    if (!claims) return reply;
    const { id } = req.params as { id: string };
    const body = (req.body ?? {}) as { status?: "enabled" | "disabled" };
    if (!body.status) return reply.code(422).send(envelope("VALIDATION", "status required", req.id));
    const og = app.container.mgmt.getOperatorGame(id);
    if (!og) return reply.code(404).send(envelope("OPERATOR_GAME_NOT_FOUND", "no such assignment", req.id));
    if (claims.scope === "operator" && claims.operator_id !== og.operator_id) {
      return reply.code(404).send(envelope("OPERATOR_GAME_NOT_FOUND", "no such assignment", req.id));
    }
    try {
      return { operator_game: app.container.mgmt.setOperatorGameStatus(id, body.status, claims.admin_id) };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // ── Ledger integrity (provider only) ──────────────────────────────────────────
  app.get("/admin/v1/integrity", { preHandler: auth }, async (req, reply) => {
    if (!requireProvider(req, reply)) return reply;
    return app.container.ledger.verifyIntegrity();
  });
};

function adminAuthPreHandler(container: Container): preHandlerHookHandler {
  return async (req, reply) => {
    const auth = req.headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      return reply.code(401).send(envelope("UNAUTHORIZED", "admin token required", req.id));
    }
    try {
      req.adminClaims = container.adminAuth.verify(auth.slice(7));
    } catch {
      return reply.code(401).send(envelope("UNAUTHORIZED", "invalid admin token", req.id));
    }
  };
}

export default adminRoutes;
