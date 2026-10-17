import type { EngineService } from "./modules/engine/engine.service";
import { GameRegistry } from "./modules/games/game-registry";
import { AuthoritativeResolver } from "./modules/rng/authoritative-resolver";
import { ManagementService } from "./modules/management/management.service";
import { SessionService } from "./modules/session/session.service";
import { SandboxWallet } from "./modules/wallet/sandbox-wallet";
import { sandboxOf } from "./modules/wallet/routing-wallet";
import { RoundIntentStore } from "./modules/rounds/round-intents";
import { PostgresPersistence } from "./persistence/persistence";
import { MemoryHistory, PgHistory, type HistoryReads } from "./modules/history/history";
import type { WalletAdapter } from "./modules/wallet/wallet.types";
import { InMemoryTransactionStore } from "./modules/wallet/transaction-store";
import { RoundOrchestrator } from "./modules/rounds/round-orchestrator";
import { DebitReconciler } from "./modules/wallet/debit-reconciler";
import { RegulatoryService, type SessionStats } from "./modules/regulatory/regulatory";
import { ReportingService } from "./modules/reporting/reporting.service";
import { AdminAuthService } from "./modules/admin/admin-auth";
import { AdminAccountService } from "./modules/admin/admin-account";
import { RoundLedgerService } from "./modules/ledger/round-ledger.service";
import { InMemoryRoundRepository, InMemoryAuditRepository } from "./modules/ledger/memory-repositories";
import { InMemoryRoundAdjustmentStore } from "./modules/rounds/round-adjustment.store";
import { RoundLifecycleService } from "./modules/rounds/round-lifecycle.service";
import { RoundVerificationService } from "./modules/rounds/round-verification.service";
import { RoundExportService } from "./modules/rounds/round-export.service";
import { SigningKeyring } from "./lib/security/signing-keyring";
import { DisputeService } from "./modules/disputes/dispute.service";
import { InMemoryCampaignRepository } from "./modules/campaigns/campaign.repository";
import { NonceStore } from "./lib/security/nonce-store";
import { RateLimiter } from "./lib/security/rate-limiter";
import { NullPersistence, type Persistence } from "./persistence/persistence";

export interface PlatformConfig {
  launchSecret: string;
  sessionSecret: string;
  adminSecret: string;
  hmacSkewSeconds: number;
  rateLimitPerMin: number;
  // Bootstrap provider super-admin (seeded on boot if no provider account exists).
  // Optional so tests that mint tokens directly need not supply them.
  bootstrapAdminUsername?: string;
  bootstrapAdminPassword?: string;
  totpIssuer?: string;
  // Gate on TOTP 2FA enrollment/verification during admin login. Defaults to
  // true (undefined === required) so existing tests/production behavior is
  // unchanged; local dev/demo entry points (dev-seed.ts, seed-demo-operator.ts)
  // pass false explicitly to skip the authenticator step entirely.
  totpRequired?: boolean;
  /** Ed25519 PKCS#8 PEM for round exports; absent = an ephemeral key (local/test only). */
  exportSigningKey?: string;
  /** Optional planned end of life of the active key (ISO); staging/production refuse to boot past it. */
  exportSigningKeyExpiresAt?: string;
}

/**
 * Composition root for the domain services. Wires the in-memory implementations
 * (swap the ledger repos + wallet for Postgres/real adapters in production without
 * touching call sites). A single shared instance is created at boot.
 */
