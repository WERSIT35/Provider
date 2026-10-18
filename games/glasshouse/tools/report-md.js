// Glasshouse: writes qa/rtp-report.md from the sim-report.js JSON files in qa/.
//   node games/glasshouse/tools/report-md.js
const fs = require("fs");
const path = require("path");

const QA = path.join(__dirname, "..", "qa");
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "math", "rules.json"), "utf8"));
const read = (f) => (fs.existsSync(path.join(QA, f)) ? JSON.parse(fs.readFileSync(path.join(QA, f), "utf8")) : null);
const variants = ["glasshouse", "glasshouse_95", "glasshouse_94"].map((v) => read(`sim-${v}-100m.json`)).filter(Boolean);
const buy = read("sim-glasshouse-buy-10m.json");
const n = (x, d = 2) => (x === null || x === undefined ? "—" : Number(x).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
const pct = (x, d = 4) => `${n(x, d)}%`;

const lines = [];
const out = (s = "") => lines.push(s);
out("# Glasshouse: RTP simulation report");
out();
out(`Rules ${rules.version}, engine ${variants[0]?.engine_version || buy?.engine_version}. Seeded Monte Carlo over the real engine file, loaded in a vm context as the RGS loads it (\`tools/sim-report.js\`, 20 fixed shards, so the result does not depend on the machine).`);
out("One sample is one paid spin including the whole feature it triggers, or one feature buy including its whole feature.");
out();
out("This is a simulation report for internal review. It is not a certificate and makes no claim of approval by any lab or regulator.");
out();
out("## Summary");
out();
out("| Variant | Samples | RTP | 99% CI | SE | Hit rate | Feature 1 in | Max win seen |");
out("|---|---|---|---|---|---|---|---|");
for (const v of variants) out(`| \`${v.variant}\` | ${v.samples.toLocaleString("en-US")} | **${pct(v.rtp)}** | ${pct(v.ci99[0])} – ${pct(v.ci99[1])} | ${pct(v.se)} | ${pct(100 * v.hitRate, 2)} | ${n(v.featureOneIn, 1)} | ${n(v.max)}× |`);
if (buy) out(`| \`${buy.variant}\` buy (100×) | ${buy.samples.toLocaleString("en-US")} | **${pct(buy.rtp)}** | ${pct(buy.ci99[0])} – ${pct(buy.ci99[1])} | ${pct(buy.se)} | 100% | every buy | ${n(buy.max)}× |`);
out();
out("The free-spin reels are the same in every variant, so the buy's RTP is the same for all three.");
out();
out("## RTP breakdown (paid spins)");
out();
out("| Variant | Base game | of which Sun Lens spins | Glass Rose pays | Free spins | Total |");
out("|---|---|---|---|---|---|");
for (const v of variants) out(`| \`${v.variant}\` | ${pct(v.baseRtp, 2)} | ${pct(v.lensRtp, 2)} | ${pct(v.scatterRtp, 2)} | ${pct(v.featureRtp, 2)} | ${pct(v.rtp, 2)} |`);
out();
out("Base game includes the spin that triggers the feature; free spins are the feature's spins only.");
out();
out("## Feature and beam figures");
out();
out("| Variant | Sun Lens spins | Feature 1 in | Avg feature (× bet, incl. trigger) | Free spins per feature | Retriggers per feature | Lit panes at the end | Cells per beam | Max-win cap hits |");
out("|---|---|---|---|---|---|---|---|---|");
for (const v of [...variants, ...(buy ? [buy] : [])]) out(`| \`${v.variant}\`${v.mode === "buy" ? " buy" : ""} | ${pct(100 * v.lensRate, 2)} | ${v.mode === "buy" ? "—" : n(v.featureOneIn, 1)} | ${n(v.avgFeatureWin)} | ${n(v.avgFeatureSpins)} | ${n(v.retriggerPerFeature, 3)} | ${n(v.stickyAtEnd)} | ${n(v.cellsPerBeam)} | ${v.capHits.toLocaleString("en-US")} |`);
out();
out(`Volatility: standard deviation per paid spin ${variants.map((v) => `\`${v.variant}\` ${n(v.sd)}`).join(", ")} (× bet).`);
out();
for (const v of [...variants, ...(buy ? [buy] : [])]) {
  out(`## Win distribution: \`${v.variant}\`${v.mode === "buy" ? " buy" : ""}`);
  out();
  out("| Round win (× cost) | Share of samples | RTP from this band |");
  out("|---|---|---|");
  v.dist.forEach((b, i) => {
    const next = v.dist[i + 1];
    const label = i === 0 ? "0 (no win)" : i === 1 ? `> 0 to < ${next.from}` : next ? `${b.from} to < ${next.from}` : `${b.from} and up (cap ${rules.max_win_x})`;
    out(`| ${label} | ${pct((100 * b.count) / v.samples, 4)} | ${pct(b.rtp, 3)} |`);
  });
  out();
}
out("## How to reproduce");
out();
out("```");
for (const v of variants) out(`node games/glasshouse/tools/sim-report.js --spins ${v.samples} --variant ${v.variant} --seed ${v.seed} --json games/glasshouse/qa/sim-${v.variant}-100m.json`);
if (buy) out(`node games/glasshouse/tools/sim-report.js --spins ${buy.samples} --mode buy --variant ${buy.variant} --seed ${buy.seed} --json games/glasshouse/qa/sim-${buy.variant}-buy-10m.json`);
out("node games/glasshouse/tools/report-md.js");
out("```");
fs.writeFileSync(path.join(QA, "rtp-report.md"), lines.join("\n") + "\n");
console.log("→", path.join(QA, "rtp-report.md"));
