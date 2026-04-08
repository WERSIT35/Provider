const sessionIdEl = document.getElementById("sessionId");
const balanceEl = document.getElementById("balance");
const betViewEl = document.getElementById("betView");
const winningLinesEl = document.getElementById("winningLines");
const lastWinEl = document.getElementById("lastWin");
const freeSpinsEl = document.getElementById("freeSpins");
const betSelectEl = document.getElementById("betSelect");
const spinBtnEl = document.getElementById("spinBtn");
const simulateBtnEl = document.getElementById("simulateBtn");
const reelsEl = document.getElementById("reels");
const resultDumpEl = document.getElementById("resultDump");
const simulateDumpEl = document.getElementById("simulateDump");
const lineExamplesEl = document.getElementById("lineExamples");
const paytableBodyEl = document.getElementById("paytableBody");
const paytableTitleEl = document.getElementById("paytableTitle");
const caughtLinesEl = document.getElementById("caughtLines");
const spinsPlayedEl = document.getElementById("spinsPlayed");
const winSpinsEl = document.getElementById("winSpins");
const lossSpinsEl = document.getElementById("lossSpins");
const sessionWageredEl = document.getElementById("sessionWagered");
const sessionWonEl = document.getElementById("sessionWon");
const sessionNetEl = document.getElementById("sessionNet");
const simProgressBarEl = document.getElementById("simProgressBar");
const simProgressLabelEl = document.getElementById("simProgressLabel");
const simLiveRtpEl = document.getElementById("simLiveRtp");
const simLivePlayerWinEl = document.getElementById("simLivePlayerWin");
const simLiveCasinoNetEl = document.getElementById("simLiveCasinoNet");
const simLiveHitRateEl = document.getElementById("simLiveHitRate");
const simLiveBig20xEl = document.getElementById("simLiveBig20x");
const simLiveHuge50xEl = document.getElementById("simLiveHuge50x");
const simLiveMaxWinXEl = document.getElementById("simLiveMaxWinX");
const simLiveBaselineRtpEl = document.getElementById("simLiveBaselineRtp");
const simLiveBaselineNetEl = document.getElementById("simLiveBaselineNet");

const ALL_PAYLINES = [
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

const ROW_LABELS = ["Top", "Middle", "Bottom"];

const SYMBOL_DISPLAY = {
  A: "🍒",
  B: "🍋",
  C: "🍇",
  D: "🍀",
  E: "🔔",
  F: "💎",
  G: "🪙",
  H: "👑",
  WILD: "🌟",
  SCATTER: "🎯"
};

const SYMBOL_KEYS = Object.keys(SYMBOL_DISPLAY);

const PAYOUTS = {
  A: { 3: 0.73, 4: 2.2, 5: 5.49 },
  B: { 3: 0.73, 4: 2.2, 5: 5.49 },
  C: { 3: 1.1, 4: 2.93, 5: 7.32 },
  D: { 3: 1.1, 4: 2.93, 5: 7.32 },
  E: { 3: 1.46, 4: 4.39, 5: 10.98 },
  F: { 3: 1.46, 4: 4.39, 5: 10.98 },
  G: { 3: 2.93, 4: 9.15, 5: 21.96 },
  H: { 3: 20, 4: 150, 5: 1000 },
  WILD: { 3: 7.32, 4: 27.45, 5: 73.2 },
  SCATTER: { 3: 7.32, 4: 36.6, 5: 183.0 }
};

let sessionId = null;
let simulationAbortController = null;

const sessionLiveStats = {
  spinsPlayed: 0,
  winSpins: 0,
  lossSpins: 0,
  wagered: 0,
  won: 0
};

function formatMoney(v) {
  return Number(v).toFixed(2);
}

function getSelectedBetAmount() {
  const bet = Number(betSelectEl.value);
  return Number.isFinite(bet) && bet > 0 ? bet : 1;
}

function setSignedClass(el, value) {
  el.classList.remove("positive", "negative");
  if (value > 0) el.classList.add("positive");
  if (value < 0) el.classList.add("negative");
}

function renderSessionLiveStats() {
  const net = Number((sessionLiveStats.won - sessionLiveStats.wagered).toFixed(2));
  spinsPlayedEl.textContent = String(sessionLiveStats.spinsPlayed);
  winSpinsEl.textContent = String(sessionLiveStats.winSpins);
  lossSpinsEl.textContent = String(sessionLiveStats.lossSpins);
  sessionWageredEl.textContent = formatMoney(sessionLiveStats.wagered);
  sessionWonEl.textContent = formatMoney(sessionLiveStats.won);
  sessionNetEl.textContent = formatMoney(net);
  setSignedClass(sessionNetEl, net);
}

function resetSimulationLiveWidgets() {
  simProgressBarEl.style.width = "0%";
  simProgressLabelEl.textContent = "Idle";
  simLiveRtpEl.textContent = "0.00%";
  simLivePlayerWinEl.textContent = "0.00";
  simLiveCasinoNetEl.textContent = "0.00";
  simLiveHitRateEl.textContent = "0.00%";
  simLiveBig20xEl.textContent = "0";
  simLiveHuge50xEl.textContent = "0";
  simLiveMaxWinXEl.textContent = "0.00x";
  simLiveBaselineRtpEl.textContent = "0.00%";
  simLiveBaselineNetEl.textContent = "0.00";
  setSignedClass(simLiveCasinoNetEl, 0);
  setSignedClass(simLiveBaselineNetEl, 0);
}

function renderEmptyGrid() {
  reelsEl.innerHTML = "";
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = "-";
      reelsEl.appendChild(cell);
    }
  }
}

