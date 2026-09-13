import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { PlayerStore } from "../src/store/player-store";
import { FakePlatformClient, testConfig } from "./support/fake-platform-client";

let app: FastifyInstance;
let store: PlayerStore;
let platform: FakePlatformClient;

beforeEach(async () => {
  store = new PlayerStore();
  platform = new FakePlatformClient();
  app = buildApp({ config: testConfig(), store, platform, logger: false });
  await app.ready();
});

async function register(email: string, password = "correcthorse"): Promise<{ token: string; player: { id: string; balance: number } }> {
  const res = await app.inject({ method: "POST", url: "/api/register", payload: { email, password } });
  expect(res.statusCode).toBe(200);
  return res.json();
}

describe("registration + login", () => {
  it("registers a new player with the configured starting balance", async () => {
    const { player } = await register("alice@example.com");
    expect(player.balance).toBe(1000);
  });

  it("rejects a short password or malformed email", async () => {
    const bad1 = await app.inject({ method: "POST", url: "/api/register", payload: { email: "not-an-email", password: "longenough" } });
    expect(bad1.statusCode).toBe(422);
    const bad2 = await app.inject({ method: "POST", url: "/api/register", payload: { email: "a@b.com", password: "short" } });
    expect(bad2.statusCode).toBe(422);
  });

  it("rejects registering the same email twice", async () => {
    await register("dupe@example.com");
    const res = await app.inject({ method: "POST", url: "/api/register", payload: { email: "dupe@example.com", password: "correcthorse" } });
    expect(res.statusCode).toBe(409);
  });

  it("logs in with the right password and rejects the wrong one", async () => {
    await register("bob@example.com", "the-real-password");
    const good = await app.inject({ method: "POST", url: "/api/login", payload: { email: "bob@example.com", password: "the-real-password" } });
    expect(good.statusCode).toBe(200);
    const bad = await app.inject({ method: "POST", url: "/api/login", payload: { email: "bob@example.com", password: "wrong-password" } });
    expect(bad.statusCode).toBe(401);
  });

  it("/api/me requires a bearer token and returns the signed-in player", async () => {
    const noAuth = await app.inject({ method: "GET", url: "/api/me" });
    expect(noAuth.statusCode).toBe(401);

    const { token, player } = await register("carl@example.com");
    const res = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { player: { id: string } }).player.id).toBe(player.id);
  });
});

describe("lobby + launch", () => {
  it("lists exactly what the platform client returns — nothing hardcoded", async () => {
    const res = await app.inject({ method: "GET", url: "/api/lobby" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { games: Array<{ game_code: string; display_name: string }> };
    expect(body.games).toHaveLength(1);
    expect(body.games[0].game_code).toBe("bananax");
    expect(body.games[0].display_name).toBe("Lucky Bananas");
  });

  it("requires login to launch a game, and passes the player's own id as playerRef", async () => {
    const anon = await app.inject({ method: "POST", url: "/api/play/bananax" });
    expect(anon.statusCode).toBe(401);

    const { token, player } = await register("dana@example.com");
    const res = await app.inject({ method: "POST", url: "/api/play/bananax", headers: { authorization: `Bearer ${token}` } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { launch_url: string }).launch_url).toContain(`lt_${player.id}`);
    expect(platform.launchCalls).toEqual([player.id]);
  });
});

describe("authorization boundary: a player can only ever see their own account", () => {
  it("player A's token never exposes player B's balance or transactions", async () => {
    const a = await register("playerA@example.com");
    const b = await register("playerB@example.com");

    // Give B a transaction so there's something distinguishing to leak.
    store.debit({ playerId: b.player.id, idempotencyKey: "b:debit", amount: 50, currency: "GEL", roundRef: "rb" });

    const asA = await app.inject({ method: "GET", url: "/api/account", headers: { authorization: `Bearer ${a.token}` } });
    expect(asA.statusCode).toBe(200);
    const bodyA = asA.json() as { player: { id: string; balance: number }; transactions: unknown[] };
    expect(bodyA.player.id).toBe(a.player.id);
    expect(bodyA.player.balance).toBe(1000); // untouched — not B's 950
    expect(bodyA.transactions).toEqual([]);

    // There is no route parameter for player id at all — /api/account always
    // resolves strictly from the bearer token, so there's no id to spoof. Confirm
    // a forged token (wrong secret) is rejected outright rather than trusting a
    // client-supplied identity.
    const forged = "eyJwbGF5ZXJfaWQiOiJhbnlvbmUiLCJleHAiOjk5OTk5OTk5OTl9.deadbeef";
    const spoofed = await app.inject({ method: "GET", url: "/api/account", headers: { authorization: `Bearer ${forged}` } });
    expect(spoofed.statusCode).toBe(401);
  });
});
