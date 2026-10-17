(function (root) {
  "use strict";

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /**
   * Cluster detection: a cluster is `min`+ orthogonally connected cells of one paying
   * symbol, where Wilds join any cluster. Found per paying symbol by flood fill over
   * cells of that symbol or Wild; a component counts only if it holds at least one real
   * symbol cell (a group of Wilds alone pays nothing). A Wild may belong to clusters of
   * different symbols (it substitutes for each). Clusters come out in a fixed order (by
   * their first cell, row-major), so results never depend on Map or Set ordering.
   *
   * opts: { paying: string[], wild: string, min: number }
   * → [{ symbol, size, wilds, cells: [{ row, col }] }]
   */
  function findClusters(board, opts) {
    const rows = board.length;
    const cols = rows ? board[0].length : 0;
    const wild = opts.wild;
    const min = Number(opts.min);
    const out = [];
    for (const symbol of opts.paying) {
      const seen = new Uint8Array(rows * cols);
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const cell = board[row][col];
          if (!cell || cell.s !== symbol || seen[row * cols + col]) continue;
          const cells = [];
          let wilds = 0;
          const stack = [[row, col]];
          seen[row * cols + col] = 1;
          while (stack.length) {
            const [r, c] = stack.pop();
            cells.push({ row: r, col: c });
            if (board[r][c].s === wild) wilds += 1;
            for (const [dr, dc] of DIRS) {
              const nr = r + dr;
              const nc = c + dc;
              if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || seen[nr * cols + nc]) continue;
              const n = board[nr][nc];
              if (!n || (n.s !== symbol && n.s !== wild)) continue;
              seen[nr * cols + nc] = 1;
              stack.push([nr, nc]);
            }
          }
          if (cells.length >= min) {
            cells.sort((a, b) => a.row - b.row || a.col - b.col);
            out.push({ symbol, size: cells.length, wilds, cells });
          }
        }
      }
    }
    return out.sort((a, b) => a.cells[0].row - b.cells[0].row || a.cells[0].col - b.cells[0].col || opts.paying.indexOf(a.symbol) - opts.paying.indexOf(b.symbol));
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Cluster = { findClusters };
})(typeof window !== "undefined" ? window : globalThis);
