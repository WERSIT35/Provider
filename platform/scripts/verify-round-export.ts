/**
 * Verify a round-history export offline (GET /operator/v1/rounds/:ref/export).
 *
 *   npx tsx scripts/verify-round-export.ts export.json --key public.pem
 *   npx tsx scripts/verify-round-export.ts export.json --platform https://rgs.example.com
 *
 * --key reads the Ed25519 public key PEM from a file; --platform fetches it from
 * <url>/.well-known/round-export-keys (matched by the signature's key_id).
 * Exits 0 when every check passes, 1 otherwise. See src/lib/round-export-verify.ts.
 */
import { readFileSync } from "node:fs";
import { verifyRoundExport } from "../src/lib/round-export-verify";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file || file.startsWith("--")) throw new Error("usage: verify-round-export.ts <export.json> (--key <pem> | --platform <url>)");
  const envelope = JSON.parse(readFileSync(file, "utf8"));
  let pem = arg("key") ? readFileSync(arg("key") as string, "utf8") : undefined;
  if (!pem && arg("platform")) {
    const res = await fetch(`${(arg("platform") as string).replace(/\/$/, "")}/.well-known/round-export-keys`);
    const { keys } = (await res.json()) as { keys: Array<{ key_id: string; public_key_pem: string }> };
    pem = keys.find((k) => k.key_id === envelope.signature?.key_id)?.public_key_pem;
    if (!pem) throw new Error(`no published key matches ${envelope.signature?.key_id}`);
  }
  if (!pem) throw new Error("pass --key <public.pem> or --platform <url>");
  const r = verifyRoundExport(envelope, pem);
  const b = envelope.bundle;
  console.log(`round ${b.round?.round_ref}  (${b.format}, issued ${b.issued_at})`);
  console.log(`  signature (${envelope.signature?.key_id})  ${r.signature_ok ? "ok" : "FAIL"}`);
  console.log(`  seed digest                     ${r.seed_ok ? "ok" : "FAIL"}`);
  console.log(`  random stream (${b.rng?.bytes_drawn} bytes)    ${r.stream_ok ? "ok" : "FAIL"}`);
  console.log(`  outcome hash                    ${r.outcome_ok ? "ok" : "FAIL"}`);
  console.log(`  platform replay verdict         ${b.verification?.verdict ?? "n/a"}`);
  console.log(r.ok ? "VERIFIED" : "NOT VERIFIED");
  process.exit(r.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
