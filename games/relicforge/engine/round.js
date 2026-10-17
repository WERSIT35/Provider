(function (root) {
  "use strict";

  /**
   * One base spin's cascade loop (phase 2: clusters, gravity, refill; specials, Mult and
   * the meter join in phases 3-5). Pure: the result depends only on ctx and the draws.
   *
   * ctx: { cols, rows, table, paytable, paying, wild, minCluster, maxSteps }
   * → { initial, steps: [{ clusters, step_x, removed, moves, drops, board }], total_x, final }
   * Pays are in bet multiples, before the profile's payout scaler.
   */
  function resolveSpin(ctx, rng) {
    const { Grid, Cluster, Cascade } = root.RelicForge;
    let board = Grid.createBoard(ctx.cols, ctx.rows, ctx.table, rng);
    const initial = Grid.symbolsOf(board);
    const steps = [];
    let totalX = 0;
    let truncated = false;
    for (let i = 0; ; i += 1) {
      const found = Cluster.findClusters(board, { paying: ctx.paying, wild: ctx.wild, min: ctx.minCluster });
      if (!found.length) break;
      if (i >= ctx.maxSteps) {
        // A safety bound on an (astronomically unlikely) endless cascade; reported by
        // the simulator. The clusters still on the board are not paid.
        truncated = true;
        break;
      }
      const clusters = found.map((c) => ({ symbol: c.symbol, size: c.size, wilds: c.wilds, cells: c.cells, pay_x: ctx.paytable.clusterPay(c.symbol, c.size) }));
      const stepX = clusters.reduce((sum, c) => sum + c.pay_x, 0);
      // A Wild shared by two clusters is removed once.
      const removed = uniqueCells(clusters.flatMap((c) => c.cells));
      const fallen = Cascade.applyGravity(Cascade.removeCells(board, removed));
      const filled = Cascade.refill(fallen.board, ctx.table, rng);
      board = filled.board;
      totalX += stepX;
      steps.push({ clusters, step_x: stepX, removed, moves: fallen.moves, drops: filled.drops, board: Grid.symbolsOf(board) });
    }
    return { initial, steps, total_x: totalX, final: Grid.symbolsOf(board), truncated };
  }

  function uniqueCells(cells) {
    const seen = new Set();
    const out = [];
    for (const c of cells) {
      const k = c.row * 64 + c.col;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ row: c.row, col: c.col });
    }
    return out.sort((a, b) => a.row - b.row || a.col - b.col);
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Round = { resolveSpin, uniqueCells };
})(typeof window !== "undefined" ? window : globalThis);
