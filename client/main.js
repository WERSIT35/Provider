const $ = (id) => document.getElementById(id);

const el = {
  sessionId: $("sessionId"),
  balance: $("balance"),
  betView: $("betView"),
  winningLines: $("winningLines"),
  lastWin: $("lastWin"),
  freeSpins: $("freeSpins"),
  activeMultiplier: $("activeMultiplier"),
  betSelect: $("betSelect"),
  spinBtn: $("spinBtn"),
  simulateBtn: $("simulateBtn"),
  buyFreeBtn: $("buyFreeBtn"),
  anteToggle: $("anteToggle"),
  reels: $("reels"),
  resultDump: $("resultDump"),
  simulateDump: $("simulateDump"),
  spinLogList: $("spinLogList"),
  spinLogStatus: $("spinLogStatus"),
  lineExamples: $("lineExamples"),
  paytableBody: $("paytableBody"),
  paytableTitle: $("paytableTitle"),
  caughtLines: $("caughtLines"),
  spinsPlayed: $("spinsPlayed"),
  winSpins: $("winSpins"),
  lossSpins: $("lossSpins"),
  sessionWagered: $("sessionWagered"),
  sessionWon: $("sessionWon"),
  sessionNet: $("sessionNet"),
  simProgressBar: $("simProgressBar"),
  simProgressLabel: $("simProgressLabel"),
  simLiveRtp: $("simLiveRtp"),
  simLivePlayerWin: $("simLivePlayerWin"),
  simLiveCasinoNet: $("simLiveCasinoNet"),
  simLiveHitRate: $("simLiveHitRate"),
  simLiveBig20x: $("simLiveBig20x"),
  simLiveHuge50x: $("simLiveHuge50x"),
  simLiveBigRate: $("simLiveBigRate"),
  simLiveHugeRate: $("simLiveHugeRate"),
  simLiveMaxWinX: $("simLiveMaxWinX"),
  simLiveBonusCatches: $("simLiveBonusCatches"),
  simLiveBonusCatchRate: $("simLiveBonusCatchRate"),
  simLiveBonusWin: $("simLiveBonusWin"),
  simLiveBaselineRtp: $("simLiveBaselineRtp"),
  simLiveBaselineNet: $("simLiveBaselineNet"),
  rulesBtn: $("rulesBtn"),
  rulesModal: $("rulesModal"),
  rulesTitle: $("rulesTitle"),
  rulesMeta: $("rulesMeta"),
  rulesList: $("rulesList"),
  rulesPrevBtn: $("rulesPrevBtn"),
  rulesNextBtn: $("rulesNextBtn"),
  rulesPageLabel: $("rulesPageLabel"),
  rulesCloseBtn: $("rulesCloseBtn"),
  lineCount: $("lineCount"),
  symbolLegend: $("symbolLegend"),
  payoutRuleText: $("payoutRuleText"),
  winCallout: $("winCallout"),
  winCalloutLabel: $("winCalloutLabel"),
  winCalloutAmount: $("winCalloutAmount"),
  featureScreen: $("featureScreen"),
  featureScreenKicker: $("featureScreenKicker"),
  featureScreenTitle: $("featureScreenTitle"),
  featureScreenCopy: $("featureScreenCopy"),
  eventBanner: $("eventBanner"),
  eventBannerText: $("eventBannerText")
};

const state = {
  sessionId: null,
  rules: null,
  rulesPageIndex: 0,
  bonusAutoplay: false,
  simulationAbort: null,
  featureResolver: null,
  spinLog: []
};

