(function (root) {
  "use strict";

  // Equal-EV drafts (docs/relic-forge/02-tech-plan.md §4). Every pick sets a Relic bonus
  // factor k(state, relic) ≥ 1, chosen offline (tools: backward induction + Monte Carlo)
  // so that all options of any offer have the same expected value for the rest of the
  // Forge. The Forge's running Relic bonus is the product of its picks' factors and
  // multiplies every Forge spin's pay.
  //
  // The table lives in rules.ev_table, so it is covered by rules_hash and replayed with
  // the round: { version, factors: { "<signature>><RELIC>": k }, volatility: {...} }.
  // A state the table does not list has factor 1 (the draft before phase 7's table).

  /** The draft-visible state: relic levels (fixed order), evolutions, spins left. */
  function signature(levels, evolutions, spinsLeft) {
    const { RELICS } = root.RelicForge.Relics;
    const lv = RELICS.map((r) => r[0] + (levels[r] || 0)).join("");
    const evo = evolutions.length ? evolutions.slice().sort().map((e) => e.slice(0, 3)).join("+") : "-";
    return `${lv}|${evo}|${spinsLeft}`;
  }

  function factor(table, sig, relic) {
    const k = table && table.factors ? Number(table.factors[`${sig}>${relic}`]) : NaN;
    return Number.isFinite(k) && k > 0 ? k : 1;
  }

  /** "low" | "medium" | "high" for an option, or null when the table has no rating. */
  function volatility(table, sig, relic) {
    const v = table && table.volatility ? table.volatility[`${sig}>${relic}`] : undefined;
    return typeof v === "string" ? v : null;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.EvTable = { signature, factor, volatility };
})(typeof window !== "undefined" ? window : globalThis);
