(function (root) {
  "use strict";

  /**
   * One spin's cascade loop. Pure: the result depends only on ctx and the draws.
   *
   * Each step (docs/relic-forge/01-GDD.md §2.3-2.4):
   *   1. find the clusters on the board and pay them;
   *   2. detonate every special already on the board (combos when adjacent) and pay the
   *      cells they clear as clusters per symbol (5+);
   *   3. leave new specials from this step's big clusters (one RNG draw each);
   *   4. remove cleared cells (the new specials stay), gravity, refill.
   * The step pays (clusters + collected) × its Mult (mult.js: +inc per step, × burst on a
   * Line Burst). The loop ends when a board has no cluster and no special.
   *
   * ctx: { cols, rows, table, paytable, paying, wild, minCluster, maxSteps, specialBands,
   *        mult?: { start, inc, burst } (default 1, 1, 2) }
   * Pays are in bet multiples, before the profile's payout scaler.
   */
  function resolveSpin(ctx, rng) {
    const { Grid, Cluster, Cascade, Specials, Mult } = root.RelicForge;
    const multRule = ctx.mult || { start: 1, inc: 1, burst: 2 };
    let board = Grid.createBoard(ctx.cols, ctx.rows, ctx.table, rng);
    const initial = Grid.symbolsOf(board);
    const steps = [];
    let totalX = 0;
    let mult = null;
    let truncated = false;
    for (let i = 0; ; i += 1) {
      const found = Cluster.findClusters(board, { paying: ctx.paying, wild: ctx.wild, min: ctx.minCluster });
      const pending = Specials.listSpecials(board);
      if (!found.length && !pending.length) break;
      if (i >= ctx.maxSteps) {
        // A safety bound on an (astronomically unlikely) endless cascade; reported by
        // the simulator. Whatever is still on the board is not paid.
        truncated = true;
        break;
      }
      const clusters = found.map((c) => ({ symbol: c.symbol, size: c.size, wilds: c.wilds, cells: c.cells, pay_x: ctx.paytable.clusterPay(c.symbol, c.size) }));
      // A Wild shared by two clusters is removed once.
      const clusterCells = uniqueCells(clusters.flatMap((c) => c.cells));
      const detonation = pending.length ? Specials.detonateAll(board, ctx.paying) : { cleared: [], events: [] };
      const collected = pending.length ? Specials.collect(board, detonation.cleared, clusterCells, ctx.paying, ctx.minCluster, ctx.paytable) : [];
      const created = Specials.createSpecials(board, found, ctx.specialBands, ctx.wild, rng);
      const removed = uniqueCells(clusterCells.concat(detonation.cleared));
      const left = Specials.placeSpecials(Cascade.removeCells(board, removed), created);
      const fallen = Cascade.applyGravity(left);
      const filled = Cascade.refill(fallen.board, ctx.table, rng);
      board = filled.board;
      // Base × Mult: the step's Mult, doubled by a Line Burst (a full row cleared).
      const burstRows = Mult.fullRows(removed, ctx.rows, ctx.cols);
      mult = Mult.stepMult(mult, burstRows, multRule);
      const baseX = clusters.reduce((sum, c) => sum + c.pay_x, 0) + collected.reduce((sum, c) => sum + c.pay_x, 0);
      const stepX = baseX * mult;
      totalX += stepX;
      steps.push({
        clusters,
        detonations: detonation.events,
        collected,
        specials_created: created,
        base_x: baseX,
        mult,
        line_burst: burstRows,
        step_x: stepX,
        removed: uniqueCells(removed.filter((p) => !created.some((s) => s.row === p.row && s.col === p.col))),
        moves: fallen.moves,
        drops: filled.drops,
        board: Grid.symbolsOf(board),
        specials: Specials.listSpecials(board)
      });
    }
    // final_mult: the Mult the spin ended on (null = no step), which Surge carries over.
    return { initial, steps, total_x: totalX, final: Grid.symbolsOf(board), final_mult: mult, truncated };
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
