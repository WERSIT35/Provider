const sessionIdEl = document.getElementById("sessionId");
const balanceEl = document.getElementById("balance");
const betViewEl = document.getElementById("betView");
const winningLinesEl = document.getElementById("winningLines");
const lastWinEl = document.getElementById("lastWin");
const freeSpinsEl = document.getElementById("freeSpins");
const betSelectEl = document.getElementById("betSelect");
const spinBtnEl = document.getElementById("spinBtn");
const simulateBtnEl = document.getElementById("simulateBtn");
const buyFreeBtnEl = document.getElementById("buyFreeBtn");
const anteToggleEl = document.getElementById("anteToggle");
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
const simLiveBigRateEl = document.getElementById("simLiveBigRate");
const simLiveHugeRateEl = document.getElementById("simLiveHugeRate");
const simLiveMaxWinXEl = document.getElementById("simLiveMaxWinX");
const simLiveBonusCatchesEl = document.getElementById("simLiveBonusCatches");
const simLiveBonusCatchRateEl = document.getElementById("simLiveBonusCatchRate");
const simLiveBonusWinEl = document.getElementById("simLiveBonusWin");
const simLiveBaselineRtpEl = document.getElementById("simLiveBaselineRtp");
const simLiveBaselineNetEl = document.getElementById("simLiveBaselineNet");
const rulesBtnEl = document.getElementById("rulesBtn");
const rulesModalEl = document.getElementById("rulesModal");
const rulesTitleEl = document.getElementById("rulesTitle");
const rulesMetaEl = document.getElementById("rulesMeta");
const rulesListEl = document.getElementById("rulesList");
const rulesPrevBtnEl = document.getElementById("rulesPrevBtn");
const rulesNextBtnEl = document.getElementById("rulesNextBtn");
const rulesPageLabelEl = document.getElementById("rulesPageLabel");
const rulesCloseBtnEl = document.getElementById("rulesCloseBtn");
const lineCountEl = document.getElementById("lineCount");
const symbolLegendEl = document.getElementById("symbolLegend");
const payoutRuleTextEl = document.getElementById("payoutRuleText");

const DEFAULT_SYMBOL_DISPLAY = {
  TOP_CROWN: "👑",
  HOURGLASS: "⏳",
  RING: "💍",
  CHALICE: "🏆",
  RED_GEM: "🟥",
  PURPLE_TRIANGLE: "🔻",
  YELLOW_HEX: "🟡",
  GREEN_TRIANGLE: "🔺",
  BLUE_DIAMOND: "🔷",
  MULTI: "✨",
  SCATTER: "⚡"
};

const SYMBOL_ASSETS = {
  TOP_CROWN: "/assets/symbols/top_crown.svg",
  HOURGLASS: "/assets/symbols/hourglass.svg",
  RING: "/assets/symbols/ring.svg",
  CHALICE: "/assets/symbols/chalice.svg",
  RED_GEM: "/assets/symbols/red_gem.svg",
  PURPLE_TRIANGLE: "/assets/symbols/purple_triangle.svg",
  YELLOW_HEX: "/assets/symbols/yellow_hex.svg",
  GREEN_TRIANGLE: "/assets/symbols/green_triangle.svg",
  BLUE_DIAMOND: "/assets/symbols/blue_diamond.svg",
  MULTI: "/assets/symbols/multi.svg",
  SCATTER: "/assets/symbols/scatter.svg"
};

const SYMBOL_TEXT = {
  TOP_CROWN: "Top Crown",
  HOURGLASS: "Hourglass",
  RING: "Ring",
  CHALICE: "Chalice",
  RED_GEM: "Red Gem",
  PURPLE_TRIANGLE: "Purple Triangle",
  YELLOW_HEX: "Yellow Hex",
  GREEN_TRIANGLE: "Green Triangle",
  BLUE_DIAMOND: "Blue Diamond",
  MULTI: "Multiplier",
  SCATTER: "Scatter"
};

const DEFAULT_PAYOUTS = {
  TOP_CROWN: { "8-9": 20, "10-11": 50, "12-30": 100 },
  HOURGLASS: { "8-9": 5, "10-11": 20, "12-30": 50 },
  RING: { "8-9": 4, "10-11": 10, "12-30": 30 },
  CHALICE: { "8-9": 3, "10-11": 4, "12-30": 24 },
  RED_GEM: { "8-9": 2, "10-11": 3, "12-30": 20 },
  PURPLE_TRIANGLE: { "8-9": 1.6, "10-11": 2.4, "12-30": 16 },
  YELLOW_HEX: { "8-9": 1, "10-11": 2, "12-30": 10 },
  GREEN_TRIANGLE: { "8-9": 0.8, "10-11": 1.8, "12-30": 8 },
  BLUE_DIAMOND: { "8-9": 0.5, "10-11": 1.5, "12-30": 4 }
};

