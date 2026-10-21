import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { sandboxOf } from "../src/modules/wallet/routing-wallet";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/** A casino with Clockwork Menagerie (one variant per launch), sandbox wallet. */
async function stack(variant = "clockwork") {
  const c = buildContainer(CONFIG, {});
  const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const op = c.mgmt.createOperator({ name: "C", slug: "c" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: variant, title: "Clockwork Menagerie" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.games.engineFor(variant).rulesVersion(), rtp_profile_key: variant, theoretical_rtp: 96, config_hash: "h" });
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

describe("Clockwork Menagerie on the RGS", () => {
  it("plays through the same orchestrator: respins inside one round (one debit), every round replays as legitimate", async () => {
    const { c, app, call, balance } = await stack();
    let respinRounds = 0;
    for (let i = 0; i < 2000 && respinRounds < 3; i++) { // a respin round ~1 in 26 paid spins: P(fewer than 3 in 2000) ~ 1e-28
      const before = await balance();
      const res = await call("/game/v1/spin", { bet_amount: 1 });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json();
      const r = payload(j);
      expect(r.engine_version).toBe("cw-1.0.0");
      expect(r.matrix).toHaveLength(3);
      expect(r.matrix[0]).toHaveLength(5);
      expect(r.boards).toHaveLength(r.respins + 1);
      if (r.respins > 0) {
        respinRounds++;
        // Every respin holds at least one wound reel: no stop drawn for it, and its column shows the wild.
        for (const b of r.boards.slice(1)) {
          const held = (b.stops as Array<number | null>).map((s, c) => (s === null ? c : -1)).filter((c) => c >= 0);
          expect(held.length).toBeGreaterThan(0);
          for (const c of held) expect(b.matrix.map((row: string[]) => row[c])).toEqual(["KEY", "KEY", "KEY"]);
        }
      }
      if (!r.is_free_spin && r.free_spins_left === 0) expect(await balance()).toBeCloseTo(before - 1 + Number(r.total_win), 2);
      const v = c.verification.verify(j.round_ref);
      expect(v?.verdict, JSON.stringify(v?.notes)).toBe("legitimate");
    }
    expect(respinRounds).toBe(3);
    await app.close();
  }, 180_000);

  it("buys the feature for 100x, carries the wound reels between free spins, keeps the bet and resumes after a reload", async () => {
    const { c, app, call, session, balance } = await stack();
    const before = await balance();
    const buy = await call("/game/v1/buy-feature", { bet_amount: 1 });
    expect(buy.statusCode, buy.body).toBe(200);
    const bj = buy.json();
    expect(Number(bj.bet_charged)).toBe(100);
    expect(payload(bj).boards[0].scatter.count).toBe(3);
    expect(payload(bj).respins).toBe(0);
    expect(payload(bj).feature_state).toEqual({ wound: [] });
    expect(c.verification.verify(bj.round_ref)?.verdict).toBe("legitimate");
    expect(await balance()).toBeCloseTo(before - 100 + Number(bj.total_win), 2);

    let left = Number(bj.free_spins_left);
    let state = payload(bj).feature_state;
    while (left > 0) {
      const resumed = (await session()).resume.feature;
      expect(resumed.feature_state).toEqual(state);
      // Inside the feature the client asks for 2; the lock keeps the buy's bet (1).
      const res = await call("/game/v1/spin", { bet_amount: 2 });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json();
      const r = payload(j);
      expect(r.is_free_spin).toBe(true);
      expect(Number(r.bet_amount)).toBe(1);
      // Every reel wound before this spin is still wound, its multiplier one higher (capped).
      for (const [reel, m] of (state?.wound ?? []) as number[][]) expect(r.boards[0].wound).toContainEqual([reel, Math.min(5, m + 1)]);
      expect(c.verification.verify(j.round_ref)?.verdict).toBe("legitimate");
      state = r.feature_state;
      left = Number(r.free_spins_left);
    }
    expect(state).toBeNull();
    expect((await session()).resume.feature ?? null).toBeFalsy();
    await app.close();
  }, 180_000);

  it("the feature state is the round's pre-state: the same seed and wound reels replay the same free spin", () => {
    const engine = buildContainer(CONFIG, {}).games.engineFor("clockwork");
    for (let i = 0; i < 300; i++) {
      const seed = (i + 1).toString(16).padStart(64, "0");
      const snap = { gameId: "clockwork", freeSpinsLeft: 6, bonusRoundWin: 10, featureState: { wound: [[1, 2], [3, 5]] } };
      const a = engine.resolveDeterministic(snap, { bet_amount: 1 }, seed).result as unknown as Record<string, unknown>;
      const b = engine.resolveDeterministic(snap, { bet_amount: 1 }, seed).result as unknown as Record<string, unknown>;
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      const wound = (a.boards as Array<{ wound: number[][] }>)[0].wound;
      expect(wound).toEqual(expect.arrayContaining([[1, 3], [3, 5]]));
    }
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

  it("the 10,000x cap covers the whole feature: a win that would cross it pays up to the cap and ends the feature", () => {
    const engine = buildContainer(CONFIG, {}).games.engineFor("clockwork");
    let checked = 0;
    for (let i = 0; i < 400 && checked < 3; i++) {
      const snap = { gameId: "clockwork", freeSpinsLeft: 5, bonusRoundWin: 9999.5, featureState: { wound: [[1, 5], [2, 5], [3, 5]] } };
      const r = engine.resolveDeterministic(snap, { bet_amount: 1 }, (i + 7).toString(16).padStart(64, "0")).result as unknown as { total_win: number; free_spins_left: number; bonus_round_win: number; feature_state: unknown; events: Array<{ type: string }> };
      expect(r.bonus_round_win).toBeLessThanOrEqual(10000);
      if (r.events.some((e) => e.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP")) {
        expect(r.total_win).toBe(0.5);
        expect(r.bonus_round_win).toBe(10000);
        expect(r.free_spins_left).toBe(0);
        expect(r.feature_state).toBeNull();
        checked++;
      }
    }
    expect(checked).toBe(3);
    expect(engine.maxWinMultiplier()).toBe(10000);
  });

  it("the variants have their own strips and RTP; the other games still run beside it", async () => {
    for (const variant of ["clockwork_94", "clockwork_92"]) {
      const { c, app, call } = await stack(variant);
      const j = (await call("/game/v1/spin", { bet_amount: 1 })).json();
      expect(payload(j).game_id).toBe(variant);
      expect(c.verification.verify(j.round_ref)?.verdict).toBe("legitimate");
      await app.close();
    }
    const c = buildContainer(CONFIG, {});
    for (const code of ["bananax", "classic-5x3", "relicforge", "glasshouse", "clockwork"]) expect(c.games.engineFor(code).gameCode).toBe(code);
  });
});
