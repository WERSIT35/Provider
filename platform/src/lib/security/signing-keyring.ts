import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { NullPersistence, type Persistence } from "../../persistence/persistence";
import { canonicalJson, type ExportSignature } from "./export-signer";

/**
 * The platform's Ed25519 signing keyring: ONE active key that signs, and the public
 * halves of every key that signed before it (retired, verify-only).
 *
 * What it signs:
 *  - round-history exports (canonical JSON of the bundle, round-export.service.ts);
 *  - every ledger entry, rounds and audit_records, over
 *    `vault20k.ledger.v1|<table>|<seq>|<chain_hash>` (see ledgerMessage). The table and
 *    seq bind a signature to one row of one ledger, so it cannot be replayed onto
 *    another. A hash chain alone stops edits, but not a full rewrite by someone with
 *    database access, who could recompute every hash; they cannot forge these.
 *
 * Key registry (`signing_keys`, migration 0012): every key that ever signed is recorded,
 * public key only, so old signatures stay verifiable forever. ROTATION = put the new
 * private key in EXPORT_SIGNING_KEY and restart. On boot the keyring hydrates the
 * registry, registers the new key as active and retires the previous one. Nothing else
 * changes, and /.well-known/round-export-keys publishes them all.
 *
 * key_id = "ed25519:" + the first 16 hex of SHA-256(public key, SPKI DER), so it is
 * derived from the key itself and cannot be made to point at a different key.
 */

export type KeyStatus = "active" | "retired";

export interface SigningKeyRecord {
  key_id: string;
  alg: "Ed25519";
  public_key_pem: string;
  status: KeyStatus;
  created_at: string;
  /** When it stopped signing (null while active). */
  retired_at: string | null;
  /** Optional planned end of life for the active key (EXPORT_SIGNING_KEY_EXPIRES_AT). */
  expires_at: string | null;
}

export interface LedgerSignature {
  signature: string; // base64
  signing_key_id: string;
}

export type SignatureStatus = "valid" | "invalid" | "unsigned" | "unknown_key";

export function keyIdOf(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
}

/** The exact bytes signed for one ledger row. */
export function ledgerMessage(table: "rounds" | "audit_records", seq: number, chainHash: string): Buffer {
  return Buffer.from(`vault20k.ledger.v1|${table}|${seq}|${chainHash}`);
}

export class SigningKeyring {
  private readonly privateKey: KeyObject;
  private readonly keys = new Map<string, SigningKeyRecord & { publicKey: KeyObject }>();
  readonly activeKeyId: string;
  /** True when no key was configured and one was generated for this process (local/test only). */
  readonly ephemeral: boolean;
  private readonly now: () => Date;

  constructor(
    opts: { activePrivateKeyPem?: string; expiresAt?: string | null; now?: () => Date } = {},
    private readonly persistence: Persistence = NullPersistence
  ) {
    if (opts.activePrivateKeyPem) {
      this.privateKey = createPrivateKey(opts.activePrivateKeyPem.replace(/\\n/g, "\n"));
      if (this.privateKey.asymmetricKeyType !== "ed25519") throw new Error("EXPORT_SIGNING_KEY must be an Ed25519 private key");
      this.ephemeral = false;
    } else {
      this.privateKey = generateKeyPairSync("ed25519").privateKey;
      this.ephemeral = true;
    }
    this.now = opts.now ?? (() => new Date());
    const publicKey = createPublicKey(this.privateKey);
    this.activeKeyId = keyIdOf(publicKey);
    this.put({
      key_id: this.activeKeyId,
      alg: "Ed25519",
      public_key_pem: publicKey.export({ type: "spki", format: "pem" }).toString(),
      status: "active",
      created_at: this.now().toISOString(),
      retired_at: null,
      expires_at: opts.expiresAt ?? null
    });
  }
  /**
   * Merge the durable registry on boot. A stored key equal to the active one keeps its
   * original created_at. Any other key still marked active was the previous active key:
   * it is retired now (rotation). Retired keys stay published for verification.
   */
  hydrate(rows: SigningKeyRecord[]): void {
    for (const row of rows) {
      if (row.key_id === this.activeKeyId && row.status === "retired") {
        // A retired key may have been rotated out because it leaked: never sign with it
        // again (the DB trigger refuses re-activation too). Configure a new key.
        throw new Error(`SIGNING_KEY_RETIRED: ${row.key_id} was retired at ${row.retired_at}; set a new EXPORT_SIGNING_KEY`);
      }
      if (row.key_id === this.activeKeyId) {
        const active = this.keys.get(this.activeKeyId)!;
        this.put({ ...active, created_at: row.created_at, expires_at: active.expires_at ?? row.expires_at ?? null });
        continue;
      }
      const retired = row.status === "active" ? { ...row, status: "retired" as const, retired_at: this.now().toISOString() } : row;
      this.put(retired, row.status === "active");
    }
  }