const DEFAULT_SCATTER_PAYOUTS = { 4: 6, 5: 10, 6: 200 };

let SYMBOL_DISPLAY = { ...DEFAULT_SYMBOL_DISPLAY };
let PAYOUTS = { ...DEFAULT_PAYOUTS };
let SCATTER_PAYOUTS = { ...DEFAULT_SCATTER_PAYOUTS };
let SYMBOL_KEYS = Object.keys(SYMBOL_DISPLAY);
let PAYOUT_GROUP_LABELS = ["8-9", "10-11", "12-30"];

let sessionId = null;
let simulationAbortController = null;
let rulesConfig = null;
let rulesPageIndex = 0;
const DEFAULT_ROWS = 5;
const DEFAULT_REELS = 6;
const ANIMATION_TIMING = {
  spinTickMs: 52,
  minSpinNoWinMs: 380,
  minSpinWinMs: 880,
  settleTickNoWinMs: 36,
  settleTickWinMs: 62,
  settleLockNoWinMs: 46,
  settleLockWinMs: 84,
  preTumbleHoldMs: 170,
  winVanishMs: 90,
  tumbleFlashMs: 120,
  tumbleDropMs: 520,
  winPulseMs: 1200
};

const sessionLiveStats = {
  spinsPlayed: 0,
  winSpins: 0,
  lossSpins: 0,
  wagered: 0,
  won: 0
};

function normalizeSymbolCode(raw) {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function symbolText(symbol) {
  return SYMBOL_TEXT[symbol] || symbol;
}

function symbolFace(symbol) {
  return SYMBOL_DISPLAY[symbol] || "🔹";
}

function buildLegendText() {
  return SYMBOL_KEYS.map((symbol) => `${symbolFace(symbol)} ${symbolText(symbol)}`).join(", ");
}

function applyRuleDrivenDisplay(rules) {
  if (!rules) return;

  const payoutGroups = Array.isArray(rules.symbol_payout_display?.groups)
    ? rules.symbol_payout_display.groups
    : [];
  PAYOUT_GROUP_LABELS = payoutGroups.length > 0
    ? payoutGroups.map((group) => String(group.label))
    : ["8-9", "10-11", "12-30"];

  const symbols = Array.isArray(rules.symbol_payout_display?.symbols)
    ? rules.symbol_payout_display.symbols
    : [];

  const nextPayouts = {};
  const nextDisplay = { ...DEFAULT_SYMBOL_DISPLAY };
  const nextText = { ...SYMBOL_TEXT };
  let nextScatterPayouts = { ...DEFAULT_SCATTER_PAYOUTS };

  symbols.forEach((entry) => {
    const code = normalizeSymbolCode(entry.symbol);
    if (!code) return;
    nextText[code] = String(entry.symbol);
    if (code === "SCATTER") {
      nextScatterPayouts = {};
      Object.entries(entry.payouts || {}).forEach(([count, value]) => {
        nextScatterPayouts[count] = Number(value);
      });
      return;
    }
    nextPayouts[code] = { ...(entry.payouts || {}) };
  });

  PAYOUTS = Object.keys(nextPayouts).length > 0 ? nextPayouts : { ...DEFAULT_PAYOUTS };
  SCATTER_PAYOUTS = nextScatterPayouts;
  SYMBOL_DISPLAY = nextDisplay;
  Object.assign(SYMBOL_TEXT, nextText);
  SYMBOL_KEYS = [...Object.keys(PAYOUTS), "MULTI", "SCATTER"];

  if (symbolLegendEl) symbolLegendEl.textContent = buildLegendText();
  if (payoutRuleTextEl) {
    payoutRuleTextEl.textContent = "Symbol payouts are multipliers of base bet. Scatter pays on any position.";
  }
  const group1El = document.getElementById("payoutGroup1");
  const group2El = document.getElementById("payoutGroup2");
  const group3El = document.getElementById("payoutGroup3");
  if (group1El) group1El.textContent = PAYOUT_GROUP_LABELS[0] || "8-9";
  if (group2El) group2El.textContent = PAYOUT_GROUP_LABELS[1] || "10-11";
  if (group3El) group3El.textContent = PAYOUT_GROUP_LABELS[2] || "12-30";

  const anteEnabled = Boolean(rules.features?.ante_bet?.enabled);
  const anteMultiplier = Number(rules.features?.ante_bet?.multiplier || 1.25).toFixed(2);
  anteToggleEl.checked = false;
  anteToggleEl.disabled = !anteEnabled;
  const anteLabelEl = anteToggleEl.closest("label");
  if (anteLabelEl) {
    anteLabelEl.style.opacity = anteEnabled ? "1" : "0.55";
    anteLabelEl.title = anteEnabled ? "" : "Ante Bet is disabled by rules";
    const trailingText = Array.from(anteLabelEl.childNodes).find((node) => node.nodeType === Node.TEXT_NODE);
    if (trailingText) trailingText.nodeValue = ` Ante Bet ${anteMultiplier}x`;
  }

  const buyEnabled = Boolean(rules.features?.buy_free_spins?.enabled);
  const buyCost = Number(rules.features?.buy_free_spins?.cost_multiplier || 100);
  buyFreeBtnEl.textContent = `Buy Free Spins (${buyCost}x)`;
  syncBuyButtonState();
}

function syncBuyButtonState() {
  const buyEnabled = Boolean(rulesConfig?.features?.buy_free_spins?.enabled);
  const blockedByAnte = Boolean(anteToggleEl.checked);
  buyFreeBtnEl.disabled = !buyEnabled || blockedByAnte;
  if (!buyEnabled) {
    buyFreeBtnEl.title = "Buy Free Spins is disabled by rules";
    return;
  }
  if (blockedByAnte) {
    buyFreeBtnEl.title = "Disable Ante Bet to use Buy Free Spins";
    return;
  }
  buyFreeBtnEl.title = "";
}

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
  simLiveBigRateEl.textContent = "0.000%";
  simLiveHugeRateEl.textContent = "0.000%";
  simLiveMaxWinXEl.textContent = "0.00x";
  simLiveBonusCatchesEl.textContent = "0";
  simLiveBonusCatchRateEl.textContent = "0.0000%";
  simLiveBonusWinEl.textContent = "0.00";
  simLiveBaselineRtpEl.textContent = "0.00%";
  simLiveBaselineNetEl.textContent = "0.00";
  setSignedClass(simLiveCasinoNetEl, 0);
  setSignedClass(simLiveBaselineNetEl, 0);
}

