// Builds games/clockwork/math/rules.json from the design below (DESIGN.md §2-§7): symbol counts
// per reel → reel strips (the key and the music box placed first, spaced so at most one of each
// is in any 3-cell window; the paying symbols spread evenly around them), paytable, lines,
// scatter, free spins, buy, variants.
//   node games/clockwork/tools/build-rules.js [--write]
// The RTP of each variant comes from the seeded simulation (tools/sim-report.js), not from this
// file. Never hand-edit the strips.
const fs = require("fs");
const path = require("path");

const PAYING = ["OWL", "FOX", "HARE", "TORTOISE", "GEAR", "SPRING", "NUT", "SCREW", "WRENCH"];
const SYMBOLS = [...PAYING, "KEY", "BOX"];
const ROWS = 3;
// The 20 fixed lines (row per reel), the same set as the house's other 5x3 game.
const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 2, 1], [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2],
  [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 0, 2, 0, 0], [2, 2, 0, 2, 2], [0, 2, 0, 2, 0]
];
// Pays per line for 3 / 4 / 5 of a kind, in LINE bets (DESIGN §3).
const PAYTABLE = {
  OWL:      [26, 130, 650],
  FOX:      [20, 78, 390],
  HARE:     [16, 52, 260],
  TORTOISE: [13, 39, 195],
  GEAR:     [7, 20, 78],
  SPRING:   [7, 16, 65],
  NUT:      [5, 13, 52],
  SCREW:    [4, 10, 39],
  WRENCH:   [4, 10, 39]
};
const SCATTER_PAYS = [2, 10, 50]; // x total bet for 3 / 4 / 5 boxes on one board
const WILD = { symbol: "KEY", reels: [2, 3, 4], respins: 2 };
const FREE_SPINS = { scatters: 3, awards: [8, 12, 16], retrigger: 4, max_mult: 5 };
const BUY = { cost_x: 100, scatters: 3 };

// Symbol counts per reel (reels 1..5), tuned with tools/tune.js. KEY only on reels 2-4 (DESIGN §2).
// The free reels carry more keys (wound reels make the feature) and fewer boxes.
const BASE = {
  OWL:      [12, 12, 12, 12, 12],
  FOX:      [16, 16, 16, 16, 16],
  HARE:     [20, 20, 20, 20, 20],
  TORTOISE: [20, 20, 20, 20, 20],
  GEAR:     [28, 28, 28, 28, 28],
  SPRING:   [28, 28, 28, 28, 28],
  NUT:      [32, 32, 32, 32, 32],
  SCREW:    [32, 32, 32, 32, 32],
  WRENCH:   [32, 32, 32, 32, 32],
  KEY:      [0, 1, 1, 1, 0],
  BOX:      [6, 6, 6, 6, 6]
};
const FREE = {
  OWL:      [9, 9, 9, 9, 9],
  FOX:      [12, 12, 12, 12, 12],
  HARE:     [15, 15, 15, 15, 15],
  TORTOISE: [15, 15, 15, 15, 15],
  GEAR:     [20, 20, 20, 20, 20],
  SPRING:   [20, 20, 20, 20, 20],
  NUT:      [22, 22, 22, 22, 22],
  SCREW:    [22, 22, 22, 22, 22],
  WRENCH:   [22, 22, 22, 22, 22],
  KEY:      [0, 2, 2, 2, 0],
  BOX:      [3, 3, 3, 3, 3]
};
// Extra low symbols per variant on the BASE reels only ({ symbol: extra per reel }).
const VARIANTS = [
  { game_id: "clockwork", slug: "clockwork_96", strips: "s96", extra: {} },
  { game_id: "clockwork_94", slug: "clockwork_94", strips: "s94", extra: { SCREW: [1, 1, 1, 1, 1], WRENCH: [1, 1, 1, 1, 1] } },
  { game_id: "clockwork_92", slug: "clockwork_92", strips: "s92", extra: { SCREW: [3, 2, 2, 2, 3], WRENCH: [2, 2, 2, 2, 2] } }
];

const MIN_GAP = ROWS; // at most one KEY and one BOX in any 3-cell window
const isSpecial = (s) => s === "KEY" || s === "BOX";

function cyclicGap(a, b, len) {
  const d = Math.abs(a - b) % len;
  return Math.min(d, len - d);
}

