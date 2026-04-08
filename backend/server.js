const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "client");
const MATH_DIR = path.join(ROOT, "math");

const paytable = JSON.parse(
  fs.readFileSync(path.join(MATH_DIR, "paytable-v1.json"), "utf8")
);
const reelStrips = JSON.parse(
  fs.readFileSync(path.join(MATH_DIR, "reel-strips-v1.json"), "utf8")
);

const sessions = new Map();
const ALLOWED_BETS = [0.2, 0.5, 1, 2, 5, 10];

const PAYLINES = [
  [1, 1, 1, 1, 1],
  [0, 0, 0, 0, 0],
  [2, 2, 2, 2, 2],
  [0, 1, 2, 1, 0],
  [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0],
  [2, 2, 1, 2, 2],
  [1, 0, 0, 0, 1],
  [1, 2, 2, 2, 1],
  [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2],
  [1, 1, 0, 1, 1],
  [1, 1, 2, 1, 1],
  [0, 1, 0, 1, 0],
  [2, 1, 2, 1, 2],
  [1, 0, 1, 0, 1],
  [1, 2, 1, 2, 1],
  [0, 2, 0, 2, 0],
  [2, 0, 2, 0, 2],
  [0, 2, 2, 2, 0]
];
const TARGET_RTP_MIN = 93.5;
const TARGET_RTP_MAX = 94.5;
const BONUS_MULTIPLIER_START = 2;
const BONUS_MULTIPLIER_CAP = 5;
const FREE_SPIN_RETRIGGER_AWARD = 5;

const BASELINE_REELS = [
  ["A", "B", "C", "D", "E", "F", "G", "H", "A", "B", "C", "D", "E", "F", "G", "H", "WILD", "SCATTER", "A", "C", "E", "G"],
  ["A", "B", "C", "D", "E", "F", "G", "H", "A", "B", "C", "D", "E", "F", "G", "H", "WILD", "SCATTER", "B", "D", "F", "H"],
  ["A", "B", "C", "D", "E", "F", "G", "H", "A", "B", "C", "D", "E", "F", "G", "H", "WILD", "SCATTER", "A", "D", "F", "G"],
  ["A", "B", "C", "D", "E", "F", "G", "H", "A", "B", "C", "D", "E", "F", "G", "H", "WILD", "SCATTER", "B", "C", "E", "H"],
  ["A", "B", "C", "D", "E", "F", "G", "H", "A", "B", "C", "D", "E", "F", "G", "H", "WILD", "SCATTER", "A", "C", "F", "H"]
];

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function createSession({ player_id, currency, locale, game_id }) {
  const sessionId = crypto.randomUUID();
  const session = {
    sessionId,
    playerId: player_id || `player_${Date.now()}`,
    currency: currency || "GEL",
    locale: locale || "en",
    gameId: game_id || "project-khma",
    balance: 1000,
    freeSpinsLeft: 0,
    bonusMultiplier: 1,
    spinHistory: new Map(),
    createdAt: new Date().toISOString()
  };
  sessions.set(sessionId, session);
  return session;
}

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function generateMatrix(sourceReels = reelStrips.reels) {
  const matrix = [[], [], []];
  for (let reelIndex = 0; reelIndex < sourceReels.length; reelIndex += 1) {
    const strip = sourceReels[reelIndex];
    const stop = randomInt(strip.length);
    for (let row = 0; row < 3; row += 1) {
      matrix[row][reelIndex] = strip[(stop + row) % strip.length];
    }
  }
  return matrix;
}

function maybeApplyExpandingWild(matrix, isFreeSpin) {
  const chance = isFreeSpin ? 0.04 : 0.02;
  if (Math.random() >= chance) {
    return { matrix, expandedReel: null };
  }
  const expandedReel = randomInt(5);
  const next = matrix.map((r) => r.slice());
  for (let row = 0; row < 3; row += 1) {
    next[row][expandedReel] = "WILD";
  }
  return { matrix: next, expandedReel };
}

