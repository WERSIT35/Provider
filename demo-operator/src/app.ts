import Fastify, { type FastifyInstance, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import type { DemoOperatorConfig } from "./config";
import { PlayerStore } from "./store/player-store";
import { PlatformClient, type IPlatformClient } from "./lib/platform-client";
import apiRoutes from "./http/api.routes";
import walletRoutes from "./http/wallet.routes";
import siteRoutes from "./http/site";

// Same raw-body-preserving JSON parser as platform/src/app.ts — needed so the
// wallet webhook's HMAC signature can be verified over the exact bytes signed.
declare module "fastify" {
  interface FastifyRequest {
    rawBody?: string;
  }
}

export interface BuildAppDeps {
  config: DemoOperatorConfig;
  store?: PlayerStore;
  platform?: IPlatformClient;
  logger?: boolean;
}

export function buildApp(deps: BuildAppDeps): FastifyInstance {
  const { config } = deps;
  const store = deps.store ?? new PlayerStore();
  const platform = deps.platform ?? new PlatformClient(config);

  const app = Fastify({
    logger: deps.logger ?? true,
    requestIdHeader: "x-request-id",
    genReqId: () => randomUUID(),
    trustProxy: true
  });

  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    (req as { rawBody?: string }).rawBody = raw;
    try {
      done(null, raw.length ? JSON.parse(raw) : {});
    } catch (err) {
      (err as FastifyError).statusCode = 400;
      done(err as Error, undefined);
    }
  });

  app.get("/health", async () => ({ ok: true }));

  app.register(apiRoutes(store, platform, config));
  app.register(walletRoutes(store, config));
  app.register(siteRoutes(config));

  app.setErrorHandler((err: FastifyError, _req, reply) => {
    const status = err.statusCode ?? 500;
    reply.code(status).send({ error: { code: status === 500 ? "INTERNAL_ERROR" : "ERROR", message: err.message } });
  });

  return app;
}
