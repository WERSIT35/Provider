(function (root) {
  "use strict";

  function buildSimulationReport({ steps, betAmount, current, profile }) {
    const baseline = { ...current };
    const minWithTolerance = Number(profile.target_band_min) - Number(profile.target_tolerance_percent);
    const maxWithTolerance = Number(profile.target_band_max) + Number(profile.target_tolerance_percent);
    return {
      steps,
      bet_amount: betAmount,
      game_id: profile.game_id,
      slug: profile.slug,
      ante_enabled: Boolean(current.ante_enabled),
      charged_bet_amount: Number(current.charged_bet_amount || betAmount),
      target_rtp_band: { min: Number(profile.target_band_min), max: Number(profile.target_band_max) },
      target_rtp_tolerance: Number(profile.target_tolerance_percent),
      baseline,
      current,
      diff: {
        casino_net_current_minus_baseline: 0,
        rtp_percent_current_minus_baseline: 0,
        hit_frequency_percent_current_minus_baseline: 0,
        big_win_20x_count_current_minus_baseline: 0,
        huge_win_50x_count_current_minus_baseline: 0
      },
      checks: {
        current_rtp_in_target_band:
          current.rtp_percent >= minWithTolerance && current.rtp_percent <= maxWithTolerance,
        current_casino_profitable: current.casino_net > 0
      }
    };
  }

  function simulateOneBonusRound(engine, betAmount, profile) {
    const session = {
      balance: 0,
      freeSpinsLeft: 1,
      freeSpinPersistentMultiplier: 1,
      bonusRoundWin: 0,
      gameId: profile.game_id,
      rtpProfile: profile,
      anteEnabled: false,
      crazyMode: false,
      forceMultiplierValue: null,
      spinHistory: new Map()
    };
    let roundWin = 0;
    let spinsPlayed = 0;
    let awardedSpins = 0;
    const guardMax = 2000;
    while (session.freeSpinsLeft > 0 && spinsPlayed < guardMax) {
      const spin = engine.evaluateSpinRound(session, betAmount, {
        ante_enabled: false,
        game_id: profile.game_id,
        rtp_profile: profile
      });
      spinsPlayed += 1;
      awardedSpins += Number(spin.free_spins_awarded || 0);
      roundWin += Number(spin.total_win || 0);
    }
    return {
      round_win: Number(roundWin.toFixed(2)),
      spins_played: spinsPlayed,
      awarded_spins: awardedSpins
    };
  }

  function* simulateStream(engine, { steps, betAmount, anteEnabled = false, bonusOnly = false, gameId, chunkSize = 1000 }) {
    const profile = engine.getRtpProfile(gameId);
    const anteOn = Boolean(engine.rules.features?.ante_bet?.enabled) && Boolean(anteEnabled);
    const chargedBet = Number((betAmount * (anteOn ? engine.ANTE_MULTIPLIER : 1)).toFixed(2));
    const session = {
      balance: 0,
      freeSpinsLeft: 0,
      freeSpinPersistentMultiplier: 1,
      bonusRoundWin: 0,
      gameId: profile.game_id,
      rtpProfile: profile,
      anteEnabled: anteOn,
      crazyMode: false,
      forceMultiplierValue: null,
      spinHistory: new Map()
    };
    let paidWager = 0;
    let paidSpins = 0;
    let freeSpinSteps = 0;
    let totalWin = 0;
    let hitSpins = 0;
    let big20 = 0;
    let huge50 = 0;
    let maxWin = 0;
    let bonusCatchCount = 0;
    let bonusAwardedSpins = 0;
    let bonusWinTotal = 0;
    let completed = 0;

    while (completed < steps) {
      const end = Math.min(steps, completed + chunkSize);
      for (let i = completed; i < end; i += 1) {
        if (bonusOnly) {
          const br = simulateOneBonusRound(engine, betAmount, profile);
          paidWager += betAmount;
          paidSpins += 1;
          freeSpinSteps += Number(br.spins_played || 0);
          bonusAwardedSpins += Number(br.awarded_spins || 0);
          bonusCatchCount += 1;
          totalWin += Number(br.round_win || 0);
          bonusWinTotal += Number(br.round_win || 0);
          if (br.round_win > 0) hitSpins += 1;
          if (br.round_win >= betAmount * 20) big20 += 1;
          if (br.round_win >= betAmount * 50) huge50 += 1;
          if (br.round_win > maxWin) maxWin = br.round_win;
          continue;
        }
        const isFree = session.freeSpinsLeft > 0;
        if (!isFree) {
          paidWager += chargedBet;
          paidSpins += 1;
          session.balance += chargedBet;
        } else {
          freeSpinSteps += 1;
        }
        const round = engine.evaluateSpinRound(session, betAmount, {
          ante_enabled: anteOn,
          game_id: profile.game_id,
          rtp_profile: profile
        });
        const win = round.total_win;
        totalWin += win;
        if (round.is_free_spin) bonusWinTotal += win;
        if (!round.is_free_spin && Number(round.free_spins_awarded || 0) > 0) {
          bonusCatchCount += 1;
          bonusAwardedSpins += Number(round.free_spins_awarded || 0);
        }
        if (win > 0) hitSpins += 1;
        if (win >= betAmount * 20) big20 += 1;
        if (win >= betAmount * 50) huge50 += 1;
        if (win > maxWin) maxWin = win;
      }
      completed = end;
      const liveRtp = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
      const casinoNet = paidWager - totalWin;
      yield {
        type: "progress",
        payload: {
          steps_completed: completed,
          steps_total: steps,
          progress_percent: Number(((completed / steps) * 100).toFixed(2)),
          game_id: profile.game_id,
          slug: profile.slug,
          ante_enabled: anteOn,
          bonus_only: bonusOnly,
          charged_bet_amount: bonusOnly ? Number(betAmount.toFixed(2)) : chargedBet,
          current_rtp_percent: Number(liveRtp.toFixed(2)),
          current_player_total_win: Number(totalWin.toFixed(2)),
          current_casino_net: Number(casinoNet.toFixed(2)),
          current_hit_frequency_percent: Number(((hitSpins / completed) * 100).toFixed(2)),
          current_big_win_20x_count: big20,
          current_huge_win_50x_count: huge50,
          current_big_win_rate_percent: Number(((big20 / completed) * 100).toFixed(3)),
          current_huge_win_rate_percent: Number(((huge50 / completed) * 100).toFixed(3)),
          current_max_win_x: Number((maxWin / betAmount).toFixed(2)),
          current_bonus_catch_count: bonusCatchCount,
          current_bonus_catch_rate_percent: Number((paidSpins > 0 ? (bonusCatchCount / paidSpins) * 100 : 0).toFixed(4)),
          current_bonus_awarded_spins_total: bonusAwardedSpins,
          current_bonus_win_total: Number(bonusWinTotal.toFixed(2)),
          baseline_rtp_percent: Number(liveRtp.toFixed(2)),
          baseline_casino_net: Number(casinoNet.toFixed(2)),
          baseline_bonus_catch_count: bonusCatchCount,
          baseline_bonus_win_total: Number(bonusWinTotal.toFixed(2))
        }
      };
    }

    const liveRtpFinal = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
    const current = {
      steps,
      bet_amount: betAmount,
      game_id: profile.game_id,
      ante_enabled: anteOn,
      bonus_only: bonusOnly,
      charged_bet_amount: bonusOnly ? Number(betAmount.toFixed(2)) : chargedBet,
      paid_spins: paidSpins,
      free_spin_steps: freeSpinSteps,
      paid_wager: Number(paidWager.toFixed(2)),
      player_total_win: Number(totalWin.toFixed(2)),
      casino_net: Number((paidWager - totalWin).toFixed(2)),
      rtp_percent: Number(liveRtpFinal.toFixed(2)),
      house_edge_percent: Number((100 - liveRtpFinal).toFixed(2)),
      hit_frequency_percent: Number(((hitSpins / steps) * 100).toFixed(2)),
      big_win_20x_count: big20,
      huge_win_50x_count: huge50,
      big_win_rate_percent: Number(((big20 / steps) * 100).toFixed(3)),
      huge_win_rate_percent: Number(((huge50 / steps) * 100).toFixed(3)),
      max_win_x: Number((maxWin / betAmount).toFixed(2)),
      bonus_catch_count: bonusCatchCount,
      bonus_catch_rate_percent: Number((paidSpins > 0 ? (bonusCatchCount / paidSpins) * 100 : 0).toFixed(4)),
      avg_paid_spins_per_bonus_catch: bonusCatchCount > 0 ? Number((paidSpins / bonusCatchCount).toFixed(2)) : null,
      bonus_awarded_spins_total: bonusAwardedSpins,
      bonus_win_total: Number(bonusWinTotal.toFixed(2))
    };
    yield { type: "complete", payload: { report: buildSimulationReport({ steps, betAmount, current, profile }) } };
  }

  async function* simulateStreamAsync(engine, params) {
    const iter = simulateStream(engine, params);
    let res = iter.next();
    while (!res.done) {
      yield res.value;
      await new Promise((r) => setTimeout(r, 8));
      res = iter.next();
    }
  }

  function simulate(engine, params) {
    let lastReport = null;
    for (const evt of simulateStream(engine, params)) {
      if (evt.type === "complete") lastReport = evt.payload.report;
    }
    return lastReport;
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Simulator = { simulate, simulateStream, simulateStreamAsync };
})(typeof window !== "undefined" ? window : globalThis);