const rows = 5;
const cols = 6;
const payoutGroups = ["8-9", "10-11", "12-30"];
const payouts = {
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
const scatterPayouts = { 4: 6, 5: 10, 6: 200 };

const symbolAssets = {
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

const stats = { spins: 0, wins: 0, losses: 0, wagered: 0, won: 0 };
const fmt = (v) => Number(v || 0).toFixed(2);
const mfmt = (v) => (Number.isInteger(Number(v || 0)) ? `${Number(v || 0)}x` : `${Number(v || 0).toFixed(1)}x`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setSigned(target, value) {
  target.classList.remove("positive", "negative");
  if (value > 0) target.classList.add("positive");
  if (value < 0) target.classList.add("negative");
}

function renderMatrix(
  matrix,
  { winning = [], multipliers = [], showHighlight = true, fallingMap = null, spinDrop = false } = {}
) {
  const winSet = new Set(winning.map((p) => `${p.row}-${p.col}`));
  const multiMap = new Map(multipliers.map((m) => [`${m.row}-${m.col}`, Number(m.value || 1)]));
  const frag = document.createDocumentFragment();
  const reelCount = matrix[0]?.length || cols;
  for (let c = 0; c < reelCount; c += 1) {
    const chamber = document.createElement("section");
    chamber.className = "relic-column";
    chamber.dataset.col = String(c);
    const spine = document.createElement("div");
    spine.className = "relic-spine";
    chamber.appendChild(spine);
    const crown = document.createElement("div");
    crown.className = "relic-crown";
    chamber.appendChild(crown);
    const stack = document.createElement("div");
    stack.className = "sigil-stack";
    chamber.appendChild(stack);
    for (let r = 0; r < matrix.length; r += 1) {
      const sym = matrix[r][c] || "-";
      const sigil = document.createElement("article");
      sigil.className = "sigil";
      sigil.dataset.row = String(r);
      sigil.dataset.col = String(c);
      if (fallingMap && Number(fallingMap[`${r}-${c}`] || 0) > 0) {
        sigil.classList.add("falling-sigil");
        if (spinDrop) sigil.classList.add("spin-drop-sigil");
      }
      if (showHighlight && winSet.has(`${r}-${c}`)) sigil.classList.add("win-sigil");
      if (sym === "MULTI") sigil.classList.add("wild");
      if (sym === "SCATTER") sigil.classList.add("scatter");
      const chain = document.createElement("div");
      chain.className = "sigil-chain";
      const medallion = document.createElement("div");
      medallion.className = "sigil-medallion";
      const icon = symbolAssets[sym];
      if (icon) {
        const img = document.createElement("img");
        img.className = "symbol-icon";
        img.src = icon;
        img.alt = sym;
        img.draggable = false;
        medallion.appendChild(img);
      } else {
        medallion.textContent = sym;
      }
      if (sym === "MULTI") {
        const badge = document.createElement("span");
        badge.className = "multiplier-value";
        badge.textContent = mfmt(multiMap.get(`${r}-${c}`) || 1);
        medallion.appendChild(badge);
      }
      sigil.appendChild(chain);
      sigil.appendChild(medallion);
      stack.appendChild(sigil);
    }
    frag.appendChild(chamber);
  }
  el.reels.innerHTML = "";
  el.reels.appendChild(frag);
}

function randomMatrix() {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => "BLUE_DIAMOND"));
}

function buildDropMap(stepMatrix, winningPositions = []) {
  const byCol = new Map();
  winningPositions.forEach((p) => {
    if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col)) return;
    if (!byCol.has(p.col)) byCol.set(p.col, new Set());
    byCol.get(p.col).add(p.row);
  });

  const map = {};
  for (let col = 0; col < (stepMatrix?.[0]?.length || cols); col += 1) {
    const removed = byCol.get(col);
    if (!removed || removed.size === 0) continue;
    const survivors = [];
    for (let row = 0; row < (stepMatrix?.length || rows); row += 1) {
      if (!removed.has(row)) survivors.push({ from: row });
    }
    const removedCount = removed.size;
    for (let row = 0; row < (stepMatrix?.length || rows); row += 1) {
      let dropCells = 0;
      if (row < removedCount) {
        dropCells = removedCount + 1;
      } else {
        const s = survivors[row - removedCount];
        if (s) dropCells = Math.max(0, row - s.from);
      }
      if (dropCells > 0) map[`${row}-${col}`] = dropCells;
    }
  }
  return map;
}

