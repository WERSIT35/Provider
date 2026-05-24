(function (root) {
  "use strict";

  function makeTumble({ matrixCtx, multiplierValues, multiplierWeights }) {
    const { MULTI_SYMBOL } = root.SlotEngine.Symbols;
    const { randomMultiplierValue } = root.SlotEngine.Multipliers;
    const { nextMultiplierId } = root.SlotEngine.RNG;
    const { LAYOUT_REELS, LAYOUT_ROWS, sanitizeMultipliersForMatrix, createSymbolCellWithRates } = matrixCtx;

    function applyTumble(matrix, existingMultipliers, winningPositions, scatterChance, multiChance) {
      const next = matrix.map((row) => row.slice());
      const removeSet = new Set(winningPositions.map((p) => `${p.row}-${p.col}`));
      const multiplierByPos = new Map();
      for (const entry of sanitizeMultipliersForMatrix(matrix, existingMultipliers)) {
        multiplierByPos.set(`${entry.row}-${entry.col}`, {
          value: Number(entry.value),
          id: entry.id || nextMultiplierId()
        });
      }

      for (let row = 0; row < next.length; row += 1) {
        for (let col = 0; col < next[row].length; col += 1) {
          if (removeSet.has(`${row}-${col}`)) next[row][col] = null;
        }
      }

      const multipliers = [];
      for (let col = 0; col < LAYOUT_REELS; col += 1) {
        const kept = [];
        for (let row = LAYOUT_ROWS - 1; row >= 0; row -= 1) {
          if (next[row][col] !== null) {
            const symbol = next[row][col];
            const multiplier = symbol === MULTI_SYMBOL ? multiplierByPos.get(`${row}-${col}`) : null;
            kept.push({ symbol, multiplier });
          }
        }

        let writeRow = LAYOUT_ROWS - 1;
        for (let i = 0; i < kept.length; i += 1) {
          next[writeRow][col] = kept[i].symbol;
          if (kept[i].symbol === MULTI_SYMBOL) {
            multipliers.push({
              row: writeRow,
              col,
              value: Number.isFinite(kept[i].multiplier?.value) && kept[i].multiplier.value > 0
                ? Number(kept[i].multiplier.value)
                : randomMultiplierValue(multiplierValues, multiplierWeights),
              id: kept[i].multiplier?.id || nextMultiplierId()
            });
          }
          writeRow -= 1;
        }
        while (writeRow >= 0) {
          const cell = createSymbolCellWithRates(scatterChance, multiChance);
          next[writeRow][col] = cell.symbol;
          if (cell.symbol === MULTI_SYMBOL) {
            multipliers.push({
              row: writeRow,
              col,
              value: cell.multiplier,
              id: cell.multiplier_id || nextMultiplierId()
            });
          }
          writeRow -= 1;
        }
      }

      return { matrix: next, multipliers };
    }

    return { applyTumble };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Tumble = { makeTumble };
})(typeof window !== "undefined" ? window : globalThis);
