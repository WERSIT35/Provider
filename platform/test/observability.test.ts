import { describe, it, expect, beforeEach } from "vitest";
import { Writable } from "node:stream";
import pino from "pino";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { WebhookWallet } from "../src/modules/wallet/webhook-wallet";
import { parseTraceparent } from "../src/lib/trace-context";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const CLIENT_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const CLIENT_TP = `00-${CLIENT_TRACE}-00f067aa0ba902b7-01`;

let app: FastifyInstance;
let c: Container;
let opId: string;
let logLines: Array<Record<string, unknown>>;
let webhookHeaders: Array<Record<string, string>>;
let key = 0;

/** A pino logger whose JSON lines land in `logLines`. */
function capturingLogger(): FastifyBaseLogger {
  logLines = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      for (const line of String(chunk).split("\n").filter(Boolean)) logLines.push(JSON.parse(line));
      cb();
    }
  });
  return pino({ level: "info" }, sink) as unknown as FastifyBaseLogger;
}

async function setup(opts: { webhook?: boolean; metricsToken?: string } = {}) {
  webhookHeaders = [];
  const sandbox = new SandboxWallet();
  // A casino wallet that answers every webhook, recording the request headers.
  const fakeCasino: typeof fetch = async (input, init) => {
    webhookHeaders.push(Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>)));
    const action = new URL(String(input)).pathname.split("/").pop();
    const body = JSON.parse(String(init?.body ?? "{}"));
    const answer = action === "balance" ? { amount: 1000, currency: "GEL" } : { operatorTxRef: `tx_${key++}`, status: action === "rollback" ? "rolled_back" : "confirmed", balanceAfter: { amount: 1000, currency: body.currency } };
    return new Response(JSON.stringify(answer), { status: 200, headers: { "content-type": "application/json" } });
  };
  c = buildContainer(CONFIG, opts.webhook ? { walletFactory: (mgmt) => new WebhookWallet(mgmt, { fetchImpl: fakeCasino }) } : { wallet: sandbox });
  app = buildApp({ logger: capturingLogger(), container: c, debitReconcileIntervalMs: 0, metricsToken: opts.metricsToken });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  if (opts.webhook) c.mgmt.setWebhook(op.id, "http://casino.test/wallet/p");
  sandbox.setBalance("p1", "GEL", 1_000);
}

async function sessionToken(): Promise<string> {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  return (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token;
}
const spin = (token: string, traceparent?: string) =>
  app.inject({
    method: "POST",
    url: "/game/v1/spin",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `k${key++}`, ...(traceparent ? { traceparent } : {}) },
    payload: JSON.stringify({ bet_amount: 1 })
  });

