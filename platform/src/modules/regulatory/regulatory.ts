/**
 * Jurisdiction profiles: per-operator responsible-gambling rules the RGS enforces.
 *
 * Server-authoritative where the server can see it:
 *   • min_round_ms           a new round (paid spin, buy, operator free round) may not
 *                            start sooner than this after the player's previous one
 *                            (SPIN_TOO_FAST, 429). Free spins inside a feature belong to
 *                            the round that triggered them and are not paced.
 *   • reality_check_minutes  every N minutes of a session, the next round is refused
 *                            (REALITY_CHECK_REQUIRED, 409, with the session's stats)
 *                            until the client acknowledges (POST /game/v1/reality-check/ack).
 *   • buy_feature_enabled    false → buy-feature is refused (FEATURE_BUY_DISABLED, 403).
 * Client-applied (the server cannot tell them apart from a normal spin):
 *   • autoplay_enabled, max_autoplay_spins, turbo_enabled.
 *   • slam_stop_enabled      the client may offer slam-stop (missing = follows turbo).
 *
 * The presets are illustrative starting points, NOT legal advice: an operator's
 * compliance team must confirm every value against the current rules of its licence.
 *
 * Runtime state (each player's last round start, each session's next reality check)
 * is in memory: a restart re-arms the reality check from the session start and lets
 * the first round through, both on the safe side.
 */

export interface RegulatoryProfile {
  jurisdiction: string;
  min_round_ms: number;
  reality_check_minutes: number | null;
  autoplay_enabled: boolean;
  max_autoplay_spins: number | null;
  turbo_enabled: boolean;
  /**
   * Slam-stop (a Stop press that cuts the reel animation short). Optional because profiles
   * stored before it existed lack it; a missing value follows turbo_enabled.
   */
  slam_stop_enabled?: boolean;
  buy_feature_enabled: boolean;
}

export const REGULATORY_PRESETS: Readonly<Record<string, RegulatoryProfile>> = Object.freeze({
  DEFAULT: {
    jurisdiction: "DEFAULT",
    min_round_ms: 0,
    reality_check_minutes: null,
    autoplay_enabled: true,
    max_autoplay_spins: null,
    turbo_enabled: true,
    slam_stop_enabled: true,
    buy_feature_enabled: true
  },
  // Illustrative: GB-style slot rules (2.5s minimum cycle, no autoplay, no turbo,
  // no feature buy, hourly reality check).
  UKGC: {
    jurisdiction: "UKGC",
    min_round_ms: 2500,
    reality_check_minutes: 60,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: false
  },
  // Illustrative: hourly reality check, otherwise permissive.
  MGA: {
    jurisdiction: "MGA",
    min_round_ms: 0,
    reality_check_minutes: 60,
    autoplay_enabled: true,
    max_autoplay_spins: 100,
    turbo_enabled: true,
    slam_stop_enabled: true,
    buy_feature_enabled: true
  },
  // Illustrative: Swedish-style limits (paced rounds, no feature buy, hourly check).
  SE: {
    jurisdiction: "SE",
    min_round_ms: 3000,
    reality_check_minutes: 60,
    autoplay_enabled: true,
    max_autoplay_spins: 100,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: false
  }
});

export class RegulatoryError extends Error {
  constructor(
    code: "SPIN_TOO_FAST" | "REALITY_CHECK_REQUIRED" | "FEATURE_BUY_DISABLED",
    public readonly details: Record<string, unknown> = {}
  ) {
    super(code);
    this.name = "RegulatoryError";
  }
}

/**
 * Build a profile from a preset name and/or explicit fields (fields override the
 * preset). Throws REGULATORY_INVALID:<field> on a bad value.
 */
