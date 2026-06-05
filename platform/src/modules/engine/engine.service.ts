import { loadSlotEngine, type SlotEngineNamespace, type GameRules } from "../../lib/engine-loader";
import { withSeed } from "../../lib/seeded-rng";
import type {
  CreateSessionInput,
  SessionInit,
  SpinInput,
  SpinResult,
  SimulateInput,
  RtpProfile
} from "./engine.types";

/** Pre-spin engine session state required to deterministically resolve a round. */
export interface SessionSnapshot {
  gameId?: string;
  balance?: number;
  freeSpinsLeft?: number;
  freeSpinPersistentMultiplier?: number;
  bonusRoundWin?: number;
  anteEnabled?: boolean;
  crazyMode?: boolean;
}

/**
 * In-memory storage shim implementing the subset of the Web Storage API the
 * engine's SessionStore uses. Each engine instance gets its own, so sessions
 * never leak into each other (the browser engine assumes a single localStorage).
 *
 * NOTE: This per-session in-memory map is Phase 1 only. Phase 2 replaces it with
 * Postgres-backed sessions + an immutable round ledger.
 */
class MemoryStorage {
  private store = new Map<string, string>();
  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
}

/**
 * Server-side facade over the Banana X engine. This is the only module that
 * touches engine internals; everything else depends on these typed methods.
 */
export class EngineService {
  private readonly ns: SlotEngineNamespace;
  private readonly rules: GameRules;
  private readonly template: InstanceType<SlotEngineNamespace["SpinEngine"]>;
  private readonly sessions = new Map<string, InstanceType<SlotEngineNamespace["SpinEngine"]>>();

  constructor(opts: { engineDir?: string; rulesPath?: string } = {}) {
    const loaded = loadSlotEngine(opts);
    this.ns = loaded.ns;
    this.rules = loaded.rules;
    // A read-only engine for stateless lookups (allowed bets, rtp profiles).
    this.template = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
  }

  isReady(): boolean {
    return Boolean(this.ns?.SpinEngine);
  }

  rulesVersion(): string {
    return String(this.rules?.version ?? "unknown");
  }

  getAllowedBets(): number[] {
    return this.template.getAllowedBets();
  }

  /** Ante stake multiplier from the rules (engine charges bet × this when ante is on). */
  anteMultiplier(): number {
    return Number((this.template as { ANTE_MULTIPLIER?: number }).ANTE_MULTIPLIER ?? 1.25);
  }

  getRtpProfile(gameId?: string): RtpProfile {
    return this.template.getRtpProfile(gameId) as RtpProfile;
  }

  /** Create a new player session and return the init payload. */
  createSession(input: CreateSessionInput = {}): SessionInit {
    const engine = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
    const init = engine.initSession(input) as SessionInit;
    this.sessions.set(init.session_id, engine);
    return init;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  private requireSession(sessionId: string): InstanceType<SlotEngineNamespace["SpinEngine"]> {
    const engine = this.sessions.get(sessionId);
    if (!engine) throw new Error("SESSION_NOT_FOUND");
    return engine;
  }

  /** Resolve a spin server-side. Idempotent per (session, spin_id). */
  spin(sessionId: string, input: SpinInput): SpinResult {
    const engine = this.requireSession(sessionId);
    return engine.spin(input) as SpinResult;
  }

  buyFreeSpins(sessionId: string, input: { bet_amount: number; spin_id?: string }): SpinResult {
    const engine = this.requireSession(sessionId);
    return engine.buyFreeSpins(input) as SpinResult;
  }

  getSessionState(sessionId: string): Record<string, unknown> {
    const engine = this.requireSession(sessionId);
    return engine.getSession() as Record<string, unknown>;
  }

  /**
   * Build a fully-specified pre-spin session object from a snapshot. Identifiers
   * and timestamps are fixed constants because they do not affect the game outcome
   * (the engine's result depends only on rules, session economic state, bet, and RNG).
   */
  buildSessionObject(snapshot: SessionSnapshot = {}): Record<string, unknown> {
    const gameId = snapshot.gameId ?? this.getRtpProfile().game_id;
    return {
      sessionId: "deterministic",
      playerId: "deterministic",
      currency: "GEL",
      locale: "en",
      gameId,
      rtpProfile: this.getRtpProfile(gameId),
      balance: snapshot.balance ?? 1000,
      freeSpinsLeft: snapshot.freeSpinsLeft ?? 0,
      freeSpinPersistentMultiplier: snapshot.freeSpinPersistentMultiplier ?? 0,
      bonusRoundWin: snapshot.bonusRoundWin ?? 0,
      forceMultiplierValue: null,
      anteEnabled: Boolean(snapshot.anteEnabled),
      crazyMode: Boolean(snapshot.crazyMode),
      spinHistory: new Map(),
      createdAt: "1970-01-01T00:00:00.000Z"
    };
  }

  /**
   * Resolve a spin deterministically: a fresh engine seeded with `seedHex` and the
   * given pre-spin session state. Re-running with the same inputs reproduces the
   * exact same outcome — the basis for replay/audit.
   */
  resolveDeterministic(
    snapshot: SessionSnapshot,
    input: SpinInput,
    seedHex: string
  ): { result: SpinResult; bytesDrawn: number } {
    const engine = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
    engine.session = this.buildSessionObject(snapshot);
    const seed = Buffer.from(seedHex, "hex");
    const { result, bytesDrawn } = withSeed(seed, () => engine.spin(input) as SpinResult);
    return { result, bytesDrawn };
  }

  /** Run an in-process Monte Carlo simulation (used by the RTP smoke script). */
  simulate(input: SimulateInput): Record<string, unknown> {
    const gameId = input.gameId ?? this.getRtpProfile().game_id;
    const engine = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
    engine.session = {
      sessionId: "sim",
      gameId,
      rtpProfile: engine.getRtpProfile(gameId),
      balance: 0,
      freeSpinsLeft: 0,
      freeSpinPersistentMultiplier: 1,
      forceMultiplierValue: null,
      anteEnabled: Boolean(input.anteEnabled),
      crazyMode: false,
      spinHistory: new Map(),
      createdAt: new Date().toISOString()
    };
    return this.ns.Simulator.simulate(engine, {
      steps: input.steps,
      betAmount: input.betAmount,
      anteEnabled: Boolean(input.anteEnabled),
      bonusOnly: Boolean(input.bonusOnly),
      gameId
    }) as Record<string, unknown>;
  }
}
