import Fastify, { LogController, type FastifyInstance, type FastifyBaseLogger, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import type { Container } from "./container";
import healthRoutes from "./modules/health/health.routes";
import operatorRoutes from "./http/operator.routes";
import gameRoutes from "./http/game.routes";
import adminRoutes from "./http/admin.routes";
import adminCampaignRoutes from "./http/admin-campaigns.routes";
import { startCampaignExpiry, type CampaignExpiryJob } from "./jobs/campaign-expiry";
import { startRoundRecovery, type RoundRecoveryJob } from "./jobs/round-recovery";
import { startDebitReconciliation, type DebitReconciliationJob } from "./jobs/debit-reconciliation";
import { installObservability, traceForRaw } from "./http/observability";
import { metrics } from "./lib/metrics";
import { NullPersistence } from "./persistence/persistence";
import adminAuthRoutes from "./http/admin-auth.routes";
import adminAccountRoutes from "./http/admin-accounts.routes";
import adminAssetsRoutes from "./http/admin-assets";
import providerConsoleRoutes from "./http/provider-console";
import operatorConsoleRoutes from "./http/operator-console";
import playPageRoutes from "./http/play-page";
import staticAssetsRoutes from "./http/static-assets";
import { installSecurityHeaders, safeJsonParse, BODY_LIMIT_BYTES } from "./http/security-headers";
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
  /** Postgres mode: full ledger integrity sweep interval (default 1 h; 0 = never). */
  integritySweepIntervalMs?: number;
  /** When set, GET /metrics requires `Authorization: Bearer <token>`. */
  metricsToken?: string;
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
    // Every log line of a request (Fastify's own "incoming request" / "request completed"
    // included) carries its W3C trace: the context is built here, when the request's
    // logger is, and the onRequest hook (http/observability.ts) makes it current.
    childLoggerFactory: (logger, bindings, opts, rawReq) => {
      const ctx = traceForRaw(rawReq);
      return logger.child({ ...bindings, trace_id: ctx.traceId, span_id: ctx.spanId }, opts);
    },
    trustProxy: true,
    bodyLimit: BODY_LIMIT_BYTES
  });
  installSecurityHeaders(app);

  // Keep the raw body so we can verify HMAC signatures over the exact bytes signed.
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (req as { rawBody?: string }).rawBody = raw;
    try {
      done(null, raw.length ? safeJsonParse(raw) : {});
    } catch (err) {
      (err as FastifyError).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.decorate("container", deps.container);
  // Trace context, request metrics, the structured money log and GET /metrics.
  installObservability(app, deps.container, { metricsToken: deps.metricsToken });

  // Background expiry of lapsed free-round grants: starts when the app is ready,
  // stops when it closes.
  let expiryJob: CampaignExpiryJob | null = null;
  let reconcileJob: DebitReconciliationJob | null = null;
  let recoveryJob: RoundRecoveryJob | null = null;
  const housekeeping: Array<ReturnType<typeof setInterval>> = [];
  app.addHook("onReady", async () => {
    expiryJob = startCampaignExpiry({
      campaigns: deps.container.campaigns,
      persistence: deps.container.persistence,
      logger: app.log,
      intervalMs: deps.campaignExpiryIntervalMs ?? 60_000
    });
    // Rounds a crash left between the casino and our ledger (write-ahead intents):
    // reverse a stake whose round never committed, re-credit a committed win.
    recoveryJob = startRoundRecovery({
      intents: deps.container.intents,
      ledger: deps.container.ledger,
      transactions: deps.container.transactions,
      debits: deps.container.debits,
      wallet: deps.container.wallet,
      persistence: deps.container.persistence,
      isInFlight: (key) => deps.container.orchestrator.isInFlight(key),
      logger: app.log,
      intervalMs: deps.debitReconcileIntervalMs ?? 30_000
    });
    // Bounded memory (Postgres mode): forget sessions no token can reach (and their
    // reality-check totals), and re-verify both ledgers end to end in the background.
    if (deps.container.historyWindow) {
      const c = deps.container;
      housekeeping.push(setInterval(() => {
        for (const id of c.sessions.evictIdle()) c.roundsRepo.dropSessionStats(id);
      }, 60_000));
      const sweepEvery = deps.integritySweepIntervalMs ?? 3_600_000;
      if (sweepEvery > 0) {
        const sweep = () => void c.history.verifyIntegrity().then(
          (r) => { if (!r.rounds.ok || !r.audit.ok || r.signatures?.rounds.ok === false || r.signatures?.audit.ok === false) app.log.error({ integrity: r }, "ledger_integrity_failed"); },
          (err) => app.log.error({ err }, "integrity_sweep_failed")
        );
        housekeeping.push(setTimeout(sweep, Math.min(sweepEvery, 300_000)));
        housekeeping.push(setInterval(sweep, sweepEvery));
      }
      for (const t of housekeeping) (t as NodeJS.Timeout).unref?.();
    }
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
    recoveryJob?.stop();
    for (const t of housekeeping) clearInterval(t);
  });

  // Durable write-through: before the response leaves, commit what this request
  // changed (one flush at a time, group-committed; see persistence.ts). A response is
  // a promise to the client, so a success is never sent for state that is not durable:
  // if this request's rows did not commit, it answers 503 PERSISTENCE_UNAVAILABLE
  // instead (retryable: a retry with the same idempotency key replays the round once
  // its rows are in, and a crash before that is unwound by the boot-time recovery).
  const persistenceOn = deps.container.persistence !== NullPersistence;
  app.addHook("onSend", async (req, reply, payload) => {
    if (!persistenceOn) return payload;
    const started = performance.now();
    try {
      await deps.container.persistence.flush();
      metrics.dbFlush.observe((performance.now() - started) / 1000, { outcome: "ok" });
      return payload;
    } catch (err) {
      metrics.dbFlush.observe((performance.now() - started) / 1000, { outcome: "failed" });
      req.log.error({ err }, "persistence_flush_failed");
      if (reply.statusCode >= 400) return payload; // already a failure: nothing was promised
      reply.code(503).header("retry-after", "1").header("content-type", "application/json; charset=utf-8");
      return JSON.stringify({
        error: { code: "PERSISTENCE_UNAVAILABLE", message: "The result could not be saved yet; retry with the same idempotency key.", retryable: true, request_id: req.id }
      });
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
