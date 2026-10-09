import { createPublicKey, verify } from "node:crypto";

/**
 * Signature format for round-history exports (GET /operator/v1/rounds/:ref/export).
 *
 * The bundle is signed over its CANONICAL JSON (object keys sorted recursively, no
 * whitespace), so anyone can re-serialize the parsed bundle and check the signature
 * with the public key its key_id names (/.well-known/round-export-keys,
 * scripts/verify-round-export.ts).
 *
 * Signing lives in the keyring (signing-keyring.ts): one active key from
 * EXPORT_SIGNING_KEY, plus every retired key's public half. Without a configured key an
 * ephemeral one is generated: fine for local/test, and refused by loadEnv() in
 * staging/production, because signatures by a key that vanished on restart can never
 * be verified.
 */
export interface ExportSignature {
  alg: "Ed25519";
  key_id: string;
  value: string; // base64
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v === undefined ? null : v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/** Verify an export signature offline, given the public key PEM its key_id names. */
export function verifyExportSignature(payload: unknown, signature: ExportSignature, publicKeyPem: string): boolean {
  if (signature?.alg !== "Ed25519") return false;
  return verify(null, Buffer.from(canonicalJson(payload)), createPublicKey(publicKeyPem), Buffer.from(signature.value, "base64"));
}
