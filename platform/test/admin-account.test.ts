import { describe, it, expect, beforeEach } from "vitest";
import { AdminAccountService } from "../src/modules/admin/admin-account";
import { InMemoryAuditRepository } from "../src/modules/ledger/memory-repositories";
import { totpCode } from "../src/lib/security/totp";

let svc: AdminAccountService;

beforeEach(() => {
  svc = new AdminAccountService(new InMemoryAuditRepository());
});

describe("AdminAccountService", () => {
  it("seeds a provider super-admin that must enroll TOTP but not reset password", () => {
    expect(svc.hasAnyProviderAccount()).toBe(false);
    svc.seedProviderSuperAdmin("Admin", "s3cret-pw");
    expect(svc.hasAnyProviderAccount()).toBe(true);
    const a = svc.getByUsername("admin"); // case-insensitive
    expect(a).not.toBeNull();
    expect(a!.role).toBe("provider_super_admin");
    expect(a!.must_set_password).toBe(false);
    expect(a!.totp_enrolled).toBe(false);
    expect(svc.verifyPassword(a!, "s3cret-pw")).toBe(true);
    expect(svc.verifyPassword(a!, "wrong")).toBe(false);
  });

  it("creates an operator account with a one-time temp password + forced setup", () => {
    const { account, temp_password } = svc.create({
      username: "casino-admin",
      scope: "operator",
      operator_id: "op-1",
      role: "operator_admin"
    });
    expect(temp_password).toBeTruthy();
    expect(account).not.toHaveProperty("password_hash");
    expect(account).not.toHaveProperty("totp_secret");
    const a = svc.getByUsername("casino-admin")!;
    expect(a.must_set_password).toBe(true);
    expect(a.operator_id).toBe("op-1");
    expect(svc.verifyPassword(a, temp_password)).toBe(true);
  });

  it("rejects duplicate usernames and operator accounts without an operator_id", () => {
    svc.create({ username: "dup", scope: "operator", operator_id: "op-1", role: "operator_admin" });
    expect(() => svc.create({ username: "dup", scope: "operator", operator_id: "op-1", role: "operator_admin" })).toThrow(/DUPLICATE/);
    expect(() => svc.create({ username: "x", scope: "operator", role: "operator_admin" })).toThrow(/OPERATOR_ID_REQUIRED/);
  });

  it("enrolls TOTP: begin issues a secret, confirm requires a valid code", () => {
    const a = svc.getByUsername(svc.create({ username: "u", scope: "provider", role: "provider_finance" }).account.username)!;
    const { secret } = svc.beginTotpEnrollment(a.id, "u");
    expect(secret).toBeTruthy();
    expect(svc.confirmTotpEnrollment(a.id, "000000")).toBe(false);
    expect(svc.confirmTotpEnrollment(a.id, totpCode(secret))).toBe(true);
    const enrolled = svc.getById(a.id)!;
    expect(enrolled.totp_enrolled).toBe(true);
    expect(svc.verifyTotpCode(enrolled, totpCode(secret))).toBe(true);
  });

  it("locks an account after repeated failed logins and clears on success", () => {
    const a = svc.getByUsername(svc.create({ username: "lockme", scope: "provider", role: "provider_read_only" }).account.username)!;
    for (let i = 0; i < 5; i += 1) svc.recordFailedLogin(a.id);
    expect(svc.isLocked(svc.getById(a.id)!)).toBe(true);
    svc.recordSuccessfulLogin(a.id);
    expect(svc.isLocked(svc.getById(a.id)!)).toBe(false);
  });

  it("reset-password forces a new setup; reset-totp clears enrollment", () => {
    const a = svc.getByUsername(svc.create({ username: "r", scope: "provider", role: "provider_super_admin" }).account.username)!;
    svc.setPassword(a.id, "brand-new-pw");
    expect(svc.getById(a.id)!.must_set_password).toBe(false);
    const { temp_password } = svc.resetPassword(a.id);
    expect(svc.getById(a.id)!.must_set_password).toBe(true);
    expect(svc.verifyPassword(svc.getById(a.id)!, temp_password)).toBe(true);

    const { secret } = svc.beginTotpEnrollment(a.id, "r");
    svc.confirmTotpEnrollment(a.id, totpCode(secret));
    svc.resetTotp(a.id);
    expect(svc.getById(a.id)!.totp_enrolled).toBe(false);
    expect(svc.getById(a.id)!.totp_secret).toBeNull();
  });
});
