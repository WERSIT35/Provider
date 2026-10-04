import { describe, expect, it } from "vitest";
import { loadEnv } from "../src/config/env";

const prodBase = {
  NODE_ENV: "production",
  DATABASE_URL: "postgres://user:pass@localhost:5432/provider",
  LAUNCH_TOKEN_SECRET: "prod-launch-secret-123",
  SESSION_TOKEN_SECRET: "prod-session-secret-123",
  ADMIN_TOKEN_SECRET: "prod-admin-secret-123",
  BOOTSTRAP_ADMIN_PASSWORD: "prod-admin-password-123"
};

describe("environment config", () => {
  it("allows local defaults outside production-like environments", () => {
    const env = loadEnv({ NODE_ENV: "local" });
    expect(env.LAUNCH_TOKEN_SECRET).toBe("dev-launch-secret-change-me");
  });

  it("defaults admin TOTP off for local/test, on for sandbox and production", () => {
    expect(loadEnv({ NODE_ENV: "local" }).ADMIN_TOTP_REQUIRED).toBe(false);
    expect(loadEnv({ NODE_ENV: "test" }).ADMIN_TOTP_REQUIRED).toBe(false);
    expect(loadEnv({ NODE_ENV: "sandbox" }).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(loadEnv(prodBase).ADMIN_TOTP_REQUIRED).toBe(true);
  });

  it("an explicit ADMIN_TOTP_REQUIRED always wins", () => {
    expect(loadEnv({ NODE_ENV: "local", ADMIN_TOTP_REQUIRED: "true" }).ADMIN_TOTP_REQUIRED).toBe(true);
    expect(loadEnv({ NODE_ENV: "sandbox", ADMIN_TOTP_REQUIRED: "false" }).ADMIN_TOTP_REQUIRED).toBe(false);
  });

  it("rejects local-only secrets in production", () => {
    expect(() => loadEnv({ ...prodBase, LAUNCH_TOKEN_SECRET: "dev-launch-secret-change-me" })).toThrow(
      /LAUNCH_TOKEN_SECRET/
    );
    expect(() => loadEnv({ ...prodBase, BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin" })).toThrow(
      /BOOTSTRAP_ADMIN_PASSWORD/
    );
  });

  it("requires durable persistence in production", () => {
    const { DATABASE_URL: _databaseUrl, ...withoutDb } = prodBase;
    expect(() => loadEnv(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it("keeps admin TOTP mandatory in production", () => {
    expect(() => loadEnv({ ...prodBase, ADMIN_TOTP_REQUIRED: "false" })).toThrow(/ADMIN_TOTP_REQUIRED/);
  });
});
