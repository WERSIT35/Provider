import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };

let app: FastifyInstance;
let container: Container;
let operatorId: string;

function providerToken(): string {
  return container.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
}
function operatorToken(): string {
  return container.adminAuth.mintToken({ admin_id: "op-1", scope: "operator", operator_id: operatorId, role: "operator_admin" });
}
async function post(url: string, token: string, body: object) {
  return await app.inject({ method: "POST", url, payload: body, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" } });
}

beforeEach(async () => {
  container = buildContainer(CONFIG);
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container });
  await app.ready();
  operatorId = container.mgmt.createOperator({ name: "LuckySpin", slug: "luckyspin" }).id;
});

describe("Admin-account management (provider-only)", () => {
  it("lets a provider super-admin create an operator account with a one-time password", async () => {
    const res = await post("/admin/v1/admin-accounts", providerToken(), {
      username: "casino-admin",
      scope: "operator",
      operator_id: operatorId,
      role: "operator_admin"
    });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { account: { username: string; operator_id: string }; temp_password: string };
    expect(body.account.username).toBe("casino-admin");
    expect(body.account.operator_id).toBe(operatorId);
    expect(body.temp_password).toBeTruthy();
    expect(body.account).not.toHaveProperty("password_hash");
  });

  it("forbids an operator admin from managing accounts", async () => {
    const res = await post("/admin/v1/admin-accounts", operatorToken(), {
      username: "sneaky", scope: "operator", operator_id: operatorId, role: "operator_admin"
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a role that doesn't match the scope", async () => {
    const res = await post("/admin/v1/admin-accounts", providerToken(), {
      username: "mismatch", scope: "operator", operator_id: operatorId, role: "provider_super_admin"
    });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: { code: string } }).error.code).toBe("ROLE_SCOPE_MISMATCH");
  });

  it("404s when the named operator does not exist", async () => {
    const res = await post("/admin/v1/admin-accounts", providerToken(), {
      username: "orphan", scope: "operator", operator_id: "nope", role: "operator_admin"
    });
    expect(res.statusCode).toBe(404);
  });

  it("409s on a duplicate username", async () => {
    const body = { username: "dupe", scope: "provider", role: "provider_finance" };
    expect((await post("/admin/v1/admin-accounts", providerToken(), body)).statusCode).toBe(201);
    expect((await post("/admin/v1/admin-accounts", providerToken(), body)).statusCode).toBe(409);
  });

  it("reset-password returns a fresh one-time password and re-arms first-login", async () => {
    const created = (await post("/admin/v1/admin-accounts", providerToken(), {
      username: "resetme", scope: "provider", role: "provider_read_only"
    })).json() as { account: { id: string } };
    const reset = await post(`/admin/v1/admin-accounts/${created.account.id}/reset-password`, providerToken(), {});
    expect(reset.statusCode).toBe(200);
    expect((reset.json() as { temp_password: string }).temp_password).toBeTruthy();
    expect(container.adminAccounts.getById(created.account.id)!.must_set_password).toBe(true);
  });

  it("lists accounts for the provider", async () => {
    await post("/admin/v1/admin-accounts", providerToken(), { username: "analyst-1", scope: "provider", role: "provider_finance" });
    const list = await app.inject({ method: "GET", url: "/admin/v1/admin-accounts", headers: { authorization: `Bearer ${providerToken()}` } });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { accounts: unknown[] }).accounts.length).toBeGreaterThanOrEqual(1);
  });
});
