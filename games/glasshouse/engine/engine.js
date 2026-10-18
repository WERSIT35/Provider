/*
 * Glasshouse: the math engine (6 reels x 4 rows, 4,096 ways, the Sunbeam, Glass Rose free
 * spins with lit panes that stay lit, a feature buy). games/glasshouse/DESIGN.md is the
 * specification (section numbers below refer to it); math/rules.json the data.
 *
 * Same shape as the other engines, so the RGS drives it unchanged: a browser/Node IIFE
 * that registers `Glasshouse` on its root (in the RGS: its own vm context), ALL randomness
 * through `root.crypto.getRandomValues` (the RGS's seeded RNG: replayable), and a
 * `SpinEngine` with initSession / spin / buyFreeSpins / getRtpProfile / getAllowedBets /
 * MAX_WIN_CAP_X. Stateful (USES_FEATURE_STATE): the feature's lit panes ride on
 * `feature_state` = { sticky: [[row, reel], ...] }, so a reload or a server restart resumes
 * the feature exactly. No ante.
 */
(function (root) {
  "use strict";

  // Bump on every change that alters what a seed resolves to (recorded on every RGS round).
  const ENGINE_VERSION = "gh-1.0.0";
  const cryptoObj = root.crypto;

  /** Uniform integer in [0, n): rejection sampling on 32-bit draws (no modulo bias). */
  function randomInt(n) {
    if (n <= 1) return 0;
    const buf = new Uint32Array(1);
    const limit = 0x100000000 - (0x100000000 % n);
    for (;;) {
      cryptoObj.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  function uuid() {
    const b = new Uint8Array(16);
    cryptoObj.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  const cents = (x) => Math.round(x * 100) / 100;

  // §4.1: a beam moving `d` into a mirror leaves moving TURN[mirror][d].
  const STEP = { R: [0, 1], L: [0, -1], U: [-1, 0], D: [1, 0] };
  const TURN = {
    MIRROR_RISE: { R: "U", U: "R", D: "L", L: "D" },
    MIRROR_FALL: { R: "D", D: "R", U: "L", L: "U" }
  };
  const EXIT = { R: "right", L: "left", U: "top", D: "bottom" };

  /**
   * One beam (§4.2-4.4) from the Sun Lens at (row, 0), moving right, on the board as it
   * landed. `sticky[r][c]` true = a pane lit earlier in the feature: the beam passes straight
   * through it (§5). Returns { lens, path: [[row, reel, dirOut]...], bends, exit }.
   * A loop is impossible (§4.3); the guard throws BEAM_LOOP rather than ever paying one.
   */
  function trace(matrix, row, sticky) {
    const rows = matrix.length;
    const reels = matrix[0].length;
    let r = row;
    let c = 0;
    let d = "R";
    const path = [[r, c, d]];
    const bends = [];
    const seen = new Set([`${r},${c},${d}`]);
    for (let steps = 0; steps <= rows * reels * 4; steps++) {
      r += STEP[d][0];
      c += STEP[d][1];
      if (r < 0 || r >= rows || c < 0 || c >= reels) return { lens: [row, 0], path, bends, exit: EXIT[d] };
      const turn = sticky && sticky[r][c] ? null : TURN[matrix[r][c]];
      if (turn) {
        bends.push([r, c, d, turn[d]]);
        d = turn[d];
      }
      const key = `${r},${c},${d}`;
      if (seen.has(key)) throw new Error("BEAM_LOOP");
      seen.add(key);
      path.push([r, c, d]);
    }
    throw new Error("BEAM_LOOP");
  }

  /** Every beam on a board, top to bottom (§4.4), and the union of the cells they lit. */
  function beamsFor(rules, matrix, sticky) {
    const lens = rules.specials.lens;
    const beams = [];
    const litGrid = matrix.map((row) => row.map(() => false));
    for (let r = 0; r < matrix.length; r++) {
      if (matrix[r][0] !== lens || (sticky && sticky[r][0])) continue;
      const b = trace(matrix, r, sticky);
      beams.push(b);
      for (const [pr, pc] of b.path) litGrid[pr][pc] = true;
    }
    return { beams, litGrid };
  }

  /**
   * Ways wins (§3.3). `wild[r][c]` = the pane is wild (lit this spin, or sticky). A sticky
   * cell's own symbol is ignored; a lit Glass Rose stays a scatter and is not wild.
   */
  function evaluateWays(rules, matrix, wild, bet) {
    const rows = matrix.length;
    const reels = matrix[0].length;
    const top = rules.top_symbol;
    const wins = [];
    for (const sym of rules.paying) {
      const pays = rules.paytable[sym];
      let run = 0;
      let ways = 1;
      let allWild = 1;
      for (let c = 0; c < reels; c++) {
        let n = 0;
        let w = 0;
        for (let r = 0; r < rows; r++) {
          if (wild[r][c]) w++;
          else if (matrix[r][c] === sym) n++;
        }
        if (n + w === 0) break;
        ways *= n + w;
        allWild *= w;
        run++;
      }
      if (run < 3) continue;
      if (sym !== top) ways -= allWild;
      const payX = pays[run - 3];
      if (!(ways > 0) || !(payX > 0)) continue;
      const positions = [];
      for (let c = 0; c < run; c++) for (let r = 0; r < rows; r++) if (wild[r][c] || matrix[r][c] === sym) positions.push([r, c]);
      wins.push({ symbol: sym, reels: run, ways, pay_x: payX, amount: cents(ways * payX * bet), positions });
    }
    return wins;
  }

  /** Cells as a sorted list of [row, reel] (stable payloads and round hashes). */
  function cellsOf(grid) {
    const out = [];
    for (let r = 0; r < grid.length; r++) for (let c = 0; c < grid[r].length; c++) if (grid[r][c]) out.push([r, c]);
    return out;
  }

  function gridOf(cells, rows, reels) {
    const g = Array.from({ length: rows }, () => new Array(reels).fill(false));
    for (const [r, c] of cells || []) if (r >= 0 && r < rows && c >= 0 && c < reels) g[r][c] = true;
    return g;
  }

  class SpinEngine {
    constructor({ rules, storage } = {}) {
      this.rules = rules;
      this.storage = storage || null;
      this.MAX_WIN_CAP_X = Number(rules.max_win_x);
      this.BUY_FREE_SPINS_COST_MULT = Number(rules.buy.cost_x);
      this.SUPPORTS_BUY = true;
      this.SUPPORTS_ANTE = false;
      this.USES_FEATURE_STATE = true;
      this.session = null;
    }

    getAllowedBets() {
      return this.rules.allowed_bets.slice();
    }

    /** A variant = one strip set (§8); unknown ids get the default variant. */
    getRtpProfile(gameId) {
      const profiles = this.rules.rtp_profiles;
      const gid = String(gameId || profiles[0].game_id).toLowerCase();
      const p = profiles.find((x) => x.game_id === gid) || profiles[0];
      return {
        game_id: p.game_id, slug: p.slug, strips: p.strips,
        theoretical_percent: Number(p.theoretical_percent), buy_free_spins_percent: Number(p.buy_free_spins_percent),
        payout_scaler: 1, free_spin_payout_scaler: 1
      };
    }

    initSession({ player_id, currency, locale, game_id, balance } = {}) {
      const profile = this.getRtpProfile(game_id);
      this.session = {
        sessionId: uuid(), playerId: player_id || "player", currency: currency || "GEL", locale: locale || "en",
        gameId: profile.game_id, rtpProfile: profile, balance: Number(balance ?? 1000),
        freeSpinsLeft: 0, freeSpinPersistentMultiplier: 0, bonusRoundWin: 0, anteEnabled: false, crazyMode: false,
        featureState: null, spinHistory: new Map(), createdAt: new Date().toISOString()
      };
      return this.getSession();
    }

    getSession() {
      const s = this.session;
      return {
        session_id: s.sessionId, balance: s.balance, allowed_bets: this.getAllowedBets(), currency: s.currency, locale: s.locale,
        game_id: s.gameId, slug: s.rtpProfile.slug, free_spins_left: s.freeSpinsLeft, feature_state: s.featureState || null
      };
    }

    stripsFor(isFree) {
      const set = this.rules.strip_sets[this.getRtpProfile(this.session.gameId).strips];
      return isFree ? set.free : set.base;
    }

    /** Reel stops: one uniform draw per reel; each reel shows `rows` consecutive cells. */
    land(strips) {
      const rows = this.rules.layout.rows;
      const stops = strips.map((strip) => randomInt(strip.length));
      const matrix = [];
      for (let r = 0; r < rows; r++) matrix.push(strips.map((strip, reel) => strip[(stops[reel] + r) % strip.length]));
      return { stops, matrix };
    }

    validBet(bet_amount) {
      const bet = Number(bet_amount);
      if (!this.rules.allowed_bets.includes(bet)) throw new Error("INVALID_BET");
      return bet;
    }

    spin({ bet_amount, ante_enabled, spin_id } = {}) {
      const s = this.session;
      if (!s) throw new Error("SESSION_NOT_INITIALIZED");
      const bet = this.validBet(bet_amount);
      if (ante_enabled) throw new Error("ANTE_NOT_AVAILABLE");
      const isFree = s.freeSpinsLeft > 0;
      const board = this.land(this.stripsFor(isFree));
      return this.resolve(board, { bet, isFree, isBuy: false, charged: isFree ? 0 : bet, spin_id });
    }

    /**
     * Feature buy (§6): a base board conditioned on exactly `buy.scatters` Glass Roses, drawn
     * by rejection (redraw every reel until the board has exactly that many). Unbiased and
     * replayable: the whole draw is part of the round's seeded stream.
     */
    buyFreeSpins({ bet_amount, spin_id } = {}) {
      const s = this.session;
      if (!s) throw new Error("SESSION_NOT_INITIALIZED");
      if (s.freeSpinsLeft > 0) throw new Error("FEATURE_IN_PROGRESS");
      const bet = this.validBet(bet_amount);
      const rose = this.rules.specials.rose;
      const want = Number(this.rules.buy.scatters);
      const strips = this.stripsFor(false);
      for (let tries = 0; tries < 1e6; tries++) {
        const board = this.land(strips);
        let n = 0;
        for (const row of board.matrix) for (const x of row) if (x === rose) n++;
        if (n === want) return this.resolve(board, { bet, isFree: false, isBuy: true, charged: cents(bet * this.BUY_FREE_SPINS_COST_MULT), spin_id, tries: tries + 1 });
      }
      throw new Error("BUY_DRAW_EXHAUSTED");
    }

    resolve({ stops, matrix }, { bet, isFree, isBuy, charged, spin_id, tries }) {
      const s = this.session;
      const rules = this.rules;
      const rows = rules.layout.rows;
      const reels = rules.layout.reels;
      const rose = rules.specials.rose;
      const stickyIn = isFree ? ((s.featureState && s.featureState.sticky) || []) : [];
      const sticky = gridOf(stickyIn, rows, reels);

      // 1. Beams on the landed board (§4), then the wild panes (§4.5, §5).
      const { beams, litGrid } = beamsFor(rules, matrix, sticky);
      // The Sun Lens is the light source, not a pane (§4.5): never wild, never stays lit.
      const lens = rules.specials.lens;
      for (let r = 0; r < rows; r++) if (matrix[r][0] === lens && !sticky[r][0]) litGrid[r][0] = rules.lens_is_wild === true;
      const wild = matrix.map((row, r) => row.map((x, c) => sticky[r][c] || (litGrid[r][c] && x !== rose)));

      // 2. Ways (§3.3) and the Glass Rose scatter (a sticky cell is never a rose).
      const wayWins = evaluateWays(rules, matrix, wild, bet);
      const scatterPositions = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < reels; c++) if (matrix[r][c] === rose && !sticky[r][c]) scatterPositions.push([r, c]);
      const scatterCount = scatterPositions.length;
      const scatterPayX = scatterCount >= 3 ? Number(rules.scatter.pays[Math.min(scatterCount, rules.scatter.pays.length + 2) - 3]) : 0;
      let win = cents(wayWins.reduce((t, w) => t + w.amount, 0) + scatterPayX * bet);

      // 3. Free spins: 3+ roses award 10 (base, buy) or add 5 (in the feature).
      const fs = rules.free_spins;
      const awarded = scatterCount >= fs.scatters ? (isFree ? fs.retrigger : fs.award) : 0;
      const events = [];

      // 4. The max-win cap covers a whole feature: its trigger (or buy) plus every free spin (§7).
      const cap = cents(this.MAX_WIN_CAP_X * bet);
      const before = isFree ? Number(s.bonusRoundWin || 0) : 0;
      let capped = false;
      if (before + win > cap) {
        win = cents(Math.max(0, cap - before));
        capped = true;
      }
      let freeLeft;
      if (isFree) {
        freeLeft = capped ? 0 : s.freeSpinsLeft - 1 + awarded;
        s.bonusRoundWin = cents(before + win);
        if (capped) events.push({ type: "FREE_SPINS_ENDED_BY_MAX_WIN_CAP", cap_x: this.MAX_WIN_CAP_X, bonus_total_win: s.bonusRoundWin });
      } else {
        freeLeft = capped ? 0 : awarded;
        s.bonusRoundWin = freeLeft > 0 ? win : 0;
        if (capped) events.push({ type: "MAX_WIN_CAP", cap_x: this.MAX_WIN_CAP_X });
      }
      if (awarded > 0 && !capped) events.push({ type: isFree ? "FREE_SPINS_RETRIGGERED" : "FREE_SPINS_TRIGGERED", awarded, scatter_count: scatterCount });

      // 5. Lit panes stay lit for the rest of the feature (§5); the trigger spin's do not carry in.
      const litCells = cellsOf(litGrid);
      // Optional fade (rules.free_spins.sticky_spins = N): a pane stays lit for N more spins.
      const ttlSpins = rules.free_spins.sticky_spins || 0;
      let stickyOut = [];
      let ttlOut = ttlSpins ? [] : undefined;
      if (isFree && !ttlSpins) stickyOut = cellsOf(sticky.map((row, r) => row.map((x, c) => x || litGrid[r][c])));
      if (isFree && ttlSpins) {
        const ttlIn = (s.featureState && s.featureState.ttl) || [];
        const age = matrix.map((row) => row.map(() => 0));
        stickyIn.forEach(([r, c], i) => { age[r][c] = (ttlIn[i] ?? ttlSpins) - 1; });
        for (let r = 0; r < rows; r++) for (let c = 0; c < reels; c++) if (litGrid[r][c]) age[r][c] = ttlSpins;
        ttlOut = [];
        for (let r = 0; r < rows; r++) for (let c = 0; c < reels; c++) if (age[r][c] > 0) { stickyOut.push([r, c]); ttlOut.push(age[r][c]); }
      }
      const featureState = freeLeft > 0 ? (ttlOut ? { sticky: stickyOut, ttl: ttlOut } : { sticky: stickyOut }) : null;
      s.freeSpinsLeft = freeLeft;
      s.featureState = featureState;
      s.balance = cents(s.balance - charged + win);

      return {
        spin_id: spin_id || uuid(), engine_version: ENGINE_VERSION, game_id: s.gameId,
        is_free_spin: isFree, is_buy: isBuy, bet_amount: bet, bet_charged: charged, ante_enabled: false, crazy_mode: false,
        ...(isBuy ? { buy_draws: tries } : {}),
        stops, matrix, sticky_in: stickyIn.map((x) => x.slice()), beams, lit: litCells, wilds: cellsOf(wild),
        way_wins: wayWins,
        scatter: { count: scatterCount, positions: scatterPositions, pay_x: scatterPayX, amount: cents(scatterPayX * bet) },
        total_win: win, free_spins_awarded: capped ? 0 : awarded, free_spins_left: freeLeft,
        bonus_round_win: s.bonusRoundWin, balance_after: s.balance, events,
        feature_state: featureState
      };
    }
  }

  root.Glasshouse = root.Glasshouse || {};
  root.Glasshouse.SpinEngine = SpinEngine;
  root.Glasshouse.ENGINE_VERSION = ENGINE_VERSION;
  root.Glasshouse.trace = trace;
  root.Glasshouse.beamsFor = beamsFor;
  root.Glasshouse.evaluateWays = evaluateWays;
  root.Glasshouse.TURN = TURN;
})(typeof globalThis !== "undefined" ? globalThis : this);
