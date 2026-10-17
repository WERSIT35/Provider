(function (root) {
  "use strict";

  // Specials (docs/relic-forge/01-GDD.md §2.4). A winning cluster of 7-8 leaves a Rune,
  // 9-11 a Bomb, 12+ a Prism, on one of its cells chosen by the RNG. Rune and Bomb keep
  // their symbol (they still count towards that symbol's clusters); a Prism has none
  // (its cell symbol is PRISM, which never clusters). Every special on the board
  // detonates in the next cascade step; orthogonally adjacent specials fuse into a combo.

  const PRISM = "PRISM";
  const DIRS = [[-1, 0], [0, -1], [0, 1], [1, 0]]; // neighbour scan order: up, left, right, down

  /** The special a cluster of `size` leaves (null below the smallest band). */
  function kindForSize(bands, size) {
    for (const kind of ["PRISM", "BOMB", "RUNE"]) {
      const b = bands[kind];
      if (b && size >= b.min && (b.max === undefined || size <= b.max)) return kind;
    }
    return null;
  }

  /**
   * One special per qualifying cluster, at an RNG-chosen cell of that cluster (Wilds and
   * cells already holding a special are not eligible). Clusters in their fixed order,
   * one randomInt each, so the draw sequence is part of the replay contract.
   */
  function createSpecials(board, clusters, bands, wild, rng) {
    const out = [];
    const taken = new Set();
    for (const c of clusters) {
      const kind = kindForSize(bands, c.size);
      if (!kind) continue;
      const eligible = c.cells.filter((p) => {
        const cell = board[p.row][p.col];
        return cell && cell.s !== wild && !cell.sp && !taken.has(p.row * 64 + p.col);
      });
      if (!eligible.length) continue;
      const at = eligible[rng.randomInt(eligible.length)];
      taken.add(at.row * 64 + at.col);
      out.push({ row: at.row, col: at.col, kind, symbol: kind === "PRISM" ? PRISM : c.symbol });
    }
    return out;
  }

  /** Put created specials on a board (after the step's removal): returns a new board. */
  function placeSpecials(board, created) {
    const next = root.RelicForge.Grid.cloneBoard(board);
    for (const sp of created) next[sp.row][sp.col] = { s: sp.symbol, sp: sp.kind };
    return next;
  }

  /** Every special on the board, row-major. */
  function listSpecials(board) {
    const out = [];
    for (let row = 0; row < board.length; row += 1) {
      for (let col = 0; col < board[row].length; col += 1) {
        const cell = board[row][col];
        if (cell && cell.sp) out.push({ row, col, kind: cell.sp, symbol: cell.s });
      }
    }
    return out;
  }

  /**
   * A Prism's target: the paying symbol with the most cells on the board at that moment;
   * a tie goes to the higher-paying symbol (later in `paying`, which runs low to
   * premium). No RNG and no player input. null when no paying symbol is left.
   */
  function prismTarget(board, paying) {
    let best = null;
    let bestN = 0;
    for (const symbol of paying) {
      const n = root.RelicForge.Grid.countSymbol(board, symbol);
      if (n > 0 && n >= bestN) {
        best = symbol;
        bestN = n;
      }
    }
    return best;
  }

  function inBounds(rows, cols, r, c) {
    return r >= 0 && r < rows && c >= 0 && c < cols;
  }

  function lines(rows, cols, rowList, colList) {
    const cells = [];
    for (const r of rowList) if (r >= 0 && r < rows) for (let c = 0; c < cols; c += 1) cells.push({ row: r, col: c });
    for (const c of colList) if (c >= 0 && c < cols) for (let r = 0; r < rows; r += 1) cells.push({ row: r, col: c });
    return cells;
  }

  function square(rows, cols, center, radius) {
    const cells = [];
    for (let r = center.row - radius; r <= center.row + radius; r += 1) {
      for (let c = center.col - radius; c <= center.col + radius; c += 1) if (inBounds(rows, cols, r, c)) cells.push({ row: r, col: c });
    }
    return cells;
  }

  /** The cells one special clears on its own. */
  function area(kind, at, board, paying) {
    const rows = board.length;
    const cols = board[0].length;
    if (kind === "RUNE") return lines(rows, cols, [at.row], [at.col]);
    if (kind === "BOMB") return square(rows, cols, at, 1);
    const target = prismTarget(board, paying);
    const cells = [{ row: at.row, col: at.col }];
    if (!target) return cells;
    for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) if (board[r][c] && board[r][c].s === target) cells.push({ row: r, col: c });
    return cells;
  }

  /** Every cell of `target` acting as a `kind` special (Prism + Rune / Bomb). */
  function transformArea(kind, target, board) {
    const cells = [];
    if (!target) return cells;
    for (let r = 0; r < board.length; r += 1) {
      for (let c = 0; c < board[r].length; c += 1) {
        if (board[r][c] && board[r][c].s === target) cells.push(...area(kind, { row: r, col: c }, board, []));
      }
    }
    return cells;
  }

  /** Which combo two adjacent specials make (a is first in row-major order). */
  function comboOf(a, b) {
    if (a.kind === "PRISM" && b.kind === "PRISM") return { name: "PRISM_PRISM" };
    if (a.kind === "PRISM" || b.kind === "PRISM") {
      const other = a.kind === "PRISM" ? b.kind : a.kind;
      return { name: "PRISM_" + other, into: other };
    }
    if (a.kind === "RUNE" && b.kind === "RUNE") return { name: "RUNE_RUNE" };
    if (a.kind === "BOMB" && b.kind === "BOMB") return { name: "BOMB_BOMB" };
    return { name: "RUNE_BOMB", center: a.kind === "BOMB" ? a : b };
  }

  /**
   * Detonate every special on the board. Specials are taken row-major; each one not yet
   * used fuses with its first unused orthogonal neighbour special (scan: up, left, right,
   * down), else fires alone. Returns the cleared cells (deduplicated, row-major) and one
   * event per detonation for the client.
   */
  function detonateAll(board, paying) {
    const rows = board.length;
    const cols = board[0].length;
    const specials = listSpecials(board);
    const key = (p) => p.row * 64 + p.col;
    const byKey = new Map(specials.map((s) => [key(s), s]));
    const used = new Set();
    const events = [];
    const cleared = [];
    for (const a of specials) {
      if (used.has(key(a))) continue;
      used.add(key(a));
      let b = null;
      for (const [dr, dc] of DIRS) {
        const r = a.row + dr;
        const c = a.col + dc;
        const n = inBounds(rows, cols, r, c) ? byKey.get(r * 64 + c) : undefined;
        if (n && !used.has(key(n))) {
          b = n;
          break;
        }
      }
      if (!b) {
        const cells = area(a.kind, a, board, paying);
        events.push({ kind: a.kind, at: [{ row: a.row, col: a.col }], cells: unique(cells) });
        cleared.push(...cells);
        continue;
      }
      used.add(key(b));
      const combo = comboOf(a, b);
      const cells = [{ row: a.row, col: a.col }, { row: b.row, col: b.col }];
      if (combo.name === "RUNE_RUNE") cells.push(...lines(rows, cols, [a.row, b.row], [a.col, b.col]));
      else if (combo.name === "RUNE_BOMB") {
        const m = combo.center;
        cells.push(...lines(rows, cols, [m.row - 1, m.row, m.row + 1], [m.col - 1, m.col, m.col + 1]));
      } else if (combo.name === "BOMB_BOMB") cells.push(...square(rows, cols, a, 2));
      else if (combo.name === "PRISM_PRISM") {
        for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) cells.push({ row: r, col: c });
      } else cells.push(...transformArea(combo.into, prismTarget(board, paying), board));
      events.push({ kind: combo.name, at: [{ row: a.row, col: a.col }, { row: b.row, col: b.col }], cells: unique(cells) });
      cleared.push(...cells);
    }
    return { cleared: unique(cleared), events };
  }

  function unique(cells) {
    return root.RelicForge.Round.uniqueCells(cells);
  }

  /**
   * Cleared cells pay as clusters per symbol (GDD A1): the cells a detonation clears
   * that were not already paid in this step's clusters are counted by paying symbol,
   * and each symbol with `min`+ cells pays as a cluster of that size.
   */
  function collect(board, cleared, alreadyPaid, paying, min, paytable) {
    const paid = new Set(alreadyPaid.map((p) => p.row * 64 + p.col));
    const counts = new Map();
    for (const p of cleared) {
      if (paid.has(p.row * 64 + p.col)) continue;
      const cell = board[p.row][p.col];
      if (!cell || paying.indexOf(cell.s) < 0) continue;
      counts.set(cell.s, (counts.get(cell.s) || 0) + 1);
    }
    const out = [];
    for (const symbol of paying) {
      const count = counts.get(symbol) || 0;
      if (count >= min) out.push({ symbol, count, pay_x: paytable.clusterPay(symbol, count) });
    }
    return out;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Specials = { PRISM, kindForSize, createSpecials, placeSpecials, listSpecials, prismTarget, area, detonateAll, comboOf, collect };
})(typeof window !== "undefined" ? window : globalThis);
