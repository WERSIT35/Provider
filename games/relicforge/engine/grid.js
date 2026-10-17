(function (root) {
  "use strict";

  // The board: board[row][col], row 0 at the top. A cell is { s: SYMBOL } (phase 3 adds
  // specials as { s, sp }). Every cell is an independent weighted draw from a symbol
  // table: no reel strips, no stops, nothing placed or replaced after an outcome is
  // known (no engineered near-misses; docs/relic-forge/01-GDD.md §2.1).

  /** A symbol table: [{ symbol, weight }] → a cumulative table for drawing. */
  function makeTable(entries) {
    const symbols = [];
    const cumulative = [];
    let total = 0;
    for (const e of entries) {
      const w = Number(e.weight);
      if (!(w > 0)) continue;
      total += w;
      symbols.push(String(e.symbol));
      cumulative.push(total);
    }
    if (!symbols.length) throw new Error("RF_EMPTY_SYMBOL_TABLE");
    return { symbols, cumulative, total };
  }

  /** One weighted draw (one randomFloat per cell). */
  function drawSymbol(table, rng) {
    const r = rng.randomFloat() * table.total;
    for (let i = 0; i < table.cumulative.length; i += 1) {
      if (r < table.cumulative[i]) return table.symbols[i];
    }
    return table.symbols[table.symbols.length - 1];
  }

  /** A full board, drawn row by row from the top. */
  function createBoard(cols, rows, table, rng) {
    const board = [];
    for (let row = 0; row < rows; row += 1) {
      const line = [];
      for (let col = 0; col < cols; col += 1) line.push({ s: drawSymbol(table, rng) });
      board.push(line);
    }
    return board;
  }

  function cloneBoard(board) {
    return board.map((line) => line.map((cell) => (cell ? Object.assign({}, cell) : null)));
  }

  /** The board as symbol codes (payload and test convenience). */
  function symbolsOf(board) {
    return board.map((line) => line.map((cell) => (cell ? cell.s : null)));
  }

  /** A board from symbol codes (tests, replays). */
  function fromSymbols(rows) {
    return rows.map((line) => line.map((s) => (s === null ? null : { s })));
  }

  function countSymbol(board, symbol) {
    let n = 0;
    for (const line of board) for (const cell of line) if (cell && cell.s === symbol) n += 1;
    return n;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Grid = { makeTable, drawSymbol, createBoard, cloneBoard, symbolsOf, fromSymbols, countSymbol };
})(typeof window !== "undefined" ? window : globalThis);
