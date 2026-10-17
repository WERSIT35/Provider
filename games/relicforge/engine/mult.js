(function (root) {
  "use strict";

  // Base × Mult (docs/relic-forge/01-GDD.md §2.5). Mult starts at `start` (×1 in the
  // base game) on the spin's first evaluation, and every later cascade step adds `inc`
  // (+1; the Chain relic raises it). A step that clears at least one full row is a Line
  // Burst: the running Mult is multiplied by `burst` (×2; Surge Lv3 makes it ×3) from
  // that step on, once per step however many rows it clears. An optional ceiling (`max`)
  // bounds runaway chains (a phase-7 tuning lever; none by default).

  /** The Mult a step pays at, given the previous step's (null on the first step). */
  function stepMult(prev, burstRows, rule) {
    let mult = prev === null ? rule.start : prev + rule.inc;
    if (burstRows.length) mult *= rule.burst;
    return rule.max ? Math.min(mult, rule.max) : mult;
  }

  /** Rows whose every cell is in `cleared` (the Line Bursts of a step). */
  function fullRows(cleared, rows, cols) {
    const perRow = new Array(rows).fill(0);
    for (const p of cleared) perRow[p.row] += 1;
    const out = [];
    for (let r = 0; r < rows; r += 1) if (perRow[r] === cols) out.push(r);
    return out;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Mult = { stepMult, fullRows };
})(typeof window !== "undefined" ? window : globalThis);