function applyDropOffsets(dropMap) {
  if (!dropMap || Object.keys(dropMap).length === 0) return 0;
  const firstSigil = el.reels.querySelector(".sigil");
  if (!firstSigil) return 0;
  const style = window.getComputedStyle(el.reels);
  const gap = Number.parseFloat(style.gap || style.rowGap || "8") || 8;
  const height = firstSigil.getBoundingClientRect().height || 80;
  const stepPx = height + gap;
  let maxWindow = 0;

  el.reels.querySelectorAll(".sigil.falling-sigil").forEach((sigil) => {
    const r = Number(sigil.dataset.row);
    const c = Number(sigil.dataset.col);
    const dropCells = Number(dropMap[`${r}-${c}`] || 0);
    if (dropCells <= 0) return;

    const seed = ((r + 1) * 13 + (c + 1) * 23 + dropCells * 11) % 9;
    const duration = Math.min(1480, 640 + dropCells * 120 + seed * 18);
    const delay = Math.max(0, c * 28 + r * 12 + seed * 8);
    sigil.style.setProperty("--drop-px", `${(dropCells * stepPx * 1.2).toFixed(2)}px`);
    sigil.style.setProperty("--drop-duration", `${duration}ms`);
    sigil.style.setProperty("--drop-delay", `${delay}ms`);
    sigil.style.setProperty("--drop-sway", `${((c % 2 === 0 ? -1 : 1) * (2.1 + seed * 0.24)).toFixed(2)}px`);
    sigil.style.setProperty("--drop-tilt", `${((r % 2 === 0 ? 1 : -1) * (0.5 + seed * 0.08)).toFixed(2)}deg`);
    sigil.style.setProperty("--impact-depth", `${Math.min(9, 3 + dropCells * 0.72 + seed * 0.16).toFixed(2)}px`);
    sigil.style.setProperty("--rebound-lift", `${Math.min(5, 1.2 + dropCells * 0.28 + seed * 0.06).toFixed(2)}px`);
    sigil.style.setProperty("--drop-blur", `${Math.min(0.26, 0.04 + dropCells * 0.03 + seed * 0.005).toFixed(2)}px`);
    maxWindow = Math.max(maxWindow, duration + delay);
  });

  return maxWindow;
}

function winTier(waysWins = [], bet = 1) {
  let maxCount = 0;
  let maxPayoutX = 0;
  waysWins.forEach((w) => {
    const count = Number(w?.count || 0);
    const payout = Number(w?.payout || 0);
    const amount = Number(w?.amount || 0);
    const byAmount = bet > 0 ? amount / bet : 0;
    maxCount = Math.max(maxCount, count);
    maxPayoutX = Math.max(maxPayoutX, payout, byAmount);
  });
  const score = maxPayoutX + (maxCount >= 12 ? 8 : maxCount >= 10 ? 4 : 0) + (maxCount >= 8 ? 2 : 0);
  if (maxCount >= 12 || score >= 24) return "blast-great";
  if (maxCount >= 10 || score >= 10) return "blast-medium";
  return "blast-small";
}

function decorateStepCells(step, bet) {
  const winPositions = Array.isArray(step?.winning_positions) ? step.winning_positions : [];
  if (winPositions.length > 0) {
    const tier = winTier(step?.ways_wins || [], bet);
    el.reels.querySelectorAll(".sigil.win-sigil").forEach((sigil) => {
      sigil.classList.add("strike-sigil", tier);
    });
  }
  const scatterCount = step?.matrix?.flat?.().filter((s) => s === "SCATTER").length || 0;
  if (scatterCount >= 3) {
    el.reels.querySelectorAll(".sigil.scatter").forEach((sigil) => {
      sigil.classList.add("scatter-special");
    });
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

function setControls(disabled) {
  el.spinBtn.disabled = disabled;
  el.simulateBtn.disabled = disabled;
  el.betSelect.disabled = disabled;
  el.buyFreeBtn.disabled = disabled || Boolean(el.anteToggle.checked);
  el.anteToggle.disabled = disabled;
}

function renderExamples() {
  el.lineExamples.innerHTML = "";
  [
    "Grid: 6 reels x 5 rows",
    "Symbols pay anywhere",
    "Minimum 8 matching symbols for a win",
    "Tumble continues while wins keep appearing",
    "Multipliers can appear in base and bonus rounds"
  ].forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    el.lineExamples.appendChild(li);
  });
}

