import { z } from "zod";

/**
 * Centralized, validated environment config. Nothing else in the codebase reads
 * process.env directly — they take an `Env` so config is testable and explicit.
 */
const EnvSchema = z.object({
  NODE_ENV: z
    .enum(["local", "sandbox", "staging", "production", "test"])
    .default("local"),
  HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().max(65535).default(8080),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  // Token signing secrets. Defaults are for local/test only; production MUST override.
  LAUNCH_TOKEN_SECRET: z.string().min(8).default("dev-launch-secret-change-me"),
  SESSION_TOKEN_SECRET: z.string().min(8).default("dev-session-secret-change-me"),
  ADMIN_TOKEN_SECRET: z.string().min(8).default("dev-admin-secret-change-me"),
  // Operator HMAC request signing: max allowed clock skew, and per-key rate limit.
  HMAC_SKEW_SECONDS: z.coerce.number().int().positive().max(300).default(30),
  RATE_LIMIT_PER_MIN: z.coerce.number().int().positive().default(600),
  // Optional Postgres persistence. When set, state is durably mirrored to Postgres
  // (loaded on boot, written through per request). Unset → pure in-memory (default).
  DATABASE_URL: z.string().url().optional(),
  // Optional overrides; default resolution lives in the engine loader.
  ENGINE_DIR: z.string().optional(),
  ENGINE_RULES_PATH: z.string().optional()
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  return parsed.data;
}

export function isProd(env: Env): boolean {
  return env.NODE_ENV === "production" || env.NODE_ENV === "staging";
}
