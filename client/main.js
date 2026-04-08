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
const caughtLinesEl = document.getElementById("caughtLines");

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
  H: { 3: 3.66, 4: 12.81, 5: 36.6 },
  WILD: { 3: 7.32, 4: 27.45, 5: 73.2 },
  SCATTER: { 3: 7.32, 4: 36.6, 5: 183.0 }
};

let sessionId = null;

function formatMoney(v) {
  return Number(v).toFixed(2);
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

function renderPaytable() {
  paytableBodyEl.innerHTML = "";
  Object.entries(PAYOUTS).forEach(([symbol, values]) => {
    const tr = document.createElement("tr");
    const symbolTd = document.createElement("td");
    symbolTd.textContent = `${SYMBOL_DISPLAY[symbol]} ${symbol}`;
    const td3 = document.createElement("td");
    td3.textContent = Number(values[3]).toFixed(2);
    const td4 = document.createElement("td");
    td4.textContent = Number(values[4]).toFixed(2);
    const td5 = document.createElement("td");
    td5.textContent = Number(values[5]).toFixed(2);
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
  spinBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  simulateDumpEl.textContent = "Running 1,000,000 spins... please wait.";
  try {
    const bet = Number(betSelectEl.value);
    const report = await api("/api/v1/simulate", {
      steps: 1000000,
      bet_amount: bet
    });
    simulateDumpEl.textContent = formatSimulationSummary(report);
  } catch (err) {
    simulateDumpEl.textContent = `Simulation failed: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
    simulateBtnEl.disabled = false;
  }
}

betSelectEl.addEventListener("change", () => {
  betViewEl.textContent = formatMoney(Number(betSelectEl.value));
});
spinBtnEl.addEventListener("click", spin);
simulateBtnEl.addEventListener("click", runSimulation);

renderEmptyGrid();
renderPaylineExamples();
renderPaytable();
winningLinesEl.textContent = "0";
initSession().catch((err) => {
  resultDumpEl.textContent = `Init failed: ${err.message}`;
});
