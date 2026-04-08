const sessionIdEl = document.getElementById("sessionId");
const balanceEl = document.getElementById("balance");
const betViewEl = document.getElementById("betView");
const winningLinesEl = document.getElementById("winningLines");
const lastWinEl = document.getElementById("lastWin");
const freeSpinsEl = document.getElementById("freeSpins");
const betSelectEl = document.getElementById("betSelect");
const spinBtnEl = document.getElementById("spinBtn");
const reelsEl = document.getElementById("reels");
const resultDumpEl = document.getElementById("resultDump");
const lineExamplesEl = document.getElementById("lineExamples");
const paytableBodyEl = document.getElementById("paytableBody");
const caughtLinesEl = document.getElementById("caughtLines");

const PAYLINE_EXAMPLES = [
  { line: 1, path: "Middle-Middle-Middle-Middle-Middle", rows: [2, 2, 2, 2, 2] },
  { line: 2, path: "Top-Top-Top-Top-Top", rows: [1, 1, 1, 1, 1] },
  { line: 3, path: "Bottom-Bottom-Bottom-Bottom-Bottom", rows: [3, 3, 3, 3, 3] },
  { line: 4, path: "Top-Middle-Bottom-Middle-Top", rows: [1, 2, 3, 2, 1] },
  { line: 5, path: "Bottom-Middle-Top-Middle-Bottom", rows: [3, 2, 1, 2, 3] }
];

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
  A: { 3: 1.83, 4: 5.49, 5: 13.73 },
  B: { 3: 1.83, 4: 5.49, 5: 13.73 },
  C: { 3: 2.75, 4: 7.32, 5: 18.3 },
  D: { 3: 2.75, 4: 7.32, 5: 18.3 },
  E: { 3: 3.66, 4: 10.98, 5: 27.45 },
  F: { 3: 3.66, 4: 10.98, 5: 27.45 },
  G: { 3: 7.32, 4: 22.88, 5: 54.9 },
  H: { 3: 9.15, 4: 32.03, 5: 91.5 },
  WILD: { 3: 18.3, 4: 68.63, 5: 183.0 },
  SCATTER: { 3: 18.3, 4: 91.5, 5: 457.5 }
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

function renderMatrix(matrix, winningLineIndexes = [], spinningReels = []) {
  const highlightedCells = new Set();
  const spinningReelSet = new Set(spinningReels);

  winningLineIndexes.forEach((lineIndex) => {
    const path = ALL_PAYLINES[lineIndex];
    if (!path) return;
    path.forEach((row, reel) => {
      highlightedCells.add(`${row}-${reel}`);
    });
  });

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
  PAYLINE_EXAMPLES.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = `Line ${item.line}: ${item.path} (rows ${item.rows.join("-")})`;
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
    const path = ALL_PAYLINES[win.lineIndex]
      .map((row) => row + 1)
      .join("-");
    const li = document.createElement("li");
    li.textContent = `Line ${lineNumber} (rows ${path}) | ${SYMBOL_DISPLAY[win.symbol]} ${win.symbol} x${win.count} => ${formatMoney(win.amount)}`;
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

async function animateReelsToResult(finalMatrix, winningLineIndexes) {
  const working = createRandomMatrix();
  renderMatrix(working, [], [0, 1, 2, 3, 4]);
  await sleep(120);

  for (let reel = 0; reel < 5; reel += 1) {
    const ticks = 9 + reel * 2;
    for (let tick = 0; tick < ticks; tick += 1) {
      for (let row = 0; row < 3; row += 1) {
        working[row][reel] = randomSymbol();
      }
      const activeReels = [];
      for (let next = reel; next < 5; next += 1) activeReels.push(next);
      renderMatrix(working, [], activeReels);
      await sleep(55);
    }

    for (let row = 0; row < 3; row += 1) {
      working[row][reel] = finalMatrix[row][reel];
    }
    const activeReels = [];
    for (let next = reel + 1; next < 5; next += 1) activeReels.push(next);
    renderMatrix(working, [], activeReels);
    await sleep(90);
  }

  renderMatrix(finalMatrix, winningLineIndexes);
  if (winningLineIndexes.length > 0) {
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
  try {
    const bet = Number(betSelectEl.value);
    betViewEl.textContent = formatMoney(bet);
    renderCaughtLines([]);
    winningLinesEl.textContent = "0";
    const payload = await api("/api/v1/spin", {
      session_id: sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet
    });

    const winningLineIndexes = (payload.line_wins || []).map((x) => x.lineIndex);
    await animateReelsToResult(payload.matrix, winningLineIndexes);
    winningLinesEl.textContent = String(winningLineIndexes.length);
    balanceEl.textContent = formatMoney(payload.balance_after);
    lastWinEl.textContent = formatMoney(payload.total_win);
    freeSpinsEl.textContent = String(payload.free_spins_left);
    renderCaughtLines(payload.line_wins || []);
    resultDumpEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    resultDumpEl.textContent = `Error: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
  }
}

betSelectEl.addEventListener("change", () => {
  betViewEl.textContent = formatMoney(Number(betSelectEl.value));
});
spinBtnEl.addEventListener("click", spin);

renderEmptyGrid();
renderPaylineExamples();
renderPaytable();
winningLinesEl.textContent = "0";
initSession().catch((err) => {
  resultDumpEl.textContent = `Init failed: ${err.message}`;
});
