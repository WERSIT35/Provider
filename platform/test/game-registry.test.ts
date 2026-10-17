import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { GameRegistry } from "../src/modules/games/game-registry";
import { _resetEngineCacheForTests } from "../src/lib/engine-loader";
import { installSeededCrypto, withSeed } from "../src/lib/seeded-rng";
import { stableStringify } from "../src/modules/ledger/hash-chain";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";

const REPO = path.resolve(__dirname, "..", "..");
const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

/**
 * A games/ folder with Vault 20K (the real manifest's files, by absolute path) and a
 * second, tiny fixture game that ALSO registers `SlotEngine` and records what it can see.
 */
function fixtureGames(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "games-"));
  const real = JSON.parse(fs.readFileSync(path.join(REPO, "games/bananax/game.json"), "utf8"));
  fs.mkdirSync(path.join(root, "bananax"));
  fs.writeFileSync(path.join(root, "bananax/game.json"), JSON.stringify({ ...real, engine: { ...real.engine, dir: path.join(REPO, "client/engine") }, rules: path.join(REPO, "client/math/game-rules-v2.json") }));
  const echo = path.join(root, "echo-test");
  fs.mkdirSync(echo);
  fs.writeFileSync(path.join(echo, "engine.js"), `(function (root) {
    let evalBlocked = false; try { eval("1"); } catch { evalBlocked = true; }
    class SpinEngine {
      constructor({ rules }) { this.rules = rules; this.MAX_WIN_CAP_X = 100; }
      getAllowedBets() { return [1]; }
      getRtpProfile() { return { game_id: "echo-test", payout_scaler: 1, free_spin_payout_scaler: 1, theoretical_percent: 50 }; }
      spin({ bet_amount }) { const b = new Uint8Array(1); root.crypto.getRandomValues(b); return { bet_amount, total_win: 0, byte: b[0], is_free_spin: false }; }
    }
    root.SlotEngine = { SpinEngine, ENGINE_VERSION: "echo-1", seen: { process: typeof process, require: typeof require, hostSlot: typeof root.SlotEngine, evalBlocked } };
  })(globalThis);`);
  fs.writeFileSync(path.join(echo, "rules.json"), JSON.stringify({ version: "e1", rtp_profiles: [{ game_id: "echo-test" }] }));
  fs.writeFileSync(path.join(echo, "game.json"), JSON.stringify({ code: "echo-test", title: "Echo", engine: { dir: ".", namespace: "SlotEngine", files: ["engine.js"] }, rules: "rules.json", client: "." }));
  return root;
}

describe("game registry: one engine per game, each in its own vm context", () => {
  let dir: string;
  let saved: string | undefined;
  beforeAll(() => {
    saved = process.env.GAMES_DIR;
    dir = fixtureGames();
    process.env.GAMES_DIR = dir;
    _resetEngineCacheForTests();
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.GAMES_DIR;
    else process.env.GAMES_DIR = saved;
    _resetEngineCacheForTests();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two games that both register SlotEngine stay apart, and neither touches the host", () => {
    const games = new GameRegistry().preload();
    expect(games.list().map((g) => g.code)).toEqual(["bananax", "echo-test"]);
    expect(games.engineFor("bananax").engineVersion()).toMatch(/^\d+\.\d+\.\d+$/);
    expect(games.engineFor("echo-test").engineVersion()).toBe("echo-1");
    expect((globalThis as Record<string, unknown>).SlotEngine).toBeUndefined();
  });

  it("an engine sees only its sandbox: no process, no require, no eval", async () => {
    const { loadGameEngine } = await import("../src/lib/engine-loader");
    expect(loadGameEngine("echo-test").ns.seen).toEqual({ process: "undefined", require: "undefined", hostSlot: "undefined", evalBlocked: true });
  });

  it("session game codes route to their game (RTP variants included); unknown codes are refused", () => {
    const games = new GameRegistry();
    expect(games.engineFor("bananax_94")).toBe(games.engineFor("bananax"));
    expect(games.engineFor(undefined)).toBe(games.default);
    expect(() => games.engineFor("game-unknown")).toThrow("GAME_NOT_FOUND");
    expect(games.has("echo-test") && !games.has("nope")).toBe(true);
  });

  it("every game's randomness is the seeded RNG: same seed, same draw", () => {
    const echo = new GameRegistry().engineFor("echo-test");
    const a = echo.resolveDeterministic({}, { bet_amount: 1 }, "11".repeat(32));
    const b = echo.resolveDeterministic({}, { bet_amount: 1 }, "11".repeat(32));
    expect(a.bytesDrawn).toBe(1);
    expect((a.result as unknown as { byte: number }).byte).toBe((b.result as unknown as { byte: number }).byte);
  });
});

