import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { openCasinoDb, type CasinoDatabase } from "../src/db/database";
import { PlayerStore } from "../src/store/player-store";
import { computeSignature } from "../../platform/src/lib/security/hmac";
import { FakePlatformClient, testConfig } from "./support/fake-platform-client";

const CONFIG = testConfig({ staffUsername: "casino_admin", staffPassword: "demo123", providerPortalUrl: "http://localhost:8080" });
const ADMIN_ROUTES = ["/api/admin/players", "/api/admin/transactions", "/api/admin/rounds", "/api/admin/providers"];

let app: FastifyInstance;
let db: CasinoDatabase;
let store: PlayerStore;

async function login(username = "casino_admin", password = "demo123") {
  return app.inject({ method: "POST", url: "/api/staff/login", payload: { username, password } });
}
const cookieOf = (res: { headers: Record<string, unknown> }) => String(res.headers["set-cookie"]).split(";")[0];

beforeEach(async () => {
  db = openCasinoDb();
  store = new PlayerStore(db);
  app = buildApp({ config: CONFIG, db, store, platformFactory: () => new FakePlatformClient(), logger: false });
  await app.ready();
});
afterEach(async () => {
  await app.close();
  db.close();
});

describe("back-office staff authentication", () => {
  it("every /api/admin/* route refuses requests without a staff session", async () => {
    for (const url of ADMIN_ROUTES) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(401);
    }
    const write = await app.inject({ method: "DELETE", url: "/api/admin/providers/default-provider" });
    expect(write.statusCode).toBe(401);
  });

  it("wrong credentials are rejected; the right ones set an HttpOnly SameSite=Strict cookie", async () => {
    expect((await login("casino_admin", "nope")).statusCode).toBe(401);
    expect((await login("someone_else", "demo123")).statusCode).toBe(401);
    const ok = await login();
    expect(ok.statusCode).toBe(200);
    const setCookie = String(ok.headers["set-cookie"]);
    expect(setCookie).toMatch(/^casino_staff=[\w-]{40,};/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    const me = await app.inject({ method: "GET", url: "/api/staff/me", headers: { cookie: cookieOf(ok) } });
    expect(me.json()).toEqual({ username: "casino_admin" });
  });

  it("only a hash of the session token is stored", async () => {
    const token = cookieOf(await login()).split("=")[1];
    const rows = db.prepare("SELECT token_hash FROM staff_sessions").all() as Array<{ token_hash: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toContain(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signed in: players carry no password hash and provider secrets are masked", async () => {
    store.register("p@example.com", "scrypt$secret-hash", 50);
    const cookie = cookieOf(await login());
    const players = (await app.inject({ method: "GET", url: "/api/admin/players", headers: { cookie } })).json() as { players: object[] };
    expect(players.players[0]).not.toHaveProperty("passwordHash");
    const providers = (await app.inject({ method: "GET", url: "/api/admin/providers", headers: { cookie } })).json() as {
      providers: Array<{ apiSecret: string; webhookSecret: string; adminToken: string }>;
    };
    expect(providers.providers[0].webhookSecret).toBe(`••••${CONFIG.webhookSecret.slice(-4)}`);
    expect(JSON.stringify(providers)).not.toContain(CONFIG.apiSecret);
  });

  it("editing a provider with masked secrets keeps the stored secrets", async () => {
    const cookie = cookieOf(await login());
    const list = (await app.inject({ method: "GET", url: "/api/admin/providers", headers: { cookie } })).json() as { providers: Array<Record<string, string>> };
    const masked = list.providers[0];
    const res = await app.inject({ method: "PUT", url: `/api/admin/providers/${masked.id}`, headers: { cookie }, payload: { ...masked, name: "Renamed" } });
    expect(res.statusCode).toBe(200);
    const row = db.prepare("SELECT name, webhook_secret FROM providers WHERE id = ?").get(masked.id) as { name: string; webhook_secret: string };
    expect(row).toEqual({ name: "Renamed", webhook_secret: CONFIG.webhookSecret });
  });

  it("logout revokes the session server-side", async () => {
    const cookie = cookieOf(await login());
    expect((await app.inject({ method: "GET", url: "/api/admin/rounds", headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: "POST", url: "/api/staff/logout", headers: { cookie } });
    expect((await app.inject({ method: "GET", url: "/api/admin/rounds", headers: { cookie } })).statusCode).toBe(401);
  });

  it("repeated failures are throttled, even if the right password follows", async () => {
    for (let i = 0; i < 5; i += 1) expect((await login("casino_admin", `wrong-${i}`)).statusCode).toBe(401);
    expect((await login()).statusCode).toBe(429);
  });
});

describe("webhook → ledger → back-office rounds", () => {
  it("a signed debit/credit lands in SQLite and shows as a round with its verify link", async () => {
    const player = store.register("spin@example.com", "hash", 100);
    const send = async (action: "debit" | "credit", body: object) => {
      const path = `/wallet/default-provider/${action}`;
      const raw = JSON.stringify(body);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = computeSignature(CONFIG.webhookSecret, { timestamp, method: "POST", path, rawBody: raw });
      return app.inject({ method: "POST", url: path, payload: raw, headers: { "content-type": "application/json", "x-timestamp": timestamp, "x-nonce": randomUUID(), "x-signature": signature } });
    };
    const base = { roundRef: "r_abc", operatorPlayerId: player.id, currency: "GEL", gameCode: "bananax", roundType: "paid" };
    expect((await send("debit", { ...base, idempotencyKey: "k:debit", amount: 1 })).statusCode).toBe(200);
    expect((await send("credit", { ...base, idempotencyKey: "k:credit", amount: 4.2 })).statusCode).toBe(200);

    const cookie = cookieOf(await login());
    const rounds = (await app.inject({ method: "GET", url: "/api/admin/rounds", headers: { cookie } })).json() as { rounds: Array<Record<string, unknown>> };
    expect(rounds.rounds[0]).toMatchObject({
      roundRef: "r_abc",
      playerId: player.id,
      gameCode: "bananax",
      bet: 1,
      win: 4.2,
      verifyUrl: "http://localhost:8080/admin#inspector?round=r_abc"
    });
  });
});
