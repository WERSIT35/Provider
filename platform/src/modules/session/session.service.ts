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
  created_at: string;
}

export interface LaunchRequest {
  operator_id: string;
  game_code: string;
  operator_player_id: string;
  currency: string;
  origin: string;
}

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

  /** Sync engine-driven game state (free spins, persistent multiplier) post-round. */
  applyResult(sessionId: string, result: SpinResult): void {
    const s = this.sessions.get(sessionId);
    if (!s) return;
    s.free_spins_left = Number(result.free_spins_left ?? s.free_spins_left);
    const carry = (result as { free_spin_multiplier_current?: number }).free_spin_multiplier_current;
    if (typeof carry === "number") s.free_spin_multiplier_carry = carry;
    this.persistence.save("player_sessions", s);
  }

  close(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s) {
      s.status = "closed";
      this.persistence.save("player_sessions", s);
    }
  }
}
