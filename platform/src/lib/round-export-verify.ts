import { createHash } from "node:crypto";
import { verifyExportSignature, type ExportSignature } from "./security/export-signer";
import { streamBytes } from "./seeded-rng";
import { outcomeHash } from "./outcome-hash";

/**
 * Independent checks on a round-history export (what a dispute reviewer runs; also
 * scripts/verify-round-export.ts). Needs only the bundle and the platform's public key:
 *   signature   Ed25519 over the bundle's canonical JSON
 *   seed        SHA-256(seed) = rng.seed_sha256
 *   stream      SHA-256 of the first bytes_drawn bytes of HMAC-SHA256-CTR(seed) = rng.stream_sha256
 *   outcome     SHA-256 of the result (volatile ids stripped) = outcome.outcome_hash. The
 *               hash is over the engine's own key order, so check the bundle as delivered
 *               (any JSON parse/stringify keeps it; a canonical re-sort does not).
 * Replaying the seed through the engine is the platform's own `verification` verdict,
 * which the signature covers.
 */
export interface ExportCheck {
  signature_ok: boolean;
  seed_ok: boolean;
  stream_ok: boolean;
  outcome_ok: boolean;
  ok: boolean;
}

export function verifyRoundExport(envelope: { bundle: Record<string, unknown>; signature: ExportSignature }, publicKeyPem: string): ExportCheck {
  const b = envelope.bundle as {
    rng?: { seed_hex?: string; seed_sha256?: string; bytes_drawn?: number; stream_sha256?: string };
    outcome?: { outcome_hash?: string; result?: unknown };
  };
  const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");
  let signature_ok = false;
  try {
    signature_ok = verifyExportSignature(envelope.bundle, envelope.signature, publicKeyPem);
  } catch {
    signature_ok = false;
  }
  const seedHex = String(b.rng?.seed_hex ?? "");
  const seed = /^[0-9a-f]{64}$/i.test(seedHex) ? Buffer.from(seedHex, "hex") : null;
  const seed_ok = Boolean(seed) && sha256(seed as Buffer) === b.rng?.seed_sha256;
  const n = Number(b.rng?.bytes_drawn);
  const stream_ok = Boolean(seed) && Number.isInteger(n) && n >= 0 && sha256(streamBytes(seed as Buffer, n)) === b.rng?.stream_sha256;
  const outcome_ok = b.outcome?.result !== undefined && outcomeHash(b.outcome.result) === b.outcome?.outcome_hash;
  return { signature_ok, seed_ok, stream_ok, outcome_ok, ok: signature_ok && seed_ok && stream_ok && outcome_ok };
}