function maybeApplyExpandingWildWithChance(matrix, chance) {
  if (Math.random() >= chance) {
    return matrix;
  }
  const reel = randomInt(5);
  const next = matrix.map((r) => r.slice());
  for (let row = 0; row < 3; row += 1) {
    next[row][reel] = "WILD";
  }
  return next;
}

function countScatters(matrix) {
  let count = 0;
  for (let row = 0; row < 3; row += 1) {
    for (let reel = 0; reel < 5; reel += 1) {
      if (matrix[row][reel] === "SCATTER") count += 1;
    }
  }
  return count;
}

function evaluateLine(lineSymbols, betPerLine, multiplier) {
  const regularSymbols = Object.keys(paytable.symbols).filter(
    (s) => s !== "SCATTER"
  );
  let best = 0;
  let bestSymbol = null;
  let bestCount = 0;

  for (const symbol of regularSymbols) {
    let count = 0;
    for (let i = 0; i < lineSymbols.length; i += 1) {
      const sym = lineSymbols[i];
      const matches = sym === symbol || (sym === "WILD" && symbol !== "SCATTER");
      if (!matches) break;
      count += 1;
    }
    if (count >= 3) {
      const payout = paytable.symbols[symbol]?.[String(count)] || 0;
      const value = payout * betPerLine * multiplier;
      if (value > best) {
        best = value;
        bestSymbol = symbol;
        bestCount = count;
      }
    }
  }

  return {
    amount: Number(best.toFixed(2)),
    symbol: bestSymbol,
    count: bestCount
  };
}

function evaluateSpin(matrix, totalBet, bonusMultiplier) {
  const lineBet = totalBet;
  let lineWinsTotal = 0;
  const lineWins = [];

  for (let lineIndex = 0; lineIndex < PAYLINES.length; lineIndex += 1) {
    const payline = PAYLINES[lineIndex];
    const symbols = payline.map((row, reel) => matrix[row][reel]);
    const result = evaluateLine(symbols, lineBet, bonusMultiplier);
    if (result.amount > 0) {
      lineWinsTotal += result.amount;
      lineWins.push({
        lineIndex,
        symbol: result.symbol,
        count: result.count,
        amount: result.amount
      });
    }
  }

  const scatterCount = countScatters(matrix);
  const scatterMul = paytable.symbols.SCATTER[String(scatterCount)] || 0;
  const scatterWin = Number((scatterMul * totalBet).toFixed(2));

  const trigger = paytable.scatter_triggers[String(scatterCount)];
  const freeSpinsAwarded = trigger ? trigger.free_spins : 0;

  return {
    lineWins,
    lineWinsTotal: Number(lineWinsTotal.toFixed(2)),
    scatterCount,
    scatterWin,
    freeSpinsAwarded,
    totalWin: Number((lineWinsTotal + scatterWin).toFixed(2))
  };
}

