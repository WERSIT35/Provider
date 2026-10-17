(function (root) {
  "use strict";

  // Base × Mult (docs/relic-forge/01-GDD.md §2.5). Mult starts at `start` (×1 in the
  // base game) on the spin's first evaluation, and every later cascade step adds `inc`
  // (+1; the Chain relic raises it). A step that clears at least one full row is a Line
  // Burst: the Mult is multiplied by `burst` (×2; Surge Lv3 makes it ×3), once per step
  // however many rows it clears.
  //
  // `scope` decides what a Line Burst multiplies (GDD assumption A4):
  //   "running" (default): the running Mult, so it carries into later steps;
  //   "step": only that step's pay; the running Mult goes on from where it was.
  // An optional ceiling `max` bounds the Mult (0 = none). Both are tuning levers: in the
  // Forge a long cascade with repeated running bursts compounds the Mult very fast.

  /**
   * The next step's Mult given the previous step's running Mult (null on the first
   * step): { running, pay }. The step pays at `pay`; the next step builds on `running`.
   */
  function stepMult(prev, burstRows, rule) {
    const cap = (m) => (rule.max ? Math.min(m, rule.max) : m);
    const base = prev === null ? rule.start : prev + rule.inc;
    if (!burstRows.length) return { running: cap(base), pay: cap(base) };
    if (rule.scope === "step") return { running: cap(base), pay: cap(base * rule.burst) };
    const burst = cap(base * rule.burst);
    return { running: burst, pay: burst };
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
