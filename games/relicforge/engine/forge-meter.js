(function (root) {
  "use strict";

  // The Forge meter (docs/relic-forge/01-GDD.md §2.6). An Ember is collected when it is
  // orthogonally next to an exploding cluster or cleared by a special. The meter counts
  // collected Embers (whole numbers, no rounding drift) up to `embers_to_fill`; full
  // triggers the Forge and empties the meter. Three or more Scatters on the board when
  // the cascade ends also trigger the Forge, leaving the meter as it is.
  //
  // The meter is the player's state for this game, currency and bet (the RGS keeps it
  // across sessions: platform/src/modules/player-state). Its shape: { embers: n }.

  const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

  /**
   * The Embers a step collects: next to a cell of an exploding cluster, or inside a
   * detonation's cleared area. Row-major, deduplicated.
   */
  function collectEmbers(board, clusterCells, cleared, ember) {
    const rows = board.length;
    const cols = board[0].length;
    const hit = new Set(cleared.map((p) => p.row * 64 + p.col));
    for (const p of clusterCells) {
      for (const [dr, dc] of DIRS) {
        const r = p.row + dr;
        const c = p.col + dc;
        if (r >= 0 && r < rows && c >= 0 && c < cols) hit.add(r * 64 + c);
      }
    }
    const out = [];
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const cell = board[r][c];
        if (cell && cell.s === ember && hit.has(r * 64 + c)) out.push({ row: r, col: c });
      }
    }
    return out;
  }

  /** The meter's value from a player state (anything malformed or missing = empty). */
  function read(playerState, rule) {
    const n = Number(playerState && playerState.embers);
    return Number.isInteger(n) && n > 0 ? Math.min(n, rule.embers_to_fill) : 0;
  }

  /**
   * Add a spin's collected Embers. Full → triggered, and the meter empties (Embers past
   * full in the same spin are not carried over).
   */
  function fill(before, collected, rule) {
    const raw = before + collected;
    const triggered = raw >= rule.embers_to_fill;
    return { before, collected, after: triggered ? 0 : raw, full: rule.embers_to_fill, triggered };
  }

  function countScatters(board, scatter) {
    let n = 0;
    // Works on cell objects and on symbol rows (a round's final board).
    for (const line of board) for (const cell of line) if ((typeof cell === "string" ? cell : cell && cell.s) === scatter) n += 1;
    return n;
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.ForgeMeter = { collectEmbers, read, fill, countScatters };
})(typeof window !== "undefined" ? window : globalThis);
