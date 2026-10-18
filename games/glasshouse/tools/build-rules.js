// Builds games/glasshouse/math/rules.json from the design below (DESIGN.md §2-§8): symbol
// counts per reel → reel strips (specials placed first with the §2.1 spacing rules, the
// paying symbols spread evenly around them), paytable, scatter, free spins, buy, variants.
//   node games/glasshouse/tools/build-rules.js [--write]
// The RTP of each variant comes from the seeded simulation (tools/sim-report.js), not from
// this file: the beam makes an exact sum impractical. Never hand-edit the strips.
const fs = require("fs");
const path = require("path");

const PAYING = ["HUMMINGBIRD", "ORCHID", "WATERING_CAN", "SUNDIAL", "HEART", "PEAR", "MARQUISE", "BAGUETTE", "CUSHION", "TRILLION"];
const SPECIALS = { lens: "LENS", rise: "MIRROR_RISE", fall: "MIRROR_FALL", rose: "ROSE", clear: "CLEAR" };
// CLEAR: a plain pane of uncoloured glass. It pays nothing; lit by a beam it is wild like any pane.
const FILL = [...PAYING, "CLEAR"];
const SYMBOLS = [...FILL, "LENS", "MIRROR_RISE", "MIRROR_FALL", "ROSE"];
// Pays per way for 3 / 4 / 5 / 6 reels, in x TOTAL bet (DESIGN §3.2). Smallest pay 0.05x,
// so the smallest bet (0.20) still pays a whole cent per way.
const PAYTABLE = {
  HUMMINGBIRD:  [2.25, 2.75, 4.5, 5.5],
  ORCHID:       [1.75, 2.25, 3.5, 4.5],
  WATERING_CAN: [1.4, 1.7, 2.5, 3.5],
  SUNDIAL:      [1.1, 1.4, 2.25, 2.8],
  HEART:        [0.65, 0.85, 1.1, 1.4],
  PEAR:         [0.65, 0.85, 1.1, 1.4],
  MARQUISE:     [0.55, 0.65, 0.85, 1.1],
  BAGUETTE:     [0.55, 0.65, 0.85, 1.1],
  CUSHION:      [0.5, 0.55, 0.65, 0.85],
  TRILLION:     [0.5, 0.55, 0.65, 0.85]
};
const SCATTER_PAYS = [2, 5, 20, 100]; // x total bet for 3 / 4 / 5 / 6 roses anywhere
// sticky_spins: a lit pane stays lit (and wild) for this many more free spins, then fades.
const FREE_SPINS = { scatters: 3, award: 10, retrigger: 5, sticky_spins: 2 };
const BUY = { cost_x: 100, scatters: 3 };

