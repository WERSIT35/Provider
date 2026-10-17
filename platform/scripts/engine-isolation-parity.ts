/**
 * Phase 6 gate: the per-game `vm` loader resolves EXACTLY what the old global loader
 * resolved. Both engines run side by side in one process, on the same seeded rounds,
 * and every result is compared byte for byte (canonical JSON), plus the bytes drawn.
 *
 *   npx tsx scripts/engine-isolation-parity.ts [--spins 10000000] [--shards 2] [--start 0]
 *
 * --start runs rounds [start, start + spins), so a long gate can run in resumable chunks
 * (the rounds and seeds are the same whatever the chunking).
 *
 * Rounds cycle through the paths the RGS drives: base spins (with and without ante, at
 * several bets), spins inside the Free Spins feature (persistent multiplier and bonus
 * total carried), and bonus buys. Exit 1 on the first mismatch (printed).
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fork } from "node:child_process";
import { loadGameEngine } from "../src/lib/engine-loader";
import { installSeededCrypto, withSeed } from "../src/lib/seeded-rng";
import { stableStringify } from "../src/modules/ledger/hash-chain";

const arg = (name: string, def: number) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const SPINS = arg("spins", 1_000_000);
const SHARDS = arg("shards", 2);
const SHARD = arg("shard", -1);
const START = arg("start", 0);

/** The old loader, verbatim in effect: every file run as a function on the host's globalThis. */
function loadLegacy(manifest: ReturnType<typeof loadGameEngine>["manifest"], engineDir: string) {
  installSeededCrypto();
  for (const file of manifest.engine.files) {
    const src = fs.readFileSync(path.join(engineDir, file), "utf8");
    new Function("module", "exports", src).call(globalThis, { exports: {} }, {});
  }
  return (globalThis as unknown as Record<string, unknown>)[manifest.engine.namespace] as { SpinEngine: new (o: unknown) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const storage = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }; };
/** Ante on some base spins (never with a buy: the engine refuses that combination). */
const isBuy = (i: number) => i % 50 === 4; // 2%: a buy plays a whole feature (~15 spins)
const ante = (i: number) => i % 4 === 1 && !isBuy(i);
function session(engine: any, i: number) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const inFeature = i % 5 === 3 && !isBuy(i);
  return {
    sessionId: "deterministic", playerId: "deterministic", currency: "GEL", locale: "en",
    gameId: "bananax", rtpProfile: engine.getRtpProfile("bananax"), balance: Number.MAX_SAFE_INTEGER / 1000, // the RGS sentinel (round-orchestrator.ts)
    freeSpinsLeft: inFeature ? 1 + (i % 12) : 0, freeSpinPersistentMultiplier: inFeature ? (i % 7) * 2 : 0, bonusRoundWin: inFeature ? (i % 50) / 4 : 0,
    forceMultiplierValue: null, anteEnabled: ante(i), crazyMode: false, spinHistory: new Map(), createdAt: "1970-01-01T00:00:00.000Z"
  };
}

function runShard(shard: number): { n: number; digest: string } {
  const isolated = loadGameEngine("bananax");
  const legacyNs = loadLegacy(isolated.manifest, isolated.engineDir);
  if ((legacyNs as unknown) === isolated.ns) throw new Error("the two loaders returned the same namespace");
  const a = new isolated.ns.SpinEngine({ rules: isolated.rules, storage: storage() });
  const b = new legacyNs.SpinEngine({ rules: isolated.rules, storage: storage() });
  const bets = a.getAllowedBets() as number[];
  const digest = createHash("sha256");
  let n = 0;
  for (let i = START + shard; i < START + SPINS; i += SHARDS) {
    const seed = createHash("sha256").update(`isolation-parity/${i}`).digest();
    const bet = bets[i % bets.length];
    const buy = isBuy(i);
    a.session = session(a, i);
    b.session = session(b, i);
    const play = (e: any) => (buy ? e.buyFreeSpins({ bet_amount: bet, spin_id: `p${i}` }) : e.spin({ bet_amount: bet, ante_enabled: ante(i), spin_id: `p${i}` })); // eslint-disable-line @typescript-eslint/no-explicit-any
    const ra = withSeed(seed, () => play(a));
    const rb = withSeed(seed, () => play(b));
    const sa = stableStringify(ra.result), sb = stableStringify(rb.result);
    if (sa !== sb || ra.bytesDrawn !== rb.bytesDrawn) {
      console.error(`MISMATCH at round ${i} (${buy ? "buy" : "spin"}, bet ${bet}): bytes ${ra.bytesDrawn} vs ${rb.bytesDrawn}`);
      console.error(" isolated:", sa.slice(0, 400));
      console.error(" legacy:  ", sb.slice(0, 400));
      process.exit(1);
    }
    digest.update(sa);
    n++;
  }
  return { n, digest: digest.digest("hex") };
}

if (SHARD >= 0) {
  process.send?.(runShard(SHARD));
} else {
  const t0 = Date.now();
  const kids = Array.from({ length: SHARDS }, (_, s) => new Promise<{ n: number; digest: string }>((resolve, reject) => {
    const child = fork(__filename, ["--spins", String(SPINS), "--shards", String(SHARDS), "--shard", String(s), "--start", String(START)], { execArgv: process.execArgv });
    child.once("message", (m) => resolve(m as { n: number; digest: string }));
    child.once("exit", (code) => (code ? reject(new Error(`shard ${s} exited ${code}`)) : undefined));
  }));
  Promise.all(kids).then((rs) => {
    const total = rs.reduce((s, r) => s + r.n, 0);
    console.log(JSON.stringify({ start: START, rounds: total, identical: total === SPINS, shardDigests: rs.map((r) => r.digest), seconds: Math.round((Date.now() - t0) / 1000) }));
    process.exit(total === SPINS ? 0 : 1);
  }, (e) => { console.error(String(e)); process.exit(1); });
}