function renderPaytable(bet = Number(el.betSelect.value || 1)) {
  const [g1, g2, g3] = payoutGroups;
  el.paytableTitle.textContent = `Payout Table (${g1} / ${g2} / ${g3}) - Bet ${fmt(bet)}`;
  el.paytableBody.innerHTML = "";

  Object.entries(payouts).forEach(([symbol, values]) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${symbol}</td><td>${fmt((values[g1] || 0) * bet)}</td><td>${fmt((values[g2] || 0) * bet)}</td><td>${fmt((values[g3] || 0) * bet)}</td>`;
    el.paytableBody.appendChild(tr);
  });

  const scatterTr = document.createElement("tr");
  scatterTr.innerHTML = `<td>SCATTER</td><td>4: ${fmt((scatterPayouts[4] || 0) * bet)}</td><td>5: ${fmt((scatterPayouts[5] || 0) * bet)}</td><td>6: ${fmt((scatterPayouts[6] || 0) * bet)}</td>`;
  el.paytableBody.appendChild(scatterTr);
}

function renderCaughtLines(wins = []) {
  el.caughtLines.innerHTML = "";
  if (!wins.length) {
    const li = document.createElement("li");
    li.textContent = "No winning symbols in this spin.";
    el.caughtLines.appendChild(li);
    return;
  }
  wins.forEach((w) => {
    const li = document.createElement("li");
    li.textContent = `${w.symbol} | count ${w.count} | x${Number(w.payout || 0).toFixed(2)} => ${fmt(w.amount)}`;
    el.caughtLines.appendChild(li);
  });
}

function summarizeSpin(payload, bet) {
  const tumbleSteps = Array.isArray(payload.tumble_steps) ? payload.tumble_steps : [];
  const tumbleCount = Math.max(0, tumbleSteps.length - 1);
  const allWins = Array.isArray(payload.ways_wins) ? payload.ways_wins : [];
  const winsText = allWins.length
    ? allWins.map((w) => `${w.symbol}(${Number(w.count || 0)})`).slice(0, 4).join(", ")
    : "none";

  const multipliersByPos = new Map();
  tumbleSteps.forEach((step) => {
    (step.multipliers || []).forEach((m) => {
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col)) return;
      const v = Number(m.value || 0);
      if (!Number.isFinite(v) || v <= 0) return;
      multipliersByPos.set(`${m.row}-${m.col}`, v);
    });
  });
  const multiCount = multipliersByPos.size;
  const multiSum = Number(Array.from(multipliersByPos.values()).reduce((s, v) => s + v, 0).toFixed(2));
  const rawWin = Number(
    tumbleSteps.reduce((sum, step) => sum + Number(step?.win_total || 0), 0).toFixed(2)
  );
  const applied = Number(payload.multiplier_applied || 1);
  const mode = payload.is_free_spin ? "bonus" : "base";
  return {
    id: crypto.randomUUID(),
    mode,
    bet: Number(bet || payload.bet_amount || 0),
    tumbling: tumbleCount > 0,
    tumbleCount,
    winsText,
    multiCount,
    multiSum,
    applied,
    rawWin,
    totalWin: Number(payload.total_win || 0)
  };
}

function renderSpinLog() {
  if (!el.spinLogList) return;
  el.spinLogList.innerHTML = "";
  if (!state.spinLog.length) {
    const li = document.createElement("li");
    li.textContent = "No spins yet.";
    el.spinLogList.appendChild(li);
    if (el.spinLogStatus) el.spinLogStatus.textContent = "Waiting for spins...";
    return;
  }
  state.spinLog.forEach((entry, idx) => {
    const li = document.createElement("li");
    li.innerHTML = `<strong>#${state.spinLog.length - idx}</strong> ${entry.mode.toUpperCase()} | Bet ${fmt(entry.bet)} | Wins: ${entry.winsText} | Tumble: ${entry.tumbling ? `${entry.tumbleCount}x` : "no"} | Multi caught: ${entry.multiCount} (sum ${mfmt(entry.multiSum)}) | Applied: ${mfmt(entry.applied)} | ${fmt(entry.rawWin)} -> ${fmt(entry.totalWin)}`;
    el.spinLogList.appendChild(li);
  });
  if (el.spinLogStatus) {
    const latest = state.spinLog[0];
    el.spinLogStatus.textContent = `${latest.mode.toUpperCase()} | last win ${fmt(latest.totalWin)}`;
  }
}

