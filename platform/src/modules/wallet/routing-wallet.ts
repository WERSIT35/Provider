import type { ManagementService } from "../management/management.service";
import { SandboxWallet } from "./sandbox-wallet";
import { WebhookWallet } from "./webhook-wallet";
import {
  WalletDeclinedError,
  type CreditArgs,
  type DebitArgs,
  type Money,
  type RollbackArgs,
  type WalletAdapter,
  type WalletContext,
  type WalletRollbackResult,
  type WalletTxResult
} from "./wallet.types";

/**
 * The production wallet: every operator with a configured webhook is served by its own
 * casino wallet (WebhookWallet: the casino holds the money). The provider-held
 * SandboxWallet answers only where it is allowed at all (`sandbox` non-null: NODE_ENV
 * local/test), for operators without a webhook (demo seeds, tests). Anywhere else an
 * operator without a webhook is declined before any money moves.
 */
export class RoutingWallet implements WalletAdapter {
  constructor(
    private readonly mgmt: ManagementService,
    private readonly webhook: WalletAdapter = new WebhookWallet(mgmt),
    /** The provider-held fallback, or null where it must never be used. */
    readonly sandbox: SandboxWallet | null = null
  ) {}

  private pick(ctx: WalletContext): WalletAdapter {
    if (this.mgmt.getWebhookConfig(ctx.operatorId)) return this.webhook;
    if (this.sandbox) return this.sandbox;
    // A definite "not applied": nothing was sent anywhere.
    throw new WalletDeclinedError("WEBHOOK_NOT_CONFIGURED");
  }

  async balance(ctx: WalletContext, args: { operatorPlayerId: string; currency: string }): Promise<Money> {
    return this.pick(ctx).balance(ctx, args);
  }
  async debit(ctx: WalletContext, args: DebitArgs): Promise<WalletTxResult> {
    return this.pick(ctx).debit(ctx, args);
  }
  async credit(ctx: WalletContext, args: CreditArgs): Promise<WalletTxResult> {
    return this.pick(ctx).credit(ctx, args);
  }
  async rollback(ctx: WalletContext, args: RollbackArgs): Promise<WalletRollbackResult> {
    return this.pick(ctx).rollback(ctx, args);
  }
}

/** The provider-held wallet inside `wallet`, if any (for persistence and hydrate). */
export function sandboxOf(wallet: WalletAdapter): SandboxWallet | null {
  if (wallet instanceof RoutingWallet) return wallet.sandbox;
  return wallet instanceof SandboxWallet ? wallet : null;
}
