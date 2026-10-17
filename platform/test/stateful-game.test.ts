import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { _resetEngineCacheForTests } from "../src/lib/engine-loader";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { PlayerStateStore } from "../src/modules/player-state/player-state.store";

/**
 * Stateful games (docs/relic-forge/02-tech-plan.md §5): a per-session feature state, a
 * per-player state that outlives sessions (the Forge meter), and a player choice between
 * rounds. Proven with a tiny fixture game next to the real Vault 20K, which must not
 * notice any of it.
 */

const REPO = path.resolve(__dirname, "..", "..");
const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const ORIGIN = "casino.example.com";

/**
 * forge-test: every paid spin adds 1 to the player's meter at that bet; at 3 the feature
 * triggers (2 free spins, meter back to 0) and leaves an offer of 3 picks. Each free spin
 * must name one; the picks are kept in the feature state.
 */
const FORGE_ENGINE = `(function (root) {
  "use strict";
  class SpinEngine {
    constructor({ rules }) {
      this.rules = rules;
      this.MAX_WIN_CAP_X = 100;
      this.SUPPORTS_BUY = false;
      this.SUPPORTS_ANTE = false;
      this.USES_FEATURE_STATE = true;
      this.USES_PLAYER_STATE = true;
      this.SUPPORTS_CHOICE = true;
    }
    getAllowedBets() { return [1, 5]; }
    getRtpProfile() { return { game_id: "forge-test", payout_scaler: 1, free_spin_payout_scaler: 1, theoretical_percent: 50 }; }
    choiceOptions(fs) { return fs && fs.spins_left > 0 ? fs.offer.length : 0; }
    spin(input) {
      const s = this.session;
      const fs = s.featureState || null;
      const b = new Uint8Array(1);
      root.crypto.getRandomValues(b);
      const bet = input.bet_amount;
      const win = (b[0] % 3) * 0.5 * bet;
      const base = { spin_id: input.spin_id || "x", bet_amount: bet, total_win: win, byte: b[0] };
      if (fs && fs.spins_left > 0) {
        const pick = fs.offer[input.choice];
        if (pick === undefined) throw new Error("INVALID_CHOICE");
        const left = fs.spins_left - 1;
        const picks = fs.picks.concat([pick]);
        return Object.assign(base, {
          is_free_spin: true, bet_charged: 0, free_spins_left: left, free_spins_awarded: 0, picks,
          feature_state: left > 0 ? { spins_left: left, offer: ["x" + (b[0] % 5), "y", "z"], picks } : null,
          player_state: s.playerState === undefined ? null : s.playerState
        });
      }
      const meter = Number((s.playerState && s.playerState.meter) || 0) + 1;
      const trig = meter >= 3;
      return Object.assign(base, {
        is_free_spin: false, bet_charged: bet, free_spins_left: trig ? 2 : 0, free_spins_awarded: trig ? 2 : 0,
        feature_state: trig ? { spins_left: 2, offer: ["a", "b", "c"], picks: [] } : null,
        player_state: { meter: trig ? 0 : meter }
      });
    }
  }
  root.SlotEngine = { SpinEngine, ENGINE_VERSION: "forge-test-1" };
})(globalThis);`;

function fixtureGames(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "games-stateful-"));
  const real = JSON.parse(fs.readFileSync(path.join(REPO, "games/bananax/game.json"), "utf8"));
  fs.mkdirSync(path.join(root, "bananax"));
  fs.writeFileSync(
    path.join(root, "bananax/game.json"),
    JSON.stringify({ ...real, engine: { ...real.engine, dir: path.join(REPO, "client/engine") }, rules: path.join(REPO, "client/math/game-rules-v2.json"), client: path.join(REPO, "client") })
  );
  const dir = path.join(root, "forge-test");
  fs.mkdirSync(path.join(dir, "client"), { recursive: true });
  fs.writeFileSync(path.join(dir, "engine.js"), FORGE_ENGINE);
  fs.writeFileSync(path.join(dir, "rules.json"), JSON.stringify({ version: "f1", rtp_profiles: [{ game_id: "forge-test" }] }));
  fs.writeFileSync(path.join(dir, "client/index.html"), "<!doctype html><title>forge-test client</title>");
  fs.writeFileSync(
    path.join(dir, "game.json"),
    JSON.stringify({
      code: "forge-test",
      title: "Forge Test",
      engine: { dir: ".", namespace: "SlotEngine", files: ["engine.js"] },
      rules: "rules.json",
      client: "client",
      presentation: { turbo: false, slam_stop: false }
    })
  );
  return root;
}

