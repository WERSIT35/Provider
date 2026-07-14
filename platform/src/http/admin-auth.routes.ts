import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { envelope } from "./errors";
import { signToken, verifyToken, type TokenClaims } from "../lib/tokens";
import type { Container } from "../container";
import type { AdminAccount } from "../modules/admin/admin-account";

/**
 * Admin login (both consoles): username + password → TOTP 2FA → session token.
 * Unauthenticated endpoints (they MINT the bearer token that admin.routes verifies).
 *
 * Two short-lived, signed intermediate tokens gate the multi-step flows so no step
 * can be skipped:
 *   • mfa_token   — proves the password step passed; spend it on /login/mfa.
 *   • setup ticket — proves password step during first-login; drives the forced
 *                    password-set + TOTP-enrollment sequence.
 * Both are signed with the same admin secret and carry a `purpose` claim.
 */

const MFA_TTL_SECONDS = 120;
const SETUP_TTL_SECONDS = 600;
const MIN_PASSWORD_LEN = 8;

const loginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });
const mfaBody = z.object({ mfa_token: z.string().min(1), code: z.string().min(1) });
const setPwBody = z.object({ ticket: z.string().min(1), new_password: z.string().min(MIN_PASSWORD_LEN) });
const beginBody = z.object({ ticket: z.string().min(1) });
const confirmBody = z.object({ ticket: z.string().min(1), code: z.string().min(1) });

interface MfaClaims extends TokenClaims { purpose: "mfa"; admin_id: string }
interface SetupClaims extends TokenClaims { purpose: "setup"; admin_id: string }

function bad(reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string): FastifyReply {
  return reply.code(status).send(envelope(code, message, req.id));
}

