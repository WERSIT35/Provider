import type { Container } from "../src/container";

/**
 * Fixed, well-known Operator Portal login for LOCAL development seeds only, so a
 * fresh stack can always be signed into without hunting for a one-time password.
 * Matches the demo casino's back-office default (casino_admin / demo123).
 *
 *   DEV_OPERATOR_ADMIN_USERNAME  (default operator_admin)
 *   DEV_OPERATOR_ADMIN_PASSWORD  (default demo123)
 *
 * The password is set directly (no forced change on first login). It is re-applied
 * on every seed run, so the login stays predictable even when DATABASE_URL makes
 * the account persist. 2FA still applies if ADMIN_TOTP_REQUIRED=true.
 * Never used by the app itself: only the dev seed scripts call this.
 */
export const DEV_OPERATOR_ADMIN = {
  username: (process.env.DEV_OPERATOR_ADMIN_USERNAME ?? "operator_admin").trim().toLowerCase(),
  password: process.env.DEV_OPERATOR_ADMIN_PASSWORD ?? "demo123"
};

export function ensureDevOperatorAdmin(c: Container, operatorId: string, actorId: string): { username: string; password: string } {
  const env = (process.env.NODE_ENV ?? "local").toLowerCase();
  if (env === "staging" || env === "production") {
    throw new Error(`Refusing to seed a fixed dev operator password with NODE_ENV=${env}.`);
  }
  const { username, password } = DEV_OPERATOR_ADMIN;
  const existing = c.adminAccounts.getByUsername(username);
  if (existing && (existing.scope !== "operator" || existing.operator_id !== operatorId)) {
    throw new Error(`Admin account '${username}' already exists for a different scope/operator; set DEV_OPERATOR_ADMIN_USERNAME.`);
  }
  const id = existing
    ? existing.id
    : c.adminAccounts.create({ username, scope: "operator", operator_id: operatorId, role: "operator_admin" }, actorId).account.id;
  c.adminAccounts.setPassword(id, password);
  return { username, password };
}
