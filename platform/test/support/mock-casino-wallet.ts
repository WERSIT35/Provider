import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { verifySignature, withinSkew } from "../../src/lib/security/hmac";

/**
 * A minimal stand-in for a real casino's wallet server, used only by tests to
 * exercise the full WebhookWallet loop (platform → casino wallet) without a real
 * casino. Implements the same debit/credit/rollback/balance contract WebhookWallet
 * calls, verifies the same HMAC scheme the platform itself enforces on the operator
 * API, and records every accepted call (in order) so tests can assert on it.
 */
export interface MockCasinoWalletCall {
  action: "debit" | "credit" | "rollback" | "balance";
  body: Record<string, unknown>;
}

export interface MockCasinoWallet {
  app: FastifyInstance;
  url: string;
  calls: MockCasinoWalletCall[];
  setBalance(operatorPlayerId: string, currency: string, amount: number): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}

export function createMockCasinoWallet(secret: string, opts: { skewSeconds?: number } = {}): MockCasinoWallet {
  const skewSeconds = opts.skewSeconds ?? 30;
  const balances = new Map<string, number>();
  const applied = new Map<string, unknown>();
  const debitByRef = new Map<string, { key: string; amount: number }>();
  const calls: MockCasinoWalletCall[] = [];
  const key = (playerId: string, currency: string): string => `${playerId}:${currency}`;

  const app = Fastify({ logger: false });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (req as unknown as { rawBody?: string }).rawBody = raw;
    try {
      done(null, raw.length ? JSON.parse(raw) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  app.addHook("preHandler", async (req, reply) => {
    const ts = req.headers["x-timestamp"];
    const nonce = req.headers["x-nonce"];
    const sig = req.headers["x-signature"];
    if (typeof ts !== "string" || typeof nonce !== "string" || typeof sig !== "string") {
      return reply.code(401).send({ error: "UNAUTHORIZED" });
    }
    if (!withinSkew(ts, skewSeconds)) return reply.code(401).send({ error: "TIMESTAMP_SKEW" });
    const path = new URL(req.url, "http://local").pathname;
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? "";
    if (!verifySignature(secret, { timestamp: ts, method: req.method, path, rawBody }, sig)) {
      return reply.code(401).send({ error: "SIGNATURE_INVALID" });
    }
  });

  app.post("/wallet/debit", async (req, reply) => {
    const body = req.body as { idempotencyKey: string; operatorPlayerId: string; amount: number; currency: string };
    calls.push({ action: "debit", body });
    const cached = applied.get(body.idempotencyKey);
    if (cached) return cached;
    const k = key(body.operatorPlayerId, body.currency);
    const current = balances.get(k) ?? 0;
    if (current < body.amount) return reply.code(402).send({ error: "INSUFFICIENT_FUNDS" });
    balances.set(k, Number((current - body.amount).toFixed(2)));
    const operatorTxRef = `ctx_${randomUUID()}`;
    const result = { operatorTxRef, balanceAfter: { amount: balances.get(k), currency: body.currency }, status: "confirmed" };
    applied.set(body.idempotencyKey, result);
    debitByRef.set(operatorTxRef, { key: k, amount: body.amount });
    return result;
  });

  app.post("/wallet/credit", async (req) => {
    const body = req.body as { idempotencyKey: string; operatorPlayerId: string; amount: number; currency: string };
    calls.push({ action: "credit", body });
    const cached = applied.get(body.idempotencyKey);
    if (cached) return cached;
    const k = key(body.operatorPlayerId, body.currency);
    const current = balances.get(k) ?? 0;
    balances.set(k, Number((current + body.amount).toFixed(2)));
    const result = { operatorTxRef: `ctx_${randomUUID()}`, balanceAfter: { amount: balances.get(k), currency: body.currency }, status: "confirmed" };
    applied.set(body.idempotencyKey, result);
    return result;
  });

  app.post("/wallet/rollback", async (req) => {
    const body = req.body as { idempotencyKey: string; originalOperatorTxRef: string };
    calls.push({ action: "rollback", body });
    const cached = applied.get(body.idempotencyKey);
    if (cached) return cached;
    const debit = debitByRef.get(body.originalOperatorTxRef);
    if (debit) balances.set(debit.key, Number(((balances.get(debit.key) ?? 0) + debit.amount).toFixed(2)));
    const result = { operatorTxRef: `ctx_${randomUUID()}`, status: "rolled_back" };
    applied.set(body.idempotencyKey, result);
    return result;
  });

  app.post("/wallet/balance", async (req) => {
    const body = req.body as { operatorPlayerId: string; currency: string };
    calls.push({ action: "balance", body });
    return { amount: balances.get(key(body.operatorPlayerId, body.currency)) ?? 0, currency: body.currency };
  });

  return {
    app,
    get url() {
      const addr = app.server.address();
      if (!addr || typeof addr === "string") throw new Error("mock casino wallet not listening");
      return `http://127.0.0.1:${addr.port}/wallet`;
    },
    calls,
    setBalance(operatorPlayerId, currency, amount) {
      balances.set(key(operatorPlayerId, currency), amount);
    },
    async start() {
      await app.listen({ port: 0, host: "127.0.0.1" });
    },
    async stop() {
      await app.close();
    }
  };
}
