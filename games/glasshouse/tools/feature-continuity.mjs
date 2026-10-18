// Glasshouse: after `npm run bench:chaos` with BENCH_GAME=glasshouse, check that the feature state
// survived every crash: each free spin's pre-state (`pre_state.feature_state`) must equal the
// state the session's previous round ended with (`outcome_jsonb.feature_state`).
//   BENCH_DATABASE_URL=postgres://…/vault20k_bench node games/glasshouse/tools/feature-continuity.mjs
// Exits 1 on any mismatch.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { Client } = createRequire(path.join(root, "platform", "package.json"))("pg");
const url = process.env.BENCH_DATABASE_URL;
if (!url) { console.error("needs BENCH_DATABASE_URL"); process.exit(2); }

const db = new Client({ connectionString: url });
await db.connect();
const { rows } = await db.query(
  "select session_id, seq, is_free_spin, pre_state->'feature_state' as pre, outcome_jsonb->'feature_state' as post from rounds order by session_id, seq"
);
await db.end();

let features = 0, freeSpins = 0, carried = 0;
const mismatches = [];
const last = new Map();
for (const r of rows) {
  const prev = last.get(r.session_id);
  last.set(r.session_id, r);
  if (!r.is_free_spin) { if (r.post) features++; continue; }
  freeSpins++;
  if (r.pre && r.pre.sticky && r.pre.sticky.length) carried++;
  if (!prev || JSON.stringify(prev.post ?? null) !== JSON.stringify(r.pre ?? null)) mismatches.push({ session: r.session_id, seq: r.seq });
}
const report = { rounds: rows.length, features, freeSpins, freeSpinsStartingWithLitPanes: carried, mismatches: mismatches.length, pass: mismatches.length === 0 && freeSpins > 0 };
console.log(JSON.stringify(report, null, 2));
if (mismatches.length) console.log("first mismatches:", mismatches.slice(0, 5));
process.exit(report.pass ? 0 : 1);