function setRulesModalVisible(visible) {
  rulesModalEl.classList.toggle("hidden", !visible);
  rulesModalEl.setAttribute("aria-hidden", visible ? "false" : "true");
}

function renderRulesPage() {
  if (!rulesConfig || !Array.isArray(rulesConfig.rules_pages) || rulesConfig.rules_pages.length === 0) {
    rulesTitleEl.textContent = "Game Rules";
    rulesMetaEl.textContent = "Rules are not available.";
    rulesListEl.innerHTML = "";
    rulesPageLabelEl.textContent = "Page 0/0";
    rulesPrevBtnEl.disabled = true;
    rulesNextBtnEl.disabled = true;
    return;
  }

  const pages = rulesConfig.rules_pages;
  const page = pages[rulesPageIndex];
  rulesTitleEl.textContent = page.title || "Game Rules";
  rulesMetaEl.textContent = `RTP ${Number(rulesConfig.rtp.theoretical_percent).toFixed(2)}% | Volatility ${String(rulesConfig.volatility || "").toUpperCase()} | Mode ${rulesConfig.mode}`;
  rulesListEl.innerHTML = "";
  (page.points || []).forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    rulesListEl.appendChild(li);
  });
  rulesPageLabelEl.textContent = `Page ${rulesPageIndex + 1}/${pages.length}`;
  rulesPrevBtnEl.disabled = rulesPageIndex === 0;
  rulesNextBtnEl.disabled = rulesPageIndex === pages.length - 1;
}

function openRulesModal() {
  setRulesModalVisible(true);
  renderRulesPage();
}

function closeRulesModal() {
  setRulesModalVisible(false);
}

async function loadGameRules() {
  try {
    const rules = await fetch("/api/v1/game-rules").then((r) => {
      if (!r.ok) throw new Error(`HTTP_${r.status}`);
      return r.json();
    });
    rulesConfig = rules;
    rulesPageIndex = 0;
    applyRuleDrivenDisplay(rules);
    const paysText = String(rules.layout?.pays || "symbols_pay_anywhere").replaceAll("_", " ");
    if (lineCountEl) lineCountEl.textContent = paysText;
    if (Number.isFinite(Number(rules.layout?.reels))) {
      reelsEl.style.gridTemplateColumns = `repeat(${Number(rules.layout.reels)}, 1fr)`;
    }
    renderRulesPage();
  } catch {
    rulesConfig = null;
    rulesPageIndex = 0;
    if (symbolLegendEl) symbolLegendEl.textContent = buildLegendText();
    if (payoutRuleTextEl) payoutRuleTextEl.textContent = "Symbol payouts are multipliers of base bet. Scatter pays on any position.";
    renderRulesPage();
  }
}

