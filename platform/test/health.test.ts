import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";

const TEST_CONFIG = {
  launchSecret: "test-launch-secret",
  sessionSecret: "test-session-secret",
  adminSecret: "test-admin-secret",
  hmacSkewSeconds: 30,
  rateLimitPerMin: 600
};

describe("health endpoints", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({
      logger: createLogger({ level: "silent", pretty: false, env: "test" }),
      container: buildContainer(TEST_CONFIG)
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: "ok" });
  });

  it("GET /health/ready reports engine readiness and allowed bets", async () => {
    const res = await app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { status: string; allowed_bets: number[] };
    expect(body.status).toBe("ready");
    expect(body.allowed_bets).toContain(500);
  });
});
