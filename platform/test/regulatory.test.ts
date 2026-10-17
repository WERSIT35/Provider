import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { buildRegulatoryProfile, REGULATORY_PRESETS } from "../src/modules/regulatory/regulatory";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

let app: FastifyInstance;
let c: Container;
let opId: string;
let clock = Date.now();
let key = 0;

async function setup() {
  clock = Date.now(); // sessions are stamped with real time; the fake clock moves on from it
  const wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  c.regulatory.now = () => clock;
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  opId = op.id;
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  wallet.setBalance("p1", "GEL", 100_000);
}

async function session() {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const res = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(res.statusCode).toBe(200);
  return res.json() as { session_token: string; session_id: string; regulatory: Record<string, unknown> };
}
const call = (path: string, token: string, body: object = {}) =>
  app.inject({ method: "POST", url: `/game/v1/${path}`, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": `k${key++}` }, payload: JSON.stringify(body) });
const admin = () => c.adminAuth.mintToken({ admin_id: "prov", scope: "provider", role: "provider_super_admin" });
const setProfile = (body: object) =>
  app.inject({ method: "PUT", url: `/admin/v1/operators/${opId}/regulatory`, headers: { authorization: `Bearer ${admin()}`, "content-type": "application/json" }, payload: JSON.stringify(body) });
/** Spin until a paid base round with no feature (so the next spin is a new round again). */
const playOutFeature = async (token: string) => {
  while (c.sessions.get(c.sessions.listByOperator(opId)[0].id).free_spins_left > 0) {
    clock += 60_000;
    expect((await call("spin", token, { bet_amount: 1 })).statusCode).toBe(200);
  }
};

describe("jurisdiction profiles", () => {
  beforeEach(setup);

  it("profiles: presets, overrides and validation", () => {
    expect(buildRegulatoryProfile({})).toEqual(REGULATORY_PRESETS.DEFAULT);
    expect(buildRegulatoryProfile({ preset: "ukgc" })).toMatchObject({ jurisdiction: "UKGC", min_round_ms: 2500, autoplay_enabled: false, buy_feature_enabled: false });
    expect(buildRegulatoryProfile({ preset: "MGA", reality_check_minutes: 30 })).toMatchObject({ jurisdiction: "MGA", reality_check_minutes: 30 });
    // Autoplay off forces the cap to 0.
    expect(buildRegulatoryProfile({ autoplay_enabled: false, max_autoplay_spins: 50 }).max_autoplay_spins).toBe(0);
    for (const bad of [{ preset: "XX" }, { min_round_ms: -1 }, { min_round_ms: 1.5 }, { reality_check_minutes: 0 }, { turbo_enabled: "no" }, { jurisdiction: "a b" }, { max_autoplay_spins: 2.5 },
      { celebrate_threshold: "never" }, { max_stake: 0 }, { max_stake: "5" }, { max_stake_young: -2 }, { session_hud: "banner" }, { rtp_display: "popup" }, { no_input_queue: "yes" }]) {
      expect(() => buildRegulatoryProfile(bad as never), JSON.stringify(bad)).toThrow(/REGULATORY_INVALID/);
    }
  });

  it("market presets carry the client switches (celebration, stake cap, session strip, RTP display, input)", () => {
    for (const [name, p] of Object.entries(REGULATORY_PRESETS)) {
      expect(p.jurisdiction).toBe(name);
      expect(["any", "gt_stake"]).toContain(p.celebrate_threshold);
      expect(p.no_input_queue).toBe(true);
      if (!p.autoplay_enabled) expect(p.max_autoplay_spins).toBe(0);
    }
    expect(REGULATORY_PRESETS.UKGC).toMatchObject({ celebrate_threshold: "gt_stake", max_stake: 5, max_stake_young: 2, session_hud: "net_time", turbo_enabled: false, slam_stop_enabled: false });
    expect(REGULATORY_PRESETS.ON).toMatchObject({ min_round_ms: 2500, autoplay_enabled: false, celebrate_threshold: "gt_stake", session_hud: "net_time" });
    expect(REGULATORY_PRESETS.DE).toMatchObject({ min_round_ms: 5000, max_stake: 1, buy_feature_enabled: false, rtp_display: "stake_area", session_hud: "panic" });
    expect(REGULATORY_PRESETS.DEFAULT).toMatchObject({ celebrate_threshold: "any", max_stake: null });
    expect(buildRegulatoryProfile({ preset: "de", max_stake: 3, session_hud: "none" })).toMatchObject({ jurisdiction: "DE", max_stake: 3, session_hud: "none" });
  });

  it("a profile stored before the client switches existed still loads; the session omits what it lacks", async () => {
    const legacy = { jurisdiction: "UKGC", min_round_ms: 2500, reality_check_minutes: 60, autoplay_enabled: false, max_autoplay_spins: 0, turbo_enabled: false, slam_stop_enabled: false, buy_feature_enabled: false };
    c.mgmt.setRegulatoryProfile(opId, legacy as never);
    const s = await session();
    expect(s.regulatory).toMatchObject({ jurisdiction: "UKGC", min_round_ms: 2500 });
    expect(s.regulatory.celebrate_threshold).toBeUndefined(); // the client shell falls back on the jurisdiction
  });

  it("admin sets and clears a profile; the session carries it to the client", async () => {
    expect((await setProfile({ preset: "UKGC" })).json().regulatory).toMatchObject({ jurisdiction: "UKGC" });
    expect((await setProfile({ min_round_ms: -5 })).statusCode).toBe(422);
    const s = await session();
    expect(s.regulatory).toMatchObject({ jurisdiction: "UKGC", min_round_ms: 2500, turbo_enabled: false, autoplay_enabled: false, celebrate_threshold: "gt_stake", max_stake: 5, session_hud: "net_time" });
    expect(Math.abs((s.regulatory.reality_check_due_in_ms as number) - 60 * 60_000)).toBeLessThan(5_000);
    expect(c.auditRepo.list({ operator_id: opId }).some((e) => e.action === "operator.regulatory.set")).toBe(true);
    expect((await setProfile({ preset: null })).json().regulatory).toEqual(REGULATORY_PRESETS.DEFAULT);
    const operatorScoped = c.adminAuth.mintToken({ admin_id: "op", scope: "operator", operator_id: opId, role: "operator_admin" });
    const denied = await app.inject({ method: "PUT", url: `/admin/v1/operators/${opId}/regulatory`, headers: { authorization: `Bearer ${operatorScoped}`, "content-type": "application/json" }, payload: JSON.stringify({ preset: "DEFAULT" }) });
    expect(denied.statusCode).toBe(403);
  });

  it("min_round_ms: a round started too soon is refused with retry-after; nothing is debited", async () => {
    await setProfile({ preset: "DEFAULT", min_round_ms: 2500 });
    const { session_token } = await session();
    expect((await call("spin", session_token, { bet_amount: 1 })).statusCode).toBe(200);
    await playOutFeature(session_token);
    const before = c.transactions.size();
    clock += 1000;
    const fast = await call("spin", session_token, { bet_amount: 1 });
    expect(fast.statusCode).toBe(429);
    expect(fast.json().error).toMatchObject({ code: "SPIN_TOO_FAST", details: { min_round_ms: 2500 } });
    expect(fast.json().error.details.retry_after_ms).toBeGreaterThan(0);
    expect(fast.headers["retry-after"]).toBeDefined();
    expect(c.transactions.size()).toBe(before);
    clock += 2500;
    expect((await call("spin", session_token, { bet_amount: 1 })).statusCode).toBe(200);
  });

  it("free spins inside a feature are not paced; a new round after it is", async () => {
    await setProfile({ preset: "DEFAULT", min_round_ms: 2500 });
    const { session_token } = await session();
    expect((await call("buy-feature", session_token, { bet_amount: 1 })).statusCode).toBe(200);
    // Every free spin back-to-back, no clock movement at all.
    let n = 0;
    while (c.sessions.get(c.sessions.listByOperator(opId)[0].id).free_spins_left > 0) {
      expect((await call("spin", session_token, { bet_amount: 1 })).statusCode).toBe(200);
      n++;
    }
    expect(n).toBeGreaterThan(0);
    expect((await call("spin", session_token, { bet_amount: 1 })).statusCode).toBe(429);
  });

  it("reality check: the next round is refused with session stats until acknowledged", async () => {
    await setProfile({ preset: "MGA", reality_check_minutes: 60 });
    const { session_token } = await session();
    expect((await call("spin", session_token, { bet_amount: 5 })).statusCode).toBe(200);
    await playOutFeature(session_token);
    clock += 61 * 60_000;
    const blocked = await call("spin", session_token, { bet_amount: 5 });
    expect(blocked.statusCode).toBe(409);
    const d = blocked.json().error.details;
    expect(blocked.json().error.code).toBe("REALITY_CHECK_REQUIRED");
    expect(d).toMatchObject({ jurisdiction: "MGA" });
    expect(d.rounds).toBeGreaterThan(0);
    expect(d.wagered).toBeGreaterThanOrEqual(5);
    expect(d.net).toBeCloseTo(d.won - d.wagered, 2);
    expect(d.elapsed_ms).toBeGreaterThan(60 * 60_000);
    const ack = await call("reality-check/ack", session_token);
    expect(ack.statusCode).toBe(200);
    expect(ack.json().next_due_in_ms).toBe(60 * 60_000);
    expect((await call("spin", session_token, { bet_amount: 5 })).statusCode).toBe(200);
    const state = await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${session_token}` } });
    expect(state.json().regulatory.reality_check_due_in_ms).toBe(60 * 60_000);
  });

  it("buy_feature_enabled false refuses the buy and debits nothing", async () => {
    await setProfile({ preset: "UKGC" });
    const { session_token } = await session();
    const before = c.transactions.size();
    const res = await call("buy-feature", session_token, { bet_amount: 1 });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe("FEATURE_BUY_DISABLED");
    expect(c.transactions.size()).toBe(before);
  });

  it("DEFAULT (no profile) changes nothing: back-to-back spins, no reality check", async () => {
    const { session_token, regulatory } = await session();
    expect(regulatory).toMatchObject({ jurisdiction: "DEFAULT", reality_check_due_in_ms: null });
    for (let i = 0; i < 3; i++) expect((await call("spin", session_token, { bet_amount: 1 })).statusCode).toBe(200);
  });
});