function renderEmptyGrid() {
  reelsEl.style.gridTemplateColumns = `repeat(${DEFAULT_REELS}, 1fr)`;
  reelsEl.innerHTML = "";
  for (let row = 0; row < DEFAULT_ROWS; row += 1) {
    for (let col = 0; col < DEFAULT_REELS; col += 1) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.textContent = "-";
      reelsEl.appendChild(cell);
    }
  }
}

function getWinningCells(winningPositions = []) {
  const highlightedCells = new Set();
  winningPositions.forEach((pos) => {
    if (!Number.isInteger(pos?.row) || !Number.isInteger(pos?.col)) return;
    highlightedCells.add(`${pos.row}-${pos.col}`);
  });
  return highlightedCells;
}

function renderMatrix(matrix, winningPositions = [], spinningReels = [], fallingMap = null) {
  const highlightedCells = getWinningCells(winningPositions);
  const spinningReelSet = new Set(spinningReels);
  const activeFallingMap = fallingMap && typeof fallingMap === "object" ? fallingMap : null;
  const rows = matrix.length || DEFAULT_ROWS;
  const reels = matrix[0]?.length || DEFAULT_REELS;
  reelsEl.style.gridTemplateColumns = `repeat(${reels}, 1fr)`;

  reelsEl.innerHTML = "";
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < reels; col += 1) {
      const symbol = matrix[row]?.[col] || "-";
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.row = String(row);
      cell.dataset.col = String(col);
      if (spinningReelSet.has(col)) cell.classList.add("spinning-cell");
      const dropCells = activeFallingMap ? Number(activeFallingMap[`${row}-${col}`] || 0) : 0;
      if (dropCells > 0) {
        cell.classList.add("falling-cell");
        cell.style.setProperty("--drop-cells", String(dropCells));
      }
      if (highlightedCells.has(`${row}-${col}`)) cell.classList.add("win-cell");
      if (symbol === "MULTI") cell.classList.add("wild");
      if (symbol === "SCATTER") cell.classList.add("scatter");
      const icon = SYMBOL_ASSETS[symbol];
      if (icon) {
        const img = document.createElement("img");
        img.className = "symbol-icon";
        img.src = icon;
        img.alt = symbolText(symbol);
        img.draggable = false;
        cell.appendChild(img);
      } else {
        cell.textContent = symbolFace(symbol);
      }
      cell.title = symbol;
      cell.style.setProperty("--row", String(row));
      cell.style.setProperty("--col", String(col));
      reelsEl.appendChild(cell);
    }
  }
}

function buildTumbleDropMap(stepMatrix, winningPositions) {
  const rows = stepMatrix.length || DEFAULT_ROWS;
  const reels = stepMatrix[0]?.length || DEFAULT_REELS;
  const byColumn = new Map();
  winningPositions.forEach((pos) => {
    if (!Number.isInteger(pos?.row) || !Number.isInteger(pos?.col)) return;
    if (!byColumn.has(pos.col)) byColumn.set(pos.col, new Set());
    byColumn.get(pos.col).add(pos.row);
  });

  const dropMap = {};
  for (let col = 0; col < reels; col += 1) {
    const removedRows = byColumn.get(col);
    if (!removedRows || removedRows.size === 0) continue;
    const survivors = [];
    for (let row = 0; row < rows; row += 1) {
      if (!removedRows.has(row)) {
        survivors.push({ fromRow: row });
      }
    }
    const removedCount = removedRows.size;
    for (let row = 0; row < rows; row += 1) {
      let dropCells = 0;
      if (row < removedCount) {
        // New symbols spawn above the grid and fall in.
        dropCells = removedCount + 1;
      } else {
        const survivor = survivors[row - removedCount];
        if (survivor) {
          dropCells = Math.max(0, row - survivor.fromRow);
        }
      }
      if (dropCells > 0) {
        dropMap[`${row}-${col}`] = dropCells;
      }
    }
  }
  return dropMap;
}

