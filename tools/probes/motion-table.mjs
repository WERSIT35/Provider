#!/usr/bin/env node
// Motion-table check (docs/lumina-overhaul, prompt A5): the shared timing module is
// well-formed and every game reads its durations from it.
//
//   node tools/probes/motion-table.mjs
//
// No browser needed: the module is a plain IIFE, run here in a vm context.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failed++;
};

const ctx = { globalThis: {} };
ctx.window = ctx.globalThis;
vm.runInNewContext(read("client/shell/motion.js"), ctx);
const M = ctx.globalThis.LuminaMotion;
check("LuminaMotion loads", Boolean(M && M.GRAMMAR && M.BIG_WIN));

// The Part 4 events (reports/Slot provider UI and motion.md) that must have a row.
const REQUIRED = ["spinPress", "spinOut", "columnGap", "spinLand", "anticipation", "anticipationMiss", "noWinHold",
  "winHighlight", "linesAll", "linePerLine", "countUpMin", "countUpMax", "tumbleBurst", "tumbleFall", "runningTotal",
  "multiplierLand", "multiplierSum", "multiplierApply", "scatterTrigger", "featureTransition", "freeSpinCounter",
  "retrigger", "featureOutro", "neutralCredit", "buySheet", "buyTransition", "pickReveal", "pickResolve",
  "meterCharge", "waitRing", "waitMessage", "idle"];
const missing = REQUIRED.filter((e) => !M.GRAMMAR[e]);
check("every motion-grammar event has a row", missing.length === 0, missing.join(", "));

const bad = [];
for (const [name, r] of Object.entries(M.GRAMMAR)) {
  for (const k of ["normal", "quick", "turbo", "reduced"]) if (!(Number.isFinite(r[k]) && r[k] >= 0)) bad.push(`${name}.${k}`);
  if (!(r.turbo <= r.quick && r.quick <= r.normal)) bad.push(`${name}: turbo ≤ quick ≤ normal`);
  if (r.reduced < r.normal && !r.decorative) bad.push(`${name}: reduced motion may not shorten a cause step`);
  if (!["yes", "no", "shorten", "after-result"].includes(r.skip)) bad.push(`${name}.skip`);
  if (r.measured !== null) bad.push(`${name}.measured must stay null until Phase 0`);
}
check("rows are well-formed (speeds ordered, reduced keeps cause steps, measured empty)", bad.length === 0, bad.slice(0, 6).join("; "));

const xs = M.BIG_WIN.map((t) => t.minX);
check("big-win ladder is 10 / 25 / 50 / 100 × stake", xs.join(",") === "10,25,50,100", xs.join(","));
const cu = [0.5, 5, 50, 100, 1000].map((x) => M.countUpMs(x));
check("countUpMs is log-scaled between countUpMin and countUpMax, rising with × bet", cu.every((v, i) => i === 0 || v >= cu[i - 1]) && cu[0] >= M.ms("countUpMin") && cu[3] === M.ms("countUpMax") && cu[4] === M.ms("countUpMax") && M.countUpMs(5, "turbo") < M.countUpMs(5), cu.join(", "));
check("every big-win tier holds its title 400-700 ms after a skip", [...M.BIG_WIN, M.MAX_WIN].every((t) => t.hold >= 400 && t.hold <= 700));
check("tierFor picks the highest reached tier", M.tierFor(9.99) === null && M.tierFor(10)?.key === "big" && M.tierFor(120)?.key === "legendary");

for (const [code, file] of [["vault", "client/main.js"], ["classic", "games/classic-5x3/client/game.js"], ["relicforge", "games/relicforge/client/game.js"], ["glasshouse", "games/glasshouse/client/game.js"]]) {
  check(`${file} reads LuminaMotion.game("${code}")`, read(file).includes(`LuminaMotion.game("${code}")`));
  let copy;
  try { copy = M.game(code); } catch { copy = null; }
  check(`LuminaMotion.game("${code}") returns its constants`, Boolean(copy && Object.keys(copy).length > 5));
}
for (const [page, src] of [["client/index.html", "shell/motion.js"], ["games/classic-5x3/client/index.html", "/play/shell/motion.js"], ["games/relicforge/client/index.html", "/play/shell/motion.js"], ["games/glasshouse/client/index.html", "/play/shell/motion.js"]]) {
  const html = read(page);
  const at = html.indexOf(`src="${src}`), game = Math.max(html.indexOf('src="main.js'), html.indexOf('src="game.js'));
  check(`${page} loads the motion table before the game script`, at > 0 && at < game);
}

console.log(`\nmotion-table: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
