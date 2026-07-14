import { randomUUID, randomBytes } from "node:crypto";
import type { AuditRepository } from "../ledger/ledger.types";
import { NullPersistence, type Persistence } from "../../persistence/persistence";
import { hashPassword, verifyPassword } from "../../lib/security/password";
import { generateTotpSecret, verifyTotp, otpauthUri } from "../../lib/security/totp";
import type { AdminRole, AdminScope } from "./admin-auth";

/**
 * Admin identity store: the real accounts behind the two consoles. Each account
 * has a scrypt password hash and (once enrolled) a TOTP secret for authenticator
 * 2FA. Login (password → TOTP) is orchestrated in http/admin-auth.routes.ts; this
 * service owns the credential state machine and lockout.
 *
 * Storage is an in-memory Map (write-through to Postgres when persistence is
 * attached), matching ManagementService.
 */

const now = (): string => new Date().toISOString();
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

export interface AdminAccount {
  id: string;
  username: string; // canonical (lowercased)
  scope: AdminScope;
  operator_id: string | null;
  role: AdminRole;
  password_hash: string;
  totp_secret: string | null;
  status: "active" | "disabled";
  must_set_password: boolean;
  totp_enrolled: boolean;
  failed_attempts: number;
  locked_until: string | null;
  created_at: string;
}

/** Public view — never leaks password_hash or totp_secret. */
export type AdminAccountView = Omit<AdminAccount, "password_hash" | "totp_secret">;

export function toView(a: AdminAccount): AdminAccountView {
  const { password_hash: _p, totp_secret: _t, ...view } = a;
  return view;
}

function generateTempPassword(): string {
  // URL-safe, human-transcribable one-time password handed to a new admin.
  return randomBytes(12).toString("base64url");
}

export class AdminAccountService {
  private readonly accounts = new Map<string, AdminAccount>();
  private readonly byUsername = new Map<string, string>(); // username -> id

  constructor(
    private readonly audit: AuditRepository,
    private readonly persistence: Persistence = NullPersistence,
    private readonly issuer = "Provider Platform"
  ) {}

  hydrate(rows: AdminAccount[]): void {
    for (const row of rows) {
      this.accounts.set(row.id, row);
      this.byUsername.set(row.username, row.id);
    }
  }

  private save(a: AdminAccount): void {
    this.persistence.save("admin_accounts", a);
  }

  private record(a: AdminAccount, action: string, actorId: string): void {
    this.audit.append({
      operator_id: a.operator_id,
      actor_type: "admin",
      actor_id: actorId,
      action,
      target_type: "admin_account",
      target_id: a.id
    });
  }

  getByUsername(username: string): AdminAccount | null {
    const id = this.byUsername.get(username.trim().toLowerCase());
    return id ? this.accounts.get(id) ?? null : null;
  }

  getById(id: string): AdminAccount | null {
    return this.accounts.get(id) ?? null;
  }

  list(filter: { scope?: AdminScope; operator_id?: string } = {}): AdminAccountView[] {
    return Array.from(this.accounts.values())
      .filter((a) => (filter.scope ? a.scope === filter.scope : true))
      .filter((a) => (filter.operator_id ? a.operator_id === filter.operator_id : true))
      .map(toView);
  }

  hasAnyProviderAccount(): boolean {
    for (const a of this.accounts.values()) if (a.scope === "provider") return true;
    return false;
  }

  /**
   * Create an account with a one-time temp password. The account must set a new
   * password and enroll TOTP on first login. Returns the temp password ONCE.
   */
  create(
    input: { username: string; scope: AdminScope; operator_id?: string | null; role: AdminRole },
    actorId = "system"
  ): { account: AdminAccountView; temp_password: string } {
    const username = input.username.trim().toLowerCase();
    if (!username) throw new Error("USERNAME_REQUIRED");
    if (this.byUsername.has(username)) throw new Error("DUPLICATE_USERNAME");
    if (input.scope === "operator" && !input.operator_id) throw new Error("OPERATOR_ID_REQUIRED");

    const temp = generateTempPassword();
    const account: AdminAccount = {
      id: randomUUID(),
      username,
      scope: input.scope,
      operator_id: input.scope === "operator" ? input.operator_id ?? null : null,
      role: input.role,
      password_hash: hashPassword(temp),
      totp_secret: null,
      status: "active",
      must_set_password: true,
      totp_enrolled: false,
      failed_attempts: 0,
      locked_until: null,
      created_at: now()
    };
    this.accounts.set(account.id, account);
    this.byUsername.set(username, account.id);
    this.save(account);
    this.record(account, "admin_account.create", actorId);
    return { account: toView(account), temp_password: temp };
  }

