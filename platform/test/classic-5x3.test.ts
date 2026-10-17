import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { sandboxOf } from "../src/modules/wallet/routing-wallet";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/** A casino with Vault 20K and classic-5x3 (one variant per launch), sandbox wallet. */
async function stack(variant = "classic-5x3") {
  const c = buildContainer(CONFIG, {});
  const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const op = c.mgmt.createOperator({ name: "C", slug: "c" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  const game = c.mgmt.registerGame({ code: variant, title: "Classic 5x3" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.games.engineFor(variant).rulesVersion(), rtp_profile_key: variant, theoretical_rtp: 96.02, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 2] });
  sandboxOf(c.wallet)!.setBalance("p1", "GEL", 100_000);
  const lt = c.sessions.createLaunchToken({ operator_id: op.id, game_code: variant, operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const init = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(init.statusCode, init.body).toBe(200);
  const token = init.json().session_token as string;
  const call = (url: string, body: Record<string, unknown>) =>
    app.inject({ method: "POST", url, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() }, payload: JSON.stringify(body) });
  const balance = async () => Number((await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${token}` } })).json().balance?.amount);
  return { c, app, call, balance };
}

describe("classic-5x3 on the RGS", () => {
  it("plays through the same orchestrator: its own math, every round replays as legitimate, the feature keeps the bet", async () => {
    const { c, app, call } = await stack();
    let sawFeature = false;
    let featureBet: number | null = null;
    for (let i = 0; i < 3000 && !(sawFeature && featureBet === null); i++) { // a feature every ~150 spins: P(none in 3000) ~ 2e-9
      // Inside the feature the client asks for 2; the lock must keep the trigger's bet (1).
      const res = await call("/game/v1/spin", { bet_amount: featureBet === null ? 1 : 2 });
      expect(res.statusCode, res.body).toBe(200);
      const j = res.json();
      const r = j.result ?? j;
      expect(r.lines ?? j.lines).toBe(20);
      expect(r.engine_version ?? j.engine_version).toBe("1.0.0");
      if (Number(j.free_spins_awarded ?? r.free_spins_awarded) > 0 && !j.is_free_spin) { sawFeature = true; featureBet = 1; }
      if (j.is_free_spin) expect(Number(j.bet_amount ?? r.bet_amount)).toBe(1);
      if (featureBet !== null && Number(j.free_spins_left ?? r.free_spins_left) === 0 && j.is_free_spin) featureBet = null;
      const v = c.verification.verify(j.round_ref);
      expect(v?.verdict, JSON.stringify(v?.notes)).toBe("legitimate");
    }
    expect(sawFeature).toBe(true);
    await app.close();
  }, 120_000);

  it("no feature buy and no ante: refused before any money moves", async () => {
    const { app, call, balance } = await stack();
    const before = await balance();
    const buy = await call("/game/v1/buy-feature", { bet_amount: 1 });
    expect(buy.statusCode).toBe(403);
    expect(buy.json().error.code).toBe("FEATURE_BUY_DISABLED");
    const ante = await call("/game/v1/spin", { bet_amount: 1, ante_enabled: true });
    expect(ante.statusCode).toBe(403);
    expect(ante.json().error.code).toBe("ANTE_NOT_AVAILABLE");
    expect(await balance()).toBe(before);
    await app.close();
  });

  it("the 5,000x cap covers the whole feature: a win that would cross it pays up to the cap and ends the feature", () => {
    const engine = buildContainer(CONFIG, {}).games.engineFor("classic-5x3");
    let checked = 0;
    for (let i = 0; i < 400 && checked < 3; i++) {
      const seed = i.toString(16).padStart(64, "0");
      const snap = { gameId: "classic-5x3", freeSpinsLeft: 7, bonusRoundWin: 4999.9 };
      const r = engine.resolveDeterministic(snap, { bet_amount: 1 }, seed).result as unknown as { total_win: number; free_spins_left: number; bonus_round_win: number; events: Array<{ type: string }> };
      const uncapped = engine.resolveDeterministic({ ...snap, bonusRoundWin: 0 }, { bet_amount: 1 }, seed).result as unknown as { total_win: number };
      if (!(uncapped.total_win > 0.1)) continue; // only spins whose win would cross the cap
      expect(r.total_win).toBe(0.1);
      expect(r.bonus_round_win).toBe(5000);
      expect(r.free_spins_left).toBe(0);
      expect(r.events.map((e) => e.type)).toContain("FREE_SPINS_ENDED_BY_MAX_WIN_CAP");
      checked++;
    }
    expect(checked).toBe(3);
  });

  it("the variant fixes the line count (10 / 40), and Vault 20K still runs beside it", async () => {
    for (const [variant, lines] of [["classic-5x3_10", 10], ["classic-5x3_40", 40]] as const) {
      const { app, call } = await stack(variant);
      const j = (await call("/game/v1/spin", { bet_amount: 1 })).json();
      expect((j.result ?? j).lines).toBe(lines);
      await app.close();
    }
    const c = buildContainer(CONFIG, {});
    expect(c.games.engineFor("bananax").gameCode).toBe("bananax");
    expect(c.games.engineFor("classic-5x3").gameCode).toBe("classic-5x3");
    expect(c.games.engineFor("classic-5x3").maxWinMultiplier()).toBe(5000);
  });
});