let gamesDir: string;
let savedGamesDir: string | undefined;
let c: Container;
let app: FastifyInstance;
let wallet: SandboxWallet;
let operatorId: string;

beforeAll(() => {
  savedGamesDir = process.env.GAMES_DIR;
  gamesDir = fixtureGames();
  process.env.GAMES_DIR = gamesDir;
  _resetEngineCacheForTests();
});

afterAll(() => {
  if (savedGamesDir === undefined) delete process.env.GAMES_DIR;
  else process.env.GAMES_DIR = savedGamesDir;
  _resetEngineCacheForTests();
  fs.rmSync(gamesDir, { recursive: true, force: true });
});

beforeEach(async () => {
  wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const op = c.mgmt.createOperator({ name: "O", slug: "o" });
  operatorId = op.id;
  c.mgmt.addDomain(op.id, ORIGIN, "prod");
  for (const code of ["forge-test", "bananax"]) {
    const game = c.mgmt.registerGame({ code, title: code });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "1", rtp_profile_key: code, theoretical_rtp: 96, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  }
  wallet.setBalance("p1", "GEL", 1000);
  wallet.setBalance("p2", "GEL", 1000);
});

afterEach(async () => {
  await app.close();
});

async function session(gameCode = "forge-test", player = "p1"): Promise<{ token: string; init: Record<string, any> }> {
  const lt = c.sessions.createLaunchToken({ operator_id: operatorId, game_code: gameCode, operator_player_id: player, currency: "GEL", origin: ORIGIN });
  const res = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
  expect(res.statusCode).toBe(200);
  const init = res.json();
  return { token: init.session_token, init };
}

let keySeq = 0;
function spin(token: string, body: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/game/v1/spin",
    headers: { authorization: `Bearer ${token}`, "idempotency-key": `k-${++keySeq}-${Date.now()}` },
    payload: body
  });
}

describe("stateful games: player state across sessions", () => {
  it("keeps a meter per player, game, currency and bet, across sessions", async () => {
    const a = await session();
    expect(a.init.resume.player_states).toEqual({});
    expect((await spin(a.token, { bet_amount: 1 })).json().player_state).toEqual({ meter: 1 });
    expect((await spin(a.token, { bet_amount: 1 })).json().player_state).toEqual({ meter: 2 });
    expect((await spin(a.token, { bet_amount: 5 })).json().player_state).toEqual({ meter: 1 });

    // A new session (another visit) sees both meters, keyed by bet.
    const b = await session();
    expect(b.init.resume.player_states).toEqual({ "1.00": { meter: 2 }, "5.00": { meter: 1 } });
    // Another player starts empty.
    expect((await session("forge-test", "p2")).init.resume.player_states).toEqual({});
  });

  it("records the state in the round's pre-state, and the round replays exactly", async () => {
    const a = await session();
    await spin(a.token, { bet_amount: 1 });
    const second = (await spin(a.token, { bet_amount: 1 })).json();
    const round = c.ledger.getRound(second.round_ref)!;
    expect(round.pre_state).toMatchObject({ game_code: "forge-test", feature_state: null, player_state: { meter: 1 } });
    expect(c.verification.verify(second.round_ref)?.verdict).toBe("legitimate");
  });

  it("a state built under other rules reads back empty (the disclosed reset policy)", () => {
    const store = new PlayerStateStore();
    const key = { operator_id: "o", operator_player_id: "p", game_code: "g", currency: "GEL", bet_amount: 1 };
    store.set(key, { meter: 7 }, "rules-A");
    expect(store.get(key, "rules-A")).toEqual({ meter: 7 });
    expect(store.get(key, "rules-B")).toBeNull();
    expect(store.byBet(key, "rules-B")).toEqual({});
  });

  it("one round at a time per player state: a second session of the same player and bet waits its turn", async () => {
    const a = await session();
    const b = await session();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const debit = wallet.debit.bind(wallet);
    wallet.debit = async (...args: Parameters<typeof debit>) => {
      await gate;
      return debit(...args);
    };
    const first = spin(a.token, { bet_amount: 1 });
    await new Promise((r) => setTimeout(r, 20));
    const busy = await spin(b.token, { bet_amount: 1 });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe("PLAYER_STATE_BUSY");
    // Another bet is another state: not blocked.
    const otherBet = spin(b.token, { bet_amount: 5 });
    release();
    expect((await first).statusCode).toBe(200);
    expect((await otherBet).statusCode).toBe(200);
    // Released with the round.
    expect((await spin(b.token, { bet_amount: 1 })).json().player_state).toEqual({ meter: 2 });
  });
});

