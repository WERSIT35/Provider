import { loadGameEngine, DEFAULT_GAME_CODE, type SlotEngineNamespace, type GameRules } from "../../lib/engine-loader";
import { withSeed } from "../../lib/seeded-rng";
import { hashPayload } from "../ledger/hash-chain";
import type {
  CreateSessionInput,
  SessionInit,
  SpinInput,
  SpinResult,
  SimulateInput,
  RtpProfile
} from "./engine.types";

/**
 * Pre-spin engine session state required to deterministically resolve a round.
 * Deliberately has no crazy-mode or forced-multiplier field: see engineInput().
 */
export interface SessionSnapshot {
  gameId?: string;
  balance?: number;
  freeSpinsLeft?: number;
  freeSpinPersistentMultiplier?: number;
  bonusRoundWin?: number;
  anteEnabled?: boolean;
  /**
   * Stateful games (USES_FEATURE_STATE): the session's opaque feature state, e.g. Relic
   * Forge's relics and pending draft offer. Never set for Vault 20K, whose session
   * object therefore keeps exactly its old keys.
   */
  featureState?: unknown;
  /** Stateful games (USES_PLAYER_STATE): the player's state for this game, currency and bet. */
  playerState?: unknown;
}

/**
 * The ONLY fields the RGS ever passes to the engine's spin / buy. The shared engine
 * (client/engine/) also honours dev and test inputs that would change the outcome:
 * `force_multiplier_value`, `force_free_spin_trigger`, and the session's `crazyMode`
 * (4.5x pays, forced triggers). They exist for the browser's dev view and must never be
 * reachable from a paid round, whatever a caller or a future refactor hands us. So the
 * input is rebuilt from this allow-list here, at the engine boundary, and crazy mode and
 * forced multipliers are pinned off on every session object (buildSessionObject).
 */
function engineInput(input: { bet_amount: number; ante_enabled?: boolean; spin_id?: string; choice?: number }): SpinInput {
  return {
    bet_amount: input.bet_amount,
    ...(input.ante_enabled !== undefined ? { ante_enabled: Boolean(input.ante_enabled) } : {}),
    ...(input.spin_id !== undefined ? { spin_id: String(input.spin_id) } : {}),
    ...(input.choice !== undefined ? { choice: Number(input.choice) } : {})
  };
}

