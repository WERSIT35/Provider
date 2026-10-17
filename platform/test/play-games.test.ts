import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";

const REPO = path.resolve(__dirname, "..", "..");
const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 600 };

describe("/play serves each game its own client", () => {
  let app: FastifyInstance;
  let c: Container;
  const launch = (code: string) => c.sessions.createLaunchToken({ operator_id: opId, game_code: code, operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  let opId = "";
  beforeAll(async () => {
    c = buildContainer(CONFIG, {});
    app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
    await app.ready();
    const op = c.mgmt.createOperator({ name: "C", slug: "c" });
    opId = op.id;
    c.mgmt.addDomain(op.id, "casino.example.com", "prod");
    for (const code of ["bananax", "classic-5x3_40"]) {
      const game = c.mgmt.registerGame({ code, title: code });
      let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "1", rtp_profile_key: code, theoretical_rtp: 96, config_hash: "h" });
      cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
      c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
    }
  });
  afterAll(async () => app.close());

  it("a classic-5x3 launch (any variant) goes to /play/g/classic-5x3/ with its query; Vault 20K stays on /play/", async () => {
    const lt = launch("classic-5x3_40");
    const r = await app.inject({ method: "GET", url: `/play/?lt=${lt}&lang=en` });
    expect(r.statusCode).toBe(302);
    expect(r.headers.location).toBe(`/play/g/classic-5x3/?lt=${lt}&lang=en`);
    // From the casino's /play (no slash): ONE redirect, straight to the game's folder.
    const direct = await app.inject({ method: "GET", url: `/play?lt=${lt}` });
    expect(direct.statusCode).toBe(302);
    expect(direct.headers.location).toBe(`/play/g/classic-5x3/?lt=${lt}`);
    // Vault 20K's launch URL is served as it is (no redirect round trip).
    const vaultDirect = await app.inject({ method: "GET", url: `/play?lt=${launch("bananax")}` });
    expect(vaultDirect.statusCode).toBe(200);
    expect(vaultDirect.body).toContain("app.bundle.js");
    expect(vaultDirect.headers["content-security-policy"]).toContain("frame-ancestors");
    const vault = await app.inject({ method: "GET", url: `/play/?lt=${launch("bananax")}` });
    expect(vault.statusCode).toBe(200);
    expect(vault.body).toContain("app.bundle.js");
  });

  it("the game's page is framed for the launching casino only, never cached; its files and rules are served", async () => {
    const lt = launch("classic-5x3_40");
    const page = await app.inject({ method: "GET", url: `/play/g/classic-5x3/?lt=${lt}` });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("<title>Classic 5x3</title>");
    expect(page.headers["content-security-policy"]).toBe("frame-ancestors casino.example.com");
    expect(page.headers["cache-control"]).toBe("no-store");
    expect((await app.inject({ method: "GET", url: "/play/g/classic-5x3/" })).headers["content-security-policy"]).toBe("frame-ancestors 'none'");
    const js = await app.inject({ method: "GET", url: "/play/g/classic-5x3/game.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    // Displayed pays = paid pays: the client reads the very file the engine pays from.
    const rules = await app.inject({ method: "GET", url: "/play/g/classic-5x3/rules.json" });
    expect(rules.json()).toEqual(JSON.parse(fs.readFileSync(path.join(REPO, "games/classic-5x3/math/rules.json"), "utf8")));
  });

  it("nothing else is reachable: unknown games, Vault 20K under /g/, paths out of the client folder", async () => {
    for (const url of ["/play/g/nope/", "/play/g/bananax/", "/play/g/classic-5x3/..%2f..%2fengine/engine.js", "/play/g/classic-5x3/../math/rules.json", "/play/g/..%2f..%2fplatform/package.json"]) {
      const r = await app.inject({ method: "GET", url });
      expect([400, 404], url).toContain(r.statusCode);
    }
  });
});
