// Exact RTP of classic-5x3 from its rules (reel strips + paytable), no simulation.
//   node games/classic-5x3/tools/exact-rtp.js [rules.json]
//
// Why it is exact: a reel stops uniformly on its strip and shows 3 consecutive cells, so
// every visible row of a reel has the same symbol distribution (the strip's counts), and
// reels are independent. Every pay line takes one cell per reel, so EVERY line has the
// same win distribution: the line RTP is one line's expected pay (in line bets) and does
// not depend on 10, 20 or 40 lines. Scatters are spaced at least 3 cells apart on every
// strip, so a reel shows at most one: P(scatter on reel r) = 3 * scatters_r / length_r.
// Free spins replay the same strips with every win x multiplier; a retrigger adds spins,
// so a feature lasts n0 / (1 - a) spins on average (a = expected spins added per spin).
// The 5,000x cap is not modelled here (its effect is measured by the simulation).
const fs = require("fs");
const path = require("path");

function exact(rules) {
  const { reels, paytable, scatter, wild, free_spins: fsr } = rules;
  const L = reels.map((r) => r.length);
  const p = (r, sym) => reels[r].filter((s) => s === sym).length / L[r];
  // scatter spacing check (the "at most one per reel window" assumption)
  reels.forEach((strip, r) => {
    const idx = strip.map((s, i) => (s === scatter.symbol ? i : -1)).filter((i) => i >= 0);
    for (let a = 0; a < idx.length; a++) {
      const b = idx[(a + 1) % idx.length];
      const gap = (b - idx[a] + strip.length) % strip.length || strip.length;
      if (idx.length > 1 && gap < 3) throw new Error(`reel ${r + 1}: scatters closer than 3 cells`);
    }
  });
  // One line, left to right from reel 1: the first symbol (never wild, never scatter on a line win)
  // and how many consecutive reels show it or a wild.
  let lineRtp = 0;
  const lineHits = {};
  for (const sym of Object.keys(paytable)) {
    const p1 = p(0, sym);
    if (!p1) continue;
    let run = p1; // P(reels 1..k all match)
    const pk = [0, p1];
    for (let r = 1; r < 5; r++) { run *= p(r, sym) + p(r, wild.symbol); pk.push(run); }
    for (let k = 3; k <= 5; k++) {
      const exactly = pk[k] - (k < 5 ? pk[k] * (p(k, sym) + p(k, wild.symbol)) : 0);
      const pay = paytable[sym][k - 3] || 0;
      lineRtp += exactly * pay;
      lineHits[`${sym}x${k}`] = exactly;
    }
  }
  // Scatter count distribution over 5 reels.
  let dist = [1];
  for (let r = 0; r < 5; r++) {
    const q = 3 * reels[r].filter((s) => s === scatter.symbol).length / L[r];
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((v, k) => { next[k] += v * (1 - q); next[k + 1] += v * q; });
    dist = next;
  }
  const scatterPay = (k) => (k >= 3 ? scatter.pays[Math.min(k, 5) - 3] : 0);
  const award = (k) => (k >= 3 ? fsr.awards[Math.min(k, 5) - 3] : 0);
  const scatterRtp = dist.reduce((s, v, k) => s + v * scatterPay(k), 0); // x total bet
  const trigger = dist.reduce((s, v, k) => s + (k >= 3 ? v : 0), 0);
  const a = dist.reduce((s, v, k) => s + v * award(k), 0); // spins added per (free) spin
  const n0 = dist.reduce((s, v, k) => s + v * award(k), 0) / trigger; // spins per trigger
  const spinsPerFeature = n0 / (1 - a);
  const baseRtp = lineRtp + scatterRtp;
  const featureRtpPerPaidSpin = trigger * spinsPerFeature * fsr.multiplier * baseRtp;
  return {
    lengths: L, lineRtp, scatterRtp, baseGameRtp: baseRtp, featureRtp: featureRtpPerPaidSpin, rtp: baseRtp + featureRtpPerPaidSpin,
    triggerOneIn: 1 / trigger, spinsPerFeature, retriggerSpinsPerSpin: a, scatterDist: dist, lineHits
  };
}

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, "..", "math", "rules.json");
  const r = exact(JSON.parse(fs.readFileSync(file, "utf8")));
  const pct = (x) => (100 * x).toFixed(4) + "%";
  console.log(`reel lengths      ${r.lengths.join(", ")}`);
  console.log(`line wins         ${pct(r.lineRtp)}`);
  console.log(`scatter pays      ${pct(r.scatterRtp)}`);
  console.log(`base game         ${pct(r.baseGameRtp)}`);
  console.log(`free spins        ${pct(r.featureRtp)}  (1 in ${r.triggerOneIn.toFixed(1)} spins, ${r.spinsPerFeature.toFixed(2)} spins per feature)`);
  console.log(`TOTAL RTP         ${pct(r.rtp)}`);
}
module.exports = { exact };
