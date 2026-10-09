import { describe, it, expect } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { buildApp } from "../src/app";
import { buildContainer, type Container } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { SigningKeyring, ledgerMessage, type SigningKeyRecord } from "../src/lib/security/signing-keyring";
import { verifyExportSignature } from "../src/lib/security/export-signer";
import { hashPayload, chainHash, GENESIS_HASH } from "../src/modules/ledger/hash-chain";
import { PostgresPersistence, type Persistence } from "../src/persistence/persistence";
import { hydrateContainer } from "../src/persistence/hydrate";
import type { RoundRecord } from "../src/modules/ledger/ledger.types";

/**
 * Signing keyring + per-row ledger signatures (migration 0012).
 * The threat these close: someone with database access rewrites the ledger and
 * recomputes every hash, so the chain still verifies. They cannot sign.
 */

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 };
const newKey = () => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();

/** Everything the write-through would have sent to Postgres, per table, last write per key. */
function recorder() {
  const rows: Record<string, Array<Record<string, unknown>>> = {};
  const persistence: Persistence = {
    save: (table, row) => void (rows[table] ??= []).push({ ...(row as Record<string, unknown>) }),
    flush: async () => {},
    loadTable: async () => []
  };
  return { rows, persistence };
}

/** A Postgres that returns `tables` (every column; NULL where the app never wrote one). */
function fakePg(tables: Record<string, Array<Record<string, unknown>>>): PostgresPersistence {
  const NULLABLE: Record<string, string[]> = {
    rounds: ["campaign_id", "grant_id", "engine_version", "rules_hash", "trace_id", "signature", "signing_key_id"],
    audit_records: ["trace_id", "signature", "signing_key_id"]
  };
  return new PostgresPersistence({
    query: async (sql: string) => {
      const table = /FROM\s+(\w+)/i.exec(sql)?.[1] ?? "";
      const latest = new Map<string, Record<string, unknown>>();
      for (const r of tables[table] ?? []) latest.set(String(r.id ?? r.key_id ?? r.balance_key ?? r.idempotency_key ?? randomUUID()), r);
      const rows = [...latest.values()].map((r) => {
        const row: Record<string, unknown> = { ...r, ...(table === "rounds" ? { outcome_jsonb: r.outcome } : {}) };
        for (const col of NULLABLE[table] ?? []) if (row[col] === undefined) row[col] = null;
        return row;
      });
      return { rows };
    }
  } as unknown as Pool);
}

async function platform(opts: { key?: string; persistence?: Persistence } = {}) {
  const wallet = new SandboxWallet();
  const c = buildContainer({ ...CONFIG, ...(opts.key ? { exportSigningKey: opts.key } : {}) }, { wallet, persistence: opts.persistence });
  const app = buildApp({ logger: createLogger({ level: "silent", pretty: false, env: "test" }), container: c, debitReconcileIntervalMs: 0 });
  await app.ready();
  return { c, app, wallet };
}

async function provisionAndSpin(c: Container, app: Awaited<ReturnType<typeof platform>>["app"], wallet: SandboxWallet, spins = 3): Promise<string[]> {
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.2.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: `a-${randomUUID().slice(0, 6)}` });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
  wallet.setBalance("p1", "GEL", 1_000);
  return spinMore(c, app, op.id, spins);
}

