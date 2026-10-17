/*
 * classic-5x3 — the math engine (5 reels x 3 rows, fixed pay lines, wild, scatter free spins).
 * games/classic-5x3/math-spec.md is the specification; math/rules.json the data.
 *
 * Same shape as Vault 20K's engine, so the RGS drives it unchanged: a browser/Node IIFE
 * that registers `SlotEngine` on its root (in the RGS: its own vm context), ALL randomness
 * through `root.crypto.getRandomValues` (the RGS's seeded RNG: replayable), and a
 * `SpinEngine` with initSession / spin / getRtpProfile / getAllowedBets / MAX_WIN_CAP_X.
 * No feature buy and no ante (SUPPORTS_BUY / SUPPORTS_ANTE false: the RGS refuses both
 * before any money moves).
 */
(function (root) {
  "use strict";

  const ENGINE_VERSION = "1.0.0";
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
   * Evaluate a 3x5 window (matrix[row][reel]) on the first `lines` patterns.
   * Line win: reel 1's symbol (never wild or scatter) plus each next reel showing it or a
   * wild, 3+ in a row from the left; the pay is in line bets. Scatters pay anywhere.
   */
  function evaluate(rules, matrix, lines) {
    const wild = rules.wild.symbol;
    const scatter = rules.scatter.symbol;
    const lineWins = [];
    for (let li = 0; li < lines; li++) {
      const pat = rules.lines.patterns[li];
      const first = matrix[pat[0]][0];
      const pays = rules.paytable[first];
      if (!pays) continue; // scatter (or wild) on reel 1: no line win
      let count = 1;
      while (count < 5) {
        const s = matrix[pat[count]][count];
        if (s !== first && s !== wild) break;
        count++;
      }
      if (count >= 3 && pays[count - 3] > 0) {
        lineWins.push({ line: li + 1, symbol: first, count, payout: pays[count - 3], positions: pat.slice(0, count).map((row, reel) => ({ row, col: reel })) });
      }
    }
    const scatterPositions = [];
    for (let reel = 0; reel < 5; reel++) for (let row = 0; row < 3; row++) if (matrix[row][reel] === scatter) scatterPositions.push({ row, col: reel });
    return { lineWins, scatterPositions };
  }

  class SpinEngine {
    constructor({ rules, storage } = {}) {
      this.rules = rules;
      this.storage = storage || null;
      this.MAX_WIN_CAP_X = Number(rules.max_win_x);
      this.SUPPORTS_BUY = false;
      this.SUPPORTS_ANTE = false;
      this.session = null;
    }

    getAllowedBets() {
      return this.rules.allowed_bets.slice();
    }

    /** A variant = a fixed line count (10 / 20 / 40); unknown ids get the default variant. */
    getRtpProfile(gameId) {
      const profiles = this.rules.rtp_profiles;
      const gid = String(gameId || profiles[0].game_id).toLowerCase();
      const p = profiles.find((x) => x.game_id === gid) || profiles[0];
      return { game_id: p.game_id, slug: p.slug, lines: p.lines, theoretical_percent: Number(this.rules.theoretical_rtp), payout_scaler: 1, free_spin_payout_scaler: Number(this.rules.free_spins.multiplier) };
    }

    initSession({ player_id, currency, locale, game_id, balance } = {}) {
      const profile = this.getRtpProfile(game_id);
      this.session = {
        sessionId: uuid(), playerId: player_id || "player", currency: currency || "GEL", locale: locale || "en",
        gameId: profile.game_id, rtpProfile: profile, balance: Number(balance ?? 1000),
        freeSpinsLeft: 0, freeSpinPersistentMultiplier: 0, bonusRoundWin: 0, anteEnabled: false, crazyMode: false,
        spinHistory: new Map(), createdAt: new Date().toISOString()
      };
      return this.getSession();
    }

    getSession() {
      const s = this.session;
      return { session_id: s.sessionId, balance: s.balance, allowed_bets: this.getAllowedBets(), currency: s.currency, locale: s.locale, game_id: s.gameId, slug: s.rtpProfile.slug, free_spins_left: s.freeSpinsLeft, lines: s.rtpProfile.lines };
    }

    buyFreeSpins() {
      throw new Error("BUY_NOT_AVAILABLE");
    }

    spin({ bet_amount, ante_enabled, spin_id } = {}) {
      const s = this.session;
      if (!s) throw new Error("SESSION_NOT_INITIALIZED");
      const rules = this.rules;
      const bet = Number(bet_amount);
      if (!rules.allowed_bets.includes(bet)) throw new Error("INVALID_BET");
      if (ante_enabled) throw new Error("ANTE_NOT_AVAILABLE");
      const lines = this.getRtpProfile(s.gameId).lines;
      const isFree = s.freeSpinsLeft > 0;
      const multiplier = isFree ? Number(rules.free_spins.multiplier) : 1;

      // 1. Reel stops: one uniform draw per reel; each reel shows 3 consecutive cells.
      const stops = rules.reels.map((strip) => randomInt(strip.length));
      const matrix = [0, 1, 2].map((row) => rules.reels.map((strip, reel) => strip[(stops[reel] + row) % strip.length]));

      // 2. Wins (line bets for lines, total bet for scatters), x3 in free spins.
      const { lineWins, scatterPositions } = evaluate(rules, matrix, lines);
      const lineBet = bet / lines;
      const scatterCount = scatterPositions.length;
      const scatterPayX = scatterCount >= 3 ? rules.scatter.pays[Math.min(scatterCount, 5) - 3] : 0;
      for (const w of lineWins) w.amount = cents(w.payout * lineBet * multiplier);
      const raw = (lineWins.reduce((t, w) => t + w.payout, 0) * lineBet + scatterPayX * bet) * multiplier;
      let win = cents(raw);

      // 3. Free spins: 3+ scatters award (or, in the feature, add) spins.
      const awarded = scatterCount >= 3 ? rules.free_spins.awards[Math.min(scatterCount, 5) - 3] : 0;
      const events = [];
      // 4. The max-win cap covers a whole feature: its trigger spin plus every free spin.
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
      s.freeSpinsLeft = freeLeft;
      const charged = isFree ? 0 : bet;
      s.balance = cents(s.balance - charged + win);

      return {
        spin_id: spin_id || uuid(), engine_version: ENGINE_VERSION, game_id: s.gameId, lines,
        is_free_spin: isFree, bet_amount: bet, bet_charged: charged, ante_enabled: false, crazy_mode: false,
        stops, matrix, line_wins: lineWins, line_bet: lineBet,
        scatter: { count: scatterCount, positions: scatterPositions, pay_x: scatterPayX, amount: cents(scatterPayX * bet * multiplier) },
        multiplier_applied: multiplier, total_win: win, free_spins_awarded: capped ? 0 : awarded, free_spins_left: freeLeft,
        bonus_round_win: s.bonusRoundWin, balance_after: s.balance, events
      };
    }
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.SpinEngine = SpinEngine;
  root.SlotEngine.ENGINE_VERSION = ENGINE_VERSION;
  root.SlotEngine.evaluate = evaluate;
  root.SlotEngine.RNG = { randomInt, uuid };
})(typeof window !== "undefined" ? window : globalThis);
