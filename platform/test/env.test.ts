import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const prodBase = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@localhost:5432/provider",
  LAUNCH_TOKEN_SECRET: "prod-launch-secret-123",
  SESSION_TOKEN_SECRET: "prod-session-secret-123",
  ADMIN_TOKEN_SECRET: "prod-admin-secret-123",
  // Presence is all loadEnv checks; the real key is a PEM supplied by the deployment.
  EXPORT_SIGNING_KEY: "configured",
  BOOTSTRAP_ADMIN_PASSWORD: "prod-admin-password-123"
};

const sandboxBase = {
  NODE_ENV: "sandbox",
  LAUNCH_TOKEN_SECRET: "sbx-launch-secret-123",
  SESSION_TOKEN_SECRET: "sbx-session-secret-123",
  ADMIN_TOKEN_SECRET: "sbx-admin-secret-123",
  BOOTSTRAP_ADMIN_PASSWORD: "sbx-admin-password-123"
};

describe("environment config", () => {
  it("allows local defaults outside production-like environments", () => {
    const env = loadEnv({ NODE_ENV: "local" });
    expect(env.LAUNCH_TOKEN_SECRET).toBe("dev-launch-secret-change-me");
  });

  it("defaults admin TOTP off for local/test, on for sandbox and production", () => {
    expect(loadEnv({ NODE_ENV: "local" }).ADMIN_TOTP_REQUIRED).toBe(false);
    expect(loadEnv({ NODE_ENV: "test" }).ADMIN_TOTP_REQUIRED).toBe(false);
    expect(loadEnv(sandboxBase).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(loadEnv(prodBase).ADMIN_TOTP_REQUIRED).toBe(true);
  });

  it("an explicit ADMIN_TOTP_REQUIRED always wins", () => {
    expect(loadEnv({ NODE_ENV: "local", ADMIN_TOTP_REQUIRED: "true" }).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(loadEnv({ ...sandboxBase, ADMIN_TOTP_REQUIRED: "false" }).ADMIN_TOTP_REQUIRED).toBe(false);
  });

  it("rejects local-only secrets in production", () => {
    expect(() => loadEnv({ ...prodBase, LAUNCH_TOKEN_SECRET: "dev-launch-secret-change-me" })).toThrow(
      /LAUNCH_TOKEN_SECRET/
    );
    expect(() => loadEnv({ ...prodBase, BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin" })).toThrow(
      /BOOTSTRAP_ADMIN_PASSWORD/
    );
  });

  it("rejects the public default token secrets in sandbox (casino-facing)", () => {
    expect(() => loadEnv({ NODE_ENV: "sandbox" })).toThrow(/Unsafe sandbox environment/);
    expect(() => loadEnv({ ...sandboxBase, ADMIN_TOKEN_SECRET: "dev-admin-secret-change-me" })).toThrow(/ADMIN_TOKEN_SECRET/);
    expect(loadEnv(sandboxBase).NODE_ENV).toBe("sandbox");
  });

  it("requires durable persistence in production", () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDb } = prodBase;
    expect(() => loadEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it("requires a persistent round-export signing key in production", () => {
    const { EXPORT_SIGNING_KEY: _key, ...withoutKey } = prodBase;
    expect(() => loadEnv(withoutKey)).toThrow(/EXPORT_SIGNING_KEY/);
    expect(loadEnv({ NODE_ENV: "local" }).EXPORT_SIGNING_KEY).toBeUndefined();
  });

  it("refuses to boot staging/production on an expired signing key, so a rotation can't be forgotten", () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const future = new Date(Date.now() + 864e5).toISOString();
    expect(() => loadEnv({ ...prodBase, EXPORT_SIGNING_KEY_EXPIRES_AT: past })).toThrow(/expired.*rotate/);
    expect(() => loadEnv({ ...prodBase, NODE_ENV: "staging", EXPORT_SIGNING_KEY_EXPIRES_AT: past })).toThrow(/expired/);
    expect(loadEnv({ ...prodBase, EXPORT_SIGNING_KEY_EXPIRES_AT: future }).EXPORT_SIGNING_KEY_EXPIRES_AT).toBe(future);
    expect(() => loadEnv({ ...prodBase, EXPORT_SIGNING_KEY_EXPIRES_AT: "next tuesday" })).toThrow(/EXPORT_SIGNING_KEY_EXPIRES_AT/);
    // Local development is never blocked by it.
    expect(() => loadEnv({ NODE_ENV: "local", EXPORT_SIGNING_KEY_EXPIRES_AT: past })).not.toThrow();
  });

  it("keeps admin TOTP mandatory in production", () => {
    expect(() => loadEnv({ ...prodBase, ADMIN_TOTP_REQUIRED: "false" })).toThrow(/ADMIN_TOTP_REQUIRED/);
  });
});
