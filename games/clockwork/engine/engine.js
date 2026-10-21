/*
 * Clockwork Menagerie: the math engine (5 reels x 3 rows, 20 lines paying both ways, Wound
 * Wild respins, free spins with wound reels whose multipliers grow, a feature buy).
 * games/clockwork/DESIGN.md is the specification (section numbers below refer to it);
 * math/rules.json the data.
 *
 * Same shape as the other engines, so the RGS drives it unchanged: a browser/Node IIFE that
 * registers `Clockwork` on its root (in the RGS: its own vm context), ALL randomness through
 * `root.crypto.getRandomValues` (the RGS's seeded RNG: replayable), and a `SpinEngine` with
 * initSession / spin / buyFreeSpins / getRtpProfile / getAllowedBets / MAX_WIN_CAP_X.
 * Stateful (USES_FEATURE_STATE): the feature's wound reels ride on `feature_state` =
 * { wound: [[reel, mult], ...] }. A base round's respins live inside the round (no state).
 */
(function (root) {
  "use strict";

  // Bump on every change that alters what a seed resolves to (recorded on every RGS round).
  const ENGINE_VERSION = "cw-1.0.0";
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

  /**
   * Line wins on one board, both ways (§3). `wild[c]` true = reel c is wound (wild).
   * `multFor(reels)` gives a winning run's multiplier (§5.2; base game: 1).
   * Pays are in line bets; amounts are rounded to cents per line win.
   */
  function evaluateLines(rules, matrix, wild, lineBet, multFor) {
    const reels = matrix[0].length;
    const wins = [];
    const patterns = rules.lines.patterns;
    for (let li = 0; li < patterns.length; li++) {
      const pat = patterns[li];
      const at = (c) => matrix[pat[c]][c];
      for (const dir of ["ltr", "rtl"]) {
        const first = dir === "ltr" ? 0 : reels - 1;
        const step = dir === "ltr" ? 1 : -1;
        const sym = at(first);
        const pays = rules.paytable[sym];
        if (!pays || wild[first]) continue; // reels 1 and 5 never wild; a scatter starts nothing
        let count = 1;
        while (count < reels) {
          const c = first + step * count;
          if (!(wild[c] || at(c) === sym)) break;
          count++;
        }
        if (count < 3) continue;
        if (dir === "rtl" && count === reels) continue; // 5 of a kind pays once (§3)
        const payX = pays[count - 3];
        if (!(payX > 0)) continue;
        const runReels = [];
        for (let k = 0; k < count; k++) runReels.push(first + step * k);
        runReels.sort((a, b) => a - b);
        const mult = multFor(runReels);
        wins.push({
          line: li + 1, dir, symbol: sym, count, pay_x: payX, mult,
          amount: cents(payX * lineBet * mult),
          positions: runReels.map((c) => [pat[c], c])
        });
      }
    }
    return wins;
  }

  /** Music boxes on the reels that landed this board (§4.5, §5.1). */
  function scatterOn(rules, matrix, landed) {
    const box = rules.scatter.symbol;
    const positions = [];
    for (let c = 0; c < matrix[0].length; c++) {
      if (!landed[c]) continue;
      for (let r = 0; r < matrix.length; r++) if (matrix[r][c] === box) positions.push([r, c]);
    }
    return positions;
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

    /** A variant = one strip set (§7); unknown ids get the default variant. */
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

    /**
     * Land a board. Reels in `held` (reel -> true) do not spin: no draw, their column shows
     * the wild (`KEY`) and their stop is null. Every other reel: one uniform draw, `rows`
     * consecutive cells from the stop.
     */
    land(strips, held) {
      const rows = this.rules.layout.rows;
      const wildSym = this.rules.wild.symbol;
      const stops = strips.map((strip, c) => (held && held[c] ? null : randomInt(strip.length)));
      const matrix = [];
      for (let r = 0; r < rows; r++) matrix.push(strips.map((strip, c) => (stops[c] === null ? wildSym : strip[(stops[c] + r) % strip.length])));
      return { stops, matrix };
    }

    validBet(bet_amount) {
      const bet = Number(bet_amount);
      if (!this.rules.allowed_bets.includes(bet)) throw new Error("INVALID_BET");
      return bet;
    }

    /** Reels (2..4) on which a key landed this board. */
    keyReels(matrix, landedStops) {
      const wildSym = this.rules.wild.symbol;
      const out = [];
      for (let c = 0; c < matrix[0].length; c++) {
        if (landedStops[c] === null) continue;
        for (let r = 0; r < matrix.length; r++) if (matrix[r][c] === wildSym) { out.push(c); break; }
      }
      return out;
    }

    spin({ bet_amount, ante_enabled, spin_id } = {}) {
      const s = this.session;
      if (!s) throw new Error("SESSION_NOT_INITIALIZED");
      const bet = this.validBet(bet_amount);
      if (ante_enabled) throw new Error("ANTE_NOT_AVAILABLE");
      if (s.freeSpinsLeft > 0) return this.freeSpin(bet, spin_id);
      return this.baseRound(bet, { spin_id, isBuy: false });
    }

    /** Feature buy (§6): a base board with exactly `buy.scatters` boxes, by rejection; no respins. */
    buyFreeSpins({ bet_amount, spin_id } = {}) {
      const s = this.session;
      if (!s) throw new Error("SESSION_NOT_INITIALIZED");
      if (s.freeSpinsLeft > 0) throw new Error("FEATURE_IN_PROGRESS");
      const bet = this.validBet(bet_amount);
      return this.baseRound(bet, { spin_id, isBuy: true });
    }

    /** A paid round (§4): the spin, then respins while a wound reel has turns left. */
    baseRound(bet, { spin_id, isBuy }) {
      const s = this.session;
      const rules = this.rules;
      const reels = rules.layout.reels;
      const lineBet = bet / rules.lines.patterns.length;
      const strips = this.stripsFor(false);
      const turnsPer = Number(rules.wild.respins);
      const boards = [];
      let tries = 0;

      // Board 1 (for a buy: redrawn until it shows exactly `buy.scatters` boxes).
      let first;
      if (isBuy) {
        const want = Number(rules.buy.scatters);
        for (;;) {
          tries++;
          if (tries > 1e6) throw new Error("BUY_DRAW_EXHAUSTED");
          first = this.land(strips, null);
          if (scatterOn(rules, first.matrix, first.stops.map(() => true)).length === want) break;
        }
      } else {
        first = this.land(strips, null);
      }

      let wound = {}; // reel -> turns left
      let board = first;
      for (;;) {
        const landed = board.stops.map((x) => x !== null);
        // Turns: every reel already wound uses one on this respin (§4.2); new keys wind with a full gauge (§4.3).
        if (boards.length > 0) for (const c of Object.keys(wound)) wound[c] -= 1;
        for (const c of this.keyReels(board.matrix, board.stops)) wound[c] = turnsPer;
        const wild = Array.from({ length: reels }, (_, c) => wound[c] !== undefined);
        const lineWins = evaluateLines(rules, board.matrix, wild, lineBet, () => 1);
        const boxes = scatterOn(rules, board.matrix, landed);
        const payX = boxes.length >= 3 ? Number(rules.scatter.pays[Math.min(boxes.length, 5) - 3]) : 0;
        const win = cents(lineWins.reduce((t, w) => t + w.amount, 0) + payX * bet);
        boards.push({
          stops: board.stops, matrix: board.matrix,
          wound: Object.keys(wound).map(Number).sort((a, b) => a - b).map((c) => [c, wound[c]]),
          line_wins: lineWins, scatter: { count: boxes.length, positions: boxes, pay_x: payX, amount: cents(payX * bet) }, win
        });
        // Unwind spent reels; respin while any has turns left (no respins on a buy board).
        for (const c of Object.keys(wound)) if (wound[c] <= 0) delete wound[c];
        if (isBuy || Object.keys(wound).length === 0) break;
        const held = {};
        for (const c of Object.keys(wound)) held[c] = true;
        board = this.land(strips, held);
      }

      // Free spins: the most boxes on any one board (§4.5, §5.1).
      const most = boards.reduce((m, b) => Math.max(m, b.scatter.count), 0);
      const fs = rules.free_spins;
      const awarded = most >= 3 ? Number(fs.awards[Math.min(most, 5) - 3]) : 0;
      let win = cents(boards.reduce((t, b) => t + b.win, 0));
      const events = [];
      const cap = cents(this.MAX_WIN_CAP_X * bet);
      let capped = false;
      if (win > cap) { win = cap; capped = true; events.push({ type: "MAX_WIN_CAP", cap_x: this.MAX_WIN_CAP_X }); }
      const freeLeft = capped ? 0 : awarded;
      if (freeLeft > 0) events.push({ type: "FREE_SPINS_TRIGGERED", awarded, scatter_count: most });
      if (boards.length > 1) events.push({ type: "WOUND_WILD_RESPINS", respins: boards.length - 1 });
      s.freeSpinsLeft = freeLeft;
      s.bonusRoundWin = freeLeft > 0 ? win : 0;
      s.featureState = freeLeft > 0 ? { wound: [] } : null;
      const charged = isBuy ? cents(bet * this.BUY_FREE_SPINS_COST_MULT) : bet;
      s.balance = cents(s.balance - charged + win);
      return this.payload({ spin_id, isFree: false, isBuy, bet, charged, lineBet, boards, win, awarded: capped ? 0 : awarded, freeLeft, events, tries });
    }

    /** One free spin (§5.2): wound reels stay, their multipliers grow, new keys wind at x1. */
    freeSpin(bet, spin_id) {
      const s = this.session;
      const rules = this.rules;
      const reels = rules.layout.reels;
      const lineBet = bet / rules.lines.patterns.length;
      const maxMult = Number(rules.free_spins.max_mult);
      const woundIn = ((s.featureState && s.featureState.wound) || []).map(([c, m]) => [c, m]);
      const mult = {};
      for (const [c, m] of woundIn) mult[c] = Math.min(maxMult, m + 1);
      const held = {};
      for (const c of Object.keys(mult)) held[c] = true;
      const board = this.land(this.stripsFor(true), held);
      for (const c of this.keyReels(board.matrix, board.stops)) if (mult[c] === undefined) mult[c] = 1;
      const wild = Array.from({ length: reels }, (_, c) => mult[c] !== undefined);
      const multFor = (runReels) => {
        let sum = 0;
        for (const c of runReels) if (mult[c] !== undefined) sum += mult[c];
        return sum > 0 ? sum : 1;
      };
      const lineWins = evaluateLines(rules, board.matrix, wild, lineBet, multFor);
      const landed = board.stops.map((x) => x !== null);
      const boxes = scatterOn(rules, board.matrix, landed);
      const payX = boxes.length >= 3 ? Number(rules.scatter.pays[Math.min(boxes.length, 5) - 3]) : 0;
      let win = cents(lineWins.reduce((t, w) => t + w.amount, 0) + payX * bet);
      const woundOut = Object.keys(mult).map(Number).sort((a, b) => a - b).map((c) => [c, mult[c]]);
      const boards = [{ stops: board.stops, matrix: board.matrix, wound: woundOut, line_wins: lineWins, scatter: { count: boxes.length, positions: boxes, pay_x: payX, amount: cents(payX * bet) }, win }];

      const fs = rules.free_spins;
      const awarded = boxes.length >= 3 ? Number(fs.retrigger) : 0;
      const events = [];
      const cap = cents(this.MAX_WIN_CAP_X * bet);
      const before = Number(s.bonusRoundWin || 0);
      let capped = false;
      if (before + win > cap) { win = cents(Math.max(0, cap - before)); capped = true; }
      const freeLeft = capped ? 0 : s.freeSpinsLeft - 1 + awarded;
      s.bonusRoundWin = cents(before + win);
      if (capped) events.push({ type: "FREE_SPINS_ENDED_BY_MAX_WIN_CAP", cap_x: this.MAX_WIN_CAP_X, bonus_total_win: s.bonusRoundWin });
      if (awarded > 0 && !capped) events.push({ type: "FREE_SPINS_RETRIGGERED", awarded, scatter_count: boxes.length });
      s.freeSpinsLeft = freeLeft;
      s.featureState = freeLeft > 0 ? { wound: woundOut } : null;
      s.balance = cents(s.balance + win);
      return this.payload({ spin_id, isFree: true, isBuy: false, bet, charged: 0, lineBet, boards, win, awarded: capped ? 0 : awarded, freeLeft, events });
    }

    payload({ spin_id, isFree, isBuy, bet, charged, lineBet, boards, win, awarded, freeLeft, events, tries }) {
      const s = this.session;
      const b0 = boards[0];
      return {
        spin_id: spin_id || uuid(), engine_version: ENGINE_VERSION, game_id: s.gameId,
        is_free_spin: isFree, is_buy: isBuy, bet_amount: bet, bet_charged: charged, ante_enabled: false, crazy_mode: false,
        ...(isBuy ? { buy_draws: tries } : {}),
        line_bet: lineBet, stops: b0.stops, matrix: b0.matrix, boards, respins: boards.length - 1,
        line_wins: boards.flatMap((b) => b.line_wins),
        scatter: { count: boards.reduce((m, b) => Math.max(m, b.scatter.count), 0), amount: cents(boards.reduce((t, b) => t + b.scatter.amount, 0)) },
        total_win: win, free_spins_awarded: awarded, free_spins_left: freeLeft,
        bonus_round_win: s.bonusRoundWin, balance_after: s.balance, events,
        feature_state: s.featureState
      };
    }
  }

  root.Clockwork = root.Clockwork || {};
  root.Clockwork.SpinEngine = SpinEngine;
  root.Clockwork.ENGINE_VERSION = ENGINE_VERSION;
  root.Clockwork.evaluateLines = evaluateLines;
  root.Clockwork.scatterOn = scatterOn;
})(typeof globalThis !== "undefined" ? globalThis : this);