// Symbol counts per reel (reels 1..6) for one strip set. `lens` only on reel 1, mirrors only on
// reels 2-6 (DESIGN §2.1). Variants add low gems (fewer premium hits, same look).
const BASE = {
  HUMMINGBIRD:  [8, 3, 3, 3, 3, 3],
  ORCHID:       [8, 4, 4, 4, 4, 4],
  WATERING_CAN: [11, 4, 4, 4, 4, 4],
  SUNDIAL:      [11, 4, 4, 4, 4, 4],
  HEART:        [14, 5, 5, 5, 5, 5],
  PEAR:         [14, 5, 5, 5, 5, 5],
  MARQUISE:     [14, 5, 5, 5, 5, 5],
  BAGUETTE:     [14, 5, 5, 5, 5, 5],
  CUSHION:      [17, 5, 5, 5, 5, 5],
  TRILLION:     [17, 5, 5, 5, 5, 5],
  LENS:         [1, 0, 0, 0, 0, 0],
  MIRROR_RISE:  [0, 7, 7, 7, 7, 7],
  MIRROR_FALL:  [0, 7, 7, 7, 7, 7],
  ROSE:         [2, 1, 1, 1, 1, 1]
};
const FREE = {
  HUMMINGBIRD:  [6, 3, 3, 3, 3, 3],
  ORCHID:       [6, 4, 4, 4, 4, 4],
  WATERING_CAN: [8, 4, 4, 4, 4, 4],
  SUNDIAL:      [8, 4, 4, 4, 4, 4],
  HEART:        [10, 5, 5, 5, 5, 5],
  PEAR:         [10, 5, 5, 5, 5, 5],
  MARQUISE:     [10, 5, 5, 5, 5, 5],
  BAGUETTE:     [10, 5, 5, 5, 5, 5],
  CUSHION:      [12, 5, 5, 5, 5, 5],
  TRILLION:     [12, 5, 5, 5, 5, 5],
  LENS:         [4, 0, 0, 0, 0, 0],
  MIRROR_RISE:  [0, 7, 7, 7, 7, 7],
  MIRROR_FALL:  [0, 7, 7, 7, 7, 7],
  ROSE:         [1, 1, 1, 1, 1, 1],
  CLEAR:        [10, 0, 0, 0, 0, 0]
};
// Extra low gems per variant on the BASE reels only ({ symbol: extra per reel }); reel 1, where
// the Sun Lens sits, is never changed (its neighbours decide most of a beam's value).
const VARIANTS = [
  { game_id: "glasshouse", slug: "glasshouse_96", strips: "s96", extra: {} },
  { game_id: "glasshouse_95", slug: "glasshouse_95", strips: "s95", extra: { CUSHION: [0, 0, 0, 0, 1, 1], TRILLION: [0, 0, 0, 0, 1, 1] } },
  { game_id: "glasshouse_94", slug: "glasshouse_94", strips: "s94", extra: { CUSHION: [0, 0, 1, 1, 1, 1], TRILLION: [0, 0, 1, 1, 1, 1] } }
];
const LOWS = ["HEART", "PEAR", "MARQUISE", "BAGUETTE", "CUSHION", "TRILLION"];
const ROWS = 4;

// §2.1 spacing on a strip (cyclic distance between two of the same class).
const MIN_GAP = { lens: 2, rose: ROWS, mirror: ROWS };
const classOf = (s) => (s === "LENS" ? "lens" : s === "ROSE" ? "rose" : s === "MIRROR_RISE" || s === "MIRROR_FALL" ? "mirror" : null);

function cyclicGap(a, b, len) {
  const d = Math.abs(a - b) % len;
  return Math.min(d, len - d);
}

/** One strip: specials first (spaced per MIN_GAP), then the paying symbols spread evenly. */
function strip(counts, reel) {
  const n = (s) => (counts[s] ? counts[s][reel] : 0);
  const len = SYMBOLS.reduce((t, s) => t + n(s), 0);
  const out = new Array(len).fill(null);
  const placed = { lens: [], rose: [], mirror: [] };
  const fits = (i, cls) => out[i] === null && placed[cls].every((j) => cyclicGap(i, j, len) >= MIN_GAP[cls]);
  // Mirrors alternate rise / fall so each orientation spreads round the strip.
  const specials = [];
  for (const s of ["ROSE", "LENS"]) for (let k = 0; k < n(s); k++) specials.push(s);
  const rise = n("MIRROR_RISE");
  const fall = n("MIRROR_FALL");
  for (let k = 0; k < Math.max(rise, fall); k++) {
    if (k < rise) specials.push("MIRROR_RISE");
    if (k < fall) specials.push("MIRROR_FALL");
  }
  const byClass = { lens: [], rose: [], mirror: [] };
  for (const s of specials) byClass[classOf(s)].push(s);
  const offset = { rose: 0, lens: 0.5, mirror: 0.25 };
  for (const cls of ["rose", "lens", "mirror"]) {
    const list = byClass[cls];
    list.forEach((s, k) => {
      let i = Math.floor(((k + offset[cls]) * len) / list.length + reel * 3) % len;
      let guard = 0;
      while (!fits(i, cls)) {
        i = (i + 1) % len;
        if (++guard > len) throw new Error(`reel ${reel + 1}: no room for ${s}`);
      }
      out[i] = s;
      placed[cls].push(i);
    });
  }
  // Paying symbols: each at evenly spaced free slots, most frequent first.
  const pay = FILL.map((s) => [s, n(s)]).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1] || FILL.indexOf(a[0]) - FILL.indexOf(b[0]));
  pay.forEach(([s, cnt], si) => {
    for (let k = 0; k < cnt; k++) {
      let i = Math.floor((k * len) / cnt + si * 0.37 * (len / cnt)) % len;
      while (out[i] !== null) i = (i + 1) % len;
      out[i] = s;
    }
  });
  return out;
}

