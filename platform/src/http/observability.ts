import type { FastifyInstance } from "fastify";
import type { IncomingMessage } from "node:http";
import type { Container } from "../container";
import { contextFrom, enterTrace, formatTraceparent, type TraceContext } from "../lib/trace-context";
import { metrics, renderMetrics } from "../lib/metrics";

declare module "fastify" {
  interface FastifyRequest {
    trace?: TraceContext;
  }
}

const RAW_TRACE = Symbol("traceContext");

/**
 * The request's trace context, built once per raw request: by the logger factory
 * (app.ts childLoggerFactory) or, failing that, by the onRequest hook.
 */
export function traceForRaw(raw: IncomingMessage): TraceContext {
  const holder = raw as IncomingMessage & { [RAW_TRACE]?: TraceContext };
  if (!holder[RAW_TRACE]) holder[RAW_TRACE] = contextFrom(raw.headers.traceparent);
  return holder[RAW_TRACE] as TraceContext;
}

/**
 * SRE wiring for the RGS (installed on the root app, so it covers every route):
 *
 *   • W3C Trace Context: each request continues the caller's `traceparent` (the game
 *     client starts one per round) or starts a trace; the span becomes the current
 *     trace (AsyncLocalStorage), is bound to the request logger (trace_id, span_id),
 *     is echoed as `traceparent` on the response, and flows on to the casino's wallet
 *     webhooks and onto every wallet_transactions row.
 *   • Structured money log: one JSON line per wallet transaction ({ event: "wallet.tx" }).
 *   • Prometheus metrics at GET /metrics (src/lib/metrics.ts). With `metricsToken` set,
 *     the scrape must send `Authorization: Bearer <token>`.
 */
export function installObservability(app: FastifyInstance, container: Container, opts: { metricsToken?: string } = {}): void {
  app.addHook("onRequest", async (req, reply) => {
    const ctx = traceForRaw(req.raw);
    enterTrace(ctx);
    req.trace = ctx;
    reply.header("traceparent", formatTraceparent(ctx.traceId, ctx.spanId, ctx.sampled));
  });

  app.addHook("onResponse", async (req, reply) => {
    const route = req.routeOptions?.url ?? "unmatched";
    const status = `${Math.floor(reply.statusCode / 100)}xx`;
    metrics.httpRequests.inc({ method: req.method, route, status });
    metrics.httpDuration.observe(reply.elapsedTime / 1000, { method: req.method, route });
  });

  container.transactions.onRecord((tx) => {
    metrics.walletTx.inc({ type: tx.type, status: tx.status });
    app.log.info(
      {
        event: "wallet.tx",
        tx_id: tx.id,
        seq: tx.seq,
        type: tx.type,
        status: tx.status,
        amount: tx.amount,
        currency: tx.currency,
        operator_id: tx.operator_id,
        session_id: tx.session_id,
        round_ref: tx.round_ref,
        idempotency_key: tx.idempotency_key,
        operator_tx_ref: tx.operator_tx_ref ?? null,
        error_code: tx.error_code ?? null,
        campaign_id: tx.campaign_id ?? null,
        trace_id: tx.trace_id ?? null
      },
      "wallet_tx"
    );
  });

  const started = Date.now();
  metrics.activeSessions.bind(() => container.sessions.countActive());
  metrics.pendingReversals.bind(() => container.transactions.listPendingReversals().length);
  metrics.failedSettlements.bind(() => container.transactions.listFailedSettlements().length);
  metrics.processUptime.bind(() => (Date.now() - started) / 1000);

  app.get("/metrics", async (req, reply) => {
    if (opts.metricsToken && req.headers.authorization !== `Bearer ${opts.metricsToken}`) {
      return reply.code(401).send({ error: { code: "UNAUTHORIZED", message: "metrics token required", request_id: req.id } });
    }
    return reply.type("text/plain; version=0.0.4; charset=utf-8").send(renderMetrics());
  });
}
