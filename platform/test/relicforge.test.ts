import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { GameRegistry } from "../src/modules/games/game-registry";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { stableStringify } from "../src/modules/ledger/hash-chain";

/** Relic Forge (games/relicforge) through the real registry and RGS: docs/relic-forge. */

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const ORIGIN = "casino.example.com";

describe("Relic Forge on the RGS", () => {
  let c: Container;
  let app: FastifyInstance;
  let wallet: SandboxWallet;
  let operatorId: string;

  beforeEach(async () => {
    wallet = new SandboxWallet();
    c = buildContainer(CONFIG, { wallet });
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
    await app.ready();
    const op = c.mgmt.createOperator({ name: "O", slug: "o" });
    operatorId = op.id;
    c.mgmt.addDomain(op.id, ORIGIN, "prod");
    const game = c.mgmt.registerGame({ code: "relicforge", title: "Relic Forge" });
    let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "0.1.0", rtp_profile_key: "relicforge", theoretical_rtp: 96, config_hash: "h" });
    cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
    wallet.setBalance("p1", "GEL", 1000);
  });

  afterEach(async () => {
    await app.close();
  });

  it("is registered next to Vault 20K, with its RTP variants and its own engine version", () => {
    const games = new GameRegistry();
    expect(games.list().map((g) => g.code)).toEqual(expect.arrayContaining(["bananax", "relicforge"]));
    const rf = games.engineFor("relicforge_94");
    expect(rf.gameCode).toBe("relicforge");
    expect(rf.engineVersion()).toMatch(/^rf-/);
    expect(rf.maxWinMultiplier()).toBe(10000);
    expect([rf.supportsBuy(), rf.supportsAnte(), rf.usesFeatureState(), rf.usesPlayerState(), rf.supportsChoice()]).toEqual([false, false, true, true, true]);
    expect(games.presentationFor("relicforge")).toEqual({ turbo: false, slam_stop: false });
  });

  it("resolves deterministically from a seed", () => {
    const rf = new GameRegistry().engineFor("relicforge");
    const seed = "ab".repeat(32);
    const a = rf.resolveDeterministic({ gameId: "relicforge", featureState: null, playerState: null }, { bet_amount: 1, spin_id: "x" }, seed);
    const b = rf.resolveDeterministic({ gameId: "relicforge", featureState: null, playerState: null }, { bet_amount: 1, spin_id: "x" }, seed);
    expect(stableStringify(a.result)).toBe(stableStringify(b.result));
    expect(a.bytesDrawn).toBeGreaterThan(0);
  });

  it("plays paid spins over HTTP; every round replays as legitimate", async () => {
    const lt = c.sessions.createLaunchToken({ operator_id: operatorId, game_code: "relicforge", operator_player_id: "p1", currency: "GEL", origin: ORIGIN });
    const init = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } });
    expect(init.statusCode).toBe(200);
    expect(init.json().regulatory).toMatchObject({ turbo_enabled: false, slam_stop_enabled: false });
    const token = init.json().session_token;
    // A paid spin can trigger the Forge; its spins then need a pick (choice 0).
    let pending = false;
    for (let i = 0; i < 20; i++) {
      const res = await app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${token}`, "idempotency-key": `rf-${i}` }, payload: pending ? { bet_amount: 1, choice: 0 } : { bet_amount: 1 } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      // 5 rows; 6-8 in a Forge spin with Expand.
      expect(body.initial_board.length).toBeGreaterThanOrEqual(5);
      expect(body.total_win).toBeLessThanOrEqual(10000);
      expect(c.verification.verify(body.round_ref)?.verdict).toBe("legitimate");
      pending = Array.isArray(body.feature_state?.forge?.pending_offer);
    }
    // The Forge meter at this bet survives into the next visit.
    const last = c.ledger.lastRoundForSession(init.json().session_id);
    const meter = (last?.outcome as { player_state?: unknown } | undefined)?.player_state;
    const lt2 = c.sessions.createLaunchToken({ operator_id: operatorId, game_code: "relicforge", operator_player_id: "p1", currency: "GEL", origin: ORIGIN });
    const again = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt2}` } });
    expect(again.json().resume.player_states["1.00"]).toEqual(meter);
    expect((meter as { embers: number }).embers).toBeGreaterThanOrEqual(0);

    // A whole Forge over HTTP (entered directly, as if a trigger spin had just won it).
    const sessionId = init.json().session_id as string;
    c.sessions.applyResult(
      sessionId,
      {
        free_spins_left: 10,
        feature_state: {
          forge: {
            spins_total: 10, spins_left: 10, trigger: "scatter", round_x: 0,
            relics: { IGNITE: 0, CHAIN: 0, EXPAND: 0, MAGNET: 0, HOARD: 0, SURGE: 0 },
            evolutions: [], relic_bonus: 1, carried_mult: null, stuck: [], pending_offer: ["IGNITE", "CHAIN", "EXPAND"]
          }
        }
      } as never,
      { bet: 1, currency: "GEL", ante_enabled: false, campaign_id: null, grant_id: null, feature_ref: "r_trigger" }
    );
    const noPick = await app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${token}`, "idempotency-key": "rf-np" }, payload: { bet_amount: 1 } });
    expect(noPick.json().error.code).toBe("CHOICE_REQUIRED");
    let spins = 0;
    for (let i = 0; i < 10; i++) {
      const res = await app.inject({ method: "POST", url: "/game/v1/spin", headers: { authorization: `Bearer ${token}`, "idempotency-key": `rf-f${i}` }, payload: { bet_amount: 5, choice: i % 3 } });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      spins += 1;
      expect([body.is_free_spin, body.bet_charged, body.bet_amount, body.forge_spin]).toEqual([true, 0, 1, i + 1]);
      expect(c.verification.verify(body.round_ref)?.verdict).toBe("legitimate");
      if (body.cap_reached) break;
      expect(body.meltdown).toBe(i === 9);
    }
    expect(spins).toBeGreaterThan(0);
    const after = await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${token}` } });
    expect(after.json().resume.feature).toBeNull();

    const page = await app.inject({ method: "GET", url: "/play/g/relicforge/" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("Relic Forge");
  });
});
