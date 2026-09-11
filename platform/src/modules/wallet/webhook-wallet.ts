import { randomUUID } from "node:crypto";
import { computeSignature } from "../../lib/security/hmac";
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
  WalletDeclinedError
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
export class WebhookWallet implements WalletAdapter {
  constructor(
    private readonly mgmt: ManagementService,
    private readonly opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
  ) {}

  async balance(ctx: WalletContext, args: { operatorPlayerId: string; currency: string }): Promise<Money> {
    return this.call<Money>(ctx, "balance", args);
  }

  async debit(ctx: WalletContext, args: DebitArgs): Promise<WalletTxResult> {
    return this.call<WalletTxResult>(ctx, "debit", args);
  }

  async credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
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

    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const timeoutMs = this.opts.timeoutMs ?? 5000;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let res: Response;
    try {
      res = await fetchImpl(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-operator-id": ctx.operatorId,
          "x-timestamp": timestamp,
          "x-nonce": nonce,
          "x-signature": signature
        },
        body: rawBody,
        signal: controller.signal
      });
    } catch {
      throw new Error("WEBHOOK_CALL_FAILED");
    } finally {
      clearTimeout(timer);
    }

    let payload: unknown = null;
    try {
      payload = await res.json();
    } catch {
      /* empty/non-JSON body — handled by the status check below */
    }

    if (!res.ok) {
      const err = payload as { error?: string; message?: string } | null;
      if (err?.error) throw new WalletDeclinedError(err.error, err.message);
      throw new Error("WEBHOOK_CALL_FAILED");
    }
    return payload as T;
  }
}
