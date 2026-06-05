import type { FastifyPluginAsync } from "fastify";

/**
 * Liveness (`/health`) and readiness (`/health/ready`) probes.
 * Liveness = process is up. Readiness = engine math is loaded and resolvable.
 */
const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get("/health", async () => ({
    status: "ok",
    uptime_s: Math.round(process.uptime()),
    ts: new Date().toISOString()
  }));

  app.get("/health/ready", async (_req, reply) => {
    const engine = app.container.engine;
    if (!engine.isReady()) {
      return reply.code(503).send({ status: "unavailable", reason: "engine_not_loaded" });
    }
    return {
      status: "ready",
      rules_version: engine.rulesVersion(),
      allowed_bets: engine.getAllowedBets()
    };
  });
};

export default healthRoutes;