export function buildRegulatoryProfile(input: { preset?: unknown } & Partial<Record<keyof RegulatoryProfile, unknown>>): RegulatoryProfile {
  const presetName = input.preset === undefined ? "DEFAULT" : String(input.preset).toUpperCase();
  const base = REGULATORY_PRESETS[presetName];
  if (!base) throw new Error("REGULATORY_INVALID:preset");
  const p: RegulatoryProfile = { ...base };
  const bad = (f: string) => new Error(`REGULATORY_INVALID:${f}`);
  if (input.jurisdiction !== undefined) {
    if (typeof input.jurisdiction !== "string" || !/^[A-Z0-9_-]{2,16}$/i.test(input.jurisdiction)) throw bad("jurisdiction");
    p.jurisdiction = input.jurisdiction.toUpperCase();
  }
  if (input.min_round_ms !== undefined) {
    const v = input.min_round_ms;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 60_000) throw bad("min_round_ms");
    p.min_round_ms = v;
  }
  if (input.reality_check_minutes !== undefined) {
    const v = input.reality_check_minutes;
    if (v !== null && (typeof v !== "number" || !(v > 0) || v > 1440)) throw bad("reality_check_minutes");
    p.reality_check_minutes = v as number | null;
  }
  if (input.max_autoplay_spins !== undefined) {
    const v = input.max_autoplay_spins;
    if (v !== null && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 10_000)) throw bad("max_autoplay_spins");
    p.max_autoplay_spins = v as number | null;
  }
  for (const f of ["autoplay_enabled", "turbo_enabled", "slam_stop_enabled", "buy_feature_enabled"] as const) {
    if (input[f] !== undefined) {
      if (typeof input[f] !== "boolean") throw bad(f);
      p[f] = input[f] as boolean;
    }
  }
  if (!p.autoplay_enabled) p.max_autoplay_spins = 0;
  return p;
}

export interface SessionStats {
  session_started_at: string;
  elapsed_ms: number;
  rounds: number;
  wagered: number;
  won: number;
  net: number;
}

interface SessionRef {
  id: string;
  operator_id: string;
  operator_player_id: string;
  created_at: string;
}

export class RegulatoryService {
  /** `${operator}:${player}` → ms of the player's last round start (any session). */
  private readonly lastRoundAt = new Map<string, number>();
  /** session id → ms when the next reality check is due (after an ack). */
  private readonly realityDueAt = new Map<string, number>();

  constructor(
    private readonly profileFor: (operatorId: string) => RegulatoryProfile,
    private readonly statsFor: (session: SessionRef, now: number) => SessionStats,
    public now: () => number = () => Date.now()
  ) {}

  /** An evicted session: drop its reality-check timer (housekeeping, app.ts). */
  forgetSession(sessionId: string): void {
    this.realityDueAt.delete(sessionId);
  }

  profile(operatorId: string): RegulatoryProfile {
    return this.profileFor(operatorId);
  }

  /** ms until the session's next reality check (≤ 0 = due now); null when there is none. */
  realityCheckDueIn(session: SessionRef): number | null {
    const minutes = this.profile(session.operator_id).reality_check_minutes;
    if (!minutes) return null;
    const due = this.realityDueAt.get(session.id) ?? Date.parse(session.created_at) + minutes * 60_000;
    return due - this.now();
  }

  /**
   * Gate a round start. `kind`: a paid spin or operator free round ("round"), a
   * buy-feature ("buy"), or a free spin inside a feature ("feature_spin", only the
   * reality check applies). Throws a RegulatoryError; records the start on success.
   */
  beforeRound(session: SessionRef, kind: "round" | "buy" | "feature_spin"): void {
    const p = this.profile(session.operator_id);
    const now = this.now();
    if (kind === "buy" && !p.buy_feature_enabled) throw new RegulatoryError("FEATURE_BUY_DISABLED", { jurisdiction: p.jurisdiction });
    const dueIn = this.realityCheckDueIn(session);
    if (dueIn !== null && dueIn <= 0) {
      throw new RegulatoryError("REALITY_CHECK_REQUIRED", { jurisdiction: p.jurisdiction, ...this.statsFor(session, now) });
    }
    if (kind === "feature_spin") return;
    const key = `${session.operator_id}:${session.operator_player_id}`;
    const last = this.lastRoundAt.get(key);
    if (p.min_round_ms > 0 && last !== undefined && now - last < p.min_round_ms) {
      throw new RegulatoryError("SPIN_TOO_FAST", { retry_after_ms: p.min_round_ms - (now - last), min_round_ms: p.min_round_ms });
    }
    this.lastRoundAt.set(key, now);
  }

  /** What the reality-check screen shows: time until due (≤ 0 = due) and the session so far. */
  status(session: SessionRef): { due_in_ms: number | null; stats: SessionStats } {
    return { due_in_ms: this.realityCheckDueIn(session), stats: this.statsFor(session, this.now()) };
  }

  /** The player acknowledged the reality check: the next one is a full interval away. */
  acknowledgeRealityCheck(session: SessionRef): { next_due_in_ms: number | null; stats: SessionStats } {
    const minutes = this.profile(session.operator_id).reality_check_minutes;
    const now = this.now();
    if (minutes) this.realityDueAt.set(session.id, now + minutes * 60_000);
    return { next_due_in_ms: minutes ? minutes * 60_000 : null, stats: this.statsFor(session, now) };
  }
}
