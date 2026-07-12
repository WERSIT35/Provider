import { EngineService } from "./modules/engine/engine.service";
import { AuthoritativeResolver } from "./modules/rng/authoritative-resolver";
import { ManagementService } from "./modules/management/management.service";
import { SessionService } from "./modules/session/session.service";
import { SandboxWallet } from "./modules/wallet/sandbox-wallet";
import type { WalletAdapter } from "./modules/wallet/wallet.types";
import { InMemoryTransactionStore } from "./modules/wallet/transaction-store";
import { RoundOrchestrator } from "./modules/rounds/round-orchestrator";
import { ReportingService } from "./modules/reporting/reporting.service";
import { AdminAuthService } from "./modules/admin/admin-auth";
import { RoundLedgerService } from "./modules/ledger/round-ledger.service";
import { InMemoryRoundRepository, InMemoryAuditRepository } from "./modules/ledger/memory-repositories";
import { InMemoryRoundAdjustmentStore } from "./modules/rounds/round-adjustment.store";
import { RoundLifecycleService } from "./modules/rounds/round-lifecycle.service";
import { RoundVerificationService } from "./modules/rounds/round-verification.service";
import { DisputeService } from "./modules/disputes/dispute.service";
import { NonceStore } from "./lib/security/nonce-store";
import { RateLimiter } from "./lib/security/rate-limiter";
import { NullPersistence, type Persistence } from "./persistence/persistence";

export interface PlatformConfig {
  launchSecret: string;
  sessionSecret: string;
  adminSecret: string;
  hmacSkewSeconds: number;
  rateLimitPerMin: number;
}

/**
 * Composition root for the domain services. Wires the in-memory implementations
 * (swap the ledger repos + wallet for Postgres/real adapters in production without
 * touching call sites). A single shared instance is created at boot.
 */
export interface Container {
  config: PlatformConfig;
  engine: EngineService;
  mgmt: ManagementService;
  sessions: SessionService;
  wallet: WalletAdapter;
  ledger: RoundLedgerService;
  resolver: AuthoritativeResolver;
  transactions: InMemoryTransactionStore;
  orchestrator: RoundOrchestrator;
  reporting: ReportingService;
  adjustments: InMemoryRoundAdjustmentStore;
  lifecycle: RoundLifecycleService;
  verification: RoundVerificationService;
  disputes: DisputeService;
  adminAuth: AdminAuthService;
  nonceStore: NonceStore;
  rateLimiter: RateLimiter;
  // Durable-persistence plumbing (NullPersistence when Postgres is disabled).
  persistence: Persistence;
  roundsRepo: InMemoryRoundRepository;
  auditRepo: InMemoryAuditRepository;
}

export function buildContainer(
  config: PlatformConfig,
  overrides: { wallet?: WalletAdapter; persistence?: Persistence } = {}
): Container {
  const persistence = overrides.persistence ?? NullPersistence;
  const engine = new EngineService();
  const audit = new InMemoryAuditRepository(persistence);
  const mgmt = new ManagementService(audit, persistence);
  const rounds = new InMemoryRoundRepository(persistence);
  const ledger = new RoundLedgerService(rounds, audit);
  const sessions = new SessionService(mgmt, config.launchSecret, persistence);
  const wallet = overrides.wallet ?? new SandboxWallet();
  if (wallet instanceof SandboxWallet) wallet.usePersistence(persistence);
  const resolver = new AuthoritativeResolver(engine);
  const transactions = new InMemoryTransactionStore(persistence);
  const orchestrator = new RoundOrchestrator(engine, resolver, sessions, mgmt, wallet, ledger, transactions);
  const adjustments = new InMemoryRoundAdjustmentStore(persistence);
  const reporting = new ReportingService(rounds, transactions, engine, adjustments);
  const lifecycle = new RoundLifecycleService(ledger, wallet, transactions, adjustments, audit);
  const verification = new RoundVerificationService(ledger, resolver);
  const disputes = new DisputeService(lifecycle, ledger, audit, persistence);

  return {
    config,
    engine,
    mgmt,
    sessions,
    wallet,
    ledger,
    resolver,
    transactions,
    orchestrator,
    reporting,
    adjustments,
    lifecycle,
    verification,
    disputes,
    adminAuth: new AdminAuthService(config.adminSecret),
    nonceStore: new NonceStore(config.hmacSkewSeconds * 4 * 1000),
    rateLimiter: new RateLimiter(config.rateLimitPerMin),
    persistence,
    roundsRepo: rounds,
    auditRepo: audit
  };
}
