import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, seedBootstrapAdmin, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { totpCode } from "../src/lib/security/totp";

const CONFIG = {
  launchSecret: "s1",
  sessionSecret: "s2",
  adminSecret: "s3",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 10_000,
  bootstrapAdminUsername: "root",
  bootstrapAdminPassword: "bootstrap-pw-123"
};

let app: FastifyInstance;
let container: Container;

async function post(url: string, body: object) {
  return await app.inject({ method: "POST", url, payload: body, headers: { "content-type": "application/json" } });
}

beforeEach(async () => {
  container = buildContainer(CONFIG);
  seedBootstrapAdmin(container);
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await app.ready();
});

// Drive the full first-login: password step → set password → enroll TOTP → session.
async function firstLogin(username: string, password: string, newPassword: string): Promise<{ token: string; secret: string }> {
  const login = await post("/admin/v1/auth/login", { username, password });
  expect(login.statusCode).toBe(200);
  const { setup_required, ticket, needs_totp } = login.json() as { setup_required: boolean; ticket: string; needs_totp: boolean };
  expect(setup_required).toBe(true);
  expect(needs_totp).toBe(true);

  const pw = await post("/admin/v1/auth/first-login/password", { ticket, new_password: newPassword });
  expect(pw.statusCode).toBe(200);

  const begin = await post("/admin/v1/auth/first-login/totp/begin", { ticket });
  expect(begin.statusCode).toBe(200);
  const { secret } = begin.json() as { secret: string };

  const confirm = await post("/admin/v1/auth/first-login/totp/confirm", { ticket, code: totpCode(secret) });
  expect(confirm.statusCode).toBe(200);
  const { token, done } = confirm.json() as { token: string; done: boolean };
  expect(done).toBe(true);
  expect(token).toBeTruthy();
  return { token, secret };
}

describe("Admin login (password + TOTP 2FA)", () => {
  it("bootstrap admin does first-login setup, then the token works on the Admin API", async () => {
    const { token } = await firstLogin("root", "bootstrap-pw-123", "new-strong-pw-1");
    const res = await app.inject({ method: "GET", url: "/admin/v1/operators", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200); // provider scope reaches the provider-only route
  });

  it("after enrollment, subsequent logins require password THEN a valid TOTP code", async () => {
    const { secret } = await firstLogin("root", "bootstrap-pw-123", "new-strong-pw-1");

    const login = await post("/admin/v1/auth/login", { username: "root", password: "new-strong-pw-1" });
    const { mfa_required, mfa_token } = login.json() as { mfa_required: boolean; mfa_token: string };
    expect(mfa_required).toBe(true);

    const badCode = await post("/admin/v1/auth/login/mfa", { mfa_token, code: "000000" });
    expect(badCode.statusCode).toBe(401);

    const ok = await post("/admin/v1/auth/login/mfa", { mfa_token, code: totpCode(secret) });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { token: string }).token).toBeTruthy();
  });

  it("rejects a wrong password with a generic error and does not leak user existence", async () => {
    const wrong = await post("/admin/v1/auth/login", { username: "root", password: "nope" });
    expect(wrong.statusCode).toBe(401);
    const unknown = await post("/admin/v1/auth/login", { username: "ghost", password: "whatever" });
    expect(unknown.statusCode).toBe(401);
    expect((wrong.json() as { error: { code: string } }).error.code).toBe("INVALID_CREDENTIALS");
    expect((unknown.json() as { error: { code: string } }).error.code).toBe("INVALID_CREDENTIALS");
  });

  it("locks the account after repeated failed passwords", async () => {
    for (let i = 0; i < 5; i += 1) await post("/admin/v1/auth/login", { username: "root", password: "wrong" });
    const locked = await post("/admin/v1/auth/login", { username: "root", password: "bootstrap-pw-123" });
    expect(locked.statusCode).toBe(423);
  });

  it("blocks TOTP enrollment before the password is set", async () => {
    const login = await post("/admin/v1/auth/login", { username: "root", password: "bootstrap-pw-123" });
    const { ticket } = login.json() as { ticket: string };
    // Seeded bootstrap admin has must_set_password=false, so enrollment is allowed
    // directly — assert the negative case via a freshly created operator account below.
    const created = container.adminAccounts.create({ username: "op", scope: "operator", operator_id: "op-1", role: "operator_admin" });
    const opLogin = await post("/admin/v1/auth/login", { username: "op", password: created.temp_password });
    const opTicket = (opLogin.json() as { ticket: string }).ticket;
    const begin = await post("/admin/v1/auth/first-login/totp/begin", { ticket: opTicket });
    expect(begin.statusCode).toBe(409); // must set password first
    expect(ticket).toBeTruthy();
  });
});