describe("stateful games: feature state and player choice", () => {
  async function triggered() {
    const s = await session();
    await spin(s.token, { bet_amount: 1 });
    await spin(s.token, { bet_amount: 1 });
    const trigger = (await spin(s.token, { bet_amount: 1 })).json();
    expect(trigger.free_spins_left).toBe(2);
    expect(trigger.feature_state).toEqual({ spins_left: 2, offer: ["a", "b", "c"], picks: [] });
    return s;
  }

  it("a pending offer must be answered with one of its options, before any money moves", async () => {
    const s = await triggered();
    const missing = await spin(s.token, { bet_amount: 1 });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe("CHOICE_REQUIRED");
    const outOfRange = await spin(s.token, { bet_amount: 1, choice: 3 });
    expect(outOfRange.statusCode).toBe(422);
    expect(outOfRange.json().error.code).toBe("INVALID_CHOICE");
    const notIndex = await spin(s.token, { bet_amount: 1, choice: 1.5 });
    expect(notIndex.statusCode).toBe(422);

    const picked = (await spin(s.token, { bet_amount: 1, choice: 1 })).json();
    expect(picked.picks).toEqual(["b"]);
    expect(picked.free_spins_left).toBe(1);
    const round = c.ledger.getRound(picked.round_ref)!;
    expect(round.pre_state).toMatchObject({ choice: 1, feature_state: { offer: ["a", "b", "c"] } });
    expect(c.verification.verify(picked.round_ref)?.verdict).toBe("legitimate");

    // A reload resumes the feature with its pending offer.
    const resumed = await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${s.token}` } });
    expect(resumed.json().resume.feature.feature_state.picks).toEqual(["b"]);

    const last = (await spin(s.token, { bet_amount: 1, choice: 0 })).json();
    expect(last.free_spins_left).toBe(0);
    expect(last.feature_state).toBeNull();
    // Feature over: no offer, so a choice is refused.
    const extra = await spin(s.token, { bet_amount: 1, choice: 0 });
    expect(extra.json().error.code).toBe("INVALID_CHOICE");
  });

  it("a game without choices refuses one (Vault 20K)", async () => {
    const v = await session("bananax");
    const res = await spin(v.token, { bet_amount: 1, choice: 0 });
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe("INVALID_CHOICE");
  });
});

describe("stateful games leave Vault 20K exactly as it was", () => {
  it("a Vault 20K round's pre-state and session payload carry none of the new keys", async () => {
    const v = await session("bananax");
    expect(v.init.resume).not.toHaveProperty("player_states");
    const res = (await spin(v.token, { bet_amount: 1 })).json();
    expect(res).not.toHaveProperty("feature_state");
    expect(res).not.toHaveProperty("player_state");
    const round = c.ledger.getRound(res.round_ref)!;
    expect(Object.keys(round.pre_state!).sort()).toEqual(["ante_enabled", "balance", "bonus_round_win", "free_spin_multiplier_carry", "free_spins_left", "game_code", "resolve_mode"]);
    expect(c.verification.verify(res.round_ref)?.verdict).toBe("legitimate");
  });
});

describe("per-game clients and controls", () => {
  it("serves a game's client at /play/g/<code>/; unknown codes are 404; /play/ is still Vault 20K", async () => {
    const page = await app.inject({ method: "GET", url: "/play/g/forge-test/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("forge-test client");
    const redirect = await app.inject({ method: "GET", url: "/play/g/forge-test?lt=abc" });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("/play/g/forge-test/?lt=abc");
    expect((await app.inject({ method: "GET", url: "/play/g/nope/" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/play/g/forge-test/../../engine.js" })).statusCode).toBe(404);
    const vault = await app.inject({ method: "GET", url: "/play/" });
    expect(vault.statusCode).toBe(200);
    expect(vault.body).not.toContain("forge-test client");
  });

  it("turbo and slam-stop: the market's switch AND the game's manifest", async () => {
    const forge = (await session()).init.regulatory;
    expect(forge).toMatchObject({ turbo_enabled: false, slam_stop_enabled: false });
    const vault = (await session("bananax")).init.regulatory;
    expect(vault).toMatchObject({ turbo_enabled: true, slam_stop_enabled: true });
  });
});
