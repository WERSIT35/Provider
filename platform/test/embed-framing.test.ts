import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { normalizeDomain } from "../src/modules/management/management.service";
import { signToken } from "../src/lib/tokens";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

let app: FastifyInstance;
let c: Container;
let opA: string;
let opB: string;

async function setup() {
  const wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const a = c.mgmt.createOperator({ name: "A", slug: "a" });
  const b = c.mgmt.createOperator({ name: "B", slug: "b" });
  opA = a.id;
  opB = b.id;
  c.mgmt.addDomain(opA, "casino-a.example.com", "prod");
  c.mgmt.addDomain(opA, "staging.casino-a.example.com", "sandbox");
  c.mgmt.addDomain(opB, "casino-b.example.com", "prod");
  for (const op of [opA, opB]) {
    c.mgmt.assignGame({ operator_id: op, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  }
  wallet.setBalance("p1", "GEL", 1_000);
}

const launchA = (ttl = 60, origin = "casino-a.example.com") =>
  c.sessions.createLaunchToken({ operator_id: opA, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin }, ttl);
const play = (query: string, path = "/play/") => app.inject({ method: "GET", url: `${path}${query}` });
const csp = (res: { headers: Record<string, unknown> }) => String(res.headers["content-security-policy"] ?? "");

describe("/play framing policy (CSP frame-ancestors)", () => {
  beforeEach(setup);

  it("allows exactly the launching operator's registered hosts (prod + sandbox)", async () => {
    const res = await play(`?lt=${launchA()}`);
    expect(res.statusCode).toBe(200);
    expect(csp(res)).toBe("frame-ancestors casino-a.example.com staging.casino-a.example.com");
    expect(res.headers["x-frame-options"]).toBeUndefined();
    expect(csp(res)).not.toContain("casino-b.example.com");
  });

  it("still names the operator after the 60s launch token expired (a reload inside the iframe)", async () => {
    const res = await play(`?lt=${launchA(-30)}`);
    expect(csp(res)).toBe("frame-ancestors casino-a.example.com staging.casino-a.example.com");
  });

  it("no token, a forged token, a token from another secret, or garbage: nobody may frame it", async () => {
    const good = launchA();
    const [body, sig] = good.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), operator_id: opB })).toString("base64url");
    const cases = [
      "",
      "?lt=",
      `?lt=${forgedBody}.${sig}`,
      `?lt=${signToken("not-the-launch-secret", { operator_id: opA }, 60)}`,
      "?lt=not-a-token",
      `?lt=${good}x`
    ];
    for (const q of cases) {
      const res = await play(q);
      expect(res.statusCode, q).toBe(200);
      expect(csp(res), q).toBe("frame-ancestors 'none'");
      expect(res.headers["x-frame-options"], q).toBe("DENY");
    }
  });

  it("applies to the HTML however it is reached; static assets carry no framing header", async () => {
    const lt = launchA();
    expect(csp(await play(`?lt=${lt}`, "/play/index.html"))).toContain("casino-a.example.com");
    expect(csp(await play("", "/play/index.html"))).toBe("frame-ancestors 'none'");
    const js = await play("", "/play/embed-bridge.js");
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-security-policy"]).toBeUndefined();
  });

  it("a suspended operator's game becomes unframeable", async () => {
    const lt = launchA();
    c.mgmt.setOperatorStatus(opA, "suspended");
    expect(csp(await play(`?lt=${lt}`))).toBe("frame-ancestors 'none'");
  });

  it("session/init and GET /game/v1/session hand the client the same allowlist for postMessage", async () => {
    const init = await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${launchA()}` } });
    expect(init.statusCode).toBe(200);
    expect(init.json().embed).toEqual({ allowed_hosts: ["casino-a.example.com", "staging.casino-a.example.com"] });
    const again = await app.inject({ method: "GET", url: "/game/v1/session", headers: { authorization: `Bearer ${init.json().session_token}` } });
    expect(again.json().embed.allowed_hosts).toEqual(["casino-a.example.com", "staging.casino-a.example.com"]);
  });
});

describe("operator domains", () => {
  beforeEach(setup);

  it("normalises a pasted origin to host[:port] and rejects anything that is not one", () => {
    expect(normalizeDomain("Casino.Example.com")).toBe("casino.example.com");
    expect(normalizeDomain("https://casino.example.com/")).toBe("casino.example.com");
    expect(normalizeDomain("http://localhost:4000")).toBe("localhost:4000");
    expect(normalizeDomain("127.0.0.1:4000")).toBe("127.0.0.1:4000");
    for (const bad of [
      "",
      "casino.example.com; script-src *",
      "casino.example.com evil.com",
      "*.example.com",
      "*",
      "'self'",
      "https://casino.example.com/path",
      "user@casino.example.com",
      "casino.example.com:99999",
      "casino.example.com:0",
      "-bad.example.com",
      "javascript:alert(1)",
      "data:text/html,x"
    ]) {
      expect(normalizeDomain(bad), bad).toBeNull();
    }
  });

  it("addDomain refuses an invalid domain, so a CSP can never be injected through it", () => {
    expect(() => c.mgmt.addDomain(opA, "x.com; script-src *", "prod")).toThrow("INVALID_DOMAIN");
    expect(c.mgmt.addDomain(opA, "HTTPS://New.Casino-A.example.com/", "prod").domain).toBe("new.casino-a.example.com");
  });

  it("launch accepts the origin in either spelling, and still refuses an unregistered one", () => {
    expect(() => launchA(60, "https://casino-a.example.com")).not.toThrow();
    expect(() => launchA(60, "CASINO-A.example.com")).not.toThrow();
    expect(() => launchA(60, "casino-b.example.com")).toThrow("DOMAIN_NOT_ALLOWED");
    expect(() => launchA(60, "casino-a.example.com.evil.com")).toThrow("DOMAIN_NOT_ALLOWED");
  });
});
