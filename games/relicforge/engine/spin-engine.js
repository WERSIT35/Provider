(function (root) {
  "use strict";

  // Bump on every change that alters what a seed resolves to (recorded on every RGS
  // round for replay verification, as for Vault 20K).
  const ENGINE_VERSION = "rf-0.2.0";

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  /**
   * Relic Forge's engine facade: the same surface the RGS's EngineService drives for
   * every game (getAllowedBets, getRtpProfile, spin, MAX_WIN_CAP_X, SUPPORTS_*), plus the
   * stateful-game capabilities (USES_FEATURE_STATE, USES_PLAYER_STATE, SUPPORTS_CHOICE).
   * The RGS sets `this.session` (EngineService.buildSessionObject) before each spin.
   */
  class SpinEngine {
    constructor({ rules }) {
      this.rules = rules;
      this.MAX_WIN_CAP_X = Number(rules.max_win_cap_multiplier || 10000);
      this.SUPPORTS_BUY = false;
      this.SUPPORTS_ANTE = false;
      this.USES_FEATURE_STATE = true;
      this.USES_PLAYER_STATE = true;
      this.SUPPORTS_CHOICE = true;
      this.session = null;
      const sym = rules.symbols;
      this.paying = [...sym.low, ...sym.premium];
      this.paytable = root.RelicForge.Paytable.makePaytable(rules);
      this.baseTable = root.RelicForge.Grid.makeTable(Object.entries(rules.weights.base).map(([symbol, weight]) => ({ symbol, weight })));
    }

    getAllowedBets() {
      return (this.rules.allowed_bets || []).slice();
    }

    getRtpProfile(gameId) {
      const profiles = this.rules.rtp_profiles || [];
      const gid = String(gameId || profiles[0]?.game_id || "relicforge").toLowerCase();
      const p = profiles.find((x) => String(x.game_id).toLowerCase() === gid) || profiles[0];
      return {
        game_id: p.game_id,
        slug: p.slug || "",
        theoretical_percent: Number(p.theoretical_percent),
        payout_scaler: Number(p.payout_scaler ?? 1),
        free_spin_payout_scaler: Number(p.free_spin_payout_scaler ?? p.payout_scaler ?? 1)
      };
    }

    /** Options the next spin must pick from (the relic draft arrives in phase 6). */
    choiceOptions(featureState) {
      const offer = featureState && featureState.forge && featureState.forge.pending_offer;
      return Array.isArray(offer) ? offer.length : 0;
    }

    spin(input = {}) {
      const session = this.session;
      if (!session) throw new Error("RF_NO_SESSION");
      const bet = Number(input.bet_amount);
      if (!(bet > 0)) throw new Error("INVALID_BET");
      const profile = this.getRtpProfile(session.gameId);
      const layout = this.rules.layout;
      const out = root.RelicForge.Round.resolveSpin(
        {
          cols: layout.cols,
          rows: layout.rows,
          table: this.baseTable,
          paytable: this.paytable,
          paying: this.paying,
          wild: this.rules.symbols.wild,
          minCluster: layout.min_cluster,
          maxSteps: layout.max_cascade_steps
        },
        root.RelicForge.RNG
      );
      const rawX = out.total_x * profile.payout_scaler;
      const capReached = rawX >= this.MAX_WIN_CAP_X;
      const winX = Math.min(rawX, this.MAX_WIN_CAP_X);
      return {
        spin_id: String(input.spin_id || root.RelicForge.RNG.uuid()),
        engine_version: ENGINE_VERSION,
        game_id: profile.game_id,
        is_free_spin: false,
        bet_amount: bet,
        bet_charged: bet,
        ante_enabled: false,
        initial_board: out.initial,
        steps: out.steps,
        final_board: out.final,
        cascade_truncated: out.truncated,
        win_x: winX,
        total_win: round2(winX * bet),
        cap_reached: capReached,
        free_spins_left: 0,
        free_spins_awarded: 0,
        feature_state: null,
        player_state: session.playerState === undefined ? null : session.playerState
      };
    }
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.SpinEngine = SpinEngine;
  root.RelicForge.ENGINE_VERSION = ENGINE_VERSION;
})(typeof window !== "undefined" ? window : globalThis);
