// Tuning harness (not part of the game): build rules from a few levers and simulate. The levers
// apply on top of the counts and pays in build-rules.js ('{}' = the shipped 96 % set).
//   node games/clockwork/tools/tune.js '{"M":5,"K":1,"B":7,"FK":1,"FB":2,"FM":1,"pay":0.75}' [spins] [mode]
// M: base strip length multiplier (counts x M), K: keys on reels 2-4 (base), B: boxes per reel
// (base), FM / FK / FB: the same for the free reels, pay: paytable scale (rounded to integers).
const { build, BASE, FREE, PAYTABLE } = require("./build-rules");
const { simulateParallel } = require("./sim-report");

const p = JSON.parse(process.argv[2] || "{}");
const spins = Number(process.argv[3] || 1e6);
const mode = process.argv[4] || "base";
const scale = (counts, m, k, b, extraLow, extraHi) => {
  const c = {};
  for (const [s, row] of Object.entries(counts)) c[s] = row.map((n) => n * m);
  if (k !== undefined) c.KEY = [0, k, k, k, 0];
  if (b !== undefined) c.BOX = [b, b, b, b, b];
  if (extraHi) for (const s of ["OWL", "FOX", "HARE", "TORTOISE"]) c[s] = c[s].map((n) => n + extraHi);
  if (extraLow) for (const s of ["GEAR", "SPRING", "NUT", "SCREW", "WRENCH"]) c[s] = c[s].map((n) => n + extraLow);
  return c;
};
// Per-symbol tweaks: { SYM: n } added on every reel.
const adj = (c, a) => { for (const [s, n] of Object.entries(a || {})) c[s] = c[s].map((x) => (x > 0 ? x + n : x)); return c; };
const pay = {};
for (const [s, row] of Object.entries(PAYTABLE)) pay[s] = row.map((x) => Math.max(1, Math.round(x * (p.pay ?? 1))));
if (p.payHi) for (const s of ["OWL", "FOX", "HARE", "TORTOISE"]) pay[s] = pay[s].map((x) => Math.max(1, Math.round(x * p.payHi)));
const rules = build({
  base: adj(scale(BASE, p.M ?? 1, p.K, p.B, p.lowB, p.hiB), p.baseAdj),
  free: adj(scale(FREE, p.FM ?? 1, p.FK, p.FB, p.lowF), p.freeAdj),
  paytable: pay,
  freeSpins: p.fs ? Object.assign({ scatters: 3, awards: [8, 12, 16], retrigger: 4, max_mult: 5 }, p.fs) : undefined,
  variants: [{ game_id: "clockwork", slug: "clockwork_96", strips: "s96", extra: p.extra || {} }]
});
const len = rules.strip_sets.s96.base.map((s) => s.length).join(",");
const fast = process.argv.includes("--fast");
// The feature's own value (x bet) for 8 / 12 / 16 spins (tools/feature-value.js); the same in every variant.
const E = (process.env.E_FEAT || "98,150,200").split(",").map(Number);
simulateParallel(rules, { spins, variant: "clockwork", mode, seed: "tune", skipFeature: fast }).then((s) => {
  if (fast) { console.log(`${JSON.stringify(p)}  base part ${s.baseRtp.toFixed(2)}%  feature 1/${s.featureOneIn.toFixed(1)}  =>  est RTP ${(s.baseRtp + 100 * (s.trig[0] * E[0] + s.trig[1] * E[1] + s.trig[2] * E[2])).toFixed(2)}%  (triggers 8/12/16: ${s.trig.map((x) => (x ? (1 / x).toFixed(0) : '-')).join(' / ')})`); return; }
  const f = (x, d = 2) => (x === null ? "—" : Number(x).toFixed(d));
  console.log(`${JSON.stringify(p)} len ${len}`);
  console.log(`  RTP ${f(s.rtp)}% ±${f(2.5758 * s.se)}  SD ${f(s.sd)}  hit ${f(100 * s.hitRate)}%  base ${f(s.baseRtp)} (respin ${f(s.respinRtp)}, scatter ${f(s.scatterRtp)})  feature ${f(s.featureRtp)}`);
  console.log(`  respin 1/${f(s.respinRoundOneIn, 1)}  feature 1/${f(s.featureOneIn, 1)} avg ${f(s.avgFeatureWin)}x  spins ${f(s.avgFeatureSpins)}  wound@end ${f(s.woundAtEnd)}  max ${f(s.max)}x  cap ${s.capHits}`);
});