function applyDropPixelOffsets(dropMap) {
  if (!dropMap || Object.keys(dropMap).length === 0) return 0;
  const firstCell = reelsEl.querySelector(".cell");
  if (!firstCell) return 0;
  const styles = window.getComputedStyle(reelsEl);
  const rowGap = Number.parseFloat(styles.rowGap || styles.gap || "10") || 10;
  const cellHeight = firstCell.getBoundingClientRect().height || 84;
  const stepPx = cellHeight + rowGap;
  let maxWindowMs = 0;

  reelsEl.querySelectorAll(".cell.falling-cell").forEach((cell) => {
    const row = Number(cell.dataset.row);
    const col = Number(cell.dataset.col);
    const dropCells = Number(dropMap[`${row}-${col}`] || 0);
    if (dropCells > 0) {
      cell.style.setProperty("--drop-px", `${(dropCells * stepPx).toFixed(2)}px`);
      const durationMs = Math.min(820, 280 + dropCells * 84);
      const delayMs = Math.max(0, col * 10 + row * 2);
      cell.style.setProperty("--drop-duration", `${durationMs}ms`);
      cell.style.setProperty("--drop-delay", `${delayMs}ms`);
      const totalWindow = durationMs + delayMs;
      if (totalWindow > maxWindowMs) maxWindowMs = totalWindow;
    }
  });
  return maxWindowMs;
}

function renderPaylineExamples() {
  lineExamplesEl.innerHTML = "";
  const bullets = [
    "Grid: 6 reels x 5 rows",
    "Symbols pay anywhere on the screen",
    "Minimum 8 matching symbols for a symbol win",
    "Tumble continues while wins keep appearing",
    "Multiplier symbols (2x..1000x) can appear during spin and tumbles"
  ];
  bullets.forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    lineExamplesEl.appendChild(li);
  });
}

function renderPaytable(betAmount = getSelectedBetAmount()) {
  const [g1, g2, g3] = PAYOUT_GROUP_LABELS;
  if (paytableTitleEl) {
    paytableTitleEl.textContent = `Payout Table (${g1} / ${g2} / ${g3}) - Bet ${formatMoney(betAmount)}`;
  }
  paytableBodyEl.innerHTML = "";
  Object.entries(PAYOUTS).forEach(([symbol, values]) => {
    const tr = document.createElement("tr");
    const symbolTd = document.createElement("td");
    symbolTd.textContent = `${symbolFace(symbol)} ${symbolText(symbol)}`;
    const td3 = document.createElement("td");
    td3.textContent = formatMoney((values[g1] || 0) * betAmount);
    const td4 = document.createElement("td");
    td4.textContent = formatMoney((values[g2] || 0) * betAmount);
    const td5 = document.createElement("td");
    td5.textContent = formatMoney((values[g3] || 0) * betAmount);
    tr.appendChild(symbolTd);
    tr.appendChild(td3);
    tr.appendChild(td4);
    tr.appendChild(td5);
    paytableBodyEl.appendChild(tr);
  });

  const scatterTr = document.createElement("tr");
  const scatterSymbol = document.createElement("td");
  scatterSymbol.textContent = `${symbolFace("SCATTER")} ${symbolText("SCATTER")}`;
  const s4 = document.createElement("td");
  s4.textContent = `4: ${formatMoney((SCATTER_PAYOUTS[4] || 0) * betAmount)}`;
  const s5 = document.createElement("td");
  s5.textContent = `5: ${formatMoney((SCATTER_PAYOUTS[5] || 0) * betAmount)}`;
  const s6 = document.createElement("td");
  s6.textContent = `6: ${formatMoney((SCATTER_PAYOUTS[6] || 0) * betAmount)}`;
  scatterTr.appendChild(scatterSymbol);
  scatterTr.appendChild(s4);
  scatterTr.appendChild(s5);
  scatterTr.appendChild(s6);
  paytableBodyEl.appendChild(scatterTr);
}

