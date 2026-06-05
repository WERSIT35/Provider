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
import { NonceStore } from "./lib/security/nonce-store";
import { RateLimiter } from "./lib/security/rate-limiter";

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
  adminAuth: AdminAuthService;
  nonceStore: NonceStore;
  rateLimiter: RateLimiter;
}

export function buildContainer(config: PlatformConfig, overrides: { wallet?: WalletAdapter } = {}): Container {
  const engine = new EngineService();
  const audit = new InMemoryAuditRepository();
  const mgmt = new ManagementService(audit);
  const rounds = new InMemoryRoundRepository();
  const ledger = new RoundLedgerService(rounds, audit);
  const sessions = new SessionService(mgmt, config.launchSecret);
  const wallet = overrides.wallet ?? new SandboxWallet();
  const resolver = new AuthoritativeResolver(engine);
  const transactions = new InMemoryTransactionStore();
  const orchestrator = new RoundOrchestrator(engine, resolver, sessions, mgmt, wallet, ledger, transactions);
  const reporting = new ReportingService(rounds, transactions, engine);

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
    adminAuth: new AdminAuthService(config.adminSecret),
    nonceStore: new NonceStore(config.hmacSkewSeconds * 4 * 1000),
    rateLimiter: new RateLimiter(config.rateLimitPerMin)
  };
}
