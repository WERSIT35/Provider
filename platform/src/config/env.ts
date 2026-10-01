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
  // Bootstrap provider super-admin, seeded on boot when no provider account exists.
  // Local/dev defaults only; production MUST override (and the seeded admin still
  // enrolls TOTP on first login).
  BOOTSTRAP_ADMIN_USERNAME: z.string().min(1).default("admin"),
  BOOTSTRAP_ADMIN_PASSWORD: z.string().min(8).default("change-me-admin"),
  TOTP_ISSUER: z.string().min(1).default("Provider Platform"),
  // Require TOTP 2FA enrollment/verification during admin login. An explicit
  // "true"/"false" always wins. Unset, it follows NODE_ENV (resolved in
  // loadEnv): OFF for local/test so development is plain username + password,
  // ON for sandbox/staging/production. Production-like environments refuse to
  // boot with it off (see loadEnv), so the bypass can never ship. The 2FA code
  // paths are untouched; restoring them is just ADMIN_TOTP_REQUIRED=true.
  // NOTE: z.coerce.boolean() would treat the STRING "false" as truthy (any
  // non-empty string), so this is an explicit string comparison instead.
  ADMIN_TOTP_REQUIRED: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v.toLowerCase() !== "false")),
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

// ADMIN_TOTP_REQUIRED is always resolved to a boolean by loadEnv().
export type Env = Omit<z.infer<typeof EnvSchema>, "ADMIN_TOTP_REQUIRED"> & { ADMIN_TOTP_REQUIRED: boolean };

// Development phase: admin 2FA is off by default where only developers log in.
const TOTP_OFF_BY_DEFAULT = new Set(["local", "test"]);

const LOCAL_ONLY_DEFAULTS = {
  LAUNCH_TOKEN_SECRET: "dev-launch-secret-change-me",
  SESSION_TOKEN_SECRET: "dev-session-secret-change-me",
  ADMIN_TOKEN_SECRET: "dev-admin-secret-change-me",
  BOOTSTRAP_ADMIN_PASSWORD: "change-me-admin"
} as const;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env: Env = {
    ...parsed.data,
    ADMIN_TOTP_REQUIRED: parsed.data.ADMIN_TOTP_REQUIRED ?? !TOTP_OFF_BY_DEFAULT.has(parsed.data.NODE_ENV)
  };
  if (isProd(env)) {
    const unsafe = Object.entries(LOCAL_ONLY_DEFAULTS)
      .filter(([key, value]) => env[key as keyof typeof LOCAL_ONLY_DEFAULTS] === value)
      .map(([key]) => key);
    if (unsafe.length > 0) {
      throw new Error(`Unsafe production environment: override ${unsafe.join(", ")}`);
    }
    if (!env.DATABASE_URL) {
      throw new Error("Unsafe production environment: DATABASE_URL is required");
    }
    if (!env.ADMIN_TOTP_REQUIRED) {
      throw new Error("Unsafe production environment: ADMIN_TOTP_REQUIRED must not be false");
    }
  }
  return env;
}

export function isProd(env: Env): boolean {
  return env.NODE_ENV === "production" || env.NODE_ENV === "staging";
}
