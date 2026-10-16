// Spin-path microbenchmarks: engine resolve and one ledger-row signature, per call.
//   node tools/bench/micro.mjs [--n 20000]
import { generateKeyPairSync, randomBytes, createHash } from "node:crypto";
import { args, importDist, requireDist, writeResult } from "./common.mjs";

requireDist();
const a = args({ n: 20000 });
const { EngineService } = await importDist("modules/engine/engine.service.js");
const { SigningKeyring } = await importDist("lib/security/signing-keyring.js");
const { NullPersistence } = await importDist("persistence/persistence.js");

const time = (n, fn) => { for (let i = 0; i < Math.min(2000, n); i++) fn(i); const t = performance.now(); for (let i = 0; i < n; i++) fn(i); return +((performance.now() - t) * 1000 / n).toFixed(1); };

const engine = new EngineService();
const engineResolveUs = time(a.n, () => engine.resolveDeterministic({}, { bet_amount: 1 }, randomBytes(32).toString("hex")));
const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const keyring = new SigningKeyring({ activePrivateKeyPem: pem, expiresAt: null }, NullPersistence);
const h = createHash("sha256").update("x").digest("hex");
const ledgerSignUs = time(a.n, (i) => keyring.signLedger("rounds", i, h));

const result = { calls: a.n, engineResolveUs, ledgerSignUs };
console.log(result);
console.log("→", writeResult("micro", result));
