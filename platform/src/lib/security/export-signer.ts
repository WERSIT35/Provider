import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";

/**
 * Ed25519 signer for round-history exports (GET /operator/v1/rounds/:ref/export).
 *
 * The bundle is signed over its CANONICAL JSON (object keys sorted recursively, no
 * whitespace), so anyone can re-serialize the parsed bundle and check the signature
 * with the public key (/.well-known/round-export-keys, scripts/verify-round-export.ts).
 *
 * The key comes from EXPORT_SIGNING_KEY (a PKCS#8 PEM). Without one, an ephemeral key
 * is generated: fine for local/test, and refused by loadEnv() in staging/production,
 * because bundles signed by a key that vanished on restart can never be verified.
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

export class ExportSigner {
  private readonly privateKey: KeyObject;
  readonly publicKeyPem: string;
  readonly keyId: string;
  readonly ephemeral: boolean;

  constructor(privateKeyPem?: string) {
    if (privateKeyPem) {
      this.privateKey = createPrivateKey(privateKeyPem.replace(/\\n/g, "\n"));
      if (this.privateKey.asymmetricKeyType !== "ed25519") throw new Error("EXPORT_SIGNING_KEY must be an Ed25519 private key");
      this.ephemeral = false;
    } else {
      this.privateKey = generateKeyPairSync("ed25519").privateKey;
      this.ephemeral = true;
    }
    const pub = createPublicKey(this.privateKey);
    this.publicKeyPem = pub.export({ type: "spki", format: "pem" }).toString();
    const der = pub.export({ type: "spki", format: "der" });
    this.keyId = `ed25519:${createHash("sha256").update(der).digest("hex").slice(0, 16)}`;
  }

  sign(payload: unknown): ExportSignature {
    const value = sign(null, Buffer.from(canonicalJson(payload)), this.privateKey).toString("base64");
    return { alg: "Ed25519", key_id: this.keyId, value };
  }
}

/** Verify a signature made by ExportSigner, given the signer's public key PEM. */
export function verifyExportSignature(payload: unknown, signature: ExportSignature, publicKeyPem: string): boolean {
  if (signature?.alg !== "Ed25519") return false;
  return verify(null, Buffer.from(canonicalJson(payload)), createPublicKey(publicKeyPem), Buffer.from(signature.value, "base64"));
}