  /** Public keys, active first then newest retired first (what /.well-known publishes). */
  publicKeys(): SigningKeyRecord[] {
    return [...this.keys.values()]
      .map(({ publicKey: _pk, ...rec }) => rec)
      .sort((a, b) => (a.status === b.status ? b.created_at.localeCompare(a.created_at) : a.status === "active" ? -1 : 1));
  }

  publicKeyPem(keyId: string): string | null {
    return this.keys.get(keyId)?.public_key_pem ?? null;
  }

  /** The active key, as a record. */
  active(): SigningKeyRecord {
    const { publicKey: _pk, ...rec } = this.keys.get(this.activeKeyId)!;
    return rec;
  }

  /** Sign an export payload (canonical JSON) with the active key. */
  sign(payload: unknown): ExportSignature {
    const value = sign(null, Buffer.from(canonicalJson(payload)), this.privateKey).toString("base64");
    return { alg: "Ed25519", key_id: this.activeKeyId, value };
  }

  /** Verify an export signature with the key its key_id names (active or retired). */
  verifyExport(payload: unknown, signature: ExportSignature): boolean {
    const key = signature?.alg === "Ed25519" ? this.keys.get(signature.key_id) : undefined;
    if (!key) return false;
    return verify(null, Buffer.from(canonicalJson(payload)), key.publicKey, Buffer.from(String(signature.value), "base64"));
  }

  /** Sign one ledger row (~50µs). */
  signLedger(table: "rounds" | "audit_records", seq: number, chainHash: string): LedgerSignature {
    return {
      signature: sign(null, ledgerMessage(table, seq, chainHash), this.privateKey).toString("base64"),
      signing_key_id: this.activeKeyId
    };
  }

  /** Check one ledger row's signature against the key it names. */
  verifyLedger(table: "rounds" | "audit_records", row: { seq: number; chain_hash: string; signature?: string | null; signing_key_id?: string | null }): SignatureStatus {
    if (!row.signature || !row.signing_key_id) return "unsigned";
    const key = this.keys.get(row.signing_key_id);
    if (!key) return "unknown_key";
    try {
      return verify(null, ledgerMessage(table, row.seq, row.chain_hash), key.publicKey, Buffer.from(row.signature, "base64")) ? "valid" : "invalid";
    } catch {
      return "invalid";
    }
  }

  private put(rec: SigningKeyRecord, persist = true): void {
    this.keys.set(rec.key_id, { ...rec, publicKey: createPublicKey(rec.public_key_pem) });
    if (persist) this.persistence.save("signing_keys", rec);
  }
}

/** Per-ledger tally of signature checks (GET /admin/v1/integrity). */
export interface SignatureSummary {
  ok: boolean;
  checked: number;
  valid: number;
  unsigned: number;
  invalid: number;
  unknown_key: number;
  /** seq of the first row whose signature is invalid or by an unknown key. */
  first_bad_seq: number | null;
}
