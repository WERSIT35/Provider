import type { FastifyPluginAsync } from "fastify";
import { SESSION_TOKEN_TTL_S } from "../modules/session/session.service";
import { gameBearerAuth } from "./auth";
import { envelope, sendDomainError } from "./errors";
import { checkBody, isIdempotencyKey, SPIN_BODY, BUY_BODY } from "./validation";
import { signToken } from "../lib/tokens";
import type { Session } from "../modules/session/session.service";

/** Validated by checkBody (SPIN_BODY / BUY_BODY): exactly these fields, bet required. */
interface SpinBody {
  bet_amount: number;
  ante_enabled?: boolean;
}

/** Game-client API: exchange a launch token for a session, then spin. */
const gameRoutes: FastifyPluginAsync = async (app) => {
  const bearer = gameBearerAuth(app.container);

  // session/init authenticates with the LAUNCH token (single-use handoff), then
  // issues a session token the client uses for subsequent calls.
  app.post("/game/v1/session/init", async (req, reply) => {
    const auth = req.headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      return reply.code(401).send(envelope("UNAUTHORIZED", "launch token required", req.id));
    }
    try {
      const { session, resumed } = app.container.sessions.initSessionDetailed(auth.slice(7));
      app.container.games.engineFor(session.game_code); // GAME_NOT_FOUND (404) before any token or balance call
      const sessionToken = signToken(
        app.container.config.sessionSecret,
        { session_id: session.id, operator_id: session.operator_id },
        SESSION_TOKEN_TTL_S
      );
      return { session_token: sessionToken, ...(await sessionState(session, resumed)) };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Reload without a launch token: the client keeps its session token and asks for
  // the session's current state (the launch token is a 60s handoff and is usually
  // expired by the time a player refreshes). Opens nothing new.
  app.get("/game/v1/session", { preHandler: bearer }, async (req, reply) => {
    try {
      const session = app.container.sessions.get(req.sessionId as string);
      return await sessionState(session, true);
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  /**
   * Everything the client needs to put the player back where they were: balance,
   * free rounds, and `resume` — the bet + ante to show and any unfinished feature.
   * Inside a feature the bet/ante are the LOCKED terms (the server plays them
   * whatever the client sends). Otherwise they are the player's last cash round in
   * this game and currency (any session; a free round's bet was the casino's, so it is skipped),
   * when that bet is still allowed. null bet = nothing to restore.
   */
  async function sessionState(session: Session, resumed: boolean) {
    const balance = await app.container.wallet.balance(
      { operatorId: session.operator_id },
      { operatorPlayerId: session.operator_player_id, currency: session.currency }
    );
    const inFeature = session.free_spins_left > 0;
    let bet: number | null = null;
    let ante = false;
    if (inFeature && session.locked_bet != null) {
      bet = session.locked_bet;
      ante = Boolean(session.locked_ante);
    } else {
      // Same game AND currency: a 10.00 GEL bet is not a 10.00 EUR bet.
      const last = app.container.reporting
        .listRoundsByPlayer(session.operator_id, session.operator_player_id)
        .find(
          (r) =>
            !r.is_free_spin &&
            !r.campaign_id &&
            (r.pre_state?.game_code ?? session.game_code) === session.game_code &&
            app.container.sessions.tryGet(r.session_id)?.currency === session.currency
        );
      if (last && session.allowed_bets.includes(last.bet_amount)) {
        bet = last.bet_amount;
        ante = last.ante_enabled;
      }
    }
    return {
      session_id: session.id,
      currency: session.currency,
      allowed_bets: session.allowed_bets,
      balance,
      free_spins_left: session.free_spins_left,
      resume: {
        resumed,
        bet_amount: bet,
        ante_enabled: ante,
        feature: inFeature
          ? {
              free_spins_left: session.free_spins_left,
              locked_bet: session.locked_bet,
              locked_ante: session.locked_ante,
              feature_ref: session.locked_feature_ref ?? null,
              multiplier_bank: session.free_spin_multiplier_carry,
              bonus_round_win: session.bonus_round_win ?? 0
            }
          : null
      },
      // Operator-granted free rounds waiting for this player (Campaign Manager).
      free_rounds: app.container.campaigns
        .available({
          operator_id: session.operator_id,
          operator_player_id: session.operator_player_id,
          game_id: session.game_id,
          currency: session.currency
        })
        .map(({ grant, campaign }) => ({
          campaign_id: campaign.id,
          name: campaign.name,
          bet_amount: campaign.bet_amount,
          spins_remaining: grant.spins_remaining,
          valid_to: campaign.valid_to
        })),
      game: { code: session.game_code, math_config_id: session.math_config_id },
      // The casino hosts the client may talk to over postMessage (the same list
      // /play's frame-ancestors allows); see client/embed-bridge.js.
      embed: { allowed_hosts: app.container.mgmt.embedHosts(session.operator_id) },
      // The jurisdiction rules the client must apply (autoplay / turbo / buy switches,
      // round pacing) and when the next reality check is due. The RGS enforces pacing,
      // the reality check and the buy switch itself regardless.
      regulatory: {
        ...app.container.regulatory.profile(session.operator_id),
        reality_check_due_in_ms: app.container.regulatory.realityCheckDueIn(session)
      }
    };
  }

  // The reality check's figures, for the client to show when its own timer fires.
  app.get("/game/v1/reality-check", { preHandler: bearer }, async (req, reply) => {
    try {
      return app.container.regulatory.status(app.container.sessions.get(req.sessionId as string));
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // The player saw the reality check (REALITY_CHECK_REQUIRED, or the client's own
  // timer) and chose to keep playing: the next one is a full interval away.
  app.post("/game/v1/reality-check/ack", { preHandler: bearer }, async (req, reply) => {
    try {
      const session = app.container.sessions.get(req.sessionId as string);
      return app.container.regulatory.acknowledgeRealityCheck(session);
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/game/v1/spin", { preHandler: bearer }, async (req, reply) => {
    const idem = req.headers["idempotency-key"];
    if (!isIdempotencyKey(idem)) {
      return reply.code(422).send(envelope("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required: 1-128 chars of A-Z a-z 0-9 . _ : -", req.id));
    }
    const checked = checkBody<SpinBody>(req.body, SPIN_BODY);
    if (!checked.ok) return reply.code(422).send(envelope("VALIDATION", checked.message, req.id));
    const body = checked.body;
    try {
      const outcome = await app.container.orchestrator.spin(req.sessionId as string, {
        bet_amount: body.bet_amount,
        ante_enabled: Boolean(body.ante_enabled),
        idempotency_key: idem
      });
      reply.header("idempotent-replay", String(outcome.idempotent_replay));
      // Return the full engine SpinResult so a rich client (the canvas game)
      // can animate the round verbatim, plus money-side metadata the platform
      // owns (round_ref, settled balance, settlement state, idempotency).
      return {
        ...outcome.result,
        round_ref: outcome.round_ref,
        outcome_hash: outcome.outcome_hash,
        bet_charged: outcome.bet_charged,
        total_win: outcome.total_win,
        balance: outcome.balance,
        free_spins_left: outcome.free_spins_left,
        settlement: outcome.settlement,
        idempotent_replay: outcome.idempotent_replay,
        free_round: outcome.free_round
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Buy Free Spins — pay bet × buy-cost to force the bonus immediately. Same
  // server-authoritative, idempotent lifecycle as a spin.
  app.post("/game/v1/buy-feature", { preHandler: bearer }, async (req, reply) => {
    const idem = req.headers["idempotency-key"];
    if (!isIdempotencyKey(idem)) {
      return reply.code(422).send(envelope("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required: 1-128 chars of A-Z a-z 0-9 . _ : -", req.id));
    }
    const checked = checkBody<SpinBody>(req.body, BUY_BODY);
    if (!checked.ok) return reply.code(422).send(envelope("VALIDATION", checked.message, req.id));
    const body = checked.body;
    try {
      const outcome = await app.container.orchestrator.buyFeature(req.sessionId as string, {
        bet_amount: body.bet_amount,
        idempotency_key: idem
      });
      reply.header("idempotent-replay", String(outcome.idempotent_replay));
      return {
        ...outcome.result,
        round_ref: outcome.round_ref,
        outcome_hash: outcome.outcome_hash,
        bet_charged: outcome.bet_charged,
        total_win: outcome.total_win,
        balance: outcome.balance,
        free_spins_left: outcome.free_spins_left,
        settlement: outcome.settlement,
        idempotent_replay: outcome.idempotent_replay
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Round lookup is tenant-scoped to the session's operator.
  app.get("/game/v1/rounds/:ref", { preHandler: bearer }, async (req, reply) => {
    const ref = (req.params as { ref: string }).ref;
    await app.container.history.ensureRound(ref);
    const round = app.container.ledger.getRound(ref);
    let operatorId: string | null = null;
    try {
      operatorId = app.container.sessions.get(req.sessionId as string).operator_id;
    } catch {
      operatorId = null;
    }
    if (!round || !operatorId || round.operator_id !== operatorId) {
      return reply.code(404).send(envelope("ROUND_NOT_FOUND", "no such round", req.id));
    }
    return {
      round_ref: round.round_ref,
      bet_amount: round.bet_amount,
      total_win: round.total_win,
      multiplier_applied: round.multiplier_applied,
      outcome_hash: round.outcome_hash,
      status: round.status,
      created_at: round.created_at
    };
  });
};

export default gameRoutes;