  /**
   * Seed a provider super-admin from a known password (env bootstrap). The
   * password is already set, but TOTP still must be enrolled on first login.
   * Idempotent-ish: caller checks hasAnyProviderAccount() first.
   */
  seedProviderSuperAdmin(username: string, password: string): AdminAccountView {
    const canonical = username.trim().toLowerCase();
    if (this.byUsername.has(canonical)) return toView(this.accounts.get(this.byUsername.get(canonical)!)!);
    const account: AdminAccount = {
      id: randomUUID(),
      username: canonical,
      scope: "provider",
      operator_id: null,
      role: "provider_super_admin",
      password_hash: hashPassword(password),
      totp_secret: null,
      status: "active",
      must_set_password: false,
      totp_enrolled: false,
      failed_attempts: 0,
      locked_until: null,
      created_at: now()
    };
    this.accounts.set(account.id, account);
    this.byUsername.set(canonical, account.id);
    this.save(account);
    this.record(account, "admin_account.seed", "bootstrap");
    return toView(account);
  }

  isLocked(a: AdminAccount): boolean {
    return a.locked_until !== null && Date.parse(a.locked_until) > Date.now();
  }

  verifyPassword(a: AdminAccount, password: string): boolean {
    return verifyPassword(password, a.password_hash);
  }

  recordFailedLogin(id: string): void {
    const a = this.accounts.get(id);
    if (!a) return;
    a.failed_attempts += 1;
    if (a.failed_attempts >= MAX_FAILED_ATTEMPTS) {
      a.locked_until = new Date(Date.now() + LOCKOUT_MS).toISOString();
    }
    this.save(a);
  }

  recordSuccessfulLogin(id: string): void {
    const a = this.accounts.get(id);
    if (!a) return;
    a.failed_attempts = 0;
    a.locked_until = null;
    this.save(a);
  }

  setPassword(id: string, newPassword: string): void {
    const a = this.accounts.get(id);
    if (!a) throw new Error("ACCOUNT_NOT_FOUND");
    a.password_hash = hashPassword(newPassword);
    a.must_set_password = false;
    a.failed_attempts = 0;
    a.locked_until = null;
    this.save(a);
    this.record(a, "admin_account.password_set", a.id);
  }

  /** Begin TOTP enrollment: mint + store a secret (not yet active) and return the
   *  provisioning URI/secret for the authenticator app. */
  beginTotpEnrollment(id: string, account: string): { secret: string; otpauth_uri: string } {
    const a = this.accounts.get(id);
    if (!a) throw new Error("ACCOUNT_NOT_FOUND");
    const secret = generateTotpSecret();
    a.totp_secret = secret;
    a.totp_enrolled = false;
    this.save(a);
    return { secret, otpauth_uri: otpauthUri(secret, { issuer: this.issuer, account }) };
  }

  confirmTotpEnrollment(id: string, code: string): boolean {
    const a = this.accounts.get(id);
    if (!a || !a.totp_secret) return false;
    if (!verifyTotp(a.totp_secret, code)) return false;
    a.totp_enrolled = true;
    this.save(a);
    this.record(a, "admin_account.totp_enrolled", a.id);
    return true;
  }

  verifyTotpCode(a: AdminAccount, code: string): boolean {
    if (!a.totp_secret || !a.totp_enrolled) return false;
    return verifyTotp(a.totp_secret, code);
  }

  disable(id: string, actorId = "system"): AdminAccountView {
    const a = this.accounts.get(id);
    if (!a) throw new Error("ACCOUNT_NOT_FOUND");
    a.status = "disabled";
    this.save(a);
    this.record(a, "admin_account.disable", actorId);
    return toView(a);
  }

  resetPassword(id: string, actorId = "system"): { account: AdminAccountView; temp_password: string } {
    const a = this.accounts.get(id);
    if (!a) throw new Error("ACCOUNT_NOT_FOUND");
    const temp = generateTempPassword();
    a.password_hash = hashPassword(temp);
    a.must_set_password = true;
    a.failed_attempts = 0;
    a.locked_until = null;
    this.save(a);
    this.record(a, "admin_account.reset_password", actorId);
    return { account: toView(a), temp_password: temp };
  }

  resetTotp(id: string, actorId = "system"): AdminAccountView {
    const a = this.accounts.get(id);
    if (!a) throw new Error("ACCOUNT_NOT_FOUND");
    a.totp_secret = null;
    a.totp_enrolled = false;
    this.save(a);
    this.record(a, "admin_account.reset_totp", actorId);
    return toView(a);
  }
}