function getWinningCells(lineWins = []) {
  const highlightedCells = new Set();

  lineWins.forEach((win) => {
    const path = ALL_PAYLINES[win.lineIndex];
    if (!path) return;
    const matchedCount = Math.max(0, Math.min(Number(win.count) || 0, 5));
    for (let reel = 0; reel < matchedCount; reel += 1) {
      highlightedCells.add(`${path[reel]}-${reel}`);
    }
  });

  return highlightedCells;
}

function renderMatrix(matrix, lineWins = [], spinningReels = []) {
  const highlightedCells = getWinningCells(lineWins);
  const spinningReelSet = new Set(spinningReels);

  reelsEl.innerHTML = "";
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      const symbol = matrix[row][col];
      const cell = document.createElement("div");
      cell.className = "cell";
      if (spinningReelSet.has(col)) cell.classList.add("spinning-cell");
      if (highlightedCells.has(`${row}-${col}`)) cell.classList.add("win-cell");
      if (symbol === "WILD") cell.classList.add("wild");
      if (symbol === "SCATTER") cell.classList.add("scatter");
      cell.textContent = SYMBOL_DISPLAY[symbol] || symbol;
      cell.title = symbol;
      reelsEl.appendChild(cell);
    }
  }
}

function renderPaylineExamples() {
  lineExamplesEl.innerHTML = "";
  ALL_PAYLINES.forEach((lineRows, idx) => {
    const path = lineRows.map((row) => ROW_LABELS[row]).join("-");
    const rows = lineRows.map((row) => row + 1).join("-");
    const li = document.createElement("li");
    li.textContent = `Line ${idx + 1}: ${path} (rows ${rows})`;
    lineExamplesEl.appendChild(li);
  });
}

function renderPaytable(betAmount = getSelectedBetAmount()) {
  if (paytableTitleEl) {
    paytableTitleEl.textContent = `Payout Table (3/4/5) - Bet ${formatMoney(betAmount)}`;
  }
  paytableBodyEl.innerHTML = "";
  Object.entries(PAYOUTS).forEach(([symbol, values]) => {
    const tr = document.createElement("tr");
    const symbolTd = document.createElement("td");
    symbolTd.textContent = `${SYMBOL_DISPLAY[symbol]} ${symbol}`;
    const td3 = document.createElement("td");
    td3.textContent = formatMoney(values[3] * betAmount);
    const td4 = document.createElement("td");
    td4.textContent = formatMoney(values[4] * betAmount);
    const td5 = document.createElement("td");
    td5.textContent = formatMoney(values[5] * betAmount);
    tr.appendChild(symbolTd);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tr.appendChild(td5);
    paytableBodyEl.appendChild(tr);
  });
}

function renderCaughtLines(lineWins) {
  caughtLinesEl.innerHTML = "";
  if (!lineWins || lineWins.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No winning lines in this spin.";
    caughtLinesEl.appendChild(li);
    return;
  }

  lineWins.forEach((win) => {
    const lineNumber = win.lineIndex + 1;
    const fullPath = ALL_PAYLINES[win.lineIndex]
      .map((row) => row + 1)
      .join("-");
    const matchedPath = ALL_PAYLINES[win.lineIndex]
      .slice(0, win.count)
      .map((row) => row + 1)
      .join("-");
    const li = document.createElement("li");
    li.textContent = `Line ${lineNumber} | matched rows ${matchedPath} (full ${fullPath}) | ${SYMBOL_DISPLAY[win.symbol]} ${win.symbol} x${win.count} => ${formatMoney(win.amount)}`;
    caughtLinesEl.appendChild(li);
  });
}