const adminAuthRoutes: FastifyPluginAsync = async (app) => {
  const c = app.container;
  const secret = c.config.adminSecret;

  // Issue the final admin session token from an account (same shape admin.routes verifies).
  const mintSession = (a: AdminAccount): { token: string; scope: string; role: string } => {
    c.adminAccounts.recordSuccessfulLogin(a.id);
    const token = c.adminAuth.mintToken({ admin_id: a.id, scope: a.scope, operator_id: a.operator_id, role: a.role });
    return { token, scope: a.scope, role: a.role };
  };

  // Re-fetch the live account behind a ticket/mfa token (flags may have changed mid-flow).
  const accountFor = (adminId: string): AdminAccount | null => c.adminAccounts.getById(adminId);

  // Step 1 — password. Returns either an mfa challenge or a first-login setup ticket.
  app.post("/admin/v1/auth/login", async (req, reply) => {
    const parsed = loginBody.safeParse(req.body);
    if (!parsed.success) return bad(reply, req, 400, "BAD_REQUEST", "username and password required");
    const { username, password } = parsed.data;

    if (!c.rateLimiter.allow(`login:${username.toLowerCase()}`)) {
      return bad(reply, req, 429, "RATE_LIMITED", "too many attempts, slow down");
    }

    const account = c.adminAccounts.getByUsername(username);
    // Generic failure for unknown user / wrong password — never reveal which.
    if (!account) return bad(reply, req, 401, "INVALID_CREDENTIALS", "invalid username or password");
    if (account.status === "disabled") return bad(reply, req, 403, "ACCOUNT_DISABLED", "account disabled");
    if (c.adminAccounts.isLocked(account)) {
      return bad(reply, req, 423, "ACCOUNT_LOCKED", "account temporarily locked after failed attempts");
    }
    if (!c.adminAccounts.verifyPassword(account, password)) {
      c.adminAccounts.recordFailedLogin(account.id);
      return bad(reply, req, 401, "INVALID_CREDENTIALS", "invalid username or password");
    }

    // First login: force password reset and/or TOTP enrollment before any session.
    if (account.must_set_password || !account.totp_enrolled) {
      const ticket = signToken(secret, { purpose: "setup", admin_id: account.id }, SETUP_TTL_SECONDS);
      return reply.send({
        setup_required: true,
        ticket,
        needs_password: account.must_set_password,
        needs_totp: !account.totp_enrolled
      });
    }

    const mfa_token = signToken(secret, { purpose: "mfa", admin_id: account.id }, MFA_TTL_SECONDS);
    return reply.send({ mfa_required: true, mfa_token });
  });

  // Step 2 — TOTP. Spends the mfa_token, returns the session token.
  app.post("/admin/v1/auth/login/mfa", async (req, reply) => {
    const parsed = mfaBody.safeParse(req.body);
    if (!parsed.success) return bad(reply, req, 400, "BAD_REQUEST", "mfa_token and code required");
    let claims: MfaClaims;
    try {
      claims = verifyToken<MfaClaims>(secret, parsed.data.mfa_token);
    } catch {
      return bad(reply, req, 401, "MFA_TOKEN_INVALID", "session expired, sign in again");
    }
    if (claims.purpose !== "mfa") return bad(reply, req, 401, "MFA_TOKEN_INVALID", "wrong token");
    const account = accountFor(claims.admin_id);
    if (!account || account.status === "disabled") return bad(reply, req, 401, "MFA_TOKEN_INVALID", "account unavailable");
    if (!c.adminAccounts.verifyTotpCode(account, parsed.data.code)) {
      c.adminAccounts.recordFailedLogin(account.id);
      return bad(reply, req, 401, "INVALID_2FA_CODE", "invalid authenticator code");
    }
    return reply.send(mintSession(account));
  });

  // ── First-login setup (ticket-gated) ────────────────────────────────────────
  const setupAccount = (reply: FastifyReply, req: FastifyRequest, ticket: string): AdminAccount | null => {
    let claims: SetupClaims;
    try {
      claims = verifyToken<SetupClaims>(secret, ticket);
    } catch {
      bad(reply, req, 401, "SETUP_TICKET_INVALID", "setup session expired, sign in again");
      return null;
    }
    if (claims.purpose !== "setup") {
      bad(reply, req, 401, "SETUP_TICKET_INVALID", "wrong token");
      return null;
    }
    const account = accountFor(claims.admin_id);
    if (!account || account.status === "disabled") {
      bad(reply, req, 401, "SETUP_TICKET_INVALID", "account unavailable");
      return null;
    }
    return account;
  };

  // 1a — set the new password (required before TOTP enrollment).
  app.post("/admin/v1/auth/first-login/password", async (req, reply) => {
    const parsed = setPwBody.safeParse(req.body);
    if (!parsed.success) return bad(reply, req, 400, "BAD_REQUEST", `new_password must be at least ${MIN_PASSWORD_LEN} characters`);
    const account = setupAccount(reply, req, parsed.data.ticket);
    if (!account) return reply;
    c.adminAccounts.setPassword(account.id, parsed.data.new_password);
    const updated = accountFor(account.id)!;
    // Password done. If TOTP already enrolled (unusual on first login), finish now.
    if (updated.totp_enrolled) return reply.send({ done: true, ...mintSession(updated) });
    return reply.send({ done: false, needs_totp: true });
  });

  // 1b — begin TOTP enrollment (must have set password first).
  app.post("/admin/v1/auth/first-login/totp/begin", async (req, reply) => {
    const parsed = beginBody.safeParse(req.body);
    if (!parsed.success) return bad(reply, req, 400, "BAD_REQUEST", "ticket required");
    const account = setupAccount(reply, req, parsed.data.ticket);
    if (!account) return reply;
    if (account.must_set_password) return bad(reply, req, 409, "PASSWORD_SET_REQUIRED", "set a new password first");
    const { secret: totpSecret, otpauth_uri } = c.adminAccounts.beginTotpEnrollment(account.id, account.username);
    return reply.send({ secret: totpSecret, otpauth_uri });
  });

  // 1c — confirm TOTP enrollment with a live code; issues the session token.
  app.post("/admin/v1/auth/first-login/totp/confirm", async (req, reply) => {
    const parsed = confirmBody.safeParse(req.body);
    if (!parsed.success) return bad(reply, req, 400, "BAD_REQUEST", "ticket and code required");
    const account = setupAccount(reply, req, parsed.data.ticket);
    if (!account) return reply;
    if (account.must_set_password) return bad(reply, req, 409, "PASSWORD_SET_REQUIRED", "set a new password first");
    if (!c.adminAccounts.confirmTotpEnrollment(account.id, parsed.data.code)) {
      return bad(reply, req, 401, "INVALID_2FA_CODE", "invalid authenticator code");
    }
    return reply.send({ done: true, ...mintSession(accountFor(account.id)!) });
  });
};

export default adminAuthRoutes;
