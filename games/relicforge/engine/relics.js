(function (root) {
  "use strict";

  // Relics, evolutions and Meltdown (docs/relic-forge/01-GDD.md §3.2-3.4). A relic's
  // level is 0 (not owned) to 3. Every number comes from rules.relics / rules.evolutions
  // (indexed by level - 1), so phase 7 tunes them without code changes.

  const RELICS = ["IGNITE", "CHAIN", "EXPAND", "MAGNET", "HOARD", "SURGE"];
  const MAX_LEVEL = 3;

  function emptyLevels() {
    const out = {};
    for (const r of RELICS) out[r] = 0;
    return out;
  }

  /** Evolutions newly earned: both source relics at Lv3, not evolved yet. In rules order. */
  function newEvolutions(levels, evolutions, rules) {
    const out = [];
    for (const [name, evo] of Object.entries(rules.evolutions)) {
      if (evolutions.indexOf(name) >= 0) continue;
      if (evo.from.every((r) => levels[r] >= MAX_LEVEL)) out.push(name);
    }
    return out;
  }

  /**
   * What a Forge spin plays with: the owned relics at their levels and the evolutions.
   * Meltdown (the last spin): every relic fires, an unowned one at Lv1 (GDD A3).
   */
  function effective(levels, evolutions, meltdown) {
    const lv = {};
    for (const r of RELICS) lv[r] = meltdown ? Math.max(1, levels[r] || 0) : levels[r] || 0;
    return { levels: lv, evolutions: evolutions.slice() };
  }

  /**
   * The spin config for a relic set. Pure; values from the rules.
   * → { wilds, wildMult, inc, rows, stickSpins, runeMin, removed, surge, burst,
   *     premiumOnly, persistAll }
   */
  function configFor(eff, rules, baseRows) {
    const R = rules.relics;
    const at = (relic, key) => {
      const level = eff.levels[relic];
      return level > 0 ? R[relic][key][level - 1] : undefined;
    };
    const evo = (name) => eff.evolutions.indexOf(name) >= 0;
    const removed = at("HOARD", "remove") || [];
    const cfg = {
      wilds: at("IGNITE", "wilds") || 0,
      wildMult: evo("INFERNO") ? rules.evolutions.INFERNO.wild_mult : 1,
      inc: at("CHAIN", "inc") || rules.mult.inc,
      rows: at("EXPAND", "rows") || baseRows,
      stickSpins: at("MAGNET", "stick_spins") || 0,
      runeMin: at("MAGNET", "rune_min") || rules.specials.RUNE.min,
      removed: removed.slice(),
      surge: eff.levels.SURGE || 0,
      carryBonus: at("SURGE", "carry_bonus") || 0,
      burst: at("SURGE", "burst") || rules.mult.line_burst,
      premiumOnly: false,
      persistAll: evo("SINGULARITY")
    };
    if (evo("CATHEDRAL")) {
      cfg.rows = rules.evolutions.CATHEDRAL.rows;
      cfg.premiumOnly = true;
    }
    return cfg;
  }

  /** The Forge's symbol weights for a config: Hoard removes lows; Cathedral all of them. */
  function weightsFor(cfg, rules) {
    const out = {};
    for (const [symbol, weight] of Object.entries(rules.weights.bonus)) {
      if (cfg.premiumOnly && rules.symbols.low.indexOf(symbol) >= 0) continue;
      if (cfg.removed.indexOf(symbol) >= 0) continue;
      out[symbol] = weight;
    }
    return out;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Relics = { RELICS, MAX_LEVEL, emptyLevels, newEvolutions, effective, configFor, weightsFor };
})(typeof window !== "undefined" ? window : globalThis);