function runSimulationProfile({
  steps,
  betAmount,
  reels,
  wildChanceBase,
  wildChanceFree,
  scatterTriggers
}) {
  let totalWin = 0;
  let paidWager = 0;
  let paidSpins = 0;
  let freeSpinSteps = 0;
  let freeSpinsLeft = 0;
  let bonusMultiplier = 1;
  let hitSpins = 0;
  let big20xCount = 0;
  let huge50xCount = 0;
  let maxWin = 0;

  for (let i = 0; i < steps; i += 1) {
    const isFreeSpin = freeSpinsLeft > 0;
    if (isFreeSpin) {
      freeSpinsLeft -= 1;
      freeSpinSteps += 1;
    } else {
      paidWager += betAmount;
      paidSpins += 1;
    }

    let matrix = generateMatrix(reels);
    const chance = isFreeSpin ? wildChanceFree : wildChanceBase;
    matrix = maybeApplyExpandingWildWithChance(matrix, chance);

    const activeMultiplier = isFreeSpin ? bonusMultiplier : 1;
    const evaluation = evaluateSpin(matrix, betAmount, activeMultiplier);
    let win = evaluation.totalWin;

    const trigger = scatterTriggers[String(evaluation.scatterCount)];
    if (trigger) {
      if (isFreeSpin) {
        freeSpinsLeft += FREE_SPIN_RETRIGGER_AWARD;
        bonusMultiplier = Math.min(BONUS_MULTIPLIER_CAP, bonusMultiplier + 1);
      } else {
        freeSpinsLeft += trigger.free_spins;
        bonusMultiplier = BONUS_MULTIPLIER_START;
      }
    }
    if (freeSpinsLeft === 0) {
      bonusMultiplier = 1;
    }

    if (win > 0) hitSpins += 1;
    if (win >= betAmount * 20) big20xCount += 1;
    if (win >= betAmount * 50) huge50xCount += 1;
    if (win > maxWin) maxWin = win;
    totalWin += win;
  }

  const rtpPercent = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
  const casinoNet = paidWager - totalWin;
  const hitFrequencyPercent = steps > 0 ? (hitSpins / steps) * 100 : 0;

  return {
    steps,
    bet_amount: betAmount,
    paid_spins: paidSpins,
    free_spin_steps: freeSpinSteps,
    paid_wager: Number(paidWager.toFixed(2)),
    player_total_win: Number(totalWin.toFixed(2)),
    casino_net: Number(casinoNet.toFixed(2)),
    rtp_percent: Number(rtpPercent.toFixed(2)),
    house_edge_percent: Number((100 - rtpPercent).toFixed(2)),
    hit_frequency_percent: Number(hitFrequencyPercent.toFixed(2)),
    big_win_20x_count: big20xCount,
    huge_win_50x_count: huge50xCount,
    max_win_x: Number((maxWin / betAmount).toFixed(2))
  };
}


function createSimulationState() {
  return {
    totalWin: 0,
    paidWager: 0,
    paidSpins: 0,
    freeSpinSteps: 0,
    freeSpinsLeft: 0,
    bonusMultiplier: 1,
    hitSpins: 0,
    big20xCount: 0,
    huge50xCount: 0,
    maxWin: 0
  };
}

function applySimulationStep(state, config, betAmount) {
  const isFreeSpin = state.freeSpinsLeft > 0;
  if (isFreeSpin) {
    state.freeSpinsLeft -= 1;
    state.freeSpinSteps += 1;
  } else {
    state.paidWager += betAmount;
    state.paidSpins += 1;
  }

  let matrix = generateMatrix(config.reels);
  const chance = isFreeSpin ? config.wildChanceFree : config.wildChanceBase;
  matrix = maybeApplyExpandingWildWithChance(matrix, chance);

  const activeMultiplier = isFreeSpin ? state.bonusMultiplier : 1;
  const evaluation = evaluateSpin(matrix, betAmount, activeMultiplier);
  const win = evaluation.totalWin;

  const trigger = config.scatterTriggers[String(evaluation.scatterCount)];
  if (trigger) {
    if (isFreeSpin) {
      state.freeSpinsLeft += FREE_SPIN_RETRIGGER_AWARD;
      state.bonusMultiplier = Math.min(BONUS_MULTIPLIER_CAP, state.bonusMultiplier + 1);
    } else {
      state.freeSpinsLeft += trigger.free_spins;
      state.bonusMultiplier = BONUS_MULTIPLIER_START;
    }
  }
  if (state.freeSpinsLeft === 0) {
    state.bonusMultiplier = 1;
  }

  if (win > 0) state.hitSpins += 1;
  if (win >= betAmount * 20) state.big20xCount += 1;
  if (win >= betAmount * 50) state.huge50xCount += 1;
  if (win > state.maxWin) state.maxWin = win;
  state.totalWin += win;
}

