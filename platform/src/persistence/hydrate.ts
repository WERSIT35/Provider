import type { Container } from "../container";
import type { Persistence } from "./persistence";
import { SandboxWallet } from "../modules/wallet/sandbox-wallet";
import type { RoundRecord } from "../modules/ledger/ledger.types";
import type { AuditRecord } from "../modules/ledger/ledger.types";
import type { TxRecord } from "../modules/wallet/transaction-store";
import type { AdjustmentRecord } from "../modules/rounds/round-adjustment.store";
import type { Session } from "../modules/session/session.service";
import type { DisputeRecord } from "../modules/disputes/dispute.service";
import type { Operator, OperatorDomain, ApiCredential, Game, MathConfig, OperatorGame } from "../modules/management/management.types";
import type { WalletTxResult, WalletRollbackResult } from "../modules/wallet/wallet.types";

/**
 * Load durable state from Postgres into the in-memory stores on boot, in the same
 * order the write-through recorded it (seq/created_at ASC), so the ledgers' hash
 * chains and seq counters continue seamlessly.
 */
export async function hydrateContainer(c: Container, p: Persistence): Promise<void> {
  const [operators, domains, credentials, games, mathConfigs, operatorGames, sessions, rounds, txs, adjustments, audit, disputes, balances, applied, debitRefs] =
    await Promise.all([
      p.loadTable("operators"),
      p.loadTable("operator_domains"),
      p.loadTable("operator_api_credentials"),
      p.loadTable("games"),
      p.loadTable("math_configs"),
      p.loadTable("operator_games"),
      p.loadTable("player_sessions"),
      p.loadTable("rounds"),
      p.loadTable("wallet_transactions"),
      p.loadTable("round_adjustments"),
      p.loadTable("audit_records"),
      p.loadTable("disputes"),
      p.loadTable("wallet_balances"),
      p.loadTable("wallet_applied"),
      p.loadTable("wallet_debit_refs")
    ]);

  c.mgmt.hydrate({
    operators: operators as unknown as Operator[],
    domains: domains as unknown as OperatorDomain[],
    credentials: credentials as unknown as Array<ApiCredential & { hmac_secret?: string | null }>,
    games: games as unknown as Game[],
    mathConfigs: mathConfigs as unknown as MathConfig[],
    operatorGames: operatorGames as unknown as OperatorGame[]
  });
  c.sessions.hydrate(sessions as unknown as Session[]);
  c.roundsRepo.hydrate(rounds as unknown as RoundRecord[]);
  c.auditRepo.hydrate(audit as unknown as AuditRecord[]);
  c.transactions.hydrate(txs as unknown as TxRecord[]);
  c.adjustments.hydrate(adjustments as unknown as AdjustmentRecord[]);
  c.disputes.hydrate(disputes as unknown as DisputeRecord[]);

  if (c.wallet instanceof SandboxWallet) {
    c.wallet.hydrate({
      balances: balances as unknown as Array<{ balance_key: string; amount: number }>,
      applied: applied as unknown as Array<{ idempotency_key: string; result: WalletTxResult | WalletRollbackResult }>,
      debitRefs: debitRefs as unknown as Array<{ operator_tx_ref: string; balance_key: string; amount: number }>
    });
  }
}