function pushSpinLog(payload, bet) {
  const item = summarizeSpin(payload, bet);
  state.spinLog.unshift(item);
  if (state.spinLog.length > 10) state.spinLog = state.spinLog.slice(0, 10);
  renderSpinLog();
}

function applyRoundStats(payload, bet, wagerOverride) {
  stats.spins += 1;
  if (Number(payload.total_win || 0) > 0) stats.wins += 1;
  else stats.losses += 1;
  if (Number.isFinite(wagerOverride)) stats.wagered += wagerOverride;
  else if (!payload.is_free_spin) stats.wagered += Number(payload.bet_charged || bet);
  stats.won += Number(payload.total_win || 0);

  el.spinsPlayed.textContent = String(stats.spins);
  el.winSpins.textContent = String(stats.wins);
  el.lossSpins.textContent = String(stats.losses);
  el.sessionWagered.textContent = fmt(stats.wagered);
  el.sessionWon.textContent = fmt(stats.won);
  const net = Number((stats.won - stats.wagered).toFixed(2));
  el.sessionNet.textContent = fmt(net);
  setSigned(el.sessionNet, net);
}

async function animateRound(payload, bet, wagerOverride) {
  const steps = Array.isArray(payload.tumble_steps) && payload.tumble_steps.length
    ? payload.tumble_steps
    : [{ matrix: payload.matrix, multipliers: payload.multipliers || [], winning_positions: payload.winning_positions || [], ways_wins: payload.ways_wins || [], win_total: payload.total_win || 0 }];

  const introMap = {};
  for (let r = 0; r < (steps[0]?.matrix?.length || rows); r += 1) {
    for (let c = 0; c < (steps[0]?.matrix?.[0]?.length || cols); c += 1) {
      introMap[`${r}-${c}`] = rows;
    }
  }
  renderMatrix(steps[0].matrix, {
    multipliers: steps[0].multipliers || [],
    showHighlight: false,
    fallingMap: introMap,
    spinDrop: true
  });
  const introWindow = applyDropOffsets(introMap);
  el.reels.classList.add("reels-spinning", "spin-prime");
  await sleep(16);
  el.reels.classList.add("spin-drop");
  await sleep(Math.max(980, introWindow));
  el.reels.classList.remove("spin-drop", "spin-prime", "reels-spinning");

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (i > 0) {
      const prev = steps[i - 1];
      const prevWinning = Array.isArray(prev?.winning_positions) ? prev.winning_positions : [];
      const prevWinTotal = Number(prev?.win_total || 0);
      if (prevWinning.length > 0 && prevWinTotal > 0) {
        await sleep(140);
        el.reels.querySelectorAll(".sigil.win-sigil").forEach((sigil) => sigil.classList.add("explode-out"));
        await sleep(380);
        const dropMap = buildDropMap(prev.matrix, prevWinning);
        renderMatrix(step.matrix, { multipliers: step.multipliers || [], showHighlight: false, fallingMap: dropMap });
        const windowMs = applyDropOffsets(dropMap);
        el.reels.classList.add("tumble-prime");
        await sleep(16);
        el.reels.classList.add("tumble-fall");
        await sleep(Math.max(980, windowMs));
        el.reels.classList.remove("tumble-fall", "tumble-prime");
      }
    }
    renderMatrix(step.matrix, { winning: step.winning_positions || [], multipliers: step.multipliers || [], showHighlight: true });
    decorateStepCells(step, bet);
    if ((step.winning_positions || []).length) {
      await sleep(420);
    }
  }

  el.balance.textContent = fmt(payload.balance_after || 0);
  el.lastWin.textContent = fmt(payload.total_win || 0);
  el.freeSpins.textContent = String(payload.free_spins_left || 0);
  el.activeMultiplier.textContent = mfmt(payload.is_free_spin ? payload.free_spin_multiplier_current : payload.multiplier_applied || 1);
  el.winningLines.textContent = String((payload.ways_wins || []).length);
  renderCaughtLines(payload.ways_wins || []);
  pushSpinLog(payload, bet);
  el.resultDump.textContent = JSON.stringify(payload, null, 2);
  applyRoundStats(payload, bet, wagerOverride);
}

