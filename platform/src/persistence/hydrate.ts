import type { Container } from "../container";
import { PostgresPersistence, type Persistence } from "./persistence";
import type { HISTORY_WINDOW } from "../container";
import { sandboxOf } from "../modules/wallet/routing-wallet";
import type { RoundIntent } from "../modules/rounds/round-intents";
import type { RoundRecord } from "../modules/ledger/ledger.types";
import type { AuditRecord } from "../modules/ledger/ledger.types";
import { DEBIT_OUTCOME_UNKNOWN, type TxRecord } from "../modules/wallet/transaction-store";
import { SESSION_TOKEN_TTL_S } from "../modules/session/session.service";
import type { AdjustmentRecord } from "../modules/rounds/round-adjustment.store";
import type { Session } from "../modules/session/session.service";
import type { DisputeRecord } from "../modules/disputes/dispute.service";
import type { Operator, OperatorDomain, ApiCredential, Game, MathConfig, OperatorGame, OperatorWebhook } from "../modules/management/management.types";
import type { AdminAccount } from "../modules/admin/admin-account";
import type { Campaign, PlayerCampaign } from "../modules/campaigns/campaign.repository";
import type { WalletTxResult, WalletRollbackResult } from "../modules/wallet/wallet.types";
import type { SigningKeyRecord } from "../lib/security/signing-keyring";

/**
 * Load durable state from Postgres into the in-memory stores on boot, in the same
 * order the write-through recorded it (seq/created_at ASC), so the ledgers' hash
 * chains and seq counters continue seamlessly.
 */
export async function hydrateContainer(c: Container, p: Persistence): Promise<void> {
  // Bounded memory (Phase 2): with Postgres as the system of record, load only what the
  // hot path needs; everything else is read on demand (modules/history).
  if (c.historyWindow && p instanceof PostgresPersistence) return hydrateWindowed(c, p, c.historyWindow);

  const [operators, domains, credentials, games, mathConfigs, operatorGames, webhooks, sessions, rounds, txs, adjustments, audit, disputes, balances, applied, debitRefs, adminAccounts, campaigns, playerCampaigns, signingKeys, roundIntents] =
    await Promise.all([
      p.loadTable("operators"),
      p.loadTable("operator_domains"),
      p.loadTable("operator_api_credentials"),
      p.loadTable("games"),
      p.loadTable("math_configs"),
      p.loadTable("operator_games"),
      p.loadTable("operator_webhooks"),
      p.loadTable("player_sessions"),
      p.loadTable("rounds"),
      p.loadTable("wallet_transactions"),
      p.loadTable("round_adjustments"),
      p.loadTable("audit_records"),
      p.loadTable("disputes"),
      p.loadTable("wallet_balances"),
      p.loadTable("wallet_applied"),
      p.loadTable("wallet_debit_refs"),
      p.loadTable("admin_accounts"),
      p.loadTable("campaigns"),
      p.loadTable("player_campaigns"),
      p.loadTable("signing_keys"),
      p.loadTable("round_intents")
    ]);

  // Every key that ever signed, so retired keys keep verifying; the previous active key
  // is retired here when EXPORT_SIGNING_KEY changed (rotation).
  c.signingKeyring.hydrate(signingKeys as unknown as SigningKeyRecord[]);

  c.mgmt.hydrate({
    operators: operators as unknown as Operator[],
    domains: domains as unknown as OperatorDomain[],
    credentials: credentials as unknown as Array<ApiCredential & { hmac_secret?: string | null }>,
    games: games as unknown as Game[],
    mathConfigs: mathConfigs as unknown as MathConfig[],
    operatorGames: operatorGames as unknown as OperatorGame[],
    webhooks: webhooks as unknown as Array<OperatorWebhook & { secret?: string | null }>
  });
  c.sessions.hydrate(sessions as unknown as Session[]);
  c.roundsRepo.hydrate(rounds as unknown as RoundRecord[]);
  c.auditRepo.hydrate(audit as unknown as AuditRecord[]);
  c.transactions.hydrate(txs as unknown as TxRecord[]);
  c.adjustments.hydrate(adjustments as unknown as AdjustmentRecord[]);
  c.disputes.hydrate(disputes as unknown as DisputeRecord[]);
  c.adminAccounts.hydrate(adminAccounts as unknown as AdminAccount[]);
  c.campaigns.hydrate({
    campaigns: campaigns as unknown as Campaign[],
    grants: playerCampaigns as unknown as PlayerCampaign[]
  });

  // Unfinished write-ahead intents: boot recovery (jobs/round-recovery.ts) finishes them.
  c.intents.hydrate(roundIntents as unknown as RoundIntent[]);

  const sandbox = sandboxOf(c.wallet);
  if (sandbox) {
    sandbox.hydrate({
      balances: balances as unknown as Array<{ balance_key: string; amount: number }>,
      applied: applied as unknown as Array<{ idempotency_key: string; result: WalletTxResult | WalletRollbackResult }>,
      debitRefs: debitRefs as unknown as Array<{ operator_tx_ref: string; balance_key: string; amount: number }>
    });
  }
}

/**
 * Windowed boot: small tables in full; the ledgers' newest rows plus where each chain
 * ends; the rows of every still-open queue item (unknown debits, failed credits);
 * sessions a token can still reach or that hold an unfinished bonus; unfinished round
 * intents. Boot time no longer grows with the size of the history.
 */