/** §2.1 checks on a finished strip set (also run by the unit tests). */
function checkStrips(strips) {
  const problems = [];
  strips.forEach((st, reel) => {
    const len = st.length;
    for (let i = 0; i < len; i++) {
      const win = [0, 1, 2, 3].map((k) => st[(i + k) % len]);
      const n = (cls) => win.filter((s) => classOf(s) === cls).length;
      if (n("lens") > 2) problems.push(`reel ${reel + 1} @${i}: 3 lenses in view`);
      if (n("rose") > 1) problems.push(`reel ${reel + 1} @${i}: 2 roses in view`);
      if (n("mirror") > 1) problems.push(`reel ${reel + 1} @${i}: 2 mirrors in view`);
      if (st[i] === "LENS" && st[(i + 1) % len] === "LENS") problems.push(`reel ${reel + 1} @${i}: adjacent lenses`);
    }
    if (reel > 0 && st.includes("LENS")) problems.push(`reel ${reel + 1}: lens off reel 1`);
    if (reel === 0 && st.some((s) => classOf(s) === "mirror")) problems.push("reel 1: mirror on reel 1");
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
      base: [0, 1, 2, 3, 4, 5].map((r) => strip(withExtra(base, v.extra), r)),
      // The free-spin reels are the same in every variant, so the feature (and the buy) is too.
      free: [0, 1, 2, 3, 4, 5].map((r) => strip(free, r))
    };
    const problems = [...checkStrips(set.base), ...checkStrips(set.free)];
    if (problems.length) throw new Error(`${v.strips}: ${problems.join("; ")}`);
    strip_sets[v.strips] = set;
  }
  return {
    game: "glasshouse", title: "Glasshouse", version: "1.0.0", status: "simulated (qa/rtp-report.md): not lab-certified",
    layout: { reels: 6, rows: ROWS, ways: 4096 },
    paying: PAYING, top_symbol: "HUMMINGBIRD", specials: SPECIALS,
    // The Sun Lens is the light source, not a pane: it never turns wild (DESIGN §4.5).
    lens_is_wild: false,
    paytable: design.paytable || PAYTABLE,
    scatter: { symbol: "ROSE", pays: design.scatterPays || SCATTER_PAYS },
    free_spins: FREE_SPINS, buy: BUY,
    rtp_profiles: variants.map((v) => ({ game_id: v.game_id, slug: v.slug, strips: v.strips, theoretical_percent: v.theoretical_percent ?? null, buy_free_spins_percent: v.buy_free_spins_percent ?? null })),
    max_win_x: 5000, allowed_bets: [0.2, 0.4, 1, 2, 4, 10, 20, 40, 100],
    strip_sets
  };
}

/** Pretty JSON, but every array of scalars (a strip, a pay row) on one line. */
function compactJson(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, body) => `[${body.split(/,\s*/).join(", ")}]`);
}

if (require.main === module) {
  const rules = build();
  // Keep the simulated RTP figures already in rules.json (sim-report.js --write-rtp sets them).
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
module.exports = { build, checkStrips, BASE, FREE, VARIANTS, PAYTABLE, SCATTER_PAYS, compactJson };