function renderCaughtLines(waysWins) {
  caughtLinesEl.innerHTML = "";
  if (!waysWins || waysWins.length === 0) {
    const li = document.createElement("li");
    li.textContent = "No winning symbols in this spin.";
    caughtLinesEl.appendChild(li);
    return;
  }

  waysWins.forEach((win) => {
    const li = document.createElement("li");
    li.textContent = `${symbolFace(win.symbol)} ${symbolText(win.symbol)} | count ${win.count} | payout x${Number(win.payout || 0).toFixed(2)} => ${formatMoney(win.amount)}`;
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
  const rows = matrix.length;
  for (let row = rows - 1; row >= 1; row -= 1) {
    matrix[row][reel] = matrix[row - 1][reel];
  }
  matrix[0][reel] = randomSymbol();
}

function createRandomMatrix(rows = DEFAULT_ROWS, reels = DEFAULT_REELS) {
  const matrix = Array.from({ length: rows }, () => Array(reels).fill(null));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < reels; col += 1) {
      matrix[row][col] = randomSymbol();
    }
  }
  return matrix;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function startPendingSpinAnimation(rows = DEFAULT_ROWS, reels = DEFAULT_REELS) {
  const working = createRandomMatrix(rows, reels);
  const activeReels = Array.from({ length: reels }, (_, i) => i);
  reelsEl.classList.add("reels-spinning");
  renderMatrix(working, [], activeReels);

  const intervalId = setInterval(() => {
    for (let col = 0; col < reels; col += 1) {
      stepReelDown(working, col);
    }
    renderMatrix(working, [], activeReels);
  }, ANIMATION_TIMING.spinTickMs);

  return {
    working,
    stop() {
      clearInterval(intervalId);
    }
  };
}

async function settleReelsToResult(working, finalMatrix, winningPositions) {
  const reels = finalMatrix[0]?.length || DEFAULT_REELS;
  const rows = finalMatrix.length || DEFAULT_ROWS;
  const hasWin = (winningPositions || []).length > 0;
  const settleTickMs = hasWin ? ANIMATION_TIMING.settleTickWinMs : ANIMATION_TIMING.settleTickNoWinMs;
  const settleLockMs = hasWin ? ANIMATION_TIMING.settleLockWinMs : ANIMATION_TIMING.settleLockNoWinMs;
  for (let reel = 0; reel < reels; reel += 1) {
    const ticks = 2 + reel;
    for (let tick = 0; tick < ticks; tick += 1) {
      for (let next = reel; next < reels; next += 1) {
        stepReelDown(working, next);
      }
      const activeReels = [];
      for (let next = reel; next < reels; next += 1) activeReels.push(next);
      renderMatrix(working, [], activeReels);
      await sleep(settleTickMs);
    }

    for (let row = 0; row < rows; row += 1) {
      working[row][reel] = finalMatrix[row][reel];
    }
    const activeReels = [];
    for (let next = reel + 1; next < reels; next += 1) activeReels.push(next);
    renderMatrix(working, [], activeReels);
    await sleep(settleLockMs);
  }

  renderMatrix(finalMatrix, winningPositions);
  reelsEl.classList.remove("reels-spinning");
  if (hasWin) {
    reelsEl.classList.add("win-pulse");
    setTimeout(() => reelsEl.classList.remove("win-pulse"), ANIMATION_TIMING.winPulseMs);
  }
}

async function animateTumbleSequence(tumbleSteps = []) {
  if (!Array.isArray(tumbleSteps) || tumbleSteps.length < 2) return;
  for (let i = 0; i < tumbleSteps.length - 1; i += 1) {
    const step = tumbleSteps[i];
    const next = tumbleSteps[i + 1];
    const winTotal = Number(step?.win_total || 0);
    const winning = Array.isArray(step?.winning_positions) ? step.winning_positions : [];
    if (winTotal <= 0 || winning.length === 0) continue;
    const dropMap = buildTumbleDropMap(step.matrix, winning);

    renderMatrix(step.matrix, winning);
    await sleep(ANIMATION_TIMING.preTumbleHoldMs);
    reelsEl.querySelectorAll(".cell.win-cell").forEach((cell) => cell.classList.add("win-vanish"));
    if (ANIMATION_TIMING.tumbleFlashMs > 0) {
      reelsEl.classList.add("tumble-flash");
      await sleep(ANIMATION_TIMING.tumbleFlashMs);
      reelsEl.classList.remove("tumble-flash");
    }
    await sleep(ANIMATION_TIMING.winVanishMs);
    renderMatrix(next.matrix, next.winning_positions || [], [], dropMap);
    const fallWindowMs = applyDropPixelOffsets(dropMap);
    reelsEl.classList.add("tumble-prime");
    void reelsEl.offsetWidth;
    reelsEl.classList.add("tumble-fall");
    await sleep(Math.max(ANIMATION_TIMING.tumbleDropMs, fallWindowMs));
    reelsEl.classList.remove("tumble-fall");
    reelsEl.classList.remove("tumble-prime");
  }

  const last = tumbleSteps[tumbleSteps.length - 1];
  if (last?.matrix) {
    renderMatrix(last.matrix, last.winning_positions || []);
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
  buyFreeBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  const rows = Number(rulesConfig?.layout?.rows || DEFAULT_ROWS);
  const reels = Number(rulesConfig?.layout?.reels || DEFAULT_REELS);
  const pendingSpin = startPendingSpinAnimation(rows, reels);
  try {
    const spinStart = performance.now();
    const bet = Number(betSelectEl.value);
    betViewEl.textContent = formatMoney(bet);
    renderCaughtLines([]);
    winningLinesEl.textContent = "0";

    const payload = await api("/api/v1/spin", {
      session_id: sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet,
      ante_enabled: Boolean(anteToggleEl.checked)
    });

    const minSpinDurationMs = payload.total_win > 0 ? ANIMATION_TIMING.minSpinWinMs : ANIMATION_TIMING.minSpinNoWinMs;
    const elapsed = performance.now() - spinStart;
    if (elapsed < minSpinDurationMs) {
      await sleep(minSpinDurationMs - elapsed);
    }

    pendingSpin.stop();
    const waysWins = payload.ways_wins || [];
    const tumbleSteps = payload.tumble_steps || [];
    const winningPositions = tumbleSteps[0]?.winning_positions || payload.winning_positions || [];
    const firstMatrix = tumbleSteps[0]?.matrix || payload.matrix;
    await settleReelsToResult(pendingSpin.working, firstMatrix, winningPositions);
    await animateTumbleSequence(tumbleSteps);
    winningLinesEl.textContent = String(waysWins.length);
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
      const chargedBet = Number(payload.bet_charged || bet);
      sessionLiveStats.wagered = Number((sessionLiveStats.wagered + chargedBet).toFixed(2));
    }
    sessionLiveStats.won = Number((sessionLiveStats.won + payload.total_win).toFixed(2));
    renderSessionLiveStats();
    renderCaughtLines(waysWins);
    resultDumpEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    pendingSpin.stop();
    reelsEl.classList.remove("reels-spinning");
    renderMatrix(pendingSpin.working);
    resultDumpEl.textContent = `Error: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
    syncBuyButtonState();
    simulateBtnEl.disabled = false;
  }
}

async function buyFreeSpins() {
  if (!sessionId) return;
  if (anteToggleEl.checked) {
    resultDumpEl.textContent = "Buy Free Spins is disabled while Ante Bet is enabled.";
    return;
  }
  spinBtnEl.disabled = true;
  buyFreeBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  try {
    const bet = Number(betSelectEl.value);
    const payload = await api("/api/v1/buy-free-spins", {
      session_id: sessionId,
      bet_amount: bet
    });
    const waysWins = payload.ways_wins || [];
    const tumbleSteps = payload.tumble_steps || [];
    const firstMatrix = tumbleSteps[0]?.matrix || payload.matrix;
    const winningPositions = tumbleSteps[0]?.winning_positions || payload.winning_positions || [];
    renderMatrix(firstMatrix, winningPositions);
    await animateTumbleSequence(tumbleSteps);
    reelsEl.classList.remove("reels-spinning");
    winningLinesEl.textContent = String(waysWins.length);
    balanceEl.textContent = formatMoney(payload.balance_after);
    lastWinEl.textContent = formatMoney(payload.total_win);
    freeSpinsEl.textContent = String(payload.free_spins_left);
    sessionLiveStats.spinsPlayed += 1;
    if (payload.total_win > 0) {
      sessionLiveStats.winSpins += 1;
    } else {
      sessionLiveStats.lossSpins += 1;
    }
    const buyCost = Number(payload.buy_cost || 0);
    sessionLiveStats.wagered = Number((sessionLiveStats.wagered + buyCost).toFixed(2));
    sessionLiveStats.won = Number((sessionLiveStats.won + payload.total_win).toFixed(2));
    renderSessionLiveStats();
    renderCaughtLines(waysWins);
    resultDumpEl.textContent = JSON.stringify(payload, null, 2);
  } catch (err) {
    resultDumpEl.textContent = `Error: ${err.message}`;
  } finally {
    spinBtnEl.disabled = false;
    syncBuyButtonState();
    simulateBtnEl.disabled = false;
  }
}

function formatSimulationSummary(report) {
  return [
    `Steps: ${report.steps} | Bet: ${formatMoney(report.bet_amount)} | Ante: ${report.ante_enabled ? "ON" : "OFF"} | Charged Bet: ${formatMoney(report.charged_bet_amount || report.bet_amount)}`,
    `RTP target band: ${report.target_rtp_band.min}% - ${report.target_rtp_band.max}% (tolerance ±${Number(report.target_rtp_tolerance || 0).toFixed(2)}%)`,
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
    `Huge wins >=50x (baseline -> current): ${report.baseline.huge_win_50x_count} -> ${report.current.huge_win_50x_count}`,
    `Big win rate (baseline -> current): ${Number(report.baseline.big_win_rate_percent || 0).toFixed(3)}% -> ${Number(report.current.big_win_rate_percent || 0).toFixed(3)}%`,
    `Huge win rate (baseline -> current): ${Number(report.baseline.huge_win_rate_percent || 0).toFixed(3)}% -> ${Number(report.current.huge_win_rate_percent || 0).toFixed(3)}%`,
    `Bonus catches (baseline -> current): ${report.baseline.bonus_catch_count || 0} -> ${report.current.bonus_catch_count || 0}`,
    `Bonus catch rate (baseline -> current): ${Number(report.baseline.bonus_catch_rate_percent || 0).toFixed(4)}% -> ${Number(report.current.bonus_catch_rate_percent || 0).toFixed(4)}%`,
    `Avg paid spins per bonus catch (current): ${report.current.avg_paid_spins_per_bonus_catch ?? "N/A"}`,
    `Bonus win total (baseline -> current): ${formatMoney(report.baseline.bonus_win_total || 0)} -> ${formatMoney(report.current.bonus_win_total || 0)}`
  ].join("\n");
}

async function runSimulation() {
  if (!sessionId) return;
  if (simulationAbortController) {
    simulationAbortController.abort();
    simulationAbortController = null;
  }
  spinBtnEl.disabled = true;
  buyFreeBtnEl.disabled = true;
  simulateBtnEl.disabled = true;
  simulateDumpEl.textContent = "Running 1,000,000 spins... live stream started.";
  resetSimulationLiveWidgets();
  simProgressLabelEl.textContent = "Starting...";

  const bet = Number(betSelectEl.value);
  const anteEnabled = Boolean(anteToggleEl.checked);
  const streamUrl = `/api/v1/simulate/stream?steps=1000000&bet_amount=${encodeURIComponent(String(bet))}&ante_enabled=${encodeURIComponent(String(anteEnabled))}`;
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
    syncBuyButtonState();
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
        bet_amount: bet,
        ante_enabled: anteEnabled
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
      simLiveBigRateEl.textContent = `${Number(report.current.big_win_rate_percent || 0).toFixed(3)}%`;
      simLiveHugeRateEl.textContent = `${Number(report.current.huge_win_rate_percent || 0).toFixed(3)}%`;
      simLiveMaxWinXEl.textContent = `${Number(report.current.max_win_x).toFixed(2)}x`;
      simLiveBonusCatchesEl.textContent = String(report.current.bonus_catch_count || 0);
      simLiveBonusCatchRateEl.textContent = `${Number(report.current.bonus_catch_rate_percent || 0).toFixed(4)}%`;
      simLiveBonusWinEl.textContent = formatMoney(report.current.bonus_win_total || 0);
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
          simLiveBigRateEl.textContent = `${Number(payload.current_big_win_rate_percent || 0).toFixed(3)}%`;
          simLiveHugeRateEl.textContent = `${Number(payload.current_huge_win_rate_percent || 0).toFixed(3)}%`;
          simLiveMaxWinXEl.textContent = `${Number(payload.current_max_win_x || 0).toFixed(2)}x`;
          simLiveBonusCatchesEl.textContent = String(payload.current_bonus_catch_count || 0);
          simLiveBonusCatchRateEl.textContent = `${Number(payload.current_bonus_catch_rate_percent || 0).toFixed(4)}%`;
          simLiveBonusWinEl.textContent = formatMoney(payload.current_bonus_win_total || 0);
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
anteToggleEl.addEventListener("change", () => {
  syncBuyButtonState();
  if (anteToggleEl.checked) {
    resultDumpEl.textContent = "Ante Bet enabled. Buy Free Spins is disabled by rules.";
  }
});
spinBtnEl.addEventListener("click", spin);
buyFreeBtnEl.addEventListener("click", buyFreeSpins);
simulateBtnEl.addEventListener("click", runSimulation);

renderEmptyGrid();
renderPaylineExamples();
renderPaytable();
winningLinesEl.textContent = "0";
renderSessionLiveStats();
resetSimulationLiveWidgets();
if (symbolLegendEl) symbolLegendEl.textContent = buildLegendText();
if (payoutRuleTextEl) payoutRuleTextEl.textContent = "Symbol payouts are multipliers of base bet. Scatter pays on any position.";
syncBuyButtonState();
initSession().catch((err) => {
  resultDumpEl.textContent = `Init failed: ${err.message}`;
});
loadGameRules();

rulesBtnEl.addEventListener("click", openRulesModal);
rulesCloseBtnEl.addEventListener("click", closeRulesModal);
rulesPrevBtnEl.addEventListener("click", () => {
  if (!rulesConfig || rulesPageIndex <= 0) return;
  rulesPageIndex -= 1;
  renderRulesPage();
});
rulesNextBtnEl.addEventListener("click", () => {
  if (!rulesConfig) return;
  const max = (rulesConfig.rules_pages || []).length - 1;
  if (rulesPageIndex >= max) return;
  rulesPageIndex += 1;
  renderRulesPage();
});
rulesModalEl.addEventListener("click", (e) => {
  if (e.target === rulesModalEl) closeRulesModal();
});
window.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !rulesModalEl.classList.contains("hidden")) {
    closeRulesModal();
  }
});
