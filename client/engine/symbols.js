(function (root) {
  "use strict";

  const SCATTER_SYMBOL = "SCATTER";
  const MULTI_SYMBOL = "MULTI";

  function buildSymbolTables(rules) {
    const symbolPayouts = new Map();
    const scatterPayouts = {};
    const regularSymbols = [];
    const symbolWeights = new Map();
    const entries = rules.symbol_payout_display?.symbols || [];
    for (const entry of entries) {
      const code = String(entry.symbol || "").toUpperCase().replace(/\s+/g, "_");
      if (!code) continue;
      if (code === SCATTER_SYMBOL) {
        Object.assign(scatterPayouts, entry.payouts || {});
        continue;
      }
      regularSymbols.push(code);
      symbolPayouts.set(code, entry.payouts || {});
    }
    for (const symbol of regularSymbols) {
      let w = 1;
      if (symbol.includes("TOP_CROWN")) w = 0.35;
      else if (symbol.includes("HOURGLASS")) w = 0.42;
      else if (symbol.includes("RING")) w = 0.52;
      else if (symbol.includes("CHALICE")) w = 0.62;
      else if (symbol.includes("RED_GEM")) w = 0.72;
      else if (symbol.includes("PURPLE_TRIANGLE")) w = 0.82;
      else if (symbol.includes("YELLOW_HEX")) w = 0.9;
      else if (symbol.includes("GREEN_TRIANGLE")) w = 0.95;
      else if (symbol.includes("BLUE_DIAMOND")) w = 1.0;
      symbolWeights.set(symbol, w);
    }
    return { symbolPayouts, scatterPayouts, regularSymbols, symbolWeights };
  }

  function weightedRegularSymbol(tables) {
    const { regularSymbols, symbolWeights } = tables;
    const { weightedPick } = root.SlotEngine.RNG;
    return weightedPick(regularSymbols, (s) => symbolWeights.get(s) || 1);
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Symbols = {
    SCATTER_SYMBOL,
    MULTI_SYMBOL,
    buildSymbolTables,
    weightedRegularSymbol
  };
})(typeof window !== "undefined" ? window : globalThis);
