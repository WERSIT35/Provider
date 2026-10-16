import { describe, it, expect, afterEach } from "vitest";
import http from "node:http";
import { buildContainer } from "../src/container";
import { WebhookWallet } from "../src/modules/wallet/webhook-wallet";
import { WalletDeclinedError } from "../src/modules/wallet/wallet.types";

/** A real casino endpoint on loopback; `handler` decides how it answers. */
async function casino(handler: http.RequestListener) {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const port = (srv.address() as { port: number }).port;
  return { srv, url: `http://127.0.0.1:${port}/wallet` };
}

describe("casino wallet transport (pooled HTTP)", () => {
  let srv: http.Server | null = null;
  afterEach(async () => {
    srv?.closeAllConnections();
    await new Promise((r) => srv?.close(r) ?? r(null));
    srv = null;
  });

  const walletFor = (url: string, timeoutMs = 300) => {
    const mgmt = buildContainer({ launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 600 }, {}).mgmt;
    const op = mgmt.createOperator({ name: "C", slug: "c" });
    mgmt.setWebhook(op.id, url);
    return { w: new WebhookWallet(mgmt, { timeoutMs }), ctx: { operatorId: op.id, sessionId: "s", roundRef: "r" } };
  };

  it("signs and posts the body, reuses connections, and returns the casino's JSON", async () => {
    const sockets = new Set<unknown>();
    const seen: Array<{ path: string; sig: string | undefined; body: string }> = [];
    const c = await casino((req, res) => {
      sockets.add(req.socket);
      let b = "";
      req.on("data", (d) => (b += d));
      req.on("end", () => {
        seen.push({ path: req.url ?? "", sig: req.headers["x-signature"] as string | undefined, body: b });
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ tx_id: `t${seen.length}`, balance: { amount: 9, currency: "GEL" } }));
      });
    });
    srv = c.srv;
    const { w, ctx } = walletFor(c.url);
    for (let i = 0; i < 5; i++) {
      const r = await w.debit(ctx, { operatorPlayerId: "p1", amount: 1, currency: "GEL", idempotencyKey: `k${i}`, roundRef: "r" } as never);
      expect(r).toMatchObject({ tx_id: `t${i + 1}` });
    }
    expect(seen[0].path).toBe("/wallet/debit");
    expect(seen[0].sig).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.parse(seen[0].body)).toMatchObject({ idempotencyKey: "k0", amount: 1 });
    expect(sockets.size).toBeLessThan(5); // keep-alive: connections are reused across calls
  });

  it("a casino refusal with an error code is a definite decline", async () => {
    const c = await casino((_req, res) => { res.statusCode = 402; res.setHeader("content-type", "application/json"); res.end('{"error":"INSUFFICIENT_FUNDS","message":"no"}'); });
    srv = c.srv;
    const { w, ctx } = walletFor(c.url);
    await expect(w.debit(ctx, { operatorPlayerId: "p1", amount: 1, currency: "GEL", idempotencyKey: "k", roundRef: "r" } as never)).rejects.toBeInstanceOf(WalletDeclinedError);
  });

  it("headers sent, then the body stalls: times out as an unknown outcome instead of hanging the round", async () => {
    const c = await casino((_req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.write('{"tx_id":'); /* never ends */ });
    srv = c.srv;
    const { w, ctx } = walletFor(c.url, 300);
    const t0 = Date.now();
    await expect(w.debit(ctx, { operatorPlayerId: "p1", amount: 1, currency: "GEL", idempotencyKey: "k", roundRef: "r" } as never)).rejects.toThrow("WEBHOOK_CALL_FAILED");
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it("no casino listening: an unknown outcome, not a decline", async () => {
    const { w, ctx } = walletFor("http://127.0.0.1:1/wallet");
    await expect(w.credit(ctx, { operatorPlayerId: "p1", amount: 1, currency: "GEL", idempotencyKey: "k", roundRef: "r" } as never)).rejects.toThrow("WEBHOOK_CALL_FAILED");
  });
});
