// Builds games/classic-5x3/math/rules.json from the design below: symbol counts per
// reel → reel strips (deterministic spread, scatters at least 3 cells apart), paytable,
// scatter, free spins, lines. Then prints the exact RTP (exact-rtp.js).
//   node games/classic-5x3/tools/build-rules.js [--write]
const fs = require("fs");
const path = require("path");
const { exact } = require("./exact-rtp");

const SYMBOLS = ["CHERRY", "LEMON", "ORANGE", "PLUM", "GRAPE", "MELON", "BELL", "BAR", "SEVEN", "WILD", "SCATTER"];
// Line pays for 3 / 4 / 5 of a kind, in LINE bets (total bet / lines).
const PAYTABLE = {
  CHERRY: [6, 20, 50], LEMON: [6, 20, 50], ORANGE: [8, 25, 60], PLUM: [8, 25, 60],
  GRAPE: [12, 40, 125], MELON: [15, 50, 150], BELL: [20, 75, 250], BAR: [25, 100, 400], SEVEN: [40, 150, 800]
};
// Symbol counts per reel (columns = reels 1..5). WILD only on reels 2-4; one SCATTER per reel.
const COUNTS = {
  CHERRY:  [5, 5, 5, 5, 5],
  LEMON:   [5, 5, 5, 5, 5],
  ORANGE:  [4, 4, 4, 4, 4],
  PLUM:    [4, 4, 4, 4, 4],
  GRAPE:   [3, 3, 3, 3, 3],
  MELON:   [3, 3, 3, 3, 3],
  BELL:    [2, 2, 2, 2, 2],
  BAR:     [2, 2, 2, 2, 2],
  SEVEN:   [2, 2, 2, 2, 2],
  WILD:    [0, 3, 3, 3, 0],
  SCATTER: [1, 1, 1, 1, 1]
};
const SCATTER = { symbol: "SCATTER", pays: [3, 15, 100] }; // x TOTAL bet for 3 / 4 / 5 anywhere
const FREE_SPINS = { awards: [20, 25, 30], multiplier: 3 }; // spins for 3 / 4 / 5 scatters; every free spin win x3; retriggers add spins

// The 40 fixed lines (row per reel: 0 top, 1 middle, 2 bottom). 10 lines = the first 10, 20 = the first 20.
const LINES = [
  [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],[0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[0,1,1,1,0],
  [2,1,1,1,2],[1,0,1,2,1],[1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],[1,1,0,1,1],[1,1,2,1,1],[0,0,2,0,0],[2,2,0,2,2],[0,2,0,2,0],
  [2,0,2,0,2],[1,0,2,0,1],[1,2,0,2,1],[0,2,2,2,0],[2,0,0,0,2],[0,0,1,0,0],[2,2,1,2,2],[1,1,1,0,0],[1,1,1,2,2],[0,1,2,2,2],
  [2,1,0,0,0],[0,0,0,1,2],[2,2,2,1,0],[1,0,1,0,1],[1,2,1,2,1],[0,2,1,2,0],[2,0,1,0,2],[0,1,1,1,2],[2,1,1,1,0],[1,1,0,0,0]
];

/** A strip with the counts spread evenly (largest-remainder interleave), then scatters re-spaced. */
function strip(r) {
  const counts = SYMBOLS.map((s) => [s, COUNTS[s][r]]).filter(([, n]) => n > 0);
  const len = counts.reduce((s, [, n]) => s + n, 0);
  const out = new Array(len).fill(null);
  // Place each symbol at evenly spaced slots, most frequent first, nudging to the next free cell.
  counts.sort((a, b) => b[1] - a[1] || SYMBOLS.indexOf(a[0]) - SYMBOLS.indexOf(b[0]));
  counts.forEach(([s, n], si) => {
    for (let k = 0; k < n; k++) {
      let i = Math.floor((k * len) / n + si * 0.37 * (len / n)) % len;
      while (out[i] !== null) i = (i + 1) % len;
      out[i] = s;
    }
  });
  // Each reel starts at a different point of the same spread (rotation changes nothing in the math).
  const k = (r * 7) % len;
  return out.slice(k).concat(out.slice(0, k));
}

function build() {
  const reels = [0, 1, 2, 3, 4].map(strip);
  const seen = new Set();
  for (const l of LINES) { const k = l.join(""); if (seen.has(k)) throw new Error(`duplicate line ${k}`); seen.add(k); }
  return {
    game: "classic-5x3", version: "1.0.0", layout: { reels: 5, rows: 3 },
    lines: { options: [10, 20, 40], patterns: LINES },
    symbols: SYMBOLS, wild: { symbol: "WILD", substitutes_all_but: ["SCATTER"] }, scatter: SCATTER,
    paytable: PAYTABLE, free_spins: FREE_SPINS,
    // Fixed lines: each variant (session game code) plays a fixed line count; same RTP.
    rtp_profiles: [
      { game_id: "classic-5x3", slug: "classic_5x3_20", lines: 20 },
      { game_id: "classic-5x3_10", slug: "classic_5x3_10", lines: 10 },
      { game_id: "classic-5x3_40", slug: "classic_5x3_40", lines: 40 }
    ],
    max_win_x: 5000, allowed_bets: [0.2, 0.4, 1, 2, 4, 10, 20, 40, 100],
    target_rtp: 96.0, theoretical_rtp: null, reels
  };
}

/** Pretty JSON, but every array of scalars (a reel strip, a line, a pay row) on one line. */
function compactJson(value) {
  return JSON.stringify(value, null, 2).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, body) => `[${body.split(/,\s*/).join(", ")}]`);
}

if (require.main === module) {
  const rules = build();
  const r = exact(rules);
  rules.theoretical_rtp = Number((100 * r.rtp).toFixed(4)); // exact, from the strips and paytable
  const pct = (x) => (100 * x).toFixed(4) + "%";
  console.log(`lengths ${r.lengths.join(",")}  line ${pct(r.lineRtp)}  scatter ${pct(r.scatterRtp)}  base ${pct(r.baseGameRtp)}  fs ${pct(r.featureRtp)} (1 in ${r.triggerOneIn.toFixed(1)}, ${r.spinsPerFeature.toFixed(2)} spins)  TOTAL ${pct(r.rtp)}`);
  if (process.argv.includes("--write")) {
    const file = path.join(__dirname, "..", "math", "rules.json");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, compactJson(rules) + "\n");
    console.log("→", file);
  }
}
module.exports = { build, LINES };