export interface Container {
  config: PlatformConfig;
  /** Every game (games/<code>/game.json); a round resolves with its session's game. */
  games: GameRegistry;
  /** Vault 20K's engine (games.default): what single-game callers use. */
  engine: EngineService;
  mgmt: ManagementService;
  sessions: SessionService;
  wallet: WalletAdapter;
  ledger: RoundLedgerService;
  resolver: AuthoritativeResolver;
  transactions: InMemoryTransactionStore;
  orchestrator: RoundOrchestrator;
  intents: RoundIntentStore;
  /** Whole-history reads (reports, old rounds, integrity sweep): SQL with Postgres, in-memory otherwise. */
  history: HistoryReads & Partial<PgHistory>;
  /** Postgres mode: the rows each ledger keeps in memory; null in memory mode (keeps all). */
  historyWindow: typeof HISTORY_WINDOW | null;
  /** Lost-debit reconciliation: in-line retry, void + reversal, and the reversal queue. */
  debits: DebitReconciler;
  /** Jurisdiction rules per operator (round pacing, reality check, feature-buy switch). */
  regulatory: RegulatoryService;
  reporting: ReportingService;
  adjustments: InMemoryRoundAdjustmentStore;
  lifecycle: RoundLifecycleService;
  verification: RoundVerificationService;
  /** Signed round-history exports (GET /operator/v1/rounds/:ref/export). */
  roundExport: RoundExportService;
  /** Ed25519 keyring: signs exports and every ledger row; publishes active + retired keys. */
  signingKeyring: SigningKeyring;
  disputes: DisputeService;
  // Operator-granted Free Rounds (NOT the engine scatter feature).
  campaigns: InMemoryCampaignRepository;
  adminAuth: AdminAuthService;
  adminAccounts: AdminAccountService;
  nonceStore: NonceStore;
  rateLimiter: RateLimiter;
  // Durable-persistence plumbing (NullPersistence when Postgres is disabled).
  persistence: Persistence;
  roundsRepo: InMemoryRoundRepository;
  auditRepo: InMemoryAuditRepository;
}

/**
 * Rows each ledger keeps in memory in Postgres mode (~7.5 KB per round incl. its money
 * moves and audit row, so the defaults hold ~250 MB at most whatever the history size).
 */
export const HISTORY_WINDOW = { rounds: 20_000, coldRounds: 5_000, audit: 20_000, transactions: 60_000, coldTransactions: 15_000 };

