// Writes a complete .env.prod: .env.prod.example with every secret filled in.
//   node gen-secrets.mjs > .env.prod      (then set RGS_DOMAIN)
// Keep a private backup of the result; never commit it.
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";

const token = (n = 32) => randomBytes(n).toString("base64url");
const { privateKey } = generateKeyPairSync("ed25519");
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString().trim();

const secrets = {
  POSTGRES_PASSWORD: token(24),
  LAUNCH_TOKEN_SECRET: token(),
  SESSION_TOKEN_SECRET: token(),
  ADMIN_TOKEN_SECRET: token(),
  BOOTSTRAP_ADMIN_PASSWORD: token(18),
  // One line with literal \n; platform/src/lib/security/export-signer.ts unescapes it.
  EXPORT_SIGNING_KEY: pem.replace(/\n/g, "\\n"),
  METRICS_TOKEN: token(24)
};

const template = readFileSync(new URL(".env.prod.example", import.meta.url), "utf8");
const out = template.replace(/^([A-Z_]+)=$/gm, (line, key) => (key in secrets ? `${key}=${secrets[key]}` : line));
process.stdout.write(out);
