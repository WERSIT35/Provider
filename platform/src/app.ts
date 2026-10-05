import Fastify, { LogController, type FastifyInstance, type FastifyBaseLogger, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import type { Container } from "./container";
import healthRoutes from "./modules/health/health.routes";
import operatorRoutes from "./http/operator.routes";
import gameRoutes from "./http/game.routes";
import adminRoutes from "./http/admin.routes";
import adminCampaignRoutes from "./http/admin-campaigns.routes";
import { startCampaignExpiry, type CampaignExpiryJob } from "./jobs/campaign-expiry";
import { startDebitReconciliation, type DebitReconciliationJob } from "./jobs/debit-reconciliation";
import adminAuthRoutes from "./http/admin-auth.routes";
import adminAccountRoutes from "./http/admin-accounts.routes";
import adminAssetsRoutes from "./http/admin-assets";
import providerConsoleRoutes from "./http/provider-console";
import operatorConsoleRoutes from "./http/operator-console";
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
  /** Free-round grant expiry sweep interval (default 60s; 0 = start-up sweep only). */
  campaignExpiryIntervalMs?: number;
  /** Retry interval for queued lost-debit reversals (default 30s; 0 = start-up sweep only). */
  debitReconcileIntervalMs?: number;
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
    logController: new LogController({ requestIdLogLabel: "request_id" }),
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

  // Background expiry of lapsed free-round grants: starts when the app is ready,
  // stops when it closes.
  let expiryJob: CampaignExpiryJob | null = null;
  let reconcileJob: DebitReconciliationJob | null = null;
  app.addHook("onReady", async () => {
    expiryJob = startCampaignExpiry({
      campaigns: deps.container.campaigns,
      persistence: deps.container.persistence,
      logger: app.log,
      intervalMs: deps.campaignExpiryIntervalMs ?? 60_000
    });
    reconcileJob = startDebitReconciliation({
      debits: deps.container.debits,
      sessions: deps.container.sessions,
      persistence: deps.container.persistence,
      logger: app.log,
      intervalMs: deps.debitReconcileIntervalMs ?? 30_000
    });
  });
  app.addHook("onClose", async () => {
    expiryJob?.stop();
    reconcileJob?.stop();
  });

  // Durable write-through: after handling each request, flush any queued mutations
  // to Postgres in one transaction. No-op when persistence is disabled (in-memory).
  // A flush failure is logged, not surfaced — the batch is re-queued for the next
  // request so a transient DB hiccup never fails an otherwise-successful spin.
  app.addHook("onSend", async (req) => {
    try {
      await deps.container.persistence.flush();
    } catch (err) {
      req.log.error({ err }, "persistence_flush_failed");
    }
  });

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
  app.register(adminAssetsRoutes);
  app.register(providerConsoleRoutes);
  app.register(operatorConsoleRoutes);
  app.register(playPageRoutes);
  app.register(operatorRoutes);
  app.register(gameRoutes);
  app.register(adminAuthRoutes);
  app.register(adminAccountRoutes);
  app.register(adminRoutes);
  app.register(adminCampaignRoutes);

  return app;
}
