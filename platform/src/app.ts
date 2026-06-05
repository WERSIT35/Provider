import Fastify, { type FastifyInstance, type FastifyBaseLogger, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import type { Container } from "./container";
import healthRoutes from "./modules/health/health.routes";
import operatorRoutes from "./http/operator.routes";
import gameRoutes from "./http/game.routes";
import adminRoutes from "./http/admin.routes";
import adminConsoleRoutes from "./http/admin-console";
import playPageRoutes from "./http/play-page";
import staticAssetsRoutes from "./http/static-assets";
import type { AdminClaims } from "./modules/admin/admin-auth";

// Shared container + per-request auth context.
declare module "fastify" {
  interface FastifyInstance {
    container: Container;
  }
  interface FastifyRequest {
    rawBody?: string;
    operatorId?: string;
    apiKeyId?: string;
    sessionId?: string;
    adminClaims?: AdminClaims;
  }
}

export interface BuildAppDeps {
  logger: FastifyBaseLogger;
  container: Container;
}

/**
 * Composition root for the HTTP app: health probes, the HMAC-signed Operator API,
 * and the session-scoped Game API. Auth/rate-limit/replay protection live in the
 * route preHandlers (src/http/auth.ts).
 */
export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const app = Fastify({
    loggerInstance: deps.logger,
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "request_id",
    genReqId: () => randomUUID(),
    trustProxy: true
  });

  // Keep the raw body so we can verify HMAC signatures over the exact bytes signed.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (req as { rawBody?: string }).rawBody = raw;
    try {
      done(null, raw.length ? JSON.parse(raw) : {});
    } catch (err) {
      (err as FastifyError).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.decorate("container", deps.container);

  app.setErrorHandler((err: FastifyError, req, reply) => {
    req.log.error({ err }, "request_failed");
    const status = err.statusCode && err.statusCode >= 400 ? err.statusCode : 500;
    reply.code(status).send({
      error: {
        code: status >= 500 ? "INTERNAL_ERROR" : err.code ?? "BAD_REQUEST",
        message: status >= 500 ? "Internal error" : err.message,
        request_id: req.id
      }
    });
  });

  app.register(healthRoutes);
  app.register(staticAssetsRoutes);
  app.register(adminConsoleRoutes);
  app.register(playPageRoutes);
  app.register(operatorRoutes);
  app.register(gameRoutes);
  app.register(adminRoutes);

  return app;
}