function randomIndex(maxExclusive) {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return arr[0] % maxExclusive;
}

function randomSymbol() {
  return SYMBOL_KEYS[randomIndex(SYMBOL_KEYS.length)];
}

function stepReelDown(matrix, reel) {
  matrix[2][reel] = matrix[1][reel];
  matrix[1][reel] = matrix[0][reel];
  matrix[0][reel] = randomSymbol();
}

function createRandomMatrix() {
  const matrix = [[], [], []];
  for (let row = 0; row < 3; row += 1) {
    for (let col = 0; col < 5; col += 1) {
      matrix[row][col] = randomSymbol();
    }
  }
  return matrix;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPendingSpinAnimation() {
  const working = createRandomMatrix();
  const activeReels = [0, 1, 2, 3, 4];
  reelsEl.classList.add("reels-spinning");
  renderMatrix(working, [], activeReels);

  const intervalId = setInterval(() => {
    for (let col = 0; col < 5; col += 1) {
      stepReelDown(working, col);
    }
    renderMatrix(working, [], activeReels);
  }, 42);

  return {
    working,
    stop() {
      clearInterval(intervalId);
    }
  };
}

async function settleReelsToResult(working, finalMatrix, lineWins) {
  for (let reel = 0; reel < 5; reel += 1) {
    const ticks = 2 + reel;
    for (let tick = 0; tick < ticks; tick += 1) {
      for (let next = reel; next < 5; next += 1) {
        stepReelDown(working, next);
      }
      const activeReels = [];
      for (let next = reel; next < 5; next += 1) activeReels.push(next);
      renderMatrix(working, [], activeReels);
      await sleep(28);
    }

    for (let row = 0; row < 3; row += 1) {
      working[row][reel] = finalMatrix[row][reel];
    }
    const activeReels = [];
    for (let next = reel + 1; next < 5; next += 1) activeReels.push(next);
    renderMatrix(working, [], activeReels);
    await sleep(38);
  }

  renderMatrix(finalMatrix, lineWins);
  reelsEl.classList.remove("reels-spinning");
  if (lineWins.length > 0) {
    reelsEl.classList.add("win-pulse");
    setTimeout(() => reelsEl.classList.remove("win-pulse"), 550);
  }
}

async function api(path, payload) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "Request failed");
  return json;
}

async function streamSse(url, onEvent, signal) {
  const res = await fetch(url, {
    method: "GET",
    headers: { Accept: "text/event-stream" },
    signal
  });
  if (!res.ok) {
    throw new Error(`STREAM_HTTP_${res.status}`);
  }
  if (!res.body) {
    throw new Error("STREAM_NO_BODY");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);

      let eventName = "message";
      const dataLines = [];
      rawEvent.split("\n").forEach((line) => {
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
          return;
        }
        if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trim());
        }
      });

      if (dataLines.length > 0) {
        let payload = null;
        try {
          payload = JSON.parse(dataLines.join("\n"));
        } catch {
          payload = null;
        }
        onEvent(eventName, payload);
      }

      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function initSession() {
  const data = await api("/api/v1/session/init", {
    player_id: `player_${Date.now()}`,
    currency: "GEL",
    locale: "en",
    game_id: "project-khma"
  });
  sessionId = data.session_id;
  sessionIdEl.textContent = sessionId.slice(0, 8);
  balanceEl.textContent = formatMoney(data.balance);
  betSelectEl.innerHTML = "";
  data.allowed_bets.forEach((bet) => {
    const option = document.createElement("option");
    option.value = String(bet);
    option.textContent = formatMoney(bet);
    betSelectEl.appendChild(option);
  });
  betSelectEl.value = "1";
  betViewEl.textContent = "1.00";
  renderPaytable(getSelectedBetAmount());
  sessionLiveStats.spinsPlayed = 0;
  sessionLiveStats.winSpins = 0;
  sessionLiveStats.lossSpins = 0;
  sessionLiveStats.wagered = 0;
  sessionLiveStats.won = 0;
  renderSessionLiveStats();
  resetSimulationLiveWidgets();
}

