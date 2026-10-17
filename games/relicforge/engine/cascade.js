(function (root) {
  "use strict";

  /** The board with the given cells emptied (null). Returns a new board. */
  function removeCells(board, positions) {
    const next = root.RelicForge.Grid.cloneBoard(board);
    for (const p of positions) next[p.row][p.col] = null;
    return next;
  }

  /**
   * Gravity: in every column the remaining cells fall straight down, keeping their
   * order. Returns the new board and each moved cell's path (for the client).
   */
  function applyGravity(board) {
    const rows = board.length;
    const cols = rows ? board[0].length : 0;
    const next = board.map((line) => line.map(() => null));
    const moves = [];
    for (let col = 0; col < cols; col += 1) {
      let write = rows - 1;
      for (let row = rows - 1; row >= 0; row -= 1) {
        const cell = board[row][col];
        if (!cell) continue;
        next[write][col] = Object.assign({}, cell);
        if (write !== row) moves.push({ from: { row, col }, to: { row: write, col } });
        write -= 1;
      }
    }
    return { board: next, moves };
  }

  /**
   * Refill: every empty cell gets a fresh independent draw. Fixed draw order (part of
   * the replay contract): column by column from the left, each column from its lowest
   * empty cell upwards.
   */
  function refill(board, table, rng) {
    const next = root.RelicForge.Grid.cloneBoard(board);
    const drops = [];
    const rows = next.length;
    const cols = rows ? next[0].length : 0;
    for (let col = 0; col < cols; col += 1) {
      for (let row = rows - 1; row >= 0; row -= 1) {
        if (next[row][col]) continue;
        const s = root.RelicForge.Grid.drawSymbol(table, rng);
        next[row][col] = { s };
        drops.push({ row, col, s });
      }
    }
    return { board: next, drops };
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Cascade = { removeCells, applyGravity, refill };
})(typeof window !== "undefined" ? window : globalThis);
