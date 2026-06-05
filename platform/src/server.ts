import { loadEnv, isProd } from "./config/env";
import { createLogger } from "./lib/logger";
import { buildContainer } from "./container";
import { buildApp } from "./app";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    pretty: !isProd(env) && env.NODE_ENV !== "test",
    env: env.NODE_ENV
  });

  // Build all services once at boot (engine math loads here, so readiness reflects
  // real state and the first request isn't penalized by a cold load).
  const container = buildContainer({
    launchSecret: env.LAUNCH_TOKEN_SECRET,
    sessionSecret: env.SESSION_TOKEN_SECRET,
    adminSecret: env.ADMIN_TOKEN_SECRET,
    hmacSkewSeconds: env.HMAC_SKEW_SECONDS,
    rateLimitPerMin: env.RATE_LIMIT_PER_MIN
  });
  logger.info({ rules_version: container.engine.rulesVersion() }, "container_ready");

  const app = buildApp({ logger, container });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting_down");
    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      logger.error({ err }, "shutdown_failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  try {
    await app.listen({ host: env.HOST, port: env.PORT });
  } catch (err) {
    logger.error({ err }, "failed_to_start");
    process.exit(1);
  }
}

void main();