describe("trace context", () => {
  beforeEach(() => setup());

  it("continues the caller's trace with a new span, and echoes traceparent", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz", headers: { traceparent: CLIENT_TP } });
    const tp = parseTraceparent(res.headers.traceparent);
    expect(tp?.traceId).toBe(CLIENT_TRACE);
    expect(tp?.spanId).not.toBe("00f067aa0ba902b7");
  });

  it("starts a new trace when there is none or it is malformed", async () => {
    for (const header of [undefined, "garbage", `00-${"0".repeat(32)}-00f067aa0ba902b7-01`, "01-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7"]) {
      const res = await app.inject({ method: "GET", url: "/healthz", headers: header ? { traceparent: header } : {} });
      const tp = parseTraceparent(res.headers.traceparent);
      expect(tp, String(header)).not.toBeNull();
      expect(tp!.traceId).not.toBe(CLIENT_TRACE);
    }
  });

  it("stamps the round's money moves and the structured wallet log with the client's trace", async () => {
    const token = await sessionToken();
    expect((await spin(token, CLIENT_TP)).statusCode).toBe(200);
    const debit = c.transactions.list({ operator_id: opId }).find((t) => t.type === "DEBIT")!;
    expect(debit.trace_id).toBe(CLIENT_TRACE);
    const line = logLines.find((l) => l.event === "wallet.tx" && l.type === "DEBIT");
    expect(line).toMatchObject({ trace_id: CLIENT_TRACE, round_ref: debit.round_ref, amount: 1, currency: "GEL", status: "confirmed" });
    // The request's own log lines carry it too.
    expect(logLines.some((l) => l.trace_id === CLIENT_TRACE && l.req)).toBe(true);
  });

  it("stamps the round ledger, its audit entry and the signed export with the client's trace (0011)", async () => {
    const token = await sessionToken();
    expect((await spin(token, CLIENT_TP)).statusCode).toBe(200);
    const round = c.roundsRepo.list({ operator_id: opId })[0];
    expect(round.trace_id).toBe(CLIENT_TRACE);
    const entry = c.auditRepo.list({ action: "round.resolved" }).find((a) => a.target_id === round.round_ref)!;
    expect(entry.trace_id).toBe(CLIENT_TRACE);
    expect(c.ledger.verifyIntegrity()).toMatchObject({ rounds: { ok: true }, audit: { ok: true } });

    const { bundle } = c.roundExport.export(round.round_ref, opId)!;
    const exported = bundle as { round: { trace_id: string | null }; wallet: Array<{ type: string; trace_id: string | null }> };
    expect(exported.round.trace_id).toBe(CLIENT_TRACE);
    expect(exported.wallet.find((t) => t.type === "DEBIT")?.trace_id).toBe(CLIENT_TRACE);

    // The Round Inspector shows it (GET /admin/v1/rounds/:ref feeds the console view).
    const admin = c.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
    const inspected = await app.inject({ method: "GET", url: `/admin/v1/rounds/${round.round_ref}`, headers: { authorization: `Bearer ${admin}` } });
    expect(inspected.statusCode).toBe(200);
    expect(inspected.json().trace_id).toBe(CLIENT_TRACE);
  });
});

describe("trace context to the casino", () => {
  beforeEach(() => setup({ webhook: true }));

  it("forwards traceparent (same trace, child span) on every wallet webhook of the round", async () => {
    const token = await sessionToken();
    webhookHeaders = [];
    expect((await spin(token, CLIENT_TP)).statusCode).toBe(200);
    expect(webhookHeaders.length).toBeGreaterThan(0);
    for (const h of webhookHeaders) {
      const tp = parseTraceparent(h.traceparent);
      expect(tp?.traceId).toBe(CLIENT_TRACE);
    }
  });
});

describe("Prometheus metrics", () => {
  it("exposes request, wallet, session and queue metrics", async () => {
    await setup({ webhook: true });
    const token = await sessionToken();
    await spin(token);
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/plain");
    const text = res.body;
    expect(text).toMatch(/rgs_http_requests_total\{method="POST",route="\/game\/v1\/spin",status="2xx"\} \d+/);
    expect(text).toMatch(/rgs_http_request_duration_seconds_bucket\{method="POST",route="\/game\/v1\/spin",le="\+Inf"\} \d+/);
    expect(text).toMatch(/rgs_wallet_webhook_duration_seconds_count\{action="debit",outcome="ok"\} \d+/);
    expect(text).toMatch(/rgs_wallet_transactions_total\{status="confirmed",type="DEBIT"\} \d+/);
    expect(text).toMatch(/rgs_rounds_total\{kind="(paid|free_spin|buy|free_round)"\} \d+/);
    expect(text).toMatch(/^rgs_active_sessions 1$/m);
    expect(text).toMatch(/^rgs_debit_reversals_pending 0$/m);
    expect(text).toMatch(/^rgs_failed_settlements_pending 0$/m);
  });

  it("requires the bearer token when one is configured", async () => {
    await setup({ metricsToken: "scrape-token-0123456789" });
    expect((await app.inject({ method: "GET", url: "/metrics" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/metrics", headers: { authorization: "Bearer scrape-token-0123456789" } })).statusCode).toBe(200);
  });
});