function jsonCopy<T>(value: T): T {
  return value === null || value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
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

/** A game code no registered game answers to (it would otherwise resolve with another game's math). */
export class UnknownGameError extends Error {
  readonly code = "GAME_NOT_FOUND";
  constructor(readonly gameCode: string) {
    super("GAME_NOT_FOUND"); // the stable domain code the HTTP layer maps (404); the code is on .gameCode
  }
}

/** Where the RGS gets the engine for a session's game code (one game, or the registry). */
export interface EngineSource {
  engineFor(gameCode?: string | null): EngineService;
}

/**
 * Server-side facade over ONE game's engine (games/<code>/game.json, loaded in its own
 * vm context). This is the only module that touches engine internals; everything else
 * depends on these typed methods. Several games: see GameRegistry.
 */
export class EngineService implements EngineSource {
  readonly gameCode: string;
  private readonly ns: SlotEngineNamespace;
  private readonly rules: GameRules;
  private readonly template: InstanceType<SlotEngineNamespace["SpinEngine"]>;
  private readonly sessions = new Map<string, InstanceType<SlotEngineNamespace["SpinEngine"]>>();
  private readonly ownCodes: Set<string>;

  constructor(opts: { gameCode?: string; engineDir?: string; rulesPath?: string } = {}) {
    this.gameCode = opts.gameCode ?? DEFAULT_GAME_CODE;
    const loaded = loadGameEngine(this.gameCode, opts);
    this.ns = loaded.ns;
    this.rules = loaded.rules;
    // A read-only engine for stateless lookups (allowed bets, rtp profiles).
    this.template = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
    // The session game codes this game answers to: its own, plus each RTP profile's
    // game_id (Vault 20K: bananax, bananax_94, bananax_92, …).
    this.ownCodes = new Set([this.gameCode, ...((this.rules?.rtp_profiles ?? []) as Array<{ game_id?: string }>).map((p) => String(p.game_id ?? "").toLowerCase()).filter(Boolean)]);
  }

  /** The session game codes (RTP variants) this game resolves. */
  codes(): string[] {
    return [...this.ownCodes];
  }

  /** This engine, if it is the game for `gameCode` (none = this game); else GAME_NOT_FOUND. */
  engineFor(gameCode?: string | null): EngineService {
    if (!gameCode || this.ownCodes.has(String(gameCode).toLowerCase())) return this;
    throw new UnknownGameError(String(gameCode));
  }

  isReady(): boolean {
    return Boolean(this.ns?.SpinEngine);
  }

  rulesVersion(): string {
    return String(this.rules?.version ?? "unknown");
  }

  /** The loaded engine's ENGINE_VERSION; stamped on every round for replay verification. */
  engineVersion(): string {
    return String(this.ns?.ENGINE_VERSION ?? "unversioned");
  }

  /**
   * SHA-256 of the canonical (key-order-independent) rules payload the engine resolves
   * with. Scalers, paytable and features all live in the rules, so a seed reproduces its
   * outcome only under the same engine version AND the same rules hash.
   */
  rulesHash(): string {
    if (this.cachedRulesHash === null) this.cachedRulesHash = hashPayload(this.rules);
    return this.cachedRulesHash;
  }
  private cachedRulesHash: string | null = null;

  /** The rules' max-win cap, in multiples of the bet (what the engine itself enforces). */
  maxWinMultiplier(): number {
    return Number(this.template.MAX_WIN_CAP_X);
  }

  /** Does this game have a feature buy / an ante? (Vault 20K: both; an engine says otherwise with SUPPORTS_*: false.) */
  supportsBuy(): boolean {
    return (this.template as { SUPPORTS_BUY?: boolean }).SUPPORTS_BUY !== false;
  }
  supportsAnte(): boolean {
    return (this.template as { SUPPORTS_ANTE?: boolean }).SUPPORTS_ANTE !== false;
  }

  /**
   * Stateful-game capabilities (opt-in; Vault 20K declares none, so none of its paths
   * change): a per-session feature state, a per-player state that outlives sessions,
   * and player choices between rounds.
   */
  usesFeatureState(): boolean {
    return (this.template as { USES_FEATURE_STATE?: boolean }).USES_FEATURE_STATE === true;
  }
  usesPlayerState(): boolean {
    return (this.template as { USES_PLAYER_STATE?: boolean }).USES_PLAYER_STATE === true;
  }
  supportsChoice(): boolean {
    return (this.template as { SUPPORTS_CHOICE?: boolean }).SUPPORTS_CHOICE === true;
  }

  /** How many options the next round must pick from (0 = no choice pending). */
  choiceOptions(featureState: unknown): number {
    if (!this.supportsChoice()) return 0;
    const n = Number((this.template as { choiceOptions?: (s: unknown) => number }).choiceOptions?.(featureState ?? null) ?? 0);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  getAllowedBets(): number[] {
    return this.template.getAllowedBets();
  }

  /** Ante stake multiplier from the rules (engine charges bet × this when ante is on). */
  anteMultiplier(): number {
    return Number((this.template as { ANTE_MULTIPLIER?: number }).ANTE_MULTIPLIER ?? 1.25);
  }

  /** Buy-Free-Spins cost multiplier from the rules (player is charged bet × this). */
  buyCostMultiplier(): number {
    return Number((this.template as { BUY_FREE_SPINS_COST_MULT?: number }).BUY_FREE_SPINS_COST_MULT ?? 100);
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
    return engine.spin(engineInput(input)) as SpinResult;
  }

  buyFreeSpins(sessionId: string, input: { bet_amount: number; spin_id?: string }): SpinResult {
    const engine = this.requireSession(sessionId);
    return engine.buyFreeSpins({ bet_amount: input.bet_amount, ...(input.spin_id !== undefined ? { spin_id: String(input.spin_id) } : {}) }) as SpinResult;
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
      // Pinned off, never read from the snapshot (see engineInput).
      forceMultiplierValue: null,
      anteEnabled: Boolean(snapshot.anteEnabled),
      crazyMode: false,
      spinHistory: new Map(),
      createdAt: "1970-01-01T00:00:00.000Z",
      // Stateful games only: absent keys keep Vault 20K's session object unchanged. Deep
      // copies, so an engine can never mutate the session or the stored pre-state.
      ...(snapshot.featureState !== undefined ? { featureState: jsonCopy(snapshot.featureState) } : {}),
      ...(snapshot.playerState !== undefined ? { playerState: jsonCopy(snapshot.playerState) } : {})
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
    const { result, bytesDrawn } = withSeed(seed, () => engine.spin(engineInput(input)) as SpinResult);
    return { result, bytesDrawn };
  }

  /**
   * Deterministically resolve a Buy-Free-Spins round (forces the bonus trigger).
   * Mirrors resolveDeterministic but drives engine.buyFreeSpins so the outcome —
   * and the free spins it awards — is reproducible from (seed, pre-spin state).
   */
  resolveDeterministicBuy(
    snapshot: SessionSnapshot,
    input: SpinInput,
    seedHex: string
  ): { result: SpinResult; bytesDrawn: number } {
    const engine = new this.ns.SpinEngine({ rules: this.rules, storage: new MemoryStorage() });
    engine.session = this.buildSessionObject(snapshot);
    const seed = Buffer.from(seedHex, "hex");
    const { result, bytesDrawn } = withSeed(
      seed,
      () => engine.buyFreeSpins({ bet_amount: input.bet_amount, spin_id: input.spin_id }) as SpinResult
    );
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
