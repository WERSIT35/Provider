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
 *   • celebrate_threshold    "gt_stake": no win effects when a round returns at or below its
 *                            stake (UK RTS 14F, Ontario AGCO 2.20); "any": every win celebrates.
 *   • max_stake              the market's stake cap per game cycle, bet + ante or the buy price
 *                            (UK £5; £2 for under-25s is max_stake_young, which needs the
 *                            player's age band from the operator). Shown and clamped by the
 *                            client; NOT enforced by the RGS yet (that is a money-flow change).
 *   • session_hud            what the session strip shows: "none" | "net_time" (net position +
 *                            time) | "panic" (Germany: operator panic button in the host zone) |
 *                            "balance" | "session" (balance, staked, won) | "clock_elapsed".
 *   • rtp_display            "info" (in the rules) | "stake_area" (Germany: where the stake is placed).
 *   • no_input_queue         presses never queue: release-then-press (UK RTS 14D, SIFS 2022:3).
 * The Lumina clients read these through the shared shell (client/shell/shell.js); a profile
 * stored before a field existed sends nothing and the shell falls back on the jurisdiction.
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
  /** Optional on stored profiles (added 2026-10); see the header for each. */
  celebrate_threshold?: CelebrateThreshold;
  max_stake?: number | null;
  max_stake_young?: number | null;
  session_hud?: SessionHud;
  rtp_display?: RtpDisplay;
  no_input_queue?: boolean;
}

export type CelebrateThreshold = "any" | "gt_stake";
export type SessionHud = "none" | "net_time" | "panic" | "balance" | "session" | "clock_elapsed";
export type RtpDisplay = "info" | "stake_area";
const CELEBRATE: readonly CelebrateThreshold[] = ["any", "gt_stake"];
const SESSION_HUD: readonly SessionHud[] = ["none", "net_time", "panic", "balance", "session", "clock_elapsed"];
const RTP_DISPLAY: readonly RtpDisplay[] = ["info", "stake_area"];

