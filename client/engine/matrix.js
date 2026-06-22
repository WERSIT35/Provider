(function (root) {
  "use strict";

  function makeMatrixContext({ rules, tables, multiplierValues, multiplierWeights }) {
    const { SCATTER_SYMBOL, MULTI_SYMBOL, weightedRegularSymbol } = root.SlotEngine.Symbols;
    const { randomMultiplierValue } = root.SlotEngine.Multipliers;
    const { randomFloat, randomInt, nextMultiplierId } = root.SlotEngine.RNG;

    const LAYOUT_REELS = Number(rules.layout?.reels || 6);
    const LAYOUT_ROWS = Number(rules.layout?.rows || 5);

    function createSymbolCellWithRates(scatterChance, multiChance) {
      const roll = randomFloat();
      if (roll < scatterChance) return { symbol: SCATTER_SYMBOL };
      if (roll < scatterChance + multiChance) {
        return {
          symbol: MULTI_SYMBOL,
          multiplier: randomMultiplierValue(multiplierValues, multiplierWeights),
          multiplier_id: nextMultiplierId()
        };
      }
      return { symbol: weightedRegularSymbol(tables) };
    }

    function createMatrixWithMetaRates(scatterChance, multiChance) {
      const matrix = Array.from({ length: LAYOUT_ROWS }, () => Array(LAYOUT_REELS).fill(null));
      const multipliers = [];
      for (let row = 0; row < LAYOUT_ROWS; row += 1) {
        for (let col = 0; col < LAYOUT_REELS; col += 1) {
          const cell = createSymbolCellWithRates(scatterChance, multiChance);
          matrix[row][col] = cell.symbol;
          if (cell.symbol === MULTI_SYMBOL) {
            multipliers.push({ row, col, value: cell.multiplier, id: cell.multiplier_id || nextMultiplierId() });
          }
        }
      }
      return { matrix, multipliers };
    }

    function sanitizeMultipliersForMatrix(matrix, multipliers) {
      const byPos = new Map();
      if (Array.isArray(multipliers)) {
        for (const entry of multipliers) {
          if (!Number.isInteger(entry?.row) || !Number.isInteger(entry?.col)) continue;
          const value = Number(entry?.value);
          if (!Number.isFinite(value) || value <= 0) continue;
          const id = typeof entry?.id === "string" && entry.id ? entry.id : nextMultiplierId();
          byPos.set(`${entry.row}-${entry.col}`, { value, id });
        }
      }
      const sanitized = [];
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          if (matrix[row][col] !== MULTI_SYMBOL) continue;
          const existing = byPos.get(`${row}-${col}`);
          sanitized.push({
            row,
            col,
            value: Number.isFinite(existing?.value) && existing.value > 0
              ? existing.value
              : randomMultiplierValue(multiplierValues, multiplierWeights),
            id: existing?.id || nextMultiplierId()
          });
        }
      }
      return sanitized;
    }

    function forceScatterTrigger(matrix, requiredCount) {
      const next = matrix.map((row) => row.slice());
      let current = countSymbol(next, SCATTER_SYMBOL);
      let attempts = 0;
      while (current < requiredCount && attempts < 2000) {
        attempts += 1;
        const row = randomInt(LAYOUT_ROWS);
        const col = randomInt(LAYOUT_REELS);
        if (next[row][col] === SCATTER_SYMBOL) continue;
        next[row][col] = SCATTER_SYMBOL;
        current += 1;
      }
      return next;
    }

    function injectForcedMultiplier(matrix, multipliers, forcedValue) {
      const value = Number(forcedValue);
      if (!Number.isFinite(value) || !multiplierValues.includes(value)) {
        return { matrix, multipliers };
      }
      const nextMatrix = matrix.map((row) => row.slice());
      const nextMultipliers = sanitizeMultipliersForMatrix(nextMatrix, multipliers);
      const row = randomInt(LAYOUT_ROWS);
      const col = randomInt(LAYOUT_REELS);
      nextMatrix[row][col] = MULTI_SYMBOL;
      const byPos = new Map(nextMultipliers.map((m) => [`${m.row}-${m.col}`, m]));
      byPos.set(`${row}-${col}`, { row, col, value, id: nextMultiplierId() });
      return { matrix: nextMatrix, multipliers: Array.from(byPos.values()) };
    }

    function applyCrazyClustering(matrix, plan) {
      // Stamp a wall of ONE premium symbol onto the board so a crazy spin
      // visibly screams "huge win incoming". Picks the target via the (crazy)
      // weighted table, which favors high-value symbols, then floods a random
      // batch of regular cells with it. Never touches SCATTER/MULTI cells so
      // free-spin and multiplier logic is unaffected.
      if (!plan) return matrix;
      if (randomFloat() >= Number(plan.probability || 0)) return matrix;
      const next = matrix.map((row) => row.slice());
      const target = weightedRegularSymbol(tables);
      const minCells = Math.max(1, Number(plan.minCells || 1));
      const maxCells = Math.max(minCells, Number(plan.maxCells || minCells));
      const want = minCells + randomInt(maxCells - minCells + 1);
      const total = LAYOUT_ROWS * LAYOUT_REELS;
      let converted = 0;
      let attempts = 0;
      while (converted < want && attempts < total * 5) {
        attempts += 1;
        const row = randomInt(LAYOUT_ROWS);
        const col = randomInt(LAYOUT_REELS);
        const cell = next[row][col];
        if (cell === SCATTER_SYMBOL || cell === MULTI_SYMBOL || cell === target) continue;
        next[row][col] = target;
        converted += 1;
      }
      return next;
    }

    function countSymbol(matrix, symbol) {
      let count = 0;
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          if (matrix[row][col] === symbol) count += 1;
        }
      }
      return count;
    }

    function toPublicMultipliers(multipliers) {
      return (multipliers || []).map((m) => ({
        row: Number(m.row),
        col: Number(m.col),
        value: Number(m.value),
        id: String(m.id || "")
      }));
    }

    return {
      LAYOUT_REELS,
      LAYOUT_ROWS,
      createSymbolCellWithRates,
      createMatrixWithMetaRates,
      sanitizeMultipliersForMatrix,
      forceScatterTrigger,
      injectForcedMultiplier,
      applyCrazyClustering,
      countSymbol,
      toPublicMultipliers
    };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Matrix = { makeMatrixContext };
})(typeof window !== "undefined" ? window : globalThis);