async function spinMore(c: Container, app: Awaited<ReturnType<typeof platform>>["app"], opId: string, spins: number): Promise<string[]> {
  const lt = c.sessions.createLaunchToken({ operator_id: opId, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  const token = (await app.inject({ method: "POST", url: "/game/v1/session/init", headers: { authorization: `Bearer ${lt}` } })).json().session_token;
  const refs: string[] = [];
  for (let i = 0; i < spins; i++) {
    const res = await app.inject({
      method: "POST",
      url: "/game/v1/spin",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": randomUUID() },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(res.statusCode, res.body).toBe(200);
    refs.push(res.json().round_ref);
  }
  return refs;
}

describe("the keyring", () => {
  it("derives key_id from the public key, and signs and verifies exports with the key the signature names", () => {
    const ring = new SigningKeyring({ activePrivateKeyPem: newKey() });
    expect(ring.activeKeyId).toMatch(/^ed25519:[0-9a-f]{16}$/);
    expect(ring.ephemeral).toBe(false);
    const sig = ring.sign({ a: 1, b: [2, 3] });
    expect(sig.key_id).toBe(ring.activeKeyId);
    expect(ring.verifyExport({ b: [2, 3], a: 1 }, sig)).toBe(true); // canonical: key order free
    expect(ring.verifyExport({ a: 2, b: [2, 3] }, sig)).toBe(false);
    expect(ring.verifyExport({ a: 1, b: [2, 3] }, { ...sig, key_id: "ed25519:0000000000000000" })).toBe(false);
    expect(verifyExportSignature({ a: 1, b: [2, 3] }, sig, ring.publicKeyPem(sig.key_id)!)).toBe(true);
  });

  it("refuses a non-Ed25519 key, and generates an ephemeral key only when none is configured", () => {
    const ec = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    expect(() => new SigningKeyring({ activePrivateKeyPem: ec })).toThrow(/Ed25519/);
    expect(new SigningKeyring().ephemeral).toBe(true);
  });

  it("a ledger signature is bound to its table and row: it does not verify anywhere else", () => {
    const ring = new SigningKeyring({ activePrivateKeyPem: newKey() });
    const chain = "ab".repeat(32);
    const sig = ring.signLedger("rounds", 7, chain);
    expect(ring.verifyLedger("rounds", { seq: 7, chain_hash: chain, ...sig })).toBe("valid");
    expect(ring.verifyLedger("audit_records", { seq: 7, chain_hash: chain, ...sig })).toBe("invalid");
    expect(ring.verifyLedger("rounds", { seq: 8, chain_hash: chain, ...sig })).toBe("invalid");
    expect(ring.verifyLedger("rounds", { seq: 7, chain_hash: "cd".repeat(32), ...sig })).toBe("invalid");
    expect(ring.verifyLedger("rounds", { seq: 7, chain_hash: chain })).toBe("unsigned");
    expect(ring.verifyLedger("rounds", { seq: 7, chain_hash: chain, signature: sig.signature, signing_key_id: "ed25519:ffffffffffffffff" })).toBe("unknown_key");
    expect(ledgerMessage("rounds", 7, chain).toString()).toBe(`vault20k.ledger.v1|rounds|7|${chain}`);
  });
});

describe("per-row ledger signatures", () => {
  it("signs every round and audit row; the integrity report and the inspector say so", async () => {
    const { c, app, wallet } = await platform({ key: newKey() });
    const [ref] = await provisionAndSpin(c, app, wallet);
    const round = c.ledger.getRound(ref)!;
    expect(round.signing_key_id).toBe(c.signingKeyring.activeKeyId);
    expect(round.signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    for (const a of c.auditRepo.list()) expect(a.signing_key_id).toBe(c.signingKeyring.activeKeyId);

    const report = c.ledger.verifyIntegrity();
    expect(report.signatures?.rounds).toMatchObject({ ok: true, checked: 3, valid: 3, invalid: 0, unsigned: 0 });
    expect(report.signatures?.audit.ok).toBe(true);
    expect(report.signatures?.audit.valid).toBe(c.auditRepo.size());

    const admin = c.adminAuth.mintToken({ admin_id: "prov-1", scope: "provider", role: "provider_super_admin" });
    const inspected = (await app.inject({ method: "GET", url: `/admin/v1/rounds/${ref}`, headers: { authorization: `Bearer ${admin}` } })).json();
    expect(inspected.signature).toEqual({ status: "valid", key_id: c.signingKeyring.activeKeyId });
    const verdict = (await app.inject({ method: "GET", url: `/admin/v1/rounds/${ref}/verify`, headers: { authorization: `Bearer ${admin}` } })).json();
    expect(verdict).toMatchObject({ verdict: "legitimate", chain_ok: true, signature: { status: "valid" } });
    const integrity = (await app.inject({ method: "GET", url: "/admin/v1/integrity", headers: { authorization: `Bearer ${admin}` } })).json();
    expect(integrity.signatures.rounds.ok).toBe(true);
  });

  it("catches a FULL rewrite: a round edited with every hash recomputed passes the chain, not the signatures", async () => {
    const { c, app, wallet } = await platform({ key: newKey() });
    const refs = await provisionAndSpin(c, app, wallet, 3);
    // The attacker (DB access, no private key) inflates round 1's win and recomputes
    // payload_hash / chain_hash for it and every later row, keeping their signatures.
    const rows = c.roundsRepo.list();
    let prev = rows[0].prev_hash;
    for (const row of rows) {
      const content = Object.fromEntries(Object.entries(row).filter(([k]) => !["id", "prev_hash", "payload_hash", "chain_hash", "signature", "signing_key_id"].includes(k)));
      if (row.round_ref === refs[1]) content.total_win = 19_999;
      const payload_hash = hashPayload(content);
      const chain_hash = chainHash(prev, payload_hash);
      c.roundsRepo.__unsafeTamper(row.seq, { ...(content as Partial<RoundRecord>), prev_hash: prev, payload_hash, chain_hash });
      prev = chain_hash;
    }
    const report = c.ledger.verifyIntegrity();
    expect(report.rounds.ok).toBe(true); // the hash chain alone is fooled…
    expect(report.signatures?.rounds).toMatchObject({ ok: false, first_bad_seq: 1 }); // …the signatures are not
    const v = c.verification.verify(refs[1])!;
    expect(v.verdict).toBe("tampered");
    expect(v.chain_ok).toBe(false);
    expect(v.signature.status).toBe("invalid");
  });

  it("verifying one round checks one signature, not the whole ledger (it runs on every inspector open and export)", async () => {
    const { c, app, wallet } = await platform({ key: newKey() });
    const refs = await provisionAndSpin(c, app, wallet, 5);
    let checks = 0;
    const real = c.signingKeyring.verifyLedger.bind(c.signingKeyring);
    c.signingKeyring.verifyLedger = (table, row) => (checks++, real(table, row));
    expect(c.verification.verify(refs[2])?.signature.status).toBe("valid");
    expect(checks).toBe(1);
    c.roundExport.export(refs[2], c.ledger.getRound(refs[2])!.operator_id);
    expect(checks).toBe(2);
    // The full sweep is the integrity report's job.
    checks = 0;
    c.ledger.verifyIntegrity();
    expect(checks).toBe(c.roundsRepo.size() + c.auditRepo.size());
  });

  it("a row signed by a key the platform never had is tampering", async () => {
    const { c, app, wallet } = await platform({ key: newKey() });
    const [ref] = await provisionAndSpin(c, app, wallet, 1);
    const forger = new SigningKeyring({ activePrivateKeyPem: newKey() });
    const round = c.ledger.getRound(ref)!;
    c.roundsRepo.__unsafeTamper(round.seq, forger.signLedger("rounds", round.seq, round.chain_hash));
    expect(c.verification.verify(ref)).toMatchObject({ verdict: "tampered", signature: { status: "unknown_key" } });
  });

  it("the signed export carries the row's own signature, verifiable with the published key", async () => {
    const { c, app, wallet } = await platform({ key: newKey() });
    const [ref] = await provisionAndSpin(c, app, wallet, 1);
    const round = c.ledger.getRound(ref)!;
    const { bundle, signature } = c.roundExport.export(ref, round.operator_id)!;
    const ledger = (bundle as { ledger: { seq: number; chain_hash: string; signature: string; signing_key_id: string } }).ledger;
    expect(ledger.signature).toBe(round.signature);
    const keys = (await app.inject({ method: "GET", url: "/.well-known/round-export-keys" })).json();
    const pem = keys.keys.find((k: SigningKeyRecord) => k.key_id === ledger.signing_key_id).public_key_pem;
    const offline = new SigningKeyring();
    offline.hydrate([{ ...keys.keys[0], status: "retired", retired_at: new Date().toISOString() }]); // a verifier knows only public keys
    expect(offline.verifyLedger("rounds", ledger)).toBe("valid");
    expect(verifyExportSignature(bundle, signature, pem)).toBe(true);
  });
});

describe("rotation", () => {
  it("a new key on restart: the old one is retired and still verifies its rows; new rows use the new key", async () => {
    const keyA = newKey();
    const keyB = newKey();
    // Life 1, key A, writing through to "Postgres".
    const db = recorder();
    const one = await platform({ key: keyA, persistence: db.persistence });
    const oldRefs = await provisionAndSpin(one.c, one.app, one.wallet, 2);
    const idA = one.c.signingKeyring.activeKeyId;
    expect(db.rows.signing_keys.at(-1)).toMatchObject({ key_id: idA, status: "active" });

    // Life 2: restart with key B, hydrating everything life 1 wrote.
    const db2 = recorder();
    const two = await platform({ key: keyB, persistence: db2.persistence });
    await hydrateContainer(two.c, fakePg(db.rows));
    const idB = two.c.signingKeyring.activeKeyId;
    expect(idB).not.toBe(idA);

    const published = (await two.app.inject({ method: "GET", url: "/.well-known/round-export-keys" })).json();
    expect(published.active_key_id).toBe(idB);
    expect(published.keys.map((k: SigningKeyRecord) => [k.key_id, k.status])).toEqual([[idB, "active"], [idA, "retired"]]);
    const retired = published.keys[1];
    expect(retired.retired_at).toEqual(expect.any(String));
    expect(retired.public_key_pem).toContain("BEGIN PUBLIC KEY");
    expect(JSON.stringify(published)).not.toContain("PRIVATE");
    // The retirement is written back (status change), so the registry stays durable.
    expect(db2.rows.signing_keys.find((k) => k.key_id === idA)).toMatchObject({ status: "retired" });

    // Old rows verify with the retired key, the chain continues, new rows use key B.
    const opId = two.c.ledger.getRound(oldRefs[0])!.operator_id;
    two.wallet.setBalance("p1", "GEL", 1_000);
    const [newRef] = await spinMore(two.c, two.app, opId, 1);
    expect(two.c.ledger.getRound(oldRefs[0])!.signing_key_id).toBe(idA);
    expect(two.c.ledger.getRound(newRef)!.signing_key_id).toBe(idB);
    const report = two.c.ledger.verifyIntegrity();
    expect(report.rounds.ok).toBe(true);
    expect(report.signatures?.rounds).toMatchObject({ ok: true, valid: 3, unsigned: 0 });
    expect(two.c.verification.verify(oldRefs[0])).toMatchObject({ verdict: "legitimate", signature: { status: "valid", key_id: idA } });
  });

  it("refuses to boot on a retired key: a key rotated out (maybe leaked) never signs again", () => {
    const keyA = newKey();
    const ringA = new SigningKeyring({ activePrivateKeyPem: keyA });
    const asRetired: SigningKeyRecord = { ...ringA.active(), status: "retired", retired_at: "2026-10-01T00:00:00.000Z" };
    const again = new SigningKeyring({ activePrivateKeyPem: keyA });
    expect(() => again.hydrate([asRetired])).toThrow(/SIGNING_KEY_RETIRED/);
  });

  it("restarting with the same key keeps its original created_at and status", () => {
    const key = newKey();
    const first = new SigningKeyring({ activePrivateKeyPem: key, now: () => new Date("2026-01-01T00:00:00Z") });
    const second = new SigningKeyring({ activePrivateKeyPem: key, now: () => new Date("2026-06-01T00:00:00Z") });
    second.hydrate([first.active()]);
    expect(second.active()).toMatchObject({ status: "active", created_at: "2026-01-01T00:00:00.000Z" });
    expect(second.publicKeys()).toHaveLength(1);
  });
});

describe("Postgres round-trip", () => {
  it("signatures survive a reload; rows from before 0012 stay unsigned and the chain intact", async () => {
    const key = newKey();
    const db = recorder();
    const one = await platform({ key, persistence: db.persistence });
    await provisionAndSpin(one.c, one.app, one.wallet, 2);
    // A pre-0012 row: same chain link, no signature columns written.
    const legacy = { ...db.rows.rounds[0] };
    delete legacy.signature;
    delete legacy.signing_key_id;
    db.rows.rounds[0] = legacy;

    const two = await platform({ key, persistence: recorder().persistence });
    await hydrateContainer(two.c, fakePg(db.rows));
    const report = two.c.ledger.verifyIntegrity();
    expect(report.rounds.ok).toBe(true);
    expect(report.audit.ok).toBe(true);
    expect(report.signatures?.rounds).toMatchObject({ ok: true, valid: 1, unsigned: 1 });
    expect(GENESIS_HASH).toHaveLength(64);
  });
});