function finalizeSimulationState(state, steps, betAmount) {
  const rtpPercent = state.paidWager > 0 ? (state.totalWin / state.paidWager) * 100 : 0;
  const casinoNet = state.paidWager - state.totalWin;
  const hitFrequencyPercent = steps > 0 ? (state.hitSpins / steps) * 100 : 0;

  return {
    steps,
    bet_amount: betAmount,
    paid_spins: state.paidSpins,
    free_spin_steps: state.freeSpinSteps,
    paid_wager: Number(state.paidWager.toFixed(2)),
    player_total_win: Number(state.totalWin.toFixed(2)),
    casino_net: Number(casinoNet.toFixed(2)),
    rtp_percent: Number(rtpPercent.toFixed(2)),
    house_edge_percent: Number((100 - rtpPercent).toFixed(2)),
    hit_frequency_percent: Number(hitFrequencyPercent.toFixed(2)),
    big_win_20x_count: state.big20xCount,
    huge_win_50x_count: state.huge50xCount,
    max_win_x: Number((state.maxWin / betAmount).toFixed(2))
  };
}

function runSimulationComparison(steps, betAmount) {
  const current = runSimulationProfile({
    steps,
    betAmount,
    reels: reelStrips.reels,
    wildChanceBase: 0.02,
    wildChanceFree: 0.04,
    scatterTriggers: paytable.scatter_triggers
  });

  const baseline = runSimulationProfile({
    steps,
    betAmount,
    reels: BASELINE_REELS,
    wildChanceBase: 0.08,
    wildChanceFree: 0.12,
    scatterTriggers: {
      "3": { free_spins: 10 },
      "4": { free_spins: 14 },
      "5": { free_spins: 20 }
    }
  });

  return {
    steps,
    bet_amount: betAmount,
    target_rtp_band: {
      min: TARGET_RTP_MIN,
      max: TARGET_RTP_MAX
    },
    baseline,
    current,
    diff: {
      casino_net_current_minus_baseline: Number(
        (current.casino_net - baseline.casino_net).toFixed(2)
      ),
      rtp_percent_current_minus_baseline: Number(
        (current.rtp_percent - baseline.rtp_percent).toFixed(2)
      ),
      hit_frequency_percent_current_minus_baseline: Number(
        (current.hit_frequency_percent - baseline.hit_frequency_percent).toFixed(2)
      ),
      big_win_20x_count_current_minus_baseline:
        current.big_win_20x_count - baseline.big_win_20x_count,
      huge_win_50x_count_current_minus_baseline:
        current.huge_win_50x_count - baseline.huge_win_50x_count
    },
    checks: {
      current_rtp_in_target_band:
        current.rtp_percent >= TARGET_RTP_MIN &&
        current.rtp_percent <= TARGET_RTP_MAX,
      current_casino_profitable: current.casino_net > 0
    }
  };
}

