(function (root) {
  "use strict";

  const DEFAULT_PROBABILITY = 0.18;
  const DEFAULT_WEIGHTS = {
    one_short_cluster: 0.45,
    two_short_cluster: 0.30,
    scatter_one_short: 0.20,
    tease_multiplier: 0.05
  };

  function pickPattern(weights) {
    const { randomFloat } = root.SlotEngine.RNG;
    const entries = Object.entries(weights);
    const total = entries.reduce((s, [, w]) => s + Number(w || 0), 0);
    if (total <= 0) return null;
    let r = randomFloat() * total;
    for (const [name, w] of entries) {
      r -= Number(w || 0);
      if (r <= 0) return name;
    }
    return entries[entries.length - 1][0];
  }

  function makeNearMiss({ rules, matrixCtx, payoutsCtx, tables }) {
    const featureCfg = rules.features?.near_miss || {};
    const probability = Number(featureCfg.probability ?? DEFAULT_PROBABILITY);
    const weights = featureCfg.pattern_weights || DEFAULT_WEIGHTS;
    const FREE_SPINS_TRIGGER = Number(rules.features?.free_spins?.base_trigger_scatter_count || 4);
    const MIN_MATCH = payoutsCtx.MIN_MATCH_COUNT;
    const { SCATTER_SYMBOL, MULTI_SYMBOL } = root.SlotEngine.Symbols;
    const { countSymbol, LAYOUT_REELS, LAYOUT_ROWS } = matrixCtx;
    const { randomFloat, randomInt, nextMultiplierId, weightedPick } = root.SlotEngine.RNG;
    const { randomMultiplierValue } = root.SlotEngine.Multipliers;
    const stats = { eligible: 0, mutated: 0, patternCounts: {} };

    function countsByRegular(matrix) {
      const counts = new Map();
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          const sym = matrix[row][col];
          if (!sym || sym === SCATTER_SYMBOL || sym === MULTI_SYMBOL) continue;
          counts.set(sym, (counts.get(sym) || 0) + 1);
        }
      }
      return counts;
    }

    function lowestWeightRegularCell(matrix, excludeSymbol) {
      const { symbolWeights } = tables;
      let pick = null;
      let pickWeight = Infinity;
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          const sym = matrix[row][col];
          if (!sym || sym === SCATTER_SYMBOL || sym === MULTI_SYMBOL) continue;
          if (sym === excludeSymbol) continue;
          const w = Number(symbolWeights.get(sym) || 1);
          if (w < pickWeight) { pickWeight = w; pick = { row, col, symbol: sym }; }
        }
      }
      return pick;
    }

    function applyOneShort(matrix) {
      const counts = countsByRegular(matrix);
      let bestSymbol = null; let bestCount = 0;
      for (const [s, c] of counts) {
        if (c === MIN_MATCH - 1 && c > bestCount) { bestSymbol = s; bestCount = c; }
      }
      if (!bestSymbol) return null;
      return { matrix, near_miss: { pattern: "one_short_cluster", symbol: bestSymbol, count: bestCount } };
    }

    function applyTwoShort(matrix) {
      const counts = countsByRegular(matrix);
      let bestSymbol = null; let bestCount = 0;
      for (const [s, c] of counts) {
        if ((c === 4 || c === 5) && c > bestCount) { bestSymbol = s; bestCount = c; }
      }
      if (!bestSymbol) return null;
      const need = (MIN_MATCH - 2) - bestCount;
      if (need <= 0) {
        return { matrix, near_miss: { pattern: "two_short_cluster", symbol: bestSymbol, count: bestCount } };
      }
      const next = matrix.map((row) => row.slice());
      let added = 0;
      let attempts = 0;
      while (added < need && attempts < 200) {
        attempts += 1;
        const target = lowestWeightRegularCell(next, bestSymbol);
        if (!target) break;
        next[target.row][target.col] = bestSymbol;
        added += 1;
      }
      const finalCount = countSymbol(next, bestSymbol);
      if (finalCount >= MIN_MATCH) return null;
      return { matrix: next, near_miss: { pattern: "two_short_cluster", symbol: bestSymbol, count: finalCount } };
    }

    function applyScatterOneShort(matrix) {
      const current = countSymbol(matrix, SCATTER_SYMBOL);
      const target = FREE_SPINS_TRIGGER - 1;
      if (current >= target) {
        return { matrix, near_miss: { pattern: "scatter_one_short", symbol: SCATTER_SYMBOL, count: current } };
      }
      const next = matrix.map((row) => row.slice());
      let placed = current;
      let attempts = 0;
      while (placed < target && attempts < 500) {
        attempts += 1;
        const row = randomInt(LAYOUT_ROWS);
        const col = randomInt(LAYOUT_REELS);
        const sym = next[row][col];
        if (sym === SCATTER_SYMBOL || sym === MULTI_SYMBOL) continue;
        next[row][col] = SCATTER_SYMBOL;
        placed += 1;
      }
      const finalCount = countSymbol(next, SCATTER_SYMBOL);
      if (finalCount >= FREE_SPINS_TRIGGER) return null;
      return { matrix: next, near_miss: { pattern: "scatter_one_short", symbol: SCATTER_SYMBOL, count: finalCount } };
    }

    function applyTeaseMultiplier(matrix, existingMultipliers, multiplierValues) {
      if ((existingMultipliers || []).length > 0) return null;
      const lowTier = multiplierValues.filter((v) => v <= 4);
      if (lowTier.length === 0) return null;
      const next = matrix.map((row) => row.slice());
      const candidates = [];
      for (let row = 0; row < next.length; row += 1) {
        for (let col = 0; col < next[row].length; col += 1) {
          const sym = next[row][col];
          if (!sym || sym === SCATTER_SYMBOL || sym === MULTI_SYMBOL) continue;
          let safe = true;
          for (let r2 = 0; r2 < next.length; r2 += 1) {
            if (r2 === row) continue;
            if (next[r2][col] === sym) { safe = false; break; }
          }
          if (safe) candidates.push({ row, col });
        }
      }
      if (candidates.length === 0) return null;
      const pick = candidates[randomInt(candidates.length)];
      const value = lowTier[randomInt(lowTier.length)];
      next[pick.row][pick.col] = MULTI_SYMBOL;
      const newMultiplier = { row: pick.row, col: pick.col, value, id: nextMultiplierId() };
      return {
        matrix: next,
        multipliers: [newMultiplier],
        near_miss: { pattern: "tease_multiplier", symbol: MULTI_SYMBOL, count: 1, value }
      };
    }

    function maybeMutate({ matrix, multipliers, scatterPeak, isFreeSpin, crazyMode, betAmount, multiplierValues, payouts }) {
      if (isFreeSpin || crazyMode) return null;
      const ways = payouts.evaluateWaysWin(matrix, betAmount);
      if (ways.total > 0) return null;
      if (scatterPeak >= FREE_SPINS_TRIGGER) return null;
      stats.eligible += 1;
      if (randomFloat() >= probability) return null;
      const pattern = pickPattern(weights);
      let result = null;
      if (pattern === "one_short_cluster") result = applyOneShort(matrix);
      else if (pattern === "two_short_cluster") result = applyTwoShort(matrix);
      else if (pattern === "scatter_one_short") result = applyScatterOneShort(matrix);
      else if (pattern === "tease_multiplier") result = applyTeaseMultiplier(matrix, multipliers, multiplierValues);
      if (!result) return null;
      stats.mutated += 1;
      stats.patternCounts[pattern] = (stats.patternCounts[pattern] || 0) + 1;
      return result;
    }

    function getStats() { return { ...stats, patternCounts: { ...stats.patternCounts } }; }
    function resetStats() { stats.eligible = 0; stats.mutated = 0; stats.patternCounts = {}; }

    return { maybeMutate, getStats, resetStats, probability, weights };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.NearMiss = { makeNearMiss, DEFAULT_PROBABILITY, DEFAULT_WEIGHTS };
})(typeof window !== "undefined" ? window : globalThis);
