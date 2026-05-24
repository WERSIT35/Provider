(function (root) {
  "use strict";

  const ALLOWED_BETS = [0.2, 0.5, 1, 2, 5, 10];

  function buildEngineContext(rules) {
    const { Symbols, Multipliers, Matrix, Payouts, Tumble, NearMiss } = root.SlotEngine;
    const tables = Symbols.buildSymbolTables(rules);
    const multiplierValues = Multipliers.buildMultiplierValues(rules);
    const matrixCtx = Matrix.makeMatrixContext({
      rules,
      tables,
      multiplierValues,
      multiplierWeights: null
    });
    const payoutsCtx = Payouts.makePayouts({ rules, tables, matrixCtx });
    const tumbleCtx = Tumble.makeTumble({ matrixCtx, multiplierValues, multiplierWeights: null });
    const nearMissCtx = NearMiss.makeNearMiss({ rules, matrixCtx, payoutsCtx, tables });
    return { tables, multiplierValues, matrixCtx, payoutsCtx, tumbleCtx, nearMissCtx };
  }

  class SpinEngine {
    constructor({ rules, storage }) {
      this.rules = rules;
      this.storage = storage || (typeof localStorage !== "undefined" ? localStorage : null);
      this.ctx = buildEngineContext(rules);
      this.session = null;
      const { Config } = root.SlotEngine;
      this.defaultRtpProfile = Config.getRtpProfileByGameId(rules, rules.rtp_profiles?.[0]?.game_id);
      this.MAX_WIN_CAP_X = Number(rules.max_win_cap_multiplier || 15000);
      this.FREE_SPINS_TRIGGER = Number(rules.features?.free_spins?.base_trigger_scatter_count || 4);
      this.FREE_SPINS_AWARD = Number(rules.features?.free_spins?.base_award_spins || 15);
      this.FREE_SPINS_RETRIGGER_TRIGGER = Number(rules.features?.free_spins?.retrigger_scatter_count || 3);
      this.FREE_SPINS_RETRIGGER_AWARD = Number(rules.features?.free_spins?.retrigger_award_spins || 5);
      this.ANTE_MULTIPLIER = Number(rules.features?.ante_bet?.multiplier || 1.25);
      this.BUY_FREE_SPINS_COST_MULT = Number(rules.features?.buy_free_spins?.cost_multiplier || 100);
    }

    static async create({ rulesUrl = "math/game-rules-v2.json", rules: providedRules, storage } = {}) {
      const { Config } = root.SlotEngine;
      const rules = providedRules || await Config.loadRules(rulesUrl);
      return new SpinEngine({ rules, storage });
    }

    getDecoratedRules() { return this.rules; }
    getSession() { return this.session; }
    getAllowedBets() { return ALLOWED_BETS.slice(); }
    getRtpProfile(gameId) {
      return root.SlotEngine.Config.getRtpProfileByGameId(this.rules, gameId);
    }

    setCrazyMode(on) {
      if (!this.session) return;
      this.session.crazyMode = Boolean(on);
      this._persist();
    }
    setAnteEnabled(on) {
      if (!this.session) return;
      this.session.anteEnabled = Boolean(on) && Boolean(this.rules.features?.ante_bet?.enabled);
      this._persist();
    }
    setForcedMultiplierValue(value) {
      if (!this.session) return;
      const num = Number(value);
      this.session.forceMultiplierValue =
        Number.isFinite(num) && this.ctx.multiplierValues.includes(num) ? num : null;
    }

    _newSessionObject({ player_id, currency, locale, game_id }) {
      const resolvedGameId = game_id || this.defaultRtpProfile.game_id;
      const profile = this.getRtpProfile(resolvedGameId);
      return {
        sessionId: root.SlotEngine.RNG.uuid(),
        playerId: player_id || `player_${Date.now()}`,
        currency: currency || "GEL",
        locale: locale || "en",
        gameId: resolvedGameId,
        rtpProfile: profile,
        balance: 1000,
        freeSpinsLeft: 0,
        freeSpinPersistentMultiplier: 1,
        bonusRoundWin: 0,
        forceMultiplierValue: null,
        anteEnabled: false,
        crazyMode: false,
        spinHistory: new Map(),
        createdAt: new Date().toISOString()
      };
    }

    initSession(payload = {}) {
      const persisted = root.SlotEngine.SessionStore.loadSession(this.storage);
      if (persisted && persisted.sessionId) {
        const profile = this.getRtpProfile(persisted.gameId);
        this.session = {
          ...this._newSessionObject(payload),
          sessionId: persisted.sessionId,
          playerId: persisted.playerId,
          currency: persisted.currency || "GEL",
          locale: persisted.locale || "en",
          gameId: persisted.gameId || profile.game_id,
          rtpProfile: profile,
          balance: Number.isFinite(persisted.balance) ? persisted.balance : 1000,
          freeSpinsLeft: Number(persisted.freeSpinsLeft || 0),
          freeSpinPersistentMultiplier: Number(persisted.freeSpinPersistentMultiplier || 1),
          bonusRoundWin: Number(persisted.freeSpinsLeft || 0) > 0 ? Number(persisted.bonusRoundWin || 0) : 0,
          anteEnabled: Boolean(persisted.anteEnabled),
          crazyMode: Boolean(persisted.crazyMode),
          createdAt: persisted.createdAt || new Date().toISOString()
        };
      } else {
        this.session = this._newSessionObject(payload);
      }
      this._persist();
      return {
        session_id: this.session.sessionId,
        balance: this.session.balance,
        allowed_bets: ALLOWED_BETS.slice(),
        currency: this.session.currency,
        locale: this.session.locale,
        game_id: this.session.gameId,
        slug: this.session.rtpProfile?.slug || "",
        rtp_profile: this.session.rtpProfile,
        math_config_id: "engine-v2-client",
        rules_config_id: this.rules.version,
        crazy_mode: this.session.crazyMode,
        ante_enabled: this.session.anteEnabled,
        free_spins_left: this.session.freeSpinsLeft,
        free_spin_multiplier_current: this.session.freeSpinPersistentMultiplier,
        bonus_round_win: Number(this.session.bonusRoundWin || 0)
      };
    }

    _persist() {
      if (!this.session) return;
      root.SlotEngine.SessionStore.saveSession(this.session, this.storage);
    }

    evaluateSpinRound(session, betAmount, options = {}) {
      const { Symbols, Matrix, Payouts, CrazyMode } = root.SlotEngine;
      const { SCATTER_SYMBOL } = Symbols;
      const crazyMode = Boolean(session.crazyMode);
      const profile = options.rtp_profile || this.getRtpProfile(options.game_id || session.gameId);
      const { basePayoutScaler, freeSpinPayoutScaler } = CrazyMode.getPayoutScalers({ crazyMode, profile });
      const anteEnabled = Boolean(options.ante_enabled);
      const forceFreeSpinTrigger = Boolean(options.force_free_spin_trigger);
      const skipBetCharge = Boolean(options.skip_bet_charge);
      const isFreeSpin = session.freeSpinsLeft > 0;
      const betCharged = skipBetCharge
        ? 0
        : (!isFreeSpin && anteEnabled ? Number((betAmount * this.ANTE_MULTIPLIER).toFixed(2)) : betAmount);

      if (!isFreeSpin && !skipBetCharge && session.balance < betCharged) {
        throw new Error("INSUFFICIENT_FUNDS");
      }
      if (!isFreeSpin) {
        if (!skipBetCharge) session.balance = Number((session.balance - betCharged).toFixed(2));
      } else {
        session.freeSpinsLeft -= 1;
      }

      const { scatterChance, multiChance } = CrazyMode.getRates({ crazyMode, isFreeSpin, anteEnabled });
      const multiplierWeights = CrazyMode.getMultiplierWeights(crazyMode);
      const ctx = crazyMode || multiplierWeights
        ? this._cloneContextForWeights(multiplierWeights)
        : this.ctx;

      let { matrix, multipliers } = ctx.matrixCtx.createMatrixWithMetaRates(scatterChance, multiChance);
      if (!isFreeSpin && (forceFreeSpinTrigger || CrazyMode.shouldForceFreeSpinTrigger(crazyMode))) {
        matrix = ctx.matrixCtx.forceScatterTrigger(matrix, this.FREE_SPINS_TRIGGER);
      }
      if (!isFreeSpin && Number.isFinite(Number(options.force_multiplier_value))) {
        const forced = ctx.matrixCtx.injectForcedMultiplier(matrix, multipliers, Number(options.force_multiplier_value));
        matrix = forced.matrix;
        multipliers = forced.multipliers;
      }
      multipliers = ctx.matrixCtx.sanitizeMultipliersForMatrix(matrix, multipliers);

      let nearMissInfo = null;
      if (!isFreeSpin && !crazyMode) {
        const initialScatterPeek = ctx.matrixCtx.countSymbol(matrix, SCATTER_SYMBOL);
        const mutated = ctx.nearMissCtx.maybeMutate({
          matrix,
          multipliers,
          scatterPeak: initialScatterPeek,
          isFreeSpin,
          crazyMode,
          betAmount,
          multiplierValues: ctx.multiplierValues,
          payouts: ctx.payoutsCtx
        });
        if (mutated) {
          matrix = mutated.matrix;
          if (Array.isArray(mutated.multipliers)) multipliers = mutated.multipliers;
          multipliers = ctx.matrixCtx.sanitizeMultipliersForMatrix(matrix, multipliers);
          nearMissInfo = mutated.near_miss;
        }
      }

      const tumbleSteps = [];
      let sequenceWin = 0;
      let sequenceMultiplierSum = 0;
      const countedMultiplierIds = new Set();
      let highestScatterSeen = ctx.matrixCtx.countSymbol(matrix, SCATTER_SYMBOL);
      const sequenceWins = [];
      let firstWinningPositions = [];

      while (true) {
        const ways = ctx.payoutsCtx.evaluateWaysWin(matrix, betAmount);
        tumbleSteps.push({
          matrix,
          multipliers: ctx.matrixCtx.toPublicMultipliers(multipliers),
          ways_wins: ways.wins,
          win_total: ways.total,
          winning_positions: ways.winning_positions
        });
        if (ways.total <= 0) {
          if (sequenceWin > 0) {
            for (const m of multipliers) {
              const id = typeof m?.id === "string" && m.id ? m.id : `${m.row}-${m.col}-${m.value}`;
              if (countedMultiplierIds.has(id)) continue;
              countedMultiplierIds.add(id);
              sequenceMultiplierSum += Number(m.value || 0);
            }
          }
          break;
        }
        sequenceWin += ways.total;
        for (const m of multipliers) {
          const id = typeof m?.id === "string" && m.id ? m.id : `${m.row}-${m.col}-${m.value}`;
          if (countedMultiplierIds.has(id)) continue;
          countedMultiplierIds.add(id);
          sequenceMultiplierSum += Number(m.value || 0);
        }
        if (firstWinningPositions.length === 0) {
          firstWinningPositions = ways.winning_positions;
        }
        for (const win of ways.wins) sequenceWins.push(win);
        const tumbled = ctx.tumbleCtx.applyTumble(matrix, multipliers, ways.winning_positions, scatterChance, multiChance);
        matrix = tumbled.matrix;
        multipliers = ctx.matrixCtx.sanitizeMultipliersForMatrix(matrix, tumbled.multipliers);
        const scatters = ctx.matrixCtx.countSymbol(matrix, SCATTER_SYMBOL);
        if (scatters > highestScatterSeen) highestScatterSeen = scatters;
      }

      const scatterPeakFromSteps = tumbleSteps.reduce((max, step) => {
        const c = ctx.matrixCtx.countSymbol(step?.matrix || [], SCATTER_SYMBOL);
        return c > max ? c : max;
      }, 0);
      const scatterPeak = Math.max(highestScatterSeen, scatterPeakFromSteps);

      const payoutScaler = isFreeSpin ? freeSpinPayoutScaler : basePayoutScaler;
      const scaledSequenceWin = Number((sequenceWin * payoutScaler).toFixed(2));
      const scatterWin = Number((ctx.payoutsCtx.scatterPayoutByCount(scatterPeak) * betAmount * payoutScaler).toFixed(2));
      const preMultiplierWin = Number((scaledSequenceWin + scatterWin).toFixed(2));

      let multiplierApplied = 1;
      let multiplierGainApplied = 0;
      if (isFreeSpin) {
        const prevPersistent = Number(session.freeSpinPersistentMultiplier || 1);
        if (sequenceWin > 0) {
          multiplierGainApplied = Number(sequenceMultiplierSum.toFixed(2));
          const nextPersistent = Number((prevPersistent + sequenceMultiplierSum).toFixed(2));
          session.freeSpinPersistentMultiplier = nextPersistent;
          multiplierApplied = Math.max(1, nextPersistent);
        } else {
          multiplierApplied = Math.max(1, prevPersistent);
        }
      } else if (sequenceWin > 0 && sequenceMultiplierSum > 0) {
        multiplierGainApplied = Number(sequenceMultiplierSum.toFixed(2));
        multiplierApplied = Number(sequenceMultiplierSum.toFixed(2));
      }

      let totalWin = Number((preMultiplierWin * multiplierApplied).toFixed(2));
      const maxWinCap = Number((this.MAX_WIN_CAP_X * betAmount).toFixed(2));
      const events = [];
      let capReached = false;
      if (isFreeSpin) {
        const alreadyWon = Number(session.bonusRoundWin || 0);
        const remainingCap = Number(Math.max(0, maxWinCap - alreadyWon).toFixed(2));
        if (totalWin >= remainingCap) {
          totalWin = remainingCap;
          capReached = true;
          session.freeSpinsLeft = 0;
          session.freeSpinPersistentMultiplier = 1;
          session.bonusRoundWin = maxWinCap;
          events.push({
            type: "FREE_SPINS_ENDED_BY_MAX_WIN_CAP",
            cap_x: this.MAX_WIN_CAP_X,
            total_win: totalWin,
            bonus_total_win: maxWinCap
          });
        } else {
          session.bonusRoundWin = Number((alreadyWon + totalWin).toFixed(2));
        }
      } else if (totalWin > maxWinCap) {
        totalWin = maxWinCap;
        capReached = true;
        events.push({ type: "MAX_WIN_CAP_REACHED", cap_x: this.MAX_WIN_CAP_X, total_win: totalWin });
      }

      let freeSpinsAwarded = 0;
      if (!isFreeSpin && scatterPeak >= this.FREE_SPINS_TRIGGER) {
        freeSpinsAwarded = this.FREE_SPINS_AWARD;
        session.freeSpinsLeft += freeSpinsAwarded;
        session.freeSpinPersistentMultiplier = root.SlotEngine.CrazyMode.persistentMultiplierStart(crazyMode);
        session.bonusRoundWin = 0;
      }
      if (isFreeSpin && scatterPeak >= this.FREE_SPINS_RETRIGGER_TRIGGER && !capReached) {
        // Any 3+ scatter catch during free spins always awards the flat
        // retrigger amount (+5), regardless of how many scatters landed
        // or whether Crazy Mode is on. No more, no less.
        freeSpinsAwarded = this.FREE_SPINS_RETRIGGER_AWARD;
        session.freeSpinsLeft += freeSpinsAwarded;
      }

      session.balance = Number((session.balance + totalWin).toFixed(2));
      if (session.freeSpinsLeft === 0 && !capReached) {
        session.freeSpinPersistentMultiplier = 1;
        session.bonusRoundWin = 0;
      }

      return {
        is_free_spin: isFreeSpin,
        ante_enabled: anteEnabled,
        crazy_mode: crazyMode,
        bet_amount: betAmount,
        bet_charged: Number(betCharged.toFixed(2)),
        matrix,
        multipliers: ctx.matrixCtx.toPublicMultipliers(multipliers),
        tumble_steps: tumbleSteps,
        ways_wins: sequenceWins,
        winning_positions: firstWinningPositions,
        scatter_count: scatterPeak,
        scatter_win: scatterWin,
        free_spins_awarded: freeSpinsAwarded,
        free_spins_left: session.freeSpinsLeft,
        bonus_round_win: Number(session.bonusRoundWin || 0),
        multipliers_count_sequence: countedMultiplierIds.size,
        multipliers_sum_sequence: Number(sequenceMultiplierSum.toFixed(2)),
        multiplier_gain_applied: Number(multiplierGainApplied.toFixed(2)),
        multiplier_applied: Number(multiplierApplied.toFixed(2)),
        free_spin_multiplier_current: Number((isFreeSpin ? multiplierApplied : 1).toFixed(2)),
        total_win: totalWin,
        balance_after: session.balance,
        events,
        near_miss: nearMissInfo
      };
    }

    _cloneContextForWeights(weights) {
      if (!weights) return this.ctx;
      const { Symbols, Multipliers, Matrix, Payouts, Tumble, NearMiss } = root.SlotEngine;
      const tables = this.ctx.tables;
      const multiplierValues = this.ctx.multiplierValues;
      const matrixCtx = Matrix.makeMatrixContext({
        rules: this.rules,
        tables,
        multiplierValues,
        multiplierWeights: weights
      });
      const payoutsCtx = Payouts.makePayouts({ rules: this.rules, tables, matrixCtx });
      const tumbleCtx = Tumble.makeTumble({ matrixCtx, multiplierValues, multiplierWeights: weights });
      const nearMissCtx = NearMiss.makeNearMiss({ rules: this.rules, matrixCtx, payoutsCtx, tables });
      return { tables, multiplierValues, matrixCtx, payoutsCtx, tumbleCtx, nearMissCtx };
    }

    spin(payload = {}) {
      if (!this.session) throw new Error("SESSION_NOT_INITIALIZED");
      const session = this.session;
      const spinId = payload.spin_id || root.SlotEngine.RNG.uuid();
      if (session.spinHistory.has(spinId)) return session.spinHistory.get(spinId);

      const betAmount = Number(payload.bet_amount);
      if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
        throw new Error("INVALID_BET");
      }
      session.anteEnabled = Boolean(this.rules.features?.ante_bet?.enabled) && Boolean(payload.ante_enabled);
      const forcedValue = Number(payload.force_multiplier_value);
      session.forceMultiplierValue =
        Number.isFinite(forcedValue) && this.ctx.multiplierValues.includes(forcedValue) ? forcedValue : null;

      const round = this.evaluateSpinRound(session, betAmount, {
        ante_enabled: session.anteEnabled,
        game_id: session.gameId,
        rtp_profile: session.rtpProfile,
        force_multiplier_value: session.forceMultiplierValue
      });
      session.forceMultiplierValue = null;

      const outcome = {
        spin_id: spinId,
        ...round,
        line_wins: [],
        game_id: session.gameId,
        slug: session.rtpProfile?.slug || "",
        theoretical_rtp_percent: Number(session.rtpProfile?.theoretical_percent || 0)
      };
      session.spinHistory.set(spinId, outcome);
      this._persist();
      return outcome;
    }

    buyFreeSpins(payload = {}) {
      if (!this.session) throw new Error("SESSION_NOT_INITIALIZED");
      const session = this.session;
      const betAmount = Number(payload.bet_amount);
      if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) throw new Error("INVALID_BET");
      if (!Boolean(this.rules.features?.buy_free_spins?.enabled)) throw new Error("BUY_FREE_SPINS_DISABLED");
      if (session.anteEnabled) throw new Error("BUY_DISABLED_WHEN_ANTE_ENABLED");
      const cost = Number((betAmount * this.BUY_FREE_SPINS_COST_MULT).toFixed(2));
      if (session.balance < cost) throw new Error("INSUFFICIENT_FUNDS");
      session.balance = Number((session.balance - cost).toFixed(2));

      const round = this.evaluateSpinRound(session, betAmount, {
        ante_enabled: false,
        force_free_spin_trigger: true,
        skip_bet_charge: true,
        game_id: session.gameId,
        rtp_profile: session.rtpProfile
      });
      const spinId = payload.spin_id || root.SlotEngine.RNG.uuid();
      const outcome = {
        spin_id: spinId,
        buy_free_spins: true,
        buy_cost: cost,
        game_id: session.gameId,
        slug: session.rtpProfile?.slug || "",
        theoretical_rtp_percent: Number(session.rtpProfile?.theoretical_percent || 0),
        ...round,
        line_wins: []
      };
      session.spinHistory.set(spinId, outcome);
      this._persist();
      return outcome;
    }
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.SpinEngine = SpinEngine;
  root.SlotEngine.ALLOWED_BETS = ALLOWED_BETS;
})(typeof window !== "undefined" ? window : globalThis);