export function buildContainer(
  config: PlatformConfig,
  overrides: {
    wallet?: WalletAdapter;
    walletFactory?: (mgmt: ManagementService) => WalletAdapter;
    persistence?: Persistence;
    /** Pauses between in-line debit retries (default [250, 1000] ms). */
    debitRetryDelaysMs?: number[];
    /** Postgres mode: how many rows each ledger keeps in memory (defaults: HISTORY_WINDOW). */
    historyWindow?: Partial<typeof HISTORY_WINDOW>;
  } = {}
): Container {
  const persistence = overrides.persistence ?? NullPersistence;
  // Bounded memory: with Postgres as the system of record the ledgers keep only a hot
  // window (see memory-repositories.ts WindowOptions); in-memory mode keeps everything.
  const pg = persistence instanceof PostgresPersistence ? persistence : null;
  const win = { ...HISTORY_WINDOW, ...(overrides.historyWindow ?? {}) };
  const games = new GameRegistry().preload();
  const engine = games.default;
  // First: both ledgers sign every row they append with the active key.
  const signingKeyring = new SigningKeyring({ activePrivateKeyPem: config.exportSigningKey, expiresAt: config.exportSigningKeyExpiresAt ?? null }, persistence);
  const audit = new InMemoryAuditRepository(persistence, signingKeyring, pg ? { retain: win.audit } : {});
  const mgmt = new ManagementService(audit, persistence);
  const rounds = new InMemoryRoundRepository(persistence, signingKeyring, pg ? { retain: win.rounds, cold: win.coldRounds } : {});
  const ledger = new RoundLedgerService(rounds, audit, signingKeyring);
  const sessions = new SessionService(mgmt, config.launchSecret, persistence);
  // walletFactory exists because a WebhookWallet needs `mgmt`, which is only
  // available once buildContainer is already underway (constructor-order chicken/egg).
  const wallet = overrides.walletFactory ? overrides.walletFactory(mgmt) : (overrides.wallet ?? new SandboxWallet());
  sandboxOf(wallet)?.usePersistence(persistence);
  const resolver = new AuthoritativeResolver(games);
  const transactions = new InMemoryTransactionStore(persistence, pg ? { retain: win.transactions, cold: win.coldTransactions } : {});
  const campaigns = new InMemoryCampaignRepository(persistence);
  const debits = new DebitReconciler(wallet, transactions, { audit, retryDelaysMs: overrides.debitRetryDelaysMs });
  // Reality-check stats come from the round ledger (bound late: reporting is built below).
  const regulatory = new RegulatoryService(
    (operatorId) => mgmt.regulatoryProfile(operatorId),
    (session, now): SessionStats => {
      // Kept per session as rounds are appended (no scan of the player's history per spin).
      const acc = rounds.sessionStats(session.id);
      const wagered = Math.round(acc.wagered * 100) / 100;
      const won = Math.round(acc.won * 100) / 100;
      return {
        session_started_at: session.created_at,
        elapsed_ms: now - Date.parse(session.created_at),
        rounds: acc.rounds,
        wagered,
        won,
        net: Math.round((won - wagered) * 100) / 100
      };
    }
  );
  // Write-ahead round intents, committed through the same write-through (no-op in memory).
  const intents = new RoundIntentStore(persistence);
  const orchestrator = new RoundOrchestrator(games, resolver, sessions, mgmt, wallet, ledger, transactions, campaigns, debits, regulatory, {
    intents,
    commit: () => persistence.flush(),
    ...(pg ? { keyUsed: (key: string) => history.keyUsed(key) } : {})
  });
  const adjustments = new InMemoryRoundAdjustmentStore(persistence);
  const reporting = new ReportingService(rounds, transactions, engine, adjustments);
  const lifecycle = new RoundLifecycleService(ledger, wallet, transactions, adjustments, audit, campaigns);
  const history: HistoryReads & Partial<PgHistory> = pg
    ? new PgHistory(pg, rounds, transactions, adjustments, signingKeyring, sessions)
    : new MemoryHistory(reporting, ledger, transactions, sessions);
  const verification = new RoundVerificationService(
    ledger,
    resolver,
    history instanceof PgHistory ? (ref) => history.roundChainHeld(ref) : undefined
  );
  const roundExport = new RoundExportService(ledger, transactions, adjustments, verification, mgmt, signingKeyring);
  const disputes = new DisputeService(lifecycle, ledger, audit, persistence);

  return {
    config,
    games,
    engine,
    mgmt,
    sessions,
    wallet,
    ledger,
    resolver,
    transactions,
    orchestrator,
    intents,
    history,
    historyWindow: pg ? win : null,
    debits,
    regulatory,
    reporting,
    adjustments,
    lifecycle,
    verification,
    roundExport,
    signingKeyring,
    disputes,
    campaigns,
    adminAuth: new AdminAuthService(config.adminSecret),
    adminAccounts: new AdminAccountService(audit, persistence, config.totpIssuer ?? "Provider Platform"),
    nonceStore: new NonceStore(config.hmacSkewSeconds * 4 * 1000),
    rateLimiter: new RateLimiter(config.rateLimitPerMin),
    persistence,
    roundsRepo: rounds,
    auditRepo: audit
  };
}

/**
 * Seed the bootstrap provider super-admin if the platform has no provider account
 * yet. Call AFTER hydration (so an existing DB account is not duplicated). The
 * seeded admin has a known password but must still enroll TOTP on first login.
 */
export function seedBootstrapAdmin(c: Container): { username: string; seeded: boolean } {
  const username = c.config.bootstrapAdminUsername ?? "admin";
  const password = c.config.bootstrapAdminPassword ?? "change-me-admin";
  if (c.adminAccounts.hasAnyProviderAccount()) return { username, seeded: false };
  c.adminAccounts.seedProviderSuperAdmin(username, password);
  return { username, seeded: true };
}

/**
 * Staging/production: every live operator must have its casino wallet webhook. Without
 * one its players would be declined on every round (and, before RoutingWallet, played
 * against the provider's sandbox balances).
 */
export function assertLiveOperatorsHaveWallets(c: Container): void {
  const missing = c.mgmt.listOperators().filter((o) => o.status === "live" && !c.mgmt.getWebhookConfig(o.id));
  if (missing.length > 0) {
    throw new Error(`Unsafe production environment: live operator(s) without a wallet webhook: ${missing.map((o) => o.slug).join(", ")}`);
  }
}