describe("game registry: Vault 20K resolves exactly as the old global loader did", () => {
  it("2,000 seeded rounds (spins, ante, feature spins, buys) are byte-identical", () => {
    _resetEngineCacheForTests();
    const vault = new GameRegistry().default;
    // The old loader: each engine file as a function on the host's globalThis.
    installSeededCrypto();
    const g = globalThis as Record<string, unknown>;
    const before = g.SlotEngine;
    for (const f of ["rng.js", "config.js", "symbols.js", "multipliers.js", "matrix.js", "payouts.js", "tumble.js", "crazy-mode.js", "session-store.js", "spin-engine.js", "simulator.js"]) {
      new Function("module", "exports", fs.readFileSync(path.join(REPO, "client/engine", f), "utf8")).call(globalThis, { exports: {} }, {});
    }
    const legacy = g.SlotEngine as { SpinEngine: new (o: unknown) => { session: unknown; spin: (i: unknown) => unknown; buyFreeSpins: (i: unknown) => unknown } };
    const rules = JSON.parse(fs.readFileSync(path.join(REPO, "client/math/game-rules-v2.json"), "utf8"));
    const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    try {
      for (let i = 0; i < 2000; i++) {
        const seedHex = createHash("sha256").update(`registry-parity/${i}`).digest("hex");
        const buy = i % 25 === 7;
        const snap = { gameId: "bananax", freeSpinsLeft: i % 5 === 3 ? 1 + (i % 9) : 0, freeSpinPersistentMultiplier: i % 5 === 3 ? i % 6 : 0, bonusRoundWin: 0, anteEnabled: !buy && i % 4 === 1 };
        const input = { bet_amount: 1, ante_enabled: snap.anteEnabled, spin_id: `p${i}` };
        const mine = buy ? vault.resolveDeterministicBuy(snap, input, seedHex) : vault.resolveDeterministic(snap, input, seedHex);
        const old = new legacy.SpinEngine({ rules, storage });
        old.session = vault.buildSessionObject(snap);
        const theirs = withSeed(Buffer.from(seedHex, "hex"), () => (buy ? old.buyFreeSpins({ bet_amount: 1, spin_id: `p${i}` }) : old.spin(input)));
        expect(stableStringify(mine.result)).toBe(stableStringify(theirs.result));
        expect(mine.bytesDrawn).toBe(theirs.bytesDrawn);
      }
    } finally {
      g.SlotEngine = before;
    }
  });
});

describe("game registry over HTTP", () => {
  it("a game code no engine answers to is refused at registration and at session start", async () => {
    const c = buildContainer(CONFIG, {});
    const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
    await app.ready();
    const token = c.adminAuth.mintToken({ admin_id: "p", scope: "provider", role: "provider_super_admin" });
    const reg = await app.inject({ method: "POST", url: "/admin/v1/games", headers: { authorization: `Bearer ${token}` }, payload: { code: "no-such-game", title: "X" } });
    expect(reg.statusCode).toBe(422);
    expect(reg.json().error.code).toBe("GAME_ENGINE_NOT_FOUND");
    // A game registered before the check existed (straight through the service).
    const game = c.mgmt.registerGame({ code: "legacy-code", title: "Legacy" });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "1", rtp_profile_key: "x", theoretical_rtp: 96, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    const op = c.mgmt.createOperator({ name: "O", slug: "o" });
    c.mgmt.addDomain(op.id, "o.example.com", "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
    const lt = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "legacy-code", operator_player_id: "p1", currency: "GEL", origin: "o.example.com" });
    const init = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
    expect(init.statusCode).toBe(404);
    expect(init.json().error.code).toBe("GAME_NOT_FOUND");
    await app.close();
  });
});
