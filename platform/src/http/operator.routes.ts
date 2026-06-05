import type { FastifyPluginAsync } from "fastify";
import { operatorHmacAuth } from "./auth";
import { envelope, sendDomainError } from "./errors";

interface LaunchBody {
  game_code?: string;
  operator_player_id?: string;
  currency?: string;
  origin?: string;
}

/** Operator (server-to-server) API — HMAC-signed. Currently: game launch. */
const operatorRoutes: FastifyPluginAsync = async (app) => {
  const auth = operatorHmacAuth(app.container);

  app.post("/operator/v1/launch", { preHandler: auth }, async (req, reply) => {
    const body = (req.body ?? {}) as LaunchBody;
    if (!body.game_code || !body.operator_player_id || !body.currency || !body.origin) {
      return reply.code(422).send(envelope("VALIDATION", "game_code, operator_player_id, currency, origin required", req.id));
    }
    try {
      const launchToken = app.container.sessions.createLaunchToken({
        operator_id: req.operatorId as string,
        game_code: body.game_code,
        operator_player_id: body.operator_player_id,
        currency: body.currency,
        origin: body.origin
      });
      return { launch_token: launchToken, expires_in: 60 };
    } catch (err) {
      return sendDomainError(reply, err, req.id);
    }
  });
};

export default operatorRoutes;