async function spin(options = {}) {
  if (!state.sessionId) return;
  if (state.bonusAutoplay && !options.autoplay) return;
  setControls(true);
  try {
    const bet = Number(el.betSelect.value || 1);
    el.betView.textContent = fmt(bet);
    const payload = await api("/api/v1/spin", {
      session_id: state.sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet,
      ante_enabled: Boolean(el.anteToggle.checked)
    });
    await animateRound(payload, bet);
    if (Number(payload.free_spins_awarded || 0) > 0 && !payload.is_free_spin) {
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
    }
    return payload;
  } catch (err) {
    renderMatrix(randomMatrix());
    el.resultDump.textContent = `Error: ${err.message}`;
  } finally {
    if (!state.bonusAutoplay) setControls(false);
  }
}

async function autoplayBonus() {
  if (state.bonusAutoplay) return;
  state.bonusAutoplay = true;
  setControls(true);
  let total = 0;
  try {
    while (Number(el.freeSpins.textContent || "0") > 0) {
      const payload = await spin({ autoplay: true });
      total += Number(payload?.total_win || 0);
      await sleep(120);
    }
    await showFeature(`Bonus Win ${fmt(total)}`, "Press anywhere to continue.");
  } finally {
    state.bonusAutoplay = false;
    setControls(false);
  }
}

async function buyFreeSpins() {
  if (!state.sessionId || state.bonusAutoplay) return;
  if (el.anteToggle.checked) return;
  setControls(true);
  try {
    const bet = Number(el.betSelect.value || 1);
    const payload = await api("/api/v1/buy-free-spins", { session_id: state.sessionId, bet_amount: bet });
    await animateRound(payload, bet, Number(payload.buy_cost || 0));
    if (Number(payload.free_spins_awarded || 0) > 0) {
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
    }
  } catch (err) {
    el.resultDump.textContent = `Error: ${err.message}`;
  } finally {
    if (!state.bonusAutoplay) setControls(false);
  }
}

function showFeature(title, copy) {
  if (state.featureResolver) state.featureResolver();
  el.featureScreenKicker.textContent = "Feature";
  el.featureScreenTitle.textContent = title;
  el.featureScreenCopy.textContent = copy;
  el.featureScreen.classList.remove("hidden");
  return new Promise((resolve) => {
    state.featureResolver = () => {
      el.featureScreen.classList.add("hidden");
      state.featureResolver = null;
      resolve();
    };
  });
}

function dismissFeature() {
  if (state.featureResolver) state.featureResolver();
}

async function streamSse(url, onEvent, signal) {
  const res = await fetch(url, { method: "GET", headers: { Accept: "text/event-stream" }, signal });
  if (!res.ok || !res.body) throw new Error("STREAM_UNAVAILABLE");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx = buffer.search(/\r?\n\r?\n/);
    while (idx >= 0) {
      const raw = buffer.slice(0, idx);
      const sepMatch = buffer.slice(idx).match(/^\r?\n\r?\n/);
      buffer = buffer.slice(idx + (sepMatch ? sepMatch[0].length : 2));
      let event = "message";
      const lines = [];
      raw.split(/\r?\n/).forEach((line) => {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) lines.push(line.slice(5).trim());
      });
      if (lines.length) {
        try { onEvent(event, JSON.parse(lines.join("\n"))); } catch {}
      }
      idx = buffer.search(/\r?\n\r?\n/);
    }
  }
}

