import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { verifyPlayerToken } from "../lib/player-session";
import type { DemoOperatorConfig } from "../config";

declare module "fastify" {
  interface FastifyRequest {
    playerId?: string;
  }
}

/** Bearer-token auth for the logged-in player's own API calls (/api/*). */
export function playerBearerAuth(cfg: DemoOperatorConfig): preHandlerHookHandler {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const auth = req.headers["authorization"];
    if (typeof auth !== "string" || !auth.startsWith("Bearer ")) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "sign in first" } });
    }
    try {
      req.playerId = verifyPlayerToken(cfg.sessionSecret, auth.slice(7));
    } catch {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "invalid or expired session" } });
    }
  };
}