function streamSimulationComparison(req, res, steps, betAmount) {
  const currentConfig = {
    reels: reelStrips.reels,
    wildChanceBase: 0.02,
    wildChanceFree: 0.04,
    scatterTriggers: paytable.scatter_triggers
  };

  const baselineConfig = {
    reels: BASELINE_REELS,
    wildChanceBase: 0.08,
    wildChanceFree: 0.12,
    scatterTriggers: {
      "3": { free_spins: 10 },
      "4": { free_spins: 14 },
      "5": { free_spins: 20 }
    }
  };

  const currentState = createSimulationState();
  const baselineState = createSimulationState();
  const chunkSize = 2000;
  let completed = 0;
  let closed = false;

  req.on("close", () => {
    closed = true;
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.write("\n");

  const sendEvent = (eventName, payload) => {
    if (closed) return;
    res.write(`event: ${eventName}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  sendEvent("progress", {
    steps_completed: 0,
    steps_total: steps,
    progress_percent: 0,
    current_rtp_percent: 0,
    current_player_total_win: 0,
    current_casino_net: 0,
    current_hit_frequency_percent: 0,
    current_big_win_20x_count: 0,
    current_huge_win_50x_count: 0,
    current_max_win_x: 0,
    baseline_rtp_percent: 0,
    baseline_casino_net: 0
  });

  const tick = () => {
    if (closed) return;
    const limit = Math.min(completed + chunkSize, steps);
    for (let i = completed; i < limit; i += 1) {
      applySimulationStep(currentState, currentConfig, betAmount);
      applySimulationStep(baselineState, baselineConfig, betAmount);
    }
    completed = limit;

    const liveCurrentRtp =
      currentState.paidWager > 0
        ? (currentState.totalWin / currentState.paidWager) * 100
        : 0;
    const liveCurrentCasinoNet = currentState.paidWager - currentState.totalWin;
    const liveCurrentHitFrequency = completed > 0 ? (currentState.hitSpins / completed) * 100 : 0;
    const liveCurrentMaxWinX = betAmount > 0 ? currentState.maxWin / betAmount : 0;
    const liveBaselineRtp =
      baselineState.paidWager > 0
        ? (baselineState.totalWin / baselineState.paidWager) * 100
        : 0;
    const liveBaselineCasinoNet = baselineState.paidWager - baselineState.totalWin;

    sendEvent("progress", {
      steps_completed: completed,
      steps_total: steps,
      progress_percent: Number(((completed / steps) * 100).toFixed(2)),
      current_rtp_percent: Number(liveCurrentRtp.toFixed(2)),
      current_player_total_win: Number(currentState.totalWin.toFixed(2)),
      current_casino_net: Number(liveCurrentCasinoNet.toFixed(2)),
      current_hit_frequency_percent: Number(liveCurrentHitFrequency.toFixed(2)),
      current_big_win_20x_count: currentState.big20xCount,
      current_huge_win_50x_count: currentState.huge50xCount,
      current_max_win_x: Number(liveCurrentMaxWinX.toFixed(2)),
      baseline_rtp_percent: Number(liveBaselineRtp.toFixed(2)),
      baseline_casino_net: Number(liveBaselineCasinoNet.toFixed(2))
    });

    if (completed < steps) {
      setImmediate(tick);
      return;
    }

    const current = finalizeSimulationState(currentState, steps, betAmount);
    const baseline = finalizeSimulationState(baselineState, steps, betAmount);
    const report = {
      steps,
      bet_amount: betAmount,
      target_rtp_band: {
        min: TARGET_RTP_MIN,
        max: TARGET_RTP_MAX
      },
      baseline,
      current,
      diff: {
        casino_net_current_minus_baseline: Number(
          (current.casino_net - baseline.casino_net).toFixed(2)
        ),
        rtp_percent_current_minus_baseline: Number(
          (current.rtp_percent - baseline.rtp_percent).toFixed(2)
        ),
        hit_frequency_percent_current_minus_baseline: Number(
          (current.hit_frequency_percent - baseline.hit_frequency_percent).toFixed(2)
        ),
        big_win_20x_count_current_minus_baseline:
          current.big_win_20x_count - baseline.big_win_20x_count,
        huge_win_50x_count_current_minus_baseline:
          current.huge_win_50x_count - baseline.huge_win_50x_count
      },
      checks: {
        current_rtp_in_target_band:
          current.rtp_percent >= TARGET_RTP_MIN &&
          current.rtp_percent <= TARGET_RTP_MAX,
        current_casino_profitable: current.casino_net > 0
      }
    };

    sendEvent("complete", { report });
    if (!closed) res.end();
  };

  tick();
}

function resolveSpin(session, spinId, betAmount) {
  if (session.spinHistory.has(spinId)) {
    return session.spinHistory.get(spinId);
  }

  const isFreeSpin = session.freeSpinsLeft > 0;
  if (!isFreeSpin && session.balance < betAmount) {
    throw new Error("INSUFFICIENT_FUNDS");
  }

  if (!isFreeSpin) {
    session.balance = Number((session.balance - betAmount).toFixed(2));
  } else {
    session.freeSpinsLeft -= 1;
  }

  const baseMatrix = generateMatrix();
  const withFeature = maybeApplyExpandingWild(baseMatrix, isFreeSpin);
  const activeMultiplier = isFreeSpin ? session.bonusMultiplier : 1;
  const evaluation = evaluateSpin(withFeature.matrix, betAmount, activeMultiplier);
  const totalWin = evaluation.totalWin;

  if (evaluation.freeSpinsAwarded > 0) {
    if (isFreeSpin) {
      session.freeSpinsLeft += FREE_SPIN_RETRIGGER_AWARD;
      session.bonusMultiplier = Math.min(BONUS_MULTIPLIER_CAP, session.bonusMultiplier + 1);
    } else {
      session.freeSpinsLeft += evaluation.freeSpinsAwarded;
      session.bonusMultiplier = BONUS_MULTIPLIER_START;
    }
  }

  session.balance = Number((session.balance + totalWin).toFixed(2));
  if (session.freeSpinsLeft === 0) {
    session.bonusMultiplier = 1;
  }

  const payload = {
    spin_id: spinId,
    is_free_spin: isFreeSpin,
    multiplier_applied: activeMultiplier,
    matrix: withFeature.matrix,
    expanded_wild_reel: withFeature.expandedReel,
    line_wins: evaluation.lineWins,
    scatter_count: evaluation.scatterCount,
    scatter_win: evaluation.scatterWin,
    free_spins_awarded: evaluation.freeSpinsAwarded,
    free_spins_left: session.freeSpinsLeft,
    total_win: totalWin,
    balance_after: session.balance
  };

  session.spinHistory.set(spinId, payload);
  return payload;
}

function handleApi(req, res, parsedUrl) {
  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/health") {
    return sendJson(res, 200, { status: "ok", uptime: process.uptime() });
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/session/init") {
    return parseBody(req)
      .then((body) => {
        const session = createSession(body);
        sendJson(res, 200, {
          session_id: session.sessionId,
          balance: session.balance,
          allowed_bets: ALLOWED_BETS,
          currency: session.currency,
          locale: session.locale,
          game_id: session.gameId,
          math_config_id: paytable.version
        });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/spin") {
    return parseBody(req)
      .then((body) => {
        const session = sessions.get(body.session_id);
        if (!session) {
          sendJson(res, 404, { error: "SESSION_NOT_FOUND" });
          return;
        }
        const spinId = body.spin_id || crypto.randomUUID();
        const betAmount = Number(body.bet_amount);
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
          return;
        }
        try {
          const outcome = resolveSpin(session, spinId, betAmount);
          sendJson(res, 200, outcome);
        } catch (err) {
          sendJson(res, 400, { error: err.message || "INTERNAL_ERROR" });
        }
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/simulate/stream") {
    const steps = Number(parsedUrl.searchParams.get("steps"));
    const betAmount = Number(parsedUrl.searchParams.get("bet_amount"));
    if (!Number.isInteger(steps) || steps < 1000 || steps > 1000000) {
      sendJson(res, 400, {
        error: "INVALID_STEPS",
        min_steps: 1000,
        max_steps: 1000000
      });
      return;
    }
    if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
      sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
      return;
    }
    streamSimulationComparison(req, res, steps, betAmount);
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/simulate") {
    return parseBody(req)
      .then((body) => {
        const steps = Number(body.steps);
        const betAmount = Number(body.bet_amount);
        if (!Number.isInteger(steps) || steps < 1000 || steps > 1000000) {
          sendJson(res, 400, {
            error: "INVALID_STEPS",
            min_steps: 1000,
            max_steps: 1000000
          });
          return;
        }
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
          return;
        }
        const report = runSimulationComparison(steps, betAmount);
        sendJson(res, 200, report);
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

function serveStatic(req, res, parsedUrl) {
  let requested = parsedUrl.pathname;
  if (requested === "/") requested = "/index.html";
  const filePath = path.normalize(path.join(CLIENT_DIR, requested));
  if (!filePath.startsWith(CLIENT_DIR)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname.startsWith("/api/")) {
    handleApi(req, res, parsedUrl);
    return;
  }
  if (req.method === "GET") {
    serveStatic(req, res, parsedUrl);
    return;
  }
  sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
});

server.listen(PORT, () => {
  console.log(`Slot MVP running at http://localhost:${PORT}`);
});
