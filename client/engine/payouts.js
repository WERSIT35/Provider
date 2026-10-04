(function (root) {
  "use strict";

  function makePayouts({ rules, tables, matrixCtx }) {
    const MIN_MATCH_COUNT = Number(rules.layout?.min_match_count || 8);
    const MAX_MATCH_COUNT = 30;
    const { regularSymbols, symbolPayouts, scatterPayouts } = tables;
    const { countSymbol } = matrixCtx;

    function payoutByCount(payoutMap, count) {
      if (count >= 12) return Number(payoutMap["12-30"] || 0);
      if (count >= 10) return Number(payoutMap["10-11"] || 0);
      if (count >= 8) return Number(payoutMap["8-9"] || 0);
      return 0;
    }

    // Scatter tiers are lower bounds: a count pays the highest tier it reaches, so the
    // top tier ("6") also pays 7+ scatters. An exact-key lookup paid 0 for 7+.
    const scatterTiers = Object.keys(scatterPayouts)
      .map(Number)
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);
    function scatterPayoutByCount(count) {
      const tier = scatterTiers.find((t) => count >= t);
      return tier === undefined ? 0 : Number(scatterPayouts[String(tier)] || 0);
    }

    function evaluateWaysWin(matrix, betAmount) {
      const wins = [];
      let total = 0;
      const winningSymbols = new Set();
      for (const symbol of regularSymbols) {
        const count = countSymbol(matrix, symbol);
        if (count < MIN_MATCH_COUNT) continue;
        const payout = payoutByCount(symbolPayouts.get(symbol) || {}, Math.min(count, MAX_MATCH_COUNT));
        if (payout <= 0) continue;
        const amount = Number((payout * betAmount).toFixed(2));
        total += amount;
        winningSymbols.add(symbol);
        wins.push({ symbol, count, payout, amount });
      }
      const positions = [];
      for (let row = 0; row < matrix.length; row += 1) {
        for (let col = 0; col < matrix[row].length; col += 1) {
          if (winningSymbols.has(matrix[row][col])) positions.push({ row, col });
        }
      }
      return {
        wins,
        winning_symbols: Array.from(winningSymbols),
        winning_positions: positions,
        total: Number(total.toFixed(2))
      };
    }

    return {
      MIN_MATCH_COUNT,
      MAX_MATCH_COUNT,
      payoutByCount,
      scatterPayoutByCount,
      evaluateWaysWin
    };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Payouts = { makePayouts };
})(typeof window !== "undefined" ? window : globalThis);
