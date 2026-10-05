import { describe, it, expect, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID, createHash } from "node:crypto";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { computeSignature } from "../src/lib/security/hmac";
import { verifyRoundExport } from "../src/lib/round-export-verify";
import { canonicalJson } from "../src/lib/security/export-signer";
import { installSeededCrypto, streamBytes, withSeed } from "../src/lib/seeded-rng";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };

let app: FastifyInstance;
let c: Container;
const ops: Record<"a" | "b", { id: string; key: string; secret: string }> = {} as never;

async function setup() {
  const wallet = new SandboxWallet();
  c = buildContainer(CONFIG, { wallet });
  app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  for (const slug of ["a", "b"] as const) {
    const op = c.mgmt.createOperator({ name: slug, slug });
    c.mgmt.addDomain(op.id, `${slug}.example.com`, "prod");
    c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
    const cred = c.mgmt.issueCredential(op.id, "prod");
    ops[slug] = { id: op.id, key: cred.credential.api_key_id, secret: cred.api_secret };
  }
  wallet.setBalance("p1", "GEL", 1_000);
}

function signedGet(as: "a" | "b", path: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return app.inject({
    method: "GET",
    url: path,
    headers: { "x-api-key": ops[as].key, "x-timestamp": timestamp, "x-nonce": randomUUID(), "x-signature": computeSignature(ops[as].secret, { timestamp, method: "GET", path, rawBody: "" }) }
  });
}

async function playRound(): Promise<string> {
  const s = c.sessions.initSession(c.sessions.createLaunchToken({ operator_id: ops.a.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "a.example.com" }));
  const out = await c.orchestrator.spin(s.id, { bet_amount: 5, idempotency_key: randomUUID() });
  return out.round_ref;
}
const publicKey = async () => (await app.inject({ method: "GET", url: "/.well-known/round-export-keys" })).json().keys[0];

describe("signed round-history export", () => {
  beforeEach(setup);

  it("exports a complete bundle that verifies independently", async () => {
    const ref = await playRound();
    const res = await signedGet("a", `/operator/v1/rounds/${ref}/export`);
    expect(res.statusCode).toBe(200);
    const env = res.json();
    const b = env.bundle;
    expect(b.format).toBe("vault20k.round-export/v1");
    expect(b.round).toMatchObject({ round_ref: ref, operator_player_id: "p1", game_code: "bananax", bet_amount: 5, bet_charged: 5, effective_status: expect.any(String) });
    expect(b.rng).toMatchObject({ algo: "hmac-sha256-ctr/v1", seed_hex: expect.stringMatching(/^[0-9a-f]{64}$/), bytes_drawn: expect.any(Number), engine_version: c.engine.engineVersion() });
    expect(b.verification).toMatchObject({ verdict: "legitimate", outcome_ok: true, chain_ok: true });
    expect(b.wallet.map((t: { type: string }) => t.type)).toContain("DEBIT");
    expect(b.ledger).toMatchObject({ seq: expect.any(Number), chain_hash: expect.any(String) });
    const key = await publicKey();
    expect(env.signature).toMatchObject({ alg: "Ed25519", key_id: key.key_id });
    expect(verifyRoundExport(env, key.public_key_pem)).toEqual({ signature_ok: true, seed_ok: true, stream_ok: true, outcome_ok: true, ok: true });
    expect(c.auditRepo.list({ operator_id: ops.a.id }).some((e) => e.action === "round.export" && e.target_id === ref)).toBe(true);
  });

  it("the stream proof is the bytes the round really drew", async () => {
    const ref = await playRound();
    const round = c.ledger.getRound(ref)!;
    installSeededCrypto();
    const drawn = new Uint8Array(round.rng_bytes_drawn);
    withSeed(Buffer.from(round.rng_seed_hex, "hex"), () => (globalThis.crypto as unknown as { getRandomValues(v: Uint8Array): void }).getRandomValues(drawn));
    expect(Buffer.from(drawn).equals(streamBytes(Buffer.from(round.rng_seed_hex, "hex"), round.rng_bytes_drawn))).toBe(true);
    const b = (await signedGet("a", `/operator/v1/rounds/${ref}/export`)).json().bundle;
    expect(b.rng.stream_sha256).toBe(createHash("sha256").update(drawn).digest("hex"));
  });

  it("any edit to the bundle breaks the signature; a forged seed or outcome is caught", async () => {
    const ref = await playRound();
    const env = (await signedGet("a", `/operator/v1/rounds/${ref}/export`)).json();
    const key = (await publicKey()).public_key_pem;
    const edited = structuredClone(env);
    edited.bundle.round.total_win = 999_999;
    expect(verifyRoundExport(edited, key)).toMatchObject({ signature_ok: false, ok: false });
    const forgedSeed = structuredClone(env);
    forgedSeed.bundle.rng.seed_hex = "00".repeat(32);
    expect(verifyRoundExport(forgedSeed, key)).toMatchObject({ seed_ok: false, stream_ok: false, ok: false });
    const forgedOutcome = structuredClone(env);
    forgedOutcome.bundle.outcome.result.total_win = 999_999;
    expect(verifyRoundExport(forgedOutcome, key)).toMatchObject({ outcome_ok: false, ok: false });
    // The signature survives any key reordering (it is over canonical JSON). The outcome
    // hash is over the engine result in its own key order, so that check needs the
    // bundle as delivered (plain JSON parse/stringify keeps it).
    const reordered = { signature: env.signature, bundle: JSON.parse(canonicalJson(env.bundle)) };
    expect(verifyRoundExport(reordered, key).signature_ok).toBe(true);
    expect(verifyRoundExport(JSON.parse(JSON.stringify(env)), key).ok).toBe(true);
  });

  it("is tenant-scoped and HMAC-guarded", async () => {
    const ref = await playRound();
    expect((await signedGet("b", `/operator/v1/rounds/${ref}/export`)).statusCode).toBe(404);
    expect((await signedGet("a", "/operator/v1/rounds/r_missing/export")).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: `/operator/v1/rounds/${ref}/export` })).statusCode).toBe(401);
  });

  it("an ephemeral key in tests; a configured PEM is used as given", async () => {
    expect(c.exportSigner.ephemeral).toBe(true);
    const { generateKeyPairSync } = await import("node:crypto");
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const c2 = buildContainer({ ...CONFIG, exportSigningKey: pem.replace(/\n/g, "\\n") });
    expect(c2.exportSigner.ephemeral).toBe(false);
    expect(() => buildContainer({ ...CONFIG, exportSigningKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString() })).toThrow(/Ed25519/);
  });
});
