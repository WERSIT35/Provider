(function (root) {
  "use strict";

  // Bump on every change that alters what a seed resolves to (recorded on every RGS
  // round for replay verification, as for Vault 20K).
  const ENGINE_VERSION = "rf-0.5.0";

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function tableOf(weights) {
    return root.RelicForge.Grid.makeTable(Object.entries(weights).map(([symbol, weight]) => ({ symbol, weight })));
  }

  /**
   * Relic Forge's engine facade: the same surface the RGS's EngineService drives for
   * every game (getAllowedBets, getRtpProfile, spin, MAX_WIN_CAP_X, SUPPORTS_*), plus the
   * stateful-game capabilities (USES_FEATURE_STATE, USES_PLAYER_STATE, SUPPORTS_CHOICE).
   * The RGS sets `this.session` (EngineService.buildSessionObject) before each spin:
   *   session.featureState  { forge: {...} } while the Forge runs, else null
   *   session.playerState   { embers: n }: this player's Forge meter at this bet
   * and stores what the spin returns as `feature_state` / `player_state`.
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
      this.baseTable = tableOf(rules.weights.base);
      this.bonusTable = tableOf(rules.weights.bonus || rules.weights.base);
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

    ctxFor(table) {
      const layout = this.rules.layout;
      const m = this.rules.mult;
      return {
        cols: layout.cols,
        rows: layout.rows,
        table,
        paytable: this.paytable,
        paying: this.paying,
        wild: this.rules.symbols.wild,
        ember: this.rules.symbols.ember,
        minCluster: layout.min_cluster,
        maxSteps: layout.max_cascade_steps,
        specialBands: this.rules.specials,
        mult: { start: m.start, inc: m.inc, burst: m.line_burst }
      };
    }

    spin(input = {}) {
      const session = this.session;
      if (!session) throw new Error("RF_NO_SESSION");
      const bet = Number(input.bet_amount);
      if (!(bet > 0)) throw new Error("INVALID_BET");
      const forge = session.featureState && session.featureState.forge;
      if (forge && forge.spins_left > 0) return this.forgeSpin(input, bet, forge);
      return this.baseSpin(input, bet);
    }

    /** A paid spin: cascades, the Forge meter, and the Forge trigger. */
    baseSpin(input, bet) {
      const session = this.session;
      const profile = this.getRtpProfile(session.gameId);
      const out = root.RelicForge.Round.resolveSpin(this.ctxFor(this.baseTable), root.RelicForge.RNG);
      const rawX = out.total_x * profile.payout_scaler;
      const capReached = rawX >= this.MAX_WIN_CAP_X;
      const winX = Math.min(rawX, this.MAX_WIN_CAP_X);

      const meterRule = this.rules.forge_meter;
      const meter = root.RelicForge.ForgeMeter.fill(root.RelicForge.ForgeMeter.read(session.playerState, meterRule), out.embers, meterRule);
      const scatters = root.RelicForge.ForgeMeter.countScatters(out.final, this.rules.symbols.scatter);
      const byScatter = scatters >= this.rules.forge.scatters_to_trigger;
      // A round that already hit the max win ends there: no Forge (the cap covers the
      // trigger spin and its whole bonus).
      const trigger = capReached ? null : meter.triggered && byScatter ? "both" : meter.triggered ? "meter" : byScatter ? "scatter" : null;
      const spins = trigger ? this.rules.forge.free_spins : 0;
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
        meter,
        scatters,
        forge_trigger: trigger,
        free_spins_left: spins,
        free_spins_awarded: spins,
        feature_state: trigger ? { forge: { spins_total: spins, spins_left: spins, trigger, round_x: winX, pending_offer: null } } : null,
        player_state: { embers: meter.after }
      };
    }

    /**
     * A Forge free spin (phase 5: plain cascades on the bonus table; relics, drafts and
     * Meltdown arrive in phase 6). The max win covers the trigger spin plus the whole
     * Forge: reaching it ends the Forge.
     */
    forgeSpin(input, bet, forge) {
      const session = this.session;
      const profile = this.getRtpProfile(session.gameId);
      const out = root.RelicForge.Round.resolveSpin(Object.assign(this.ctxFor(this.bonusTable), { ember: null }), root.RelicForge.RNG);
      const room = Math.max(0, this.MAX_WIN_CAP_X - Number(forge.round_x || 0));
      const rawX = out.total_x * profile.free_spin_payout_scaler;
      const capReached = rawX >= room;
      const winX = Math.min(rawX, room);
      const roundX = Number(forge.round_x || 0) + winX;
      const left = capReached ? 0 : forge.spins_left - 1;
      return {
        spin_id: String(input.spin_id || root.RelicForge.RNG.uuid()),
        engine_version: ENGINE_VERSION,
        game_id: profile.game_id,
        is_free_spin: true,
        bet_amount: bet,
        bet_charged: 0,
        ante_enabled: false,
        forge_spin: forge.spins_total - forge.spins_left + 1,
        initial_board: out.initial,
        steps: out.steps,
        final_board: out.final,
        cascade_truncated: out.truncated,
        win_x: winX,
        total_win: round2(winX * bet),
        cap_reached: capReached,
        forge_round_x: roundX,
        free_spins_left: left,
        free_spins_awarded: 0,
        feature_state: left > 0 ? { forge: Object.assign({}, forge, { spins_left: left, round_x: roundX }) } : null,
        // The meter does not move during the Forge.
        player_state: session.playerState === undefined ? null : session.playerState
      };
    }
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.SpinEngine = SpinEngine;
  root.RelicForge.ENGINE_VERSION = ENGINE_VERSION;
})(typeof window !== "undefined" ? window : globalThis);
