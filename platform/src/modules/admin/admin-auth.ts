import { signToken, verifyToken } from "../../lib/tokens";

/** Admin authentication + RBAC (plan §6/§7). Provider-scoped admins manage everything;
 * operator-scoped admins are hard-limited to their own operator_id. */

export type AdminScope = "provider" | "operator";

export type AdminRole =
  | "provider_super_admin"
  | "provider_finance"
  | "provider_read_only"
  | "operator_admin"
  | "operator_finance"
  | "operator_viewer";

export interface AdminClaims {
  admin_id: string;
  scope: AdminScope;
  operator_id: string | null;
  role: AdminRole;
  exp?: number;
}

const ROLE_PERMISSIONS: Record<AdminRole, Set<string>> = {
  provider_super_admin: new Set(["*"]),
  // Finance can move money on rounds (void/settle) and resolve disputes, but not
  // change the operator/game catalog.
  provider_finance: new Set([
    "reports.read",
    "transactions.read",
    "rounds.read",
    "rounds.verify",
    "rounds.write",
    "disputes.read",
    "disputes.resolve",
    "players.read"
  ]),
  provider_read_only: new Set([
    "rounds.read",
    "rounds.verify",
    "reports.read",
    "operators.read",
    "games.read",
    "disputes.read",
    "players.read"
  ]),
  // Operator admins run their own tenant: read their data, verify rounds, toggle
  // their own games on/off, look up players, and RAISE disputes (provider executes).
  operator_admin: new Set([
    "rounds.read",
    "rounds.verify",
    "reports.read",
    "transactions.read",
    "games.read",
    "games.toggle",
    "players.read",
    "disputes.read",
    "disputes.raise"
  ]),
  operator_finance: new Set([
    "reports.read",
    "transactions.read",
    "rounds.read",
    "rounds.verify",
    "players.read",
    "disputes.read",
    "disputes.raise"
  ]),
  operator_viewer: new Set(["rounds.read", "reports.read", "players.read", "disputes.read"])
};

export function can(claims: AdminClaims, permission: string): boolean {
  const perms = ROLE_PERMISSIONS[claims.role];
  if (!perms) return false;
  return perms.has("*") || perms.has(permission);
}

/** Resolve the operator filter for a query: operator-scoped admins are forced to
 * their own operator_id; provider admins may optionally filter. */
export function resolveOperatorScope(claims: AdminClaims, requested?: string): string | undefined {
  if (claims.scope === "operator") return claims.operator_id ?? undefined;
  return requested;
}

export class AdminAuthService {
  constructor(private readonly secret: string) {}

  /** Issue an admin session token. Real login (password + MFA) precedes this; here
   * it is also the test seam. */
  mintToken(input: { admin_id: string; scope: AdminScope; operator_id?: string | null; role: AdminRole }, ttlSeconds = 3600): string {
    return signToken(
      this.secret,
      { admin_id: input.admin_id, scope: input.scope, operator_id: input.operator_id ?? null, role: input.role },
      ttlSeconds
    );
  }

  verify(token: string): AdminClaims {
    return verifyToken(this.secret, token) as unknown as AdminClaims;
  }
}