async function spin() {
  if (!sessionId) return;
  spinBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  const pendingSpin = startPendingSpinAnimation();
  try {
    const spinStart = performance.now();
    const bet = Number(betSelectEl.value);
    betViewEl.textContent = formatMoney(bet);
    renderCaughtLines([]);
    winningLinesEl.textContent = "0";

    const payload = await api("/api/v1/spin", {
      session_id: sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet
    });

    const minSpinDurationMs = 260;
    const elapsed = performance.now() - spinStart;
    if (elapsed < minSpinDurationMs) {
      await sleep(minSpinDurationMs - elapsed);
    }

    pendingSpin.stop();
    const lineWins = payload.line_wins || [];
    await settleReelsToResult(pendingSpin.working, payload.matrix, lineWins);
    winningLinesEl.textContent = String(lineWins.length);
    balanceEl.textContent = formatMoney(payload.balance_after);
    lastWinEl.textContent = formatMoney(payload.total_win);
    freeSpinsEl.textContent = String(payload.free_spins_left);
    sessionLiveStats.spinsPlayed += 1;
    if (payload.total_win > 0) {
      sessionLiveStats.winSpins += 1;
    } else {
      sessionLiveStats.lossSpins += 1;
    }
    if (!payload.is_free_spin) {
      sessionLiveStats.wagered = Number((sessionLiveStats.wagered + bet).toFixed(2));
    }
    sessionLiveStats.won = Number((sessionLiveStats.won + payload.total_win).toFixed(2));
    renderSessionLiveStats();
    renderCaughtLines(lineWins);
    resultDumpEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    pendingSpin.stop();
    reelsEl.classList.remove("reels-spinning");
    renderMatrix(pendingSpin.working);
    resultDumpEl.textContent = `Error: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
    simulateBtnEl.disabled = false;
  }
}

function formatSimulationSummary(report) {
  return [
    `Steps: ${report.steps} | Bet: ${formatMoney(report.bet_amount)}`,
    `RTP target band: ${report.target_rtp_band.min}% - ${report.target_rtp_band.max}%`,
    "",
    `Baseline casino net: ${formatMoney(report.baseline.casino_net)}`,
    `Current casino net: ${formatMoney(report.current.casino_net)}`,
    `Diff (current - baseline): ${formatMoney(report.diff.casino_net_current_minus_baseline)}`,
    "",
    `Baseline RTP: ${report.baseline.rtp_percent}%`,
    `Current RTP: ${report.current.rtp_percent}%`,
    `RTP in target band: ${report.checks.current_rtp_in_target_band ? "YES" : "NO"}`,
    `Casino profitable (current): ${report.checks.current_casino_profitable ? "YES" : "NO"}`,
    `Big wins >=20x (baseline -> current): ${report.baseline.big_win_20x_count} -> ${report.current.big_win_20x_count}`,
    `Huge wins >=50x (baseline -> current): ${report.baseline.huge_win_50x_count} -> ${report.current.huge_win_50x_count}`
  ].join("\n");
}

async function runSimulation() {
  if (!sessionId) return;
  if (simulationAbortController) {
    simulationAbortController.abort();
    simulationAbortController = null;
  }
  spinBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  simulateDumpEl.textContent = "Running 1,000,000 spins... live stream started.";
  resetSimulationLiveWidgets();
  simProgressLabelEl.textContent = "Starting...";

  const bet = Number(betSelectEl.value);
  const streamUrl = `/api/v1/simulate/stream?steps=1000000&bet_amount=${encodeURIComponent(String(bet))}`;
  simulationAbortController = new AbortController();
  let streamCompleted = false;
  let fallbackStarted = false;
  let progressEventCount = 0;
  let lastProgressAt = Date.now();
  let stallTimer = null;

  const clearStallTimer = () => {
    if (!stallTimer) return;
    clearTimeout(stallTimer);
    stallTimer = null;
  };

  const releaseButtons = () => {
    spinBtnEl.disabled = false;
    simulateBtnEl.disabled = false;
  };

  const runFallback = async (label = "Stream failed, retrying fallback...") => {
    if (fallbackStarted || streamCompleted) return;
    fallbackStarted = true;
    clearStallTimer();
    if (simulationAbortController) {
      simulationAbortController.abort();
      simulationAbortController = null;
    }
    simProgressLabelEl.textContent = label;
    try {
      const report = await api("/api/v1/simulate", {
        steps: 1000000,
        bet_amount: bet
      });
      simProgressBarEl.style.width = "100%";
      simProgressLabelEl.textContent = "Completed (Fallback)";
      simLiveRtpEl.textContent = `${Number(report.current.rtp_percent).toFixed(2)}%`;
      simLivePlayerWinEl.textContent = formatMoney(report.current.player_total_win);
      simLiveCasinoNetEl.textContent = formatMoney(report.current.casino_net);
      setSignedClass(simLiveCasinoNetEl, report.current.casino_net);
      simLiveHitRateEl.textContent = `${Number(report.current.hit_frequency_percent).toFixed(2)}%`;
      simLiveBig20xEl.textContent = String(report.current.big_win_20x_count);
      simLiveHuge50xEl.textContent = String(report.current.huge_win_50x_count);
      simLiveMaxWinXEl.textContent = `${Number(report.current.max_win_x).toFixed(2)}x`;
      simLiveBaselineRtpEl.textContent = `${Number(report.baseline.rtp_percent).toFixed(2)}%`;
      simLiveBaselineNetEl.textContent = formatMoney(report.baseline.casino_net);
      setSignedClass(simLiveBaselineNetEl, report.baseline.casino_net);
      simulateDumpEl.textContent = formatSimulationSummary(report);
    } catch (err) {
      simProgressLabelEl.textContent = "Failed";
      simulateDumpEl.textContent = `Simulation failed: ${err.message}`;
    } finally {
      releaseButtons();
    }
  };

  const scheduleStallFallback = () => {
    clearStallTimer();
    stallTimer = setTimeout(() => {
      if (streamCompleted || fallbackStarted) return;
      const stalledMs = Date.now() - lastProgressAt;
      if (progressEventCount === 0 || stalledMs > 5500) {
        runFallback("Stream stalled, retrying fallback...");
      }
    }, 12000);
  };

  scheduleStallFallback();
  try {
    await streamSse(
      streamUrl,
      (eventName, payload) => {
        if (streamCompleted || fallbackStarted || !payload) return;
        if (eventName === "progress") {
          progressEventCount += 1;
          lastProgressAt = Date.now();
          const progress = Number(payload.progress_percent || 0);
          simProgressBarEl.style.width = `${Math.max(0, Math.min(100, progress))}%`;
          simProgressLabelEl.textContent = `${progress.toFixed(2)}% (${payload.steps_completed}/${payload.steps_total})`;
          simLiveRtpEl.textContent = `${Number(payload.current_rtp_percent || 0).toFixed(2)}%`;
          simLivePlayerWinEl.textContent = formatMoney(payload.current_player_total_win || 0);
          const liveCasinoNet = Number(payload.current_casino_net || 0);
          simLiveCasinoNetEl.textContent = formatMoney(liveCasinoNet);
          setSignedClass(simLiveCasinoNetEl, liveCasinoNet);
          simLiveHitRateEl.textContent = `${Number(payload.current_hit_frequency_percent || 0).toFixed(2)}%`;
          simLiveBig20xEl.textContent = String(payload.current_big_win_20x_count || 0);
          simLiveHuge50xEl.textContent = String(payload.current_huge_win_50x_count || 0);
          simLiveMaxWinXEl.textContent = `${Number(payload.current_max_win_x || 0).toFixed(2)}x`;
          simLiveBaselineRtpEl.textContent = `${Number(payload.baseline_rtp_percent || 0).toFixed(2)}%`;
          const liveBaselineNet = Number(payload.baseline_casino_net || 0);
          simLiveBaselineNetEl.textContent = formatMoney(liveBaselineNet);
          setSignedClass(simLiveBaselineNetEl, liveBaselineNet);
          scheduleStallFallback();
          return;
        }
        if (eventName === "complete") {
          streamCompleted = true;
          clearStallTimer();
          simProgressBarEl.style.width = "100%";
          simProgressLabelEl.textContent = "Completed";
          simulateDumpEl.textContent = formatSimulationSummary(payload.report);
        }
      },
      simulationAbortController.signal
    );

    if (!streamCompleted && !fallbackStarted) {
      await runFallback("Stream ended unexpectedly, retrying fallback...");
    } else if (!fallbackStarted) {
      releaseButtons();
    }
  } catch {
    await runFallback("Stream unavailable, retrying fallback...");
  } finally {
    clearStallTimer();
    simulationAbortController = null;
  }
}

betSelectEl.addEventListener("change", () => {
  const bet = getSelectedBetAmount();
  betViewEl.textContent = formatMoney(bet);
  renderPaytable(bet);
});
spinBtnEl.addEventListener("click", spin);
simulateBtnEl.addEventListener("click", runSimulation);

renderEmptyGrid();
renderPaylineExamples();
renderPaytable();
winningLinesEl.textContent = "0";
renderSessionLiveStats();
resetSimulationLiveWidgets();
initSession().catch((err) => {
  resultDumpEl.textContent = `Init failed: ${err.message}`;
});
