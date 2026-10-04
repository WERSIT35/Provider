import { randomUUID } from "node:crypto";
import { signToken, verifyToken } from "../../lib/tokens";
import type { ManagementService } from "../management/management.service";
import type { SpinResult } from "../engine/engine.types";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

export interface Session {
  id: string;
  operator_id: string;
  game_id: string;
  game_code: string;
  math_config_id: string;
  operator_player_id: string;
  currency: string;
  allowed_bets: number[];
  status: "active" | "closed";
  free_spins_left: number;
  free_spin_multiplier_carry: number;
  /** Running win of the current feature round (trigger spin + free spins so far); the engine caps it at max win. */
  bonus_round_win: number;
  /**
   * Bonus-feature lock. Snapshotted from the round that TRIGGERED the engine's
   * free-spins feature and held until the feature ends (free_spins_left back to 0).
   * While set, every feature spin plays exactly these terms and the client's
   * requested bet/ante are ignored: otherwise a player could trigger at 1.00 and
   * play the (0-cost) feature at 500.00, or switch ante on mid-feature to double
   * the scatter rate for free. A campaign id/grant id means the feature was
   * triggered by an operator free round, so its wins are FREE_ROUND_WIN.
   */
  locked_bet: number | null;
  locked_currency: string | null;
  locked_ante: boolean | null;
  locked_campaign_id: string | null;
  locked_grant_id: string | null;
  created_at: string;
}

/** The terms a bonus feature is locked to (see Session.locked_*). */
export interface FeatureLock {
  bet: number;
  currency: string;
  ante_enabled: boolean;
  campaign_id: string | null;
  grant_id: string | null;
}

export interface LaunchRequest {
  operator_id: string;
  game_code: string;
  operator_player_id: string;
  currency: string;
  origin: string;
}

const UNLOCKED = {
  locked_bet: null,
  locked_currency: null,
  locked_ante: null,
  locked_campaign_id: null,
  locked_grant_id: null
} as const;

/**
 * Phase 4: signed launch tokens → player sessions (plan §4/§5 steps 1–2).
 * The operator mints a short-lived launch token (validated against operator status,
 * game assignment and the domain allowlist); the game client exchanges it for a
 * session bound to exactly one operator+game+player+currency.
 */
export class SessionService {
  private readonly sessions = new Map<string, Session>();

  constructor(
    private readonly mgmt: ManagementService,
    private readonly launchSecret: string,
    private readonly persistence: Persistence = NullPersistence
  ) {}

  hydrate(rows: Session[]): void {
    for (const s of rows) this.sessions.set(s.id, s);
  }

  /**
   * Operator-side: produce a signed launch token after validating access.
   * Defaults to a short 60s single-use handoff (production semantics); demo
   * callers (dev-seed, the portal's Launch-demo helper) pass a longer ttl so a
   * hand-driven test session doesn't expire before the URL is even opened.
   */
  createLaunchToken(req: LaunchRequest, ttlSeconds = 60): string {
    this.mgmt.assertOperatorActive(req.operator_id);
    const allowed =
      this.mgmt.isDomainAllowed(req.operator_id, req.origin, "prod") ||
      this.mgmt.isDomainAllowed(req.operator_id, req.origin, "sandbox");
    if (!allowed) throw new Error("DOMAIN_NOT_ALLOWED");
    if (!this.mgmt.findOperatorGame(req.operator_id, req.game_code, req.currency)) {
      throw new Error("GAME_NOT_ASSIGNED");
    }
    return signToken(this.launchSecret, { ...req }, ttlSeconds);
  }

  /** Client-side: exchange a launch token for a session. */
  initSession(launchToken: string): Session {
    const claims = verifyToken(this.launchSecret, launchToken) as unknown as LaunchRequest;
    this.mgmt.assertOperatorActive(claims.operator_id);
    const og = this.mgmt.findOperatorGame(claims.operator_id, claims.game_code, claims.currency);
    if (!og) throw new Error("GAME_NOT_ASSIGNED");

    const session: Session = {
      id: randomUUID(),
      operator_id: claims.operator_id,
      game_id: og.game_id,
      game_code: claims.game_code,
      math_config_id: og.math_config_id,
      operator_player_id: claims.operator_player_id,
      currency: claims.currency,
      allowed_bets: [...og.allowed_bets],
      status: "active",
      free_spins_left: 0,
      free_spin_multiplier_carry: 0,
      bonus_round_win: 0,
      ...UNLOCKED,
      created_at: new Date().toISOString()
    };
    this.sessions.set(session.id, session);
    this.persistence.save("player_sessions", session);
    return { ...session };
  }

  get(sessionId: string): Session {
    const s = this.sessions.get(sessionId);
    if (!s) throw new Error("SESSION_NOT_FOUND");
    if (s.status !== "active") throw new Error("SESSION_EXPIRED");
    return s;
  }

  /** Best-effort lookup; returns null if the session is unknown or already closed. */
  tryGet(sessionId: string): Session | null {
    const s = this.sessions.get(sessionId);
    return s ? { ...s } : null;
  }

  /** Tenant-scoped read: every session (active or closed) opened for an operator. */
  listByOperator(operatorId: string): Session[] {
    return Array.from(this.sessions.values())
      .filter((s) => s.operator_id === operatorId)
      .map((s) => ({ ...s }));
  }

  /**
   * Sync engine-driven game state (free spins, persistent multiplier) post-round,
   * and maintain the bonus-feature lock: `roundTerms` are the terms the round was
   * played at. Entering the feature snapshots them; leaving it clears the lock.
   * Retriggers inside the feature keep the original lock (the terms are identical).
   */
  applyResult(sessionId: string, result: SpinResult, roundTerms: FeatureLock): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.free_spins_left = Number(result.free_spins_left ?? s.free_spins_left);
    const carry = (result as { free_spin_multiplier_current?: number }).free_spin_multiplier_current;
    if (typeof carry === "number") s.free_spin_multiplier_carry = carry;
    const bonusTotal = (result as { bonus_round_win?: number }).bonus_round_win;
    if (typeof bonusTotal === "number") s.bonus_round_win = bonusTotal;
    if (s.free_spins_left <= 0) {
      s.bonus_round_win = 0;
      Object.assign(s, UNLOCKED);
    } else if (s.locked_bet == null) {
      this.writeLock(s, roundTerms);
    }
    this.persistence.save("player_sessions", s);
  }

  /** The active feature lock, or null when the session is not in a locked feature. */
  featureLock(sessionId: string): FeatureLock | null {
    const s = this.sessions.get(sessionId);
    if (!s || s.locked_bet == null) return null;
    return {
      bet: s.locked_bet,
      currency: s.locked_currency as string,
      ante_enabled: Boolean(s.locked_ante),
      campaign_id: s.locked_campaign_id ?? null,
      grant_id: s.locked_grant_id ?? null
    };
  }

  /** Install a lock on a session already mid-feature (legacy sessions; see orchestrator). */
  lockFeature(sessionId: string, terms: FeatureLock): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.free_spins_left <= 0) return;
    this.writeLock(s, terms);
    this.persistence.save("player_sessions", s);
  }

  private writeLock(s: Session, t: FeatureLock): void {
    s.locked_bet = t.bet;
    s.locked_currency = t.currency;
    s.locked_ante = t.ante_enabled;
    s.locked_campaign_id = t.campaign_id;
    s.locked_grant_id = t.grant_id;
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = "closed";
      this.persistence.save("player_sessions", s);
    }
  }
}
