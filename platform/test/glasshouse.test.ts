import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { sandboxOf } from "../src/modules/wallet/routing-wallet";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/** A casino with Glasshouse (one variant per launch), sandbox wallet. */
async function stack(variant = "glasshouse") {
  const c = buildContainer(CONFIG, {});
  const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const op = c.mgmt.createOperator({ name: "C", slug: "c" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: variant, title: "Glasshouse" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.games.engineFor(variant).rulesVersion(), rtp_profile_key: variant, theoretical_rtp: 96.3, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 2] });
  sandboxOf(c.wallet)!.setBalance("p1", "GEL", 1_000_000);
  const lt = c.sessions.createLaunchToken({ operator_id: op.id, game_code: variant, operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const init = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(init.statusCode, init.body).toBe(200);
  const token = init.json().session_token as string;
  const call = (url: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, payload: JSON.stringify(body) });
  const session = async () => (await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${token}` } })).json();
  const balance = async () => Number((await session()).balance?.amount);
  return { c, app, call, session, balance };
}

// The round payload, whether the route nests it under `result` or not.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const payload = (j: any) => j.result ?? j;

describe("Glasshouse on the RGS", () => {
  it("plays through the same orchestrator: its own math, beams in the payload, every round replays as legitimate", async () => {
    const { c, app, call } = await stack();
    let beams = 0;
    for (let i = 0; i < 1500 && beams < 3; i++) { // a beam on ~1 in 33 paid spins: P(fewer than 3 in 1500) ~ 1e-17
      const res = await call("/game/v1/spin", { bet_amount: 1 });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json();
      const r = payload(j);
      expect(r.engine_version).toBe("gh-1.0.0");
      expect(r.matrix).toHaveLength(4);
      expect(r.matrix[0]).toHaveLength(6);
      if (r.beams.length) {
        beams++;
        // The client only replays the path: every wild this spin is on a beam path (base game: no lit panes carried).
        if (!r.is_free_spin) for (const [row, reel] of r.wilds) expect(r.lit).toContainEqual([row, reel]);
      }
      const v = c.verification.verify(j.round_ref);
      expect(v?.verdict, JSON.stringify(v?.notes)).toBe("legitimate");
    }
    expect(beams).toBe(3);
    await app.close();
  }, 120_000);

  it("buys the feature for 100x, carries the lit panes between free spins, keeps the bet and resumes after a reload", async () => {
    const { c, app, call, session, balance } = await stack();
    const before = await balance();
    const buy = await call("/game/v1/buy-feature", { bet_amount: 1 });
    expect(buy.statusCode, buy.body).toBe(200);
    const bj = buy.json();
    expect(Number(bj.bet_charged)).toBe(100);
    expect(payload(bj).scatter.count).toBe(3);
    expect(payload(bj).feature_state).toEqual({ sticky: [], ttl: [] });
    expect(c.verification.verify(bj.round_ref)?.verdict).toBe("legitimate");
    expect(await balance()).toBeCloseTo(before - 100 + Number(bj.total_win), 2);

    let left = Number(bj.free_spins_left);
    let state = payload(bj).feature_state;
    while (left > 0) {
      // A reload in the middle of the feature resumes it with the same lit panes.
      const resumed = (await session()).resume.feature;
      expect(resumed.feature_state).toEqual(state);
      // Inside the feature the client asks for 2; the lock keeps the buy's bet (1).
      const res = await call("/game/v1/spin", { bet_amount: 2 });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json();
      const r = payload(j);
      expect(r.is_free_spin).toBe(true);
      expect(Number(r.bet_amount)).toBe(1);
      expect(r.sticky_in).toEqual(state ? state.sticky : []);
      expect(c.verification.verify(j.round_ref)?.verdict).toBe("legitimate");
      state = r.feature_state;
      left = Number(r.free_spins_left);
    }
    expect(state).toBeNull();
    expect((await session()).resume.feature ?? null).toBeFalsy();
    await app.close();
  }, 120_000);

  it("the feature state is the round's pre-state: the same seed and lit panes replay the same free spin", () => {
    const engine = buildContainer(CONFIG, {}).games.engineFor("glasshouse");
    let carried = 0;
    for (let i = 0; i < 300; i++) {
      const seed = (i + 1).toString(16).padStart(64, "0");
      const snap = { gameId: "glasshouse", freeSpinsLeft: 6, bonusRoundWin: 10, featureState: { sticky: [[1, 2], [2, 3]], ttl: [2, 1] } };
      const a = engine.resolveDeterministic(snap, { bet_amount: 1 }, seed).result as unknown as Record<string, unknown>;
      const b = engine.resolveDeterministic(snap, { bet_amount: 1 }, seed).result as unknown as Record<string, unknown>;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      expect(a.sticky_in).toEqual([[1, 2], [2, 3]]);
      // Both carried panes are wild this spin; the one on its last spin fades unless a beam crosses it again.
      expect(a.wilds).toEqual(expect.arrayContaining([[1, 2], [2, 3]]));
      const fs = a.feature_state as { sticky: number[][]; ttl: number[] } | null;
      if (fs) {
        const at = (r: number, c: number) => fs.ttl[fs.sticky.findIndex(([x, y]) => x === r && y === c)];
        const lit = a.lit as number[][];
        expect(at(1, 2)).toBe(lit.some(([x, y]) => x === 1 && y === 2) ? 2 : 1);
        if (!lit.some(([x, y]) => x === 2 && y === 3)) expect(at(2, 3)).toBeUndefined();
        carried++;
      }
    }
    expect(carried).toBeGreaterThan(250);
  });

  it("no ante; the buy is refused inside the feature; both before any money moves", async () => {
    const { app, call, balance } = await stack();
    const before = await balance();
    const ante = await call("/game/v1/spin", { bet_amount: 1, ante_enabled: true });
    expect(ante.statusCode).toBe(403);
    expect(ante.json().error.code).toBe("ANTE_NOT_AVAILABLE");
    expect(await balance()).toBe(before);
    const buy = await call("/game/v1/buy-feature", { bet_amount: 1 });
    expect(buy.statusCode).toBe(200);
    const mid = await balance();
    const again = await call("/game/v1/buy-feature", { bet_amount: 1 });
    expect(again.statusCode).toBeGreaterThanOrEqual(400);
    expect(await balance()).toBe(mid);
    await app.close();
  });

  it("the 5,000x cap covers the whole feature: a win that would cross it pays up to the cap and ends the feature", () => {
    const engine = buildContainer(CONFIG, {}).games.engineFor("glasshouse");
    const all: number[][] = [];
    for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) all.push([r, c]);
    const snap = { gameId: "glasshouse", freeSpinsLeft: 5, bonusRoundWin: 4990, featureState: { sticky: all, ttl: all.map(() => 2) } };
    const r = engine.resolveDeterministic(snap, { bet_amount: 1 }, "ab".repeat(32)).result as unknown as { total_win: number; free_spins_left: number; bonus_round_win: number; feature_state: unknown; events: Array<{ type: string }> };
    expect(r.total_win).toBe(10);
    expect(r.bonus_round_win).toBe(5000);
    expect(r.free_spins_left).toBe(0);
    expect(r.feature_state).toBeNull();
    expect(r.events.map((e) => e.type)).toContain("FREE_SPINS_ENDED_BY_MAX_WIN_CAP");
    expect(engine.maxWinMultiplier()).toBe(5000);
  });

  it("the variants have their own strips and RTP; the other games still run beside it", async () => {
    for (const variant of ["glasshouse_95", "glasshouse_94"]) {
      const { c, app, call } = await stack(variant);
      const j = (await call("/game/v1/spin", { bet_amount: 1 })).json();
      expect(payload(j).game_id).toBe(variant);
      expect(c.verification.verify(j.round_ref)?.verdict).toBe("legitimate");
      await app.close();
    }
    const c = buildContainer(CONFIG, {});
    expect(c.games.engineFor("glasshouse").getRtpProfile("glasshouse_94").theoretical_percent).toBe(93.95);
    for (const code of ["bananax", "classic-5x3", "relicforge", "glasshouse"]) expect(c.games.engineFor(code).gameCode).toBe(code);
  });
});
