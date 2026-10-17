(function (root) {
  "use strict";

  // Bump on every change that alters what a seed resolves to (recorded on every RGS
  // round for replay verification, as for Vault 20K).
  const ENGINE_VERSION = "rf-0.7.0";

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

    /** Options the next spin must pick from: the pending relic offer (0 = none). */
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
        mult: { start: m.start, inc: m.inc, burst: m.line_burst, max: m.max || 0, scope: m.burst_scope || "running" }
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
      // The first draft is dealt with the trigger (its draws come after the cascade's).
      const forge = trigger
        ? {
            spins_total: spins,
            spins_left: spins,
            trigger,
            round_x: winX,
            relics: root.RelicForge.Relics.emptyLevels(),
            evolutions: [],
            relic_bonus: 1,
            carried_mult: null,
            stuck: [],
            pending_offer: root.RelicForge.Draft.makeOffer(root.RelicForge.Relics.emptyLevels(), this.rules.forge.offer_size, root.RelicForge.RNG)
          }
        : null;
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
        offer_next: forge ? this.offerInfo(forge, forge.pending_offer) : null,
        feature_state: forge ? { forge } : null,
        player_state: { embers: meter.after }
      };
    }

    /** The offer as the player sees it: each relic, the level it would reach, its volatility. */
    offerInfo(forge, offer) {
      const { EvTable } = root.RelicForge;
      const sig = EvTable.signature(forge.relics, forge.evolutions, forge.spins_left);
      return offer.map((relic) => ({
        relic,
        level_next: (forge.relics[relic] || 0) + 1,
        volatility: EvTable.volatility(this.rules.ev_table, sig, relic)
      }));
    }

    /**
     * A Forge spin (docs/relic-forge/01-GDD.md §3). In order:
     *   1. the pick (`choice`) levels a relic; maxed pairs evolve; the pick's Relic bonus
     *      factor joins the Forge's running Relic bonus;
     *   2. the spin plays with the relic set (Meltdown, the last spin: every relic);
     *   3. pay = cascades × free-spin scaler × Relic bonus, under what the max win leaves;
     *   4. Surge carries the Mult, Magnet keeps the spin's specials;
     *   5. the next offer is dealt (its draws come after the spin's).
     */
    forgeSpin(input, bet, forge) {
      const { Relics, Draft, Round, RNG } = root.RelicForge;
      const rules = this.rules;
      const session = this.session;
      const profile = this.getRtpProfile(session.gameId);
      const pick = Draft.applyPick(forge, input.choice, rules, rules.ev_table);
      const spinNo = forge.spins_total - forge.spins_left + 1;
      const meltdown = forge.spins_left === 1;
      const cfg = Relics.configFor(Relics.effective(pick.levels, pick.evolutions, meltdown), rules, rules.layout.rows);
      const carried = forge.carried_mult;
      const start = cfg.surge > 0 && carried ? carried + cfg.carryBonus : rules.mult.start;
      const stuckIn = (forge.stuck || []).filter((s) => s.spins_left > 0);
      const ctx = Object.assign(this.ctxFor(tableOf(Relics.weightsFor(cfg, rules))), {
        ember: null,
        rows: cfg.rows,
        wilds: cfg.wilds,
        wildMult: cfg.wildMult,
        stuck: stuckIn,
        specialBands: Object.assign({}, rules.specials, { RUNE: { min: cfg.runeMin, max: rules.specials.RUNE.max } }),
        mult: { start, inc: cfg.inc, burst: cfg.burst, max: rules.mult.max || 0, scope: rules.mult.burst_scope || "running" }
      });
      const out = Round.resolveSpin(ctx, RNG);

      const relicBonus = Number(forge.relic_bonus || 1) * pick.factor;
      const room = Math.max(0, this.MAX_WIN_CAP_X - Number(forge.round_x || 0));
      const rawX = out.total_x * profile.free_spin_payout_scaler * relicBonus;
      const capReached = rawX > 0 && rawX >= room;
      const winX = Math.min(rawX, room);
      const roundX = Number(forge.round_x || 0) + winX;
      const left = capReached ? 0 : forge.spins_left - 1;

      // Surge (and Singularity): the Mult the spin ended on starts the next one.
      const carriedNext = cfg.surge > 0 || cfg.persistAll ? (out.final_mult !== null ? out.final_mult : carried || null) : null;
      // Magnet: this spin's specials come back for the next stickSpins spins (Singularity:
      // every remaining spin); the newest are kept when there are too many.
      const keep = cfg.persistAll ? left : cfg.stickSpins;
      const stuckNext = stuckIn
        .map((s) => Object.assign({}, s, { spins_left: cfg.persistAll ? left : s.spins_left - 1 }))
        .concat(keep > 0 ? out.specials_created.map((s) => ({ up: cfg.rows - 1 - s.row, col: s.col, kind: s.kind, symbol: s.symbol, spins_left: keep })) : [])
        .filter((s) => s.spins_left > 0)
        .slice(-rules.forge.max_stuck_specials);

      const next = left > 0
        ? {
            spins_total: forge.spins_total,
            spins_left: left,
            trigger: forge.trigger,
            round_x: roundX,
            relics: pick.levels,
            evolutions: pick.evolutions,
            relic_bonus: relicBonus,
            carried_mult: carriedNext,
            stuck: stuckNext,
            pending_offer: null
          }
        : null;
      if (next) next.pending_offer = Draft.makeOffer(pick.levels, rules.forge.offer_size, RNG);

      return {
        spin_id: String(input.spin_id || RNG.uuid()),
        engine_version: ENGINE_VERSION,
        game_id: profile.game_id,
        is_free_spin: true,
        bet_amount: bet,
        bet_charged: 0,
        ante_enabled: false,
        forge_spin: spinNo,
        meltdown,
        pick: { choice: input.choice, relic: pick.relic, level: pick.level, factor: pick.factor },
        evolved: pick.evolved,
        relics: pick.levels,
        evolutions: pick.evolutions,
        relic_bonus: relicBonus,
        config: cfg,
        dealt_board: out.dealt,
        wilds_placed: out.wilds_placed,
        stuck_placed: out.stuck_placed,
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
        offer_next: next ? this.offerInfo(next, next.pending_offer) : null,
        feature_state: next ? { forge: next } : null,
        // The meter does not move during the Forge.
        player_state: session.playerState === undefined ? null : session.playerState
      };
    }
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.SpinEngine = SpinEngine;
  root.RelicForge.ENGINE_VERSION = ENGINE_VERSION;
})(typeof window !== "undefined" ? window : globalThis);