/** One strip: KEY and BOX first (each spaced >= ROWS from its own kind), then the paying symbols spread evenly. */
function strip(counts, reel) {
  const n = (s) => (counts[s] ? counts[s][reel] : 0);
  const len = SYMBOLS.reduce((t, s) => t + n(s), 0);
  const out = new Array(len).fill(null);
  const placed = { KEY: [], BOX: [] };
  const offset = { BOX: 0, KEY: 0.5 };
  for (const s of ["BOX", "KEY"]) {
    for (let k = 0; k < n(s); k++) {
      let i = Math.floor(((k + offset[s]) * len) / n(s) + reel * 5) % len;
      let guard = 0;
      while (out[i] !== null || placed[s].some((j) => cyclicGap(i, j, len) < MIN_GAP)) {
        i = (i + 1) % len;
        if (++guard > len) throw new Error(`reel ${reel + 1}: no room for ${s}`);
      }
      out[i] = s;
      placed[s].push(i);
    }
  }
  const pay = PAYING.map((s) => [s, n(s)]).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1] || PAYING.indexOf(a[0]) - PAYING.indexOf(b[0]));
  pay.forEach(([s, cnt], si) => {
    for (let k = 0; k < cnt; k++) {
      let i = Math.floor((k * len) / cnt + si * 0.41 * (len / cnt)) % len;
      while (out[i] !== null) i = (i + 1) % len;
      out[i] = s;
    }
  });
  return out;
}

/** DESIGN §2 strip rules (also run by the unit tests). */
function checkStrips(strips) {
  const problems = [];
  strips.forEach((st, reel) => {
    const len = st.length;
    for (let i = 0; i < len; i++) {
      const win = [0, 1, 2].map((k) => st[(i + k) % len]);
      if (win.filter((s) => s === "KEY").length > 1) problems.push(`reel ${reel + 1} @${i}: 2 keys in view`);
      if (win.filter((s) => s === "BOX").length > 1) problems.push(`reel ${reel + 1} @${i}: 2 boxes in view`);
    }
    if ((reel === 0 || reel === strips.length - 1) && st.includes("KEY")) problems.push(`reel ${reel + 1}: key on an outer reel`);
    if (st.some((s) => !SYMBOLS.includes(s))) problems.push(`reel ${reel + 1}: unknown symbol`);
  });
  return problems;
}

function withExtra(counts, extra) {
  const c = JSON.parse(JSON.stringify(counts));
  for (const [sym, add] of Object.entries(extra || {})) c[sym] = c[sym].map((n, r) => n + add[r]);
  return c;
}

function build(design = {}) {
  const base = design.base || BASE;
  const free = design.free || FREE;
  const variants = design.variants || VARIANTS;
  const strip_sets = {};
  for (const v of variants) {
    const set = {
      base: [0, 1, 2, 3, 4].map((r) => strip(withExtra(base, v.extra), r)),
      // The free-spin reels are the same in every variant, so the feature (and the buy) is too.
      free: [0, 1, 2, 3, 4].map((r) => strip(free, r))
    };
    const problems = [...checkStrips(set.base), ...checkStrips(set.free)];
    if (problems.length) throw new Error(`${v.strips}: ${problems.join("; ")}`);
    strip_sets[v.strips] = set;
  }
  return {
    game: "clockwork", title: "Clockwork Menagerie", version: "1.0.0", status: "simulated (qa/rtp-report.md): not lab-certified",
    layout: { reels: 5, rows: ROWS },
    lines: { count: LINES.length, both_ways: true, patterns: LINES },
    paying: PAYING, top_symbol: "OWL",
    paytable: design.paytable || PAYTABLE,
    wild: WILD,
    scatter: { symbol: "BOX", pays: design.scatterPays || SCATTER_PAYS },
    free_spins: design.freeSpins || FREE_SPINS, buy: BUY,
    rtp_profiles: variants.map((v) => ({ game_id: v.game_id, slug: v.slug, strips: v.strips, theoretical_percent: v.theoretical_percent ?? null, buy_free_spins_percent: v.buy_free_spins_percent ?? null })),
    max_win_x: 10000, allowed_bets: [0.2, 0.4, 1, 2, 4, 10, 20, 40, 100],
    strip_sets
  };
}

/** Pretty JSON, but every array of scalars (a strip, a pay row) on one line. */
function compactJson(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, body) => `[${body.split(/,\s*/).join(", ")}]`);
}

if (require.main === module) {
  const rules = build();
  // Keep the simulated RTP figures already in rules.json (sim-report.js sets them).
  const file = path.join(__dirname, "..", "math", "rules.json");
  if (fs.existsSync(file)) {
    const old = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const p of rules.rtp_profiles) {
      const o = (old.rtp_profiles || []).find((x) => x.game_id === p.game_id);
      if (o) { p.theoretical_percent = o.theoretical_percent; p.buy_free_spins_percent = o.buy_free_spins_percent; }
    }
  }
  for (const [k, set] of Object.entries(rules.strip_sets)) console.log(`${k}: base ${set.base.map((s) => s.length).join(",")}  free ${set.free.map((s) => s.length).join(",")}`);
  if (process.argv.includes("--write")) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, compactJson(rules) + "\n");
    console.log("→", file);
  }
}
module.exports = { build, checkStrips, BASE, FREE, VARIANTS, PAYTABLE, SCATTER_PAYS, FREE_SPINS, compactJson };
