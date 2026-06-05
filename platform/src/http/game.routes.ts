import type { FastifyPluginAsync } from "fastify";
import { gameBearerAuth } from "./auth";
import { envelope, sendDomainError } from "./errors";
import { signToken } from "../lib/tokens";

interface SpinBody {
  bet_amount?: number;
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
      const session = app.container.sessions.initSession(auth.slice(7));
      const sessionToken = signToken(
        app.container.config.sessionSecret,
        { session_id: session.id, operator_id: session.operator_id },
        3600
      );
      const balance = await app.container.wallet.balance(
        { operatorId: session.operator_id },
        { operatorPlayerId: session.operator_player_id, currency: session.currency }
      );
      return {
        session_token: sessionToken,
        session_id: session.id,
        currency: session.currency,
        allowed_bets: session.allowed_bets,
        balance,
        free_spins_left: session.free_spins_left,
        game: { code: session.game_code, math_config_id: session.math_config_id }
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  app.post("/game/v1/spin", { preHandler: bearer }, async (req, reply) => {
    const idem = req.headers["idempotency-key"];
    if (typeof idem !== "string" || idem.length === 0) {
      return reply.code(422).send(envelope("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header required", req.id));
    }
    const body = (req.body ?? {}) as SpinBody;
    if (typeof body.bet_amount !== "number") {
      return reply.code(422).send(envelope("VALIDATION", "bet_amount (number) required", req.id));
    }
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
        idempotent_replay: outcome.idempotent_replay
      };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });

  // Round lookup is tenant-scoped to the session's operator.
  app.get("/game/v1/rounds/:ref", { preHandler: bearer }, async (req, reply) => {
    const ref = (req.params as { ref: string }).ref;
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