async function hydrateWindowed(c: Container, p: PostgresPersistence, win: typeof HISTORY_WINDOW): Promise<void> {
  const tipOf = async (table: "rounds" | "audit_records") => {
    const r = (await p.query(`SELECT seq, chain_hash FROM ${table} ORDER BY seq DESC LIMIT 1`)).rows[0];
    return r ? { nextSeq: Number(r.seq) + 1, lastHash: String(r.chain_hash) } : undefined;
  };
  const [operators, domains, credentials, games, mathConfigs, operatorGames, webhooks, adjustments, disputes, balances, applied, debitRefs, adminAccounts, campaigns, playerCampaigns, signingKeys] =
    await Promise.all([
      p.loadTable("operators"),
      p.loadTable("operator_domains"),
      p.loadTable("operator_api_credentials"),
      p.loadTable("games"),
      p.loadTable("math_configs"),
      p.loadTable("operator_games"),
      p.loadTable("operator_webhooks"),
      p.loadTable("round_adjustments"),
      p.loadTable("disputes"),
      p.loadTable("wallet_balances"),
      p.loadTable("wallet_applied"),
      p.loadTable("wallet_debit_refs"),
      p.loadTable("admin_accounts"),
      p.loadTable("campaigns"),
      p.loadTable("player_campaigns"),
      p.loadTable("signing_keys")
    ]);
  const [roundTip, auditTip, rounds, audit, txs, txTip, queueRows, sessions, intents] = await Promise.all([
    tipOf("rounds"),
    tipOf("audit_records"),
    p.loadRows("rounds", { newestFirst: true, limit: win.rounds }),
    p.loadRows("audit_records", { newestFirst: true, limit: win.audit }),
    p.loadRows("wallet_transactions", { newestFirst: true, limit: win.transactions }),
    p.query("SELECT coalesce(max(seq) + 1, 0) AS next FROM wallet_transactions"),
    // Every row of rounds with an open queue item: an unknown debit (maybe not reversed
    // yet) or a failed credit (maybe not settled yet). The store works out which still are.
    p.loadRows("wallet_transactions", {
      where: `round_ref IN (SELECT round_ref FROM wallet_transactions WHERE status = 'failed' AND (error_code = '${DEBIT_OUTCOME_UNKNOWN}' OR type IN ('CREDIT', 'FREE_ROUND_WIN')))`
    }),
    p.loadRows("player_sessions", { where: `created_at > now() - make_interval(secs => $1) OR free_spins_left > 0`, params: [SESSION_TOKEN_TTL_S + 300] }),
    p.loadRows("round_intents", { where: "status IN ('open', 'committed')" })
  ]);

  c.signingKeyring.hydrate(signingKeys as unknown as SigningKeyRecord[]);
  c.mgmt.hydrate({
    operators: operators as unknown as Operator[],
    domains: domains as unknown as OperatorDomain[],
    credentials: credentials as unknown as Array<ApiCredential & { hmac_secret?: string | null }>,
    games: games as unknown as Game[],
    mathConfigs: mathConfigs as unknown as MathConfig[],
    operatorGames: operatorGames as unknown as OperatorGame[],
    webhooks: webhooks as unknown as Array<OperatorWebhook & { secret?: string | null }>
  });
  c.sessions.hydrate(sessions as unknown as Session[]);
  c.roundsRepo.hydrate(rounds as unknown as RoundRecord[], roundTip);
  c.auditRepo.hydrate(audit as unknown as AuditRecord[], auditTip);
  c.transactions.hydrate(txs as unknown as TxRecord[], Number(txTip.rows[0].next));
  c.transactions.hydrateQueues(queueRows as unknown as TxRecord[]);
  c.adjustments.hydrate(adjustments as unknown as AdjustmentRecord[]);
  c.disputes.hydrate(disputes as unknown as DisputeRecord[]);
  c.adminAccounts.hydrate(adminAccounts as unknown as AdminAccount[]);
  c.campaigns.hydrate({ campaigns: campaigns as unknown as Campaign[], grants: playerCampaigns as unknown as PlayerCampaign[] });
  c.intents.hydrate(intents as unknown as RoundIntent[]);

  // Reality-check totals of the sessions in memory: from ALL their rounds, not only the
  // ones in the window (overwrites what hydrating the window counted).
  const ids = (sessions as unknown as Session[]).map((s) => s.id);
  if (ids.length) {
    const stats = await p.query(
      "SELECT session_id, count(*)::bigint AS rounds, coalesce(sum(bet_charged),0) AS wagered, coalesce(sum(total_win),0) AS won FROM rounds WHERE session_id = ANY($1) GROUP BY session_id",
      [ids]
    );
    c.roundsRepo.seedSessionStats(stats.rows.map((r) => ({ session_id: String(r.session_id), rounds: Number(r.rounds), wagered: Number(r.wagered), won: Number(r.won) })));
  }

  const sandbox = sandboxOf(c.wallet);
  if (sandbox) {
    sandbox.hydrate({
      balances: balances as unknown as Array<{ balance_key: string; amount: number }>,
      applied: applied as unknown as Array<{ idempotency_key: string; result: WalletTxResult | WalletRollbackResult }>,
      debitRefs: debitRefs as unknown as Array<{ operator_tx_ref: string; balance_key: string; amount: number }>
    });
  }
}
