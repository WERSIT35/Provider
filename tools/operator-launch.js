#!/usr/bin/env node
"use strict";

const { createHash, createHmac, randomUUID } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");

function loadDotEnv(file) {
  if (!file || !existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
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

function requireEnv(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
  }
  throw new Error(`Missing env var: ${names.join(" or ")}`);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function sign(secret, { timestamp, method, path, rawBody }) {
  const base = `${timestamp}\n${method.toUpperCase()}\n${path}\n${sha256Hex(rawBody)}`;
  return createHmac("sha256", secret).update(base).digest("hex");
}

async function main() {
  const envFile = process.env.ENV_FILE || process.argv[2] || path.join(__dirname, "..", "demo-operator", ".env");
  loadDotEnv(path.resolve(envFile));

  const providerUrl = (process.env.PROVIDER_URL || process.env.PLATFORM_URL || "http://127.0.0.1:8080").replace(/\/$/, "");
  const apiKeyId = requireEnv("API_KEY_ID", "PLATFORM_API_KEY_ID");
  const apiSecret = requireEnv("API_SECRET", "PLATFORM_API_SECRET");
  const gameCode = process.env.GAME_CODE || "bananax";
  const playerId = process.env.OPERATOR_PLAYER_ID || "player-local-1";
  const currency = process.env.CURRENCY || "GEL";
  const origin = process.env.ORIGIN || process.env.PLATFORM_ORIGIN || "demo-operator.local";

  const endpointPath = "/operator/v1/launch";
  const body = JSON.stringify({
    game_code: gameCode,
    operator_player_id: playerId,
    currency,
    origin
  });
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = sign(apiSecret, {
    timestamp,
    method: "POST",
    path: endpointPath,
    rawBody: body
  });

  const res = await fetch(`${providerUrl}${endpointPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKeyId,
      "x-timestamp": timestamp,
      "x-nonce": randomUUID(),
      "x-signature": signature
    },
    body
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  console.log(`POST ${providerUrl}${endpointPath} -> ${res.status}`);
  if (!res.ok) {
    console.log(JSON.stringify(data, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(data, null, 2));
  console.log("");
  console.log(`Open: ${providerUrl}/play?lt=${data.launch_token}`);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
