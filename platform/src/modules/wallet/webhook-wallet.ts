import { randomUUID } from "node:crypto";
import { Agent, request } from "undici";
import { computeSignature } from "../../lib/security/hmac";
import { outboundTraceparent } from "../../lib/trace-context";
import { metrics } from "../../lib/metrics";
import type { ManagementService } from "../management/management.service";
import {
  type WalletAdapter,
  type WalletContext,
  type Money,
  type DebitArgs,
  type CreditArgs,
  type RollbackArgs,
  type WalletTxResult,
  type WalletRollbackResult,
  WalletDeclinedError,
  assertFreeRoundArgs
} from "./wallet.types";

/**
 * Real-money wallet adapter for the seamless-wallet model: every debit/credit/
 * rollback/balance call is forwarded to the CASINO's own wallet webhook (the
 * casino, not this platform, holds player funds — see GUIDE.md §9 "known gaps").
 * Each operator's webhook URL + shared secret come from ManagementService
 * (`setWebhook`/`getWebhookSecret`), so one WebhookWallet instance serves every
 * operator. Requests are signed with the exact same HMAC scheme the operator API
 * itself verifies (src/lib/security/hmac.ts) — the casino's wallet server verifies
 * calls with the same shared secret it received when the webhook was configured.
 *
 * This implements the WalletAdapter interface the RoundOrchestrator already
 * depends on, so no round-lifecycle code changes to adopt it — swap it in via
 * `buildContainer(config, { walletFactory: (mgmt) => new WebhookWallet(mgmt) })`.
 */
/** One casino round trip: status + raw body. The whole exchange is bounded by the timeout. */
type Transport = (target: URL, headers: Record<string, string>, body: string, timeoutMs: number) => Promise<{ status: number; text: string }>;

/**
 * Pooled keep-alive connections to every casino, reused across rounds. undici's
 * `request` costs a fraction of `fetch`'s CPU per call (~75 vs ~600 us measured,
 * tools/bench), and it honours the casino's Keep-Alive hint so it never writes to a
 * socket the casino has just closed.
 */
const CASINO_POOL = new Agent({ connections: 128, keepAliveTimeout: 4_000, keepAliveMaxTimeout: 30_000 });

const undiciTransport: Transport = async (target, headers, body, timeoutMs) => {
  const signal = AbortSignal.timeout(timeoutMs);
  const res = await request(target, { method: "POST", headers, body, dispatcher: CASINO_POOL, signal, headersTimeout: timeoutMs, bodyTimeout: timeoutMs });
  return { status: res.statusCode, text: await res.body.text() };
};

/** An injected fetch (tests, fault injection). */
const fetchTransport = (fetchImpl: typeof fetch): Transport => async (target, headers, body, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(target, { method: "POST", headers, body, signal: controller.signal });
    return { status: res.status, text: await res.text() };
  } finally {
    clearTimeout(timer);
  }
};

export class WebhookWallet implements WalletAdapter {
  private readonly transport: Transport;

  constructor(
    private readonly mgmt: ManagementService,
    private readonly opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
  ) {
    this.transport = opts.fetchImpl ? fetchTransport(opts.fetchImpl) : undiciTransport;
  }

  async balance(ctx: WalletContext, args: { operatorPlayerId: string; currency: string }): Promise<Money> {
    return this.call<Money>(ctx, "balance", args);
  }

  // Free rounds reach the casino as the same debit/credit calls with
  // txType FREE_ROUND_BET (amount 0.00) / FREE_ROUND_WIN + campaignId in the body.
  async debit(ctx: WalletContext, args: DebitArgs): Promise<WalletTxResult> {
    assertFreeRoundArgs(args);
    return this.call<WalletTxResult>(ctx, "debit", args);
  }

  async credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
    assertFreeRoundArgs(args);
    return this.call<WalletTxResult>(ctx, "credit", args);
  }

  async rollback(ctx: WalletContext, args: RollbackArgs): Promise<WalletRollbackResult> {
    return this.call<WalletRollbackResult>(ctx, "rollback", args);
  }

  private async call<T>(ctx: WalletContext, action: "balance" | "debit" | "credit" | "rollback", body: object): Promise<T> {
    const webhook = this.mgmt.getWebhookConfig(ctx.operatorId);
    const secret = this.mgmt.getWebhookSecret(ctx.operatorId);
    if (!webhook || !secret) throw new Error("WEBHOOK_NOT_CONFIGURED");

    const base = webhook.url.endsWith("/") ? webhook.url : `${webhook.url}/`;
    const target = new URL(action, base);
    const rawBody = JSON.stringify(body);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomUUID();
    const signature = computeSignature(secret, { timestamp, method: "POST", path: target.pathname, rawBody });
    // The casino sees the same trace as the round (a child span), and stores it.
    const traceparent = outboundTraceparent();
    const headers: Record<string, string> = {
      "content-type": "application/json",
      "x-operator-id": ctx.operatorId,
      "x-timestamp": timestamp,
      "x-nonce": nonce,
      "x-signature": signature,
      ...(traceparent ? { traceparent } : {})
    };
    const started = performance.now();
    const observe = (outcome: "ok" | "declined" | "failed") =>
      metrics.walletCall.observe((performance.now() - started) / 1000, { action, outcome });

    let res: { status: number; text: string };
    try {
      res = await this.transport(target, headers, rawBody, this.opts.timeoutMs ?? 5000);
    } catch {
      // No answer (refused, reset, timed out — headers OR body): the outcome is unknown.
      observe("failed");
      throw new Error("WEBHOOK_CALL_FAILED");
    }

    let payload: unknown = null;
    try {
      payload = res.text ? JSON.parse(res.text) : null;
    } catch {
      /* non-JSON body — handled by the status check below */
    }

    if (res.status < 200 || res.status >= 300) {
      const err = payload as { error?: string; message?: string } | null;
      observe(err?.error ? "declined" : "failed");
      if (err?.error) throw new WalletDeclinedError(err.error, err.message);
      throw new Error("WEBHOOK_CALL_FAILED");
    }
    observe("ok");
    return payload as T;
  }
}
