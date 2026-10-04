import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";
import { hashPassword, verifyPassword } from "../../../platform/src/lib/security/password";
import type { CasinoDatabase } from "../db/database";

declare module "fastify" {
  interface FastifyRequest {
    staffUser?: string;
  }
}

export const STAFF_COOKIE = "casino_staff";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // one shift
const MAX_FAILURES = 5;
const FAILURE_WINDOW_MS = 5 * 60 * 1000;

const sha256 = (v: string): string => createHash("sha256").update(v).digest("hex");

/** Constant-time string comparison (hashes first so lengths never leak). */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(Buffer.from(sha256(a), "hex"), Buffer.from(sha256(b), "hex"));
}

/**
 * Back-office staff authentication.
 *
 * Demo scope: one staff account from config (default casino_admin / demo123). The password
 * is scrypt-hashed at boot and checked in constant time. A successful login issues a random
 * 256-bit token in an HttpOnly, SameSite=Strict cookie; only its SHA-256 is stored (SQLite
 * staff_sessions), so logout and expiry truly revoke and a database leak exposes no live
 * session. SameSite=Strict + the JSON-only body parser keep cross-site requests out (no CSRF).
 * Repeated failures for a username or client IP are throttled.
 */
export class StaffAuth {
  private readonly passwordHash: string;
  private readonly failures = new Map<string, { count: number; first: number }>();

  constructor(
    private readonly db: CasinoDatabase,
    private readonly username: string,
    password: string
  ) {
    this.passwordHash = hashPassword(password);
  }

  /** Returns a session token, or null for bad credentials. Throws "TOO_MANY_ATTEMPTS" when throttled. */
  login(username: string, password: string, clientIp: string): { token: string; expiresAt: string } | null {
    const keys = [`u:${username.toLowerCase()}`, `ip:${clientIp}`];
    const now = Date.now();
    if (keys.some((k) => this.isThrottled(k, now))) throw new Error("TOO_MANY_ATTEMPTS");

    const ok = safeEqual(username, this.username) && verifyPassword(password, this.passwordHash);
    if (!ok) {
      for (const k of keys) this.recordFailure(k, now);
      return null;
    }
    for (const k of keys) this.failures.delete(k);

    this.db.prepare("DELETE FROM staff_sessions WHERE expires_at <= ?").run(new Date(now).toISOString());
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
    this.db
      .prepare("INSERT INTO staff_sessions (token_hash, username, created_at, expires_at) VALUES (?, ?, ?, ?)")
      .run(sha256(token), this.username, new Date(now).toISOString(), expiresAt);
    return { token, expiresAt };
  }

  /** The staff username for a live session token, or null. */
  verify(token: string | undefined): string | null {
    if (!token) return null;
    const row = this.db
      .prepare("SELECT username, expires_at FROM staff_sessions WHERE token_hash = ?")
      .get(sha256(token)) as { username: string; expires_at: string } | undefined;
    if (!row || row.expires_at <= new Date().toISOString()) return null;
    return row.username;
  }

  logout(token: string | undefined): void {
    if (token) this.db.prepare("DELETE FROM staff_sessions WHERE token_hash = ?").run(sha256(token));
  }

  /** preHandler for every back-office API route: 401 unless a live staff session cookie is present. */
  guard(): preHandlerHookHandler {
    return async (req: FastifyRequest, reply: FastifyReply) => {
      const user = this.verify(readCookie(req, STAFF_COOKIE));
      if (!user) return reply.code(401).send({ error: { code: "STAFF_AUTH_REQUIRED", message: "sign in to the back-office" } });
      req.staffUser = user;
    };
  }

  private isThrottled(key: string, now: number): boolean {
    const f = this.failures.get(key);
    if (!f) return false;
    if (now - f.first > FAILURE_WINDOW_MS) {
      this.failures.delete(key);
      return false;
    }
    return f.count >= MAX_FAILURES;
  }

  private recordFailure(key: string, now: number): void {
    const f = this.failures.get(key);
    if (!f || now - f.first > FAILURE_WINDOW_MS) this.failures.set(key, { count: 1, first: now });
    else f.count += 1;
  }
}

export function readCookie(req: FastifyRequest, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** Set-Cookie value for the staff session (Secure is added when served over HTTPS). */
export function sessionCookie(token: string, expiresAt: string, secure: boolean): string {
  const maxAge = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  return `${STAFF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function clearedCookie(secure: boolean): string {
  return `${STAFF_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure ? "; Secure" : ""}`;
}
