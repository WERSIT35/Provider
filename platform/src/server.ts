import { loadEnv, isProd } from "./config/env";
import { createLogger } from "./lib/logger";
import { buildContainer, seedBootstrapAdmin } from "./container";
import { buildApp } from "./app";
import { NullPersistence, PostgresPersistence, type Persistence } from "./persistence/persistence";
import { hydrateContainer } from "./persistence/hydrate";
import { createPool, closePool } from "./db/pool";
import { runMigrations } from "./db/migrate";

async function main(): Promise<void> {
  const env = loadEnv();
  const logger = createLogger({
    level: env.LOG_LEVEL,
    pretty: !isProd(env) && env.NODE_ENV !== "test",
    env: env.NODE_ENV
  });

  // Optional Postgres durability: migrate + build a write-through persistence port.
  // Unset DATABASE_URL → pure in-memory (NullPersistence).
  let persistence: Persistence = NullPersistence;
  if (env.DATABASE_URL) {
    const pool = createPool(env.DATABASE_URL);
    const migrated = await runMigrations(pool);
    logger.info({ applied: migrated.applied, already: migrated.alreadyApplied.length }, "migrations_ready");
    persistence = new PostgresPersistence(pool);
  }

  // Build all services once at boot (engine math loads here, so readiness reflects
  // real state and the first request isn't penalized by a cold load).
  const container = buildContainer(
    {
      launchSecret: env.LAUNCH_TOKEN_SECRET,
      sessionSecret: env.SESSION_TOKEN_SECRET,
      adminSecret: env.ADMIN_TOKEN_SECRET,
      hmacSkewSeconds: env.HMAC_SKEW_SECONDS,
      rateLimitPerMin: env.RATE_LIMIT_PER_MIN,
      bootstrapAdminUsername: env.BOOTSTRAP_ADMIN_USERNAME,
      bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD,
      totpIssuer: env.TOTP_ISSUER
    },
    { persistence }
  );

  // Restore durable state from Postgres before serving.
  if (env.DATABASE_URL) {
    await hydrateContainer(container, persistence);
    logger.info(
      { operators: container.mgmt.listOperators().length, rounds: container.roundsRepo.size() },
      "hydrated_from_postgres"
    );
  }

  // Seed the bootstrap provider super-admin (after hydration so a durable account
  // is never duplicated). The seeded admin enrolls TOTP on first login.
  const boot = seedBootstrapAdmin(container);
  if (boot.seeded) logger.info({ username: boot.username }, "bootstrap_admin_seeded");

  logger.info({ rules_version: container.engine.rulesVersion() }, "container_ready");

  const app = buildApp({ logger, container });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting_down");
    try {
      await app.close();
      if (env.DATABASE_URL) {
        await persistence.flush().catch((err) => logger.error({ err }, "final_flush_failed"));
        await closePool();
      }
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
