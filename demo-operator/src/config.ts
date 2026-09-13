import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Tiny dependency-free .env loader (mirrors the rest of this repo's habit of
 * hand-rolling small utilities — see platform/src/lib/security/password.ts —
 * rather than pulling in a package for a few lines of logic). Values already
 * present in process.env win, so real env vars can still override the file.
 */
function loadDotEnv(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv(join(__dirname, "..", ".env"));

export interface DemoOperatorConfig {
  port: number;
  platformUrl: string;
  operatorId: string;
  apiKeyId: string;
  apiSecret: string;
  webhookSecret: string;
  adminToken: string;
  origin: string;
  gameCode: string;
  currency: string;
  sessionSecret: string;
  startingBalance: number;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(
      `Missing required env var ${name}. Run "npm run seed:demo-operator" in platform/ first — ` +
        "it seeds an Operator on the platform for this site and writes demo-operator/.env for you."
    );
  }
  return v;
}

export function loadConfig(): DemoOperatorConfig {
  return {
    port: Number(process.env.PORT ?? 4000),
    platformUrl: (process.env.PLATFORM_URL ?? "http://127.0.0.1:8080").replace(/\/$/, ""),
    operatorId: required("PLATFORM_OPERATOR_ID"),
    apiKeyId: required("PLATFORM_API_KEY_ID"),
    apiSecret: required("PLATFORM_API_SECRET"),
    webhookSecret: required("PLATFORM_WEBHOOK_SECRET"),
    adminToken: required("PLATFORM_ADMIN_TOKEN"),
    origin: process.env.PLATFORM_ORIGIN ?? "demo-operator.local",
    gameCode: process.env.GAME_CODE ?? "bananax",
    currency: process.env.CURRENCY ?? "GEL",
    sessionSecret: process.env.SESSION_TOKEN_SECRET ?? "dev-demo-operator-session-secret",
    startingBalance: Number(process.env.STARTING_BALANCE ?? 1000)
  };
}