async function runSimulation() {
  if (!state.sessionId) return;
  setControls(true);
  const bet = Number(el.betSelect.value || 1);
  const ante = Boolean(el.anteToggle.checked);
  const streamUrl = `/api/v1/simulate/stream?steps=1000000&bet_amount=${encodeURIComponent(String(bet))}&ante_enabled=${encodeURIComponent(String(ante))}`;

  el.simProgressBar.style.width = "0%";
  el.simProgressLabel.textContent = "Starting...";
  el.simulateDump.textContent = "Running live stream...";
  let fallbackTicker = null;

  let complete = false;
  const applyProgress = (p) => {
    const progress = Number(p.progress_percent || 0);
    el.simProgressBar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
    el.simProgressLabel.textContent = `${progress.toFixed(2)}% (${p.steps_completed}/${p.steps_total})`;
    el.simLiveRtp.textContent = `${Number(p.current_rtp_percent || 0).toFixed(2)}%`;
    el.simLivePlayerWin.textContent = fmt(p.current_player_total_win || 0);
    const net = Number(p.current_casino_net || 0);
    el.simLiveCasinoNet.textContent = fmt(net);
    setSigned(el.simLiveCasinoNet, net);
    el.simLiveHitRate.textContent = `${Number(p.current_hit_frequency_percent || 0).toFixed(2)}%`;
    el.simLiveBig20x.textContent = String(p.current_big_win_20x_count || 0);
    el.simLiveHuge50x.textContent = String(p.current_huge_win_50x_count || 0);
    el.simLiveBigRate.textContent = `${Number(p.current_big_win_rate_percent || 0).toFixed(3)}%`;
    el.simLiveHugeRate.textContent = `${Number(p.current_huge_win_rate_percent || 0).toFixed(3)}%`;
    el.simLiveMaxWinX.textContent = `${Number(p.current_max_win_x || 0).toFixed(2)}x`;
    el.simLiveBonusCatches.textContent = String(p.current_bonus_catch_count || 0);
    el.simLiveBonusCatchRate.textContent = `${Number(p.current_bonus_catch_rate_percent || 0).toFixed(4)}%`;
    el.simLiveBonusWin.textContent = fmt(p.current_bonus_win_total || 0);
    el.simLiveBaselineRtp.textContent = `${Number(p.baseline_rtp_percent || 0).toFixed(2)}%`;
    const baselineNet = Number(p.baseline_casino_net || 0);
    el.simLiveBaselineNet.textContent = fmt(baselineNet);
    setSigned(el.simLiveBaselineNet, baselineNet);
  };

  try {
    state.simulationAbort = new AbortController();
    await streamSse(streamUrl, (event, payload) => {
      if (!payload) return;
      if (event === "progress") applyProgress(payload);
      if (event === "complete") {
        complete = true;
        el.simProgressBar.style.width = "100%";
        el.simProgressLabel.textContent = "Completed";
        el.simulateDump.textContent = JSON.stringify(payload.report, null, 2);
      }
    }, state.simulationAbort.signal);
  } catch {
    el.simulateDump.textContent = "Stream unavailable, retrying fallback...";
    let pseudo = 0;
    fallbackTicker = setInterval(() => {
      if (complete) return;
      pseudo = Math.min(95, pseudo + (pseudo < 65 ? 2.4 : 0.8));
      el.simProgressBar.style.width = `${pseudo.toFixed(1)}%`;
      el.simProgressLabel.textContent = `Fallback running... ${pseudo.toFixed(1)}%`;
    }, 180);
    const report = await api("/api/v1/simulate", { steps: 1000000, bet_amount: bet, ante_enabled: ante });
    if (fallbackTicker) {
      clearInterval(fallbackTicker);
      fallbackTicker = null;
    }
    el.simProgressBar.style.width = "100%";
    el.simProgressLabel.textContent = "Completed (Fallback)";
    el.simulateDump.textContent = JSON.stringify(report, null, 2);
  } finally {
    if (fallbackTicker) {
      clearInterval(fallbackTicker);
      fallbackTicker = null;
    }
    state.simulationAbort = null;
    if (!state.bonusAutoplay) setControls(false);
    if (!complete && el.simProgressLabel.textContent !== "Completed (Fallback)") {
      el.simProgressLabel.textContent = "Completed";
    }
  }
}

async function loadRules() {
  try {
    const rules = await fetch("/api/v1/game-rules").then((r) => r.json());
    state.rules = rules;
    el.lineCount.textContent = String(rules.layout?.pays || "symbols_pay_anywhere").replaceAll("_", " ");
    renderRulesPage();
  } catch {}
}