// Presets are illustrative starting points from public sources (reports/Slot provider UI and
// motion.md, Part 3), NOT legal advice. VERIFIED = from the regulator's own text;
// UNCONFIRMED = from law-firm summaries or press: confirm with the test lab and counsel.
export const REGULATORY_PRESETS: Readonly<Record<string, RegulatoryProfile>> = Object.freeze({
  DEFAULT: {
    jurisdiction: "DEFAULT",
    min_round_ms: 0,
    reality_check_minutes: null,
    autoplay_enabled: true,
    max_autoplay_spins: null,
    turbo_enabled: true,
    slam_stop_enabled: true,
    buy_feature_enabled: true,
    celebrate_threshold: "any",
    max_stake: null,
    max_stake_young: null,
    session_hud: "none",
    rtp_display: "info",
    no_input_queue: true
  },
  // GB online slots: 2.5 s per cycle, no autoplay, no turbo or slam stop (RTS 14D/14E, 8C),
  // no win effects at or below the stake (14F), £5 / £2 (under 25) per cycle (VERIFIED, 2025).
  // Buy stays off here as before: offering it means clamping its price under the cap.
  UKGC: {
    jurisdiction: "UKGC",
    min_round_ms: 2500,
    reality_check_minutes: 60,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: false,
    celebrate_threshold: "gt_stake",
    max_stake: 5,
    max_stake_young: 2,
    session_hud: "net_time",
    rtp_display: "info",
    no_input_queue: true
  },
  // Ontario (AGCO Registrar's Standards 2.15-2.22, VERIFIED): 2.5 s, no autoplay, no turbo or
  // slam stop, no celebration at or below the stake, net position in C$ and elapsed time.
  ON: {
    jurisdiction: "ON",
    min_round_ms: 2500,
    reality_check_minutes: 60,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: true,
    celebrate_threshold: "gt_stake",
    max_stake: null,
    max_stake_young: null,
    session_hud: "net_time",
    rtp_display: "info",
    no_input_queue: true
  },
  // Germany (GlüStV 2021 §22a, §6i, VERIFIED): 5 s per spin on average, no autoplay, €1 per spin,
  // payout per €1 shown where the stake is placed, panic button. A reported 2026 raise of the
  // stake cap is UNCONFIRMED and NOT encoded. Buy off (a feature buy cannot fit the €1 cap).
  DE: {
    jurisdiction: "DE",
    min_round_ms: 5000,
    reality_check_minutes: 60,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: false,
    celebrate_threshold: "gt_stake",
    max_stake: 1,
    max_stake_young: null,
    session_hud: "panic",
    rtp_display: "stake_area",
    no_input_queue: true
  },
  // Illustrative: hourly reality check, otherwise permissive. No-celebrate at or below the stake is
  // Lumina's own policy here (REC), not a Maltese rule.
  MGA: {
    jurisdiction: "MGA",
    min_round_ms: 0,
    reality_check_minutes: 60,
    autoplay_enabled: true,
    max_autoplay_spins: 100,
    turbo_enabled: true,
    slam_stop_enabled: true,
    buy_feature_enabled: true,
    celebrate_threshold: "gt_stake",
    max_stake: null,
    max_stake_young: null,
    session_hud: "none",
    rtp_display: "info",
    no_input_queue: true
  },
  // Sweden (SIFS 2022:3, VERIFIED: 3 s per round, presses never queue; autoplay ban UNCONFIRMED).
  SE: {
    jurisdiction: "SE",
    min_round_ms: 3000,
    reality_check_minutes: 60,
    autoplay_enabled: true,
    max_autoplay_spins: 100,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: false,
    celebrate_threshold: "gt_stake",
    max_stake: null,
    max_stake_young: null,
    session_hud: "balance",
    rtp_display: "info",
    no_input_queue: true
  },
  // Spain (UNCONFIRMED, law-firm summary of RD 958/2020 and the slots licence): 3 s, ≤ 100
  // auto-spins, session balance, staked and won on screen.
  ES: {
    jurisdiction: "ES",
    min_round_ms: 3000,
    reality_check_minutes: 60,
    autoplay_enabled: true,
    max_autoplay_spins: 100,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: true,
    celebrate_threshold: "gt_stake",
    max_stake: null,
    max_stake_young: null,
    session_hud: "session",
    rtp_display: "info",
    no_input_queue: true
  },
  // Netherlands (UNCONFIRMED, regulator press statements: no autoplay).
  NL: {
    jurisdiction: "NL",
    min_round_ms: 0,
    reality_check_minutes: 60,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: false,
    slam_stop_enabled: false,
    buy_feature_enabled: true,
    celebrate_threshold: "gt_stake",
    max_stake: null,
    max_stake_young: null,
    session_hud: "none",
    rtp_display: "info",
    no_input_queue: true
  },
  // New Jersey (N.J.A.C. 13:69O-1.5, VERIFIED): autoplay only with the Division's approval
  // (off here), clock and elapsed time (or a 30-minute pop-up).
  NJ: {
    jurisdiction: "NJ",
    min_round_ms: 0,
    reality_check_minutes: 30,
    autoplay_enabled: false,
    max_autoplay_spins: 0,
    turbo_enabled: true,
    slam_stop_enabled: true,
    buy_feature_enabled: true,
    celebrate_threshold: "any",
    max_stake: null,
    max_stake_young: null,
    session_hud: "clock_elapsed",
    rtp_display: "info",
    no_input_queue: true
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
  if (input.celebrate_threshold !== undefined) {
    if (!CELEBRATE.includes(input.celebrate_threshold as CelebrateThreshold)) throw bad("celebrate_threshold");
    p.celebrate_threshold = input.celebrate_threshold as CelebrateThreshold;
  }
  for (const f of ["max_stake", "max_stake_young"] as const) {
    if (input[f] !== undefined) {
      const v = input[f];
      if (v !== null && (typeof v !== "number" || !(v > 0) || v > 1_000_000)) throw bad(f);
      p[f] = v as number | null;
    }
  }
  if (input.session_hud !== undefined) {
    if (!SESSION_HUD.includes(input.session_hud as SessionHud)) throw bad("session_hud");
    p.session_hud = input.session_hud as SessionHud;
  }
  if (input.rtp_display !== undefined) {
    if (!RTP_DISPLAY.includes(input.rtp_display as RtpDisplay)) throw bad("rtp_display");
    p.rtp_display = input.rtp_display as RtpDisplay;
  }
  if (input.no_input_queue !== undefined) {
    if (typeof input.no_input_queue !== "boolean") throw bad("no_input_queue");
    p.no_input_queue = input.no_input_queue;
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