function renderRulesPage() {
  const pages = state.rules?.rules_pages;
  if (!Array.isArray(pages) || pages.length === 0) {
    el.rulesTitle.textContent = "Game Rules";
    el.rulesMeta.textContent = "Rules are not available.";
    el.rulesList.innerHTML = "";
    el.rulesPageLabel.textContent = "Page 0/0";
    el.rulesPrevBtn.disabled = true;
    el.rulesNextBtn.disabled = true;
    return;
  }

  const page = pages[state.rulesPageIndex];
  el.rulesTitle.textContent = page?.title || "Game Rules";
  el.rulesMeta.textContent = `RTP ${Number(state.rules.rtp?.theoretical_percent || 0).toFixed(2)}% | Volatility ${(state.rules.volatility || "").toUpperCase()}`;
  el.rulesList.innerHTML = "";
  (page?.points || []).forEach((point) => {
    const li = document.createElement("li");
    li.textContent = point;
    el.rulesList.appendChild(li);
  });
  el.rulesPageLabel.textContent = `Page ${state.rulesPageIndex + 1}/${pages.length}`;
  el.rulesPrevBtn.disabled = state.rulesPageIndex === 0;
  el.rulesNextBtn.disabled = state.rulesPageIndex === pages.length - 1;
}

async function initSession() {
  const payload = await api("/api/v1/session/init", { player_id: `player_${Date.now()}`, currency: "GEL", locale: "en", game_id: "project-khma" });
  state.sessionId = payload.session_id;
  el.sessionId.textContent = state.sessionId.slice(0, 8);
  el.balance.textContent = fmt(payload.balance);
  el.betSelect.innerHTML = "";
  (payload.allowed_bets || []).forEach((b) => {
    const option = document.createElement("option");
    option.value = String(b);
    option.textContent = fmt(b);
    el.betSelect.appendChild(option);
  });
  el.betSelect.value = "1";
  el.betView.textContent = "1.00";
  renderPaytable(1);
}

el.betSelect.addEventListener("change", () => {
  el.betView.textContent = fmt(el.betSelect.value);
  renderPaytable(Number(el.betSelect.value || 1));
});
el.spinBtn.addEventListener("click", spin);
el.buyFreeBtn.addEventListener("click", buyFreeSpins);
el.simulateBtn.addEventListener("click", runSimulation);
el.featureScreen.addEventListener("click", dismissFeature);
el.rulesBtn.addEventListener("click", () => {
  el.rulesModal.classList.remove("hidden");
  renderRulesPage();
});
el.rulesCloseBtn.addEventListener("click", () => el.rulesModal.classList.add("hidden"));
el.rulesPrevBtn.addEventListener("click", () => {
  if (!state.rules || state.rulesPageIndex <= 0) return;
  state.rulesPageIndex -= 1;
  renderRulesPage();
});
el.rulesNextBtn.addEventListener("click", () => {
  const max = (state.rules?.rules_pages || []).length - 1;
  if (state.rulesPageIndex >= max) return;
  state.rulesPageIndex += 1;
  renderRulesPage();
});
el.rulesModal.addEventListener("click", (e) => { if (e.target === el.rulesModal) el.rulesModal.classList.add("hidden"); });

window.addEventListener("keydown", (e) => {
  const tag = e.target?.tagName;
  const typing = e.target?.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON";
  if ((e.key === " " || e.key === "Spacebar") && !typing && !el.spinBtn.disabled) {
    e.preventDefault();
    spin();
  }
});

renderMatrix(randomMatrix());
renderExamples();
renderSpinLog();
el.symbolLegend.textContent = "Top Crown, Hourglass, Ring, Chalice, Red Gem, Purple Triangle, Yellow Hex, Green Triangle, Blue Diamond, Multiplier, Scatter";
el.payoutRuleText.textContent = "Symbol payouts are multipliers of base bet. Scatter pays on any position.";
el.activeMultiplier.textContent = "1x";
requestAnimationFrame(() => document.body.classList.add("app-ready"));
initSession().catch((err) => { el.resultDump.textContent = `Init failed: ${err.message}`; });
loadRules();
