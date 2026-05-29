const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");

const BASE_PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, "..");
const CLIENT_DIR = path.join(ROOT, "client");
const CLIENT_MATH_DIR = path.join(CLIENT_DIR, "math");
const MATH_DIR = path.join(ROOT, "math");
const ASSETS_DIR = path.join(CLIENT_DIR, "assets");

const RULES_PATH = fs.existsSync(path.join(CLIENT_MATH_DIR, "game-rules-v2.json"))
  ? path.join(CLIENT_MATH_DIR, "game-rules-v2.json")
  : path.join(MATH_DIR, "game-rules-v2.json");
const gameRules = JSON.parse(fs.readFileSync(RULES_PATH, "utf8"));

const sessions = new Map();
const ALLOWED_BETS = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 250, 500];

const LAYOUT_REELS = Number(gameRules.layout?.reels || 6);
const LAYOUT_ROWS = Number(gameRules.layout?.rows || 5);
const MIN_MATCH_COUNT = Number(gameRules.layout?.min_match_count || 8);
const MAX_MATCH_COUNT = 30;
const MAX_WIN_CAP_X = Number(gameRules.max_win_cap_multiplier || 15000);
const DEFAULT_RTP_PAYOUT_SCALER = Number(gameRules.rtp?.payout_scaler ?? 1.5);
const DEFAULT_GAME_ID = String(gameRules.rtp_profiles?.[0]?.game_id || "bananax");

const FREE_SPINS_TRIGGER = Number(gameRules.features?.free_spins?.base_trigger_scatter_count || 4);
const FREE_SPINS_AWARD = Number(gameRules.features?.free_spins?.base_award_spins || 15);
const FREE_SPINS_RETRIGGER_TRIGGER = Number(gameRules.features?.free_spins?.retrigger_scatter_count || 3);
const FREE_SPINS_RETRIGGER_AWARD = Number(gameRules.features?.free_spins?.retrigger_award_spins || 5);
const ANTE_MULTIPLIER = Number(gameRules.features?.ante_bet?.multiplier || 1.25);

const MULTIPLIER_VALUES = (gameRules.features?.multipliers?.allowed_values || [2, 3, 5, 10]).map(Number);
const MULTIPLIER_WEIGHTS = {
  2: 42,
  3: 28,
  4: 15,
  5: 8,
  6: 4,
  8: 2,
  10: 1.1,
  12: 0.7,
  15: 0.3,
  20: 0.15,
  25: 0.08,
  50: 0.03,
  100: 0.01,
  250: 0.0025,
  500: 0.001,
  1000: 0.0004
};
const MULTI_SYMBOL = "MULTI";
const SCATTER_SYMBOL = "SCATTER";

const SYMBOL_PAYOUTS = new Map();
const SCATTER_PAYOUTS = {};
const REGULAR_SYMBOLS = [];
const SYMBOL_WEIGHTS = new Map();
let multiplierNonce = 0;

function nextMultiplierId() {
  multiplierNonce += 1;
  return `m_${multiplierNonce}_${crypto.randomUUID().slice(0, 8)}`;
}

function getRtpProfileByGameId(gameId) {
  const gid = String(gameId || DEFAULT_GAME_ID).toLowerCase();
  const fromProfiles = (gameRules.rtp_profiles || []).find(
    (p) => String(p.game_id || "").toLowerCase() === gid
  );
  const source = fromProfiles || gameRules.rtp || {};
  return {
    game_id: fromProfiles?.game_id || DEFAULT_GAME_ID,
    slug: fromProfiles?.slug || "",
    theoretical_percent: Number(source.theoretical_percent ?? gameRules.rtp?.theoretical_percent ?? 96),
    ante_bet_percent: Number(source.ante_bet_percent ?? source.theoretical_percent ?? 96),
    buy_free_spins_percent: Number(source.buy_free_spins_percent ?? source.theoretical_percent ?? 96),
    payout_scaler: Number(source.payout_scaler ?? gameRules.rtp?.payout_scaler ?? DEFAULT_RTP_PAYOUT_SCALER),
    base_payout_scaler: Number(
      source.base_payout_scaler ?? source.payout_scaler ?? gameRules.rtp?.payout_scaler ?? DEFAULT_RTP_PAYOUT_SCALER
    ),
    free_spin_payout_scaler: Number(
      source.free_spin_payout_scaler ?? source.payout_scaler ?? gameRules.rtp?.payout_scaler ?? DEFAULT_RTP_PAYOUT_SCALER
    ),
    target_band_min: Number(source.target_band_min ?? gameRules.rtp?.target_band_min ?? 0),
    target_band_max: Number(source.target_band_max ?? gameRules.rtp?.target_band_max ?? 100),
    target_tolerance_percent: Number(source.target_tolerance_percent ?? gameRules.rtp?.target_tolerance_percent ?? 0.05)
  };
}

function assertGameRulesOrThrow(rules) {
  if (!rules || !rules.layout || !rules.features || !rules.rtp) {
    throw new Error("INVALID_GAME_RULES: missing required sections");
  }
  if (!Number.isFinite(rules.layout.reels) || !Number.isFinite(rules.layout.rows)) {
    throw new Error("INVALID_GAME_RULES: invalid layout");
  }
  if (!Array.isArray(rules.rules_pages) || rules.rules_pages.length === 0) {
    throw new Error("INVALID_GAME_RULES: rules pages missing");
  }
  if (
    !rules.symbol_payout_display ||
    !Array.isArray(rules.symbol_payout_display.symbols) ||
    rules.symbol_payout_display.symbols.length === 0
  ) {
    throw new Error("INVALID_GAME_RULES: symbol payout display missing");
  }
  const multipliers = rules.features.multipliers;
  if (!multipliers || !Array.isArray(multipliers.allowed_values) || multipliers.allowed_values.length === 0) {
    throw new Error("INVALID_GAME_RULES: multipliers invalid");
  }
}

assertGameRulesOrThrow(gameRules);

for (const symbolEntry of gameRules.symbol_payout_display.symbols) {
  const code = String(symbolEntry.symbol || "").toUpperCase().replace(/\s+/g, "_");
  // Map the symbol to its actual image asset path for the frontend
  symbolEntry.asset_path = `/assets/symbols/${code.toLowerCase()}.svg`;
  if (!code) continue;
  if (code === SCATTER_SYMBOL) {
    Object.assign(SCATTER_PAYOUTS, symbolEntry.payouts || {});
    continue;
  }
  REGULAR_SYMBOLS.push(code);
  SYMBOL_PAYOUTS.set(code, symbolEntry.payouts || {});
}

// High-volatility weights: top symbols are rarer than low symbols.
for (const symbol of REGULAR_SYMBOLS) {
  let w = 1;
  if (symbol.includes("TOP_CROWN")) w = 0.35;
  else if (symbol.includes("HOURGLASS")) w = 0.42;
  else if (symbol.includes("RING")) w = 0.52;
  else if (symbol.includes("CHALICE")) w = 0.62;
  else if (symbol.includes("RED_GEM")) w = 0.72;
  else if (symbol.includes("PURPLE_TRIANGLE")) w = 0.82;
  else if (symbol.includes("YELLOW_HEX")) w = 0.9;
  else if (symbol.includes("GREEN_TRIANGLE")) w = 0.95;
  else if (symbol.includes("BLUE_DIAMOND")) w = 1.0;
  SYMBOL_WEIGHTS.set(symbol, w);
}

function sendJson(res, code, payload) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_000_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function parseBooleanLike(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") return defaultValue;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
  if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
  return defaultValue;
}

function weightedRegularSymbol() {
  const total = REGULAR_SYMBOLS.reduce((sum, s) => sum + (SYMBOL_WEIGHTS.get(s) || 1), 0);
  let r = Math.random() * total;
  for (const s of REGULAR_SYMBOLS) {
    r -= SYMBOL_WEIGHTS.get(s) || 1;
    if (r <= 0) return s;
  }
  return REGULAR_SYMBOLS[REGULAR_SYMBOLS.length - 1];
}

function randomMultiplierValue() {
  const total = MULTIPLIER_VALUES.reduce((s, v) => s + (MULTIPLIER_WEIGHTS[v] || 1), 0);
  let r = Math.random() * total;
  for (const value of MULTIPLIER_VALUES) {
    r -= MULTIPLIER_WEIGHTS[value] || 1;
    if (r <= 0) return value;
  }
  return MULTIPLIER_VALUES[MULTIPLIER_VALUES.length - 1];
}

function createSymbolCell() {
  const roll = Math.random();
  // Tuned for playable high-volatility behavior with rare bonus triggers.
  if (roll < 0.009) {
    return { symbol: SCATTER_SYMBOL };
  }
  if (roll < 0.0115) {
    return { symbol: MULTI_SYMBOL, multiplier: randomMultiplierValue(), multiplier_id: nextMultiplierId() };
  }
  return { symbol: weightedRegularSymbol() };
}

function createSymbolCellWithRates(scatterChance, multiChance) {
  const roll = Math.random();
  if (roll < scatterChance) return { symbol: SCATTER_SYMBOL };
  if (roll < scatterChance + multiChance) {
    return { symbol: MULTI_SYMBOL, multiplier: randomMultiplierValue(), multiplier_id: nextMultiplierId() };
  }
  return { symbol: weightedRegularSymbol() };
}

function createMatrixWithMeta() {
  const matrix = Array.from({ length: LAYOUT_ROWS }, () => Array(LAYOUT_REELS).fill(null));
  const multipliers = [];
  for (let row = 0; row < LAYOUT_ROWS; row += 1) {
    for (let col = 0; col < LAYOUT_REELS; col += 1) {
      const cell = createSymbolCell();
      matrix[row][col] = cell.symbol;
      if (cell.symbol === MULTI_SYMBOL) {
        multipliers.push({ row, col, value: cell.multiplier, id: cell.multiplier_id || nextMultiplierId() });
      }
    }
  }
  return { matrix, multipliers };
}

function createMatrixWithMetaRates(scatterChance, multiChance) {
  const matrix = Array.from({ length: LAYOUT_ROWS }, () => Array(LAYOUT_REELS).fill(null));
  const multipliers = [];
  for (let row = 0; row < LAYOUT_ROWS; row += 1) {
    for (let col = 0; col < LAYOUT_REELS; col += 1) {
      const cell = createSymbolCellWithRates(scatterChance, multiChance);
      matrix[row][col] = cell.symbol;
      if (cell.symbol === MULTI_SYMBOL) {
        multipliers.push({ row, col, value: cell.multiplier, id: cell.multiplier_id || nextMultiplierId() });
      }
    }
  }
  return { matrix, multipliers };
}

function sanitizeMultipliersForMatrix(matrix, multipliers = []) {
  const byPos = new Map();
  if (Array.isArray(multipliers)) {
    for (const entry of multipliers) {
      if (!Number.isInteger(entry?.row) || !Number.isInteger(entry?.col)) continue;
      const value = Number(entry?.value);
      if (!Number.isFinite(value) || value <= 0) continue;
      const id = typeof entry?.id === "string" && entry.id ? entry.id : nextMultiplierId();
      byPos.set(`${entry.row}-${entry.col}`, { value, id });
    }
  }
  const sanitized = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (matrix[row][col] !== MULTI_SYMBOL) continue;
      const existing = byPos.get(`${row}-${col}`);
      sanitized.push({
        row,
        col,
        value: Number.isFinite(existing?.value) && existing.value > 0 ? existing.value : randomMultiplierValue(),
        id: existing?.id || nextMultiplierId()
      });
    }
  }
  return sanitized;
}

function toPublicMultipliers(multipliers = []) {
  return (multipliers || []).map((m) => ({
    row: Number(m.row),
    col: Number(m.col),
    value: Number(m.value),
    id: String(m.id || "")
  }));
}

function countSymbol(matrix, symbol) {
  let count = 0;
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (matrix[row][col] === symbol) count += 1;
    }
  }
  return count;
}

function payoutByCount(payoutMap, count) {
  if (count >= 12) return Number(payoutMap["12-30"] || 0);
  if (count >= 10) return Number(payoutMap["10-11"] || 0);
  if (count >= 8) return Number(payoutMap["8-9"] || 0);
  return 0;
}

function scatterPayoutByCount(count) {
  return Number(SCATTER_PAYOUTS[String(count)] || 0);
}

function evaluateWaysWin(matrix, betAmount) {
  const wins = [];
  let total = 0;
  const winningSymbols = new Set();

  for (const symbol of REGULAR_SYMBOLS) {
    const count = countSymbol(matrix, symbol);
    if (count < MIN_MATCH_COUNT) continue;
    const payout = payoutByCount(SYMBOL_PAYOUTS.get(symbol) || {}, Math.min(count, MAX_MATCH_COUNT));
    if (payout <= 0) continue;
    const amount = Number((payout * betAmount).toFixed(2));
    total += amount;
    winningSymbols.add(symbol);
    wins.push({ symbol, count, payout, amount });
  }

  const positions = [];
  for (let row = 0; row < matrix.length; row += 1) {
    for (let col = 0; col < matrix[row].length; col += 1) {
      if (winningSymbols.has(matrix[row][col])) positions.push({ row, col });
    }
  }

  return {
    wins,
    winning_symbols: Array.from(winningSymbols),
    winning_positions: positions,
    total: Number(total.toFixed(2))
  };
}

function applyTumble(matrix, existingMultipliers, winningPositions, scatterChance, multiChance) {
  const next = matrix.map((row) => row.slice());
  const removeSet = new Set(winningPositions.map((p) => `${p.row}-${p.col}`));
  const multiplierByPos = new Map();
  for (const entry of sanitizeMultipliersForMatrix(matrix, existingMultipliers)) {
    multiplierByPos.set(`${entry.row}-${entry.col}`, {
      value: Number(entry.value),
      id: entry.id || nextMultiplierId()
    });
  }

  for (let row = 0; row < next.length; row += 1) {
    for (let col = 0; col < next[row].length; col += 1) {
      if (removeSet.has(`${row}-${col}`)) next[row][col] = null;
    }
  }

  const multipliers = [];
  for (let col = 0; col < LAYOUT_REELS; col += 1) {
    const kept = [];
    for (let row = LAYOUT_ROWS - 1; row >= 0; row -= 1) {
      if (next[row][col] !== null) {
        const symbol = next[row][col];
        const multiplier = symbol === MULTI_SYMBOL ? multiplierByPos.get(`${row}-${col}`) : null;
        kept.push({ symbol, multiplier });
      }
    }

    let writeRow = LAYOUT_ROWS - 1;
    for (let i = 0; i < kept.length; i += 1) {
      next[writeRow][col] = kept[i].symbol;
      if (kept[i].symbol === MULTI_SYMBOL) {
        multipliers.push({
          row: writeRow,
          col,
          value: Number.isFinite(kept[i].multiplier?.value) && kept[i].multiplier.value > 0
            ? Number(kept[i].multiplier.value)
            : randomMultiplierValue(),
          id: kept[i].multiplier?.id || nextMultiplierId()
        });
      }
      writeRow -= 1;
    }
    while (writeRow >= 0) {
      const cell = createSymbolCellWithRates(scatterChance, multiChance);
      next[writeRow][col] = cell.symbol;
      if (cell.symbol === MULTI_SYMBOL) {
        multipliers.push({
          row: writeRow,
          col,
          value: cell.multiplier,
          id: cell.multiplier_id || nextMultiplierId()
        });
      }
      writeRow -= 1;
    }
  }

  return { matrix: next, multipliers };
}

function forceScatterTrigger(matrix, requiredCount) {
  const next = matrix.map((row) => row.slice());
  let current = countSymbol(next, SCATTER_SYMBOL);
  while (current < requiredCount) {
    const row = randomInt(LAYOUT_ROWS);
    const col = randomInt(LAYOUT_REELS);
    if (next[row][col] === SCATTER_SYMBOL) continue;
    next[row][col] = SCATTER_SYMBOL;
    current += 1;
  }
  return next;
}

function injectForcedMultiplier(matrix, multipliers, forcedValue) {
  const value = Number(forcedValue);
  if (!Number.isFinite(value) || !MULTIPLIER_VALUES.includes(value)) {
    return { matrix, multipliers };
  }
  const nextMatrix = matrix.map((row) => row.slice());
  const nextMultipliers = sanitizeMultipliersForMatrix(nextMatrix, multipliers);
  const row = randomInt(LAYOUT_ROWS);
  const col = randomInt(LAYOUT_REELS);
  nextMatrix[row][col] = MULTI_SYMBOL;

  const byPos = new Map(nextMultipliers.map((m) => [`${m.row}-${m.col}`, m]));
  byPos.set(`${row}-${col}`, { row, col, value, id: nextMultiplierId() });
  return {
    matrix: nextMatrix,
    multipliers: Array.from(byPos.values())
  };
}

function evaluateSpinRound(session, betAmount, options = {}) {
  const rtpProfile = options.rtp_profile || getRtpProfileByGameId(options.game_id || session?.gameId);
  const basePayoutScaler = Number(
    rtpProfile?.payout_scaler ?? rtpProfile?.base_payout_scaler ?? DEFAULT_RTP_PAYOUT_SCALER
  );
  const freeSpinPayoutScaler = Number(
    rtpProfile?.free_spin_payout_scaler ?? rtpProfile?.payout_scaler ?? DEFAULT_RTP_PAYOUT_SCALER
  );
  const anteEnabled = Boolean(options.ante_enabled);
  const forceFreeSpinTrigger = Boolean(options.force_free_spin_trigger);
  const skipBetCharge = Boolean(options.skip_bet_charge);
  const isFreeSpin = session.freeSpinsLeft > 0;
  const betCharged = skipBetCharge
    ? 0
    : (!isFreeSpin && anteEnabled ? Number((betAmount * ANTE_MULTIPLIER).toFixed(2)) : betAmount);
  if (!isFreeSpin && session.balance < betCharged) {
    throw new Error("INSUFFICIENT_FUNDS");
  }

  if (!isFreeSpin) {
    session.balance = Number((session.balance - betCharged).toFixed(2));
  } else {
    session.freeSpinsLeft -= 1;
  }

  const scatterChance = Math.min(0.045, anteEnabled ? 0.0172 : 0.0086);
  const multiChance = isFreeSpin ? 0.014 : anteEnabled ? 0.0072 : 0.0042;
  let { matrix, multipliers } = createMatrixWithMetaRates(scatterChance, multiChance);
  if (!isFreeSpin && forceFreeSpinTrigger) {
    matrix = forceScatterTrigger(matrix, FREE_SPINS_TRIGGER);
  }
  if (!isFreeSpin && Number.isFinite(Number(options.force_multiplier_value))) {
    const forced = injectForcedMultiplier(matrix, multipliers, Number(options.force_multiplier_value));
    matrix = forced.matrix;
    multipliers = forced.multipliers;
  }
  multipliers = sanitizeMultipliersForMatrix(matrix, multipliers);
  const tumbleSteps = [];
  let sequenceWin = 0;
  let sequenceMultiplierSum = 0;
  const countedMultiplierIds = new Set();
  let highestScatterSeen = countSymbol(matrix, SCATTER_SYMBOL);
  const sequenceWins = [];
  let firstWinningPositions = [];

  while (true) {
    const ways = evaluateWaysWin(matrix, betAmount);
    tumbleSteps.push({
      matrix,
      multipliers: toPublicMultipliers(multipliers),
      ways_wins: ways.wins,
      win_total: ways.total,
      winning_positions: ways.winning_positions
    });
    if (ways.total <= 0) break;
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
    for (const win of ways.wins) {
      sequenceWins.push(win);
    }
    const tumbled = applyTumble(matrix, multipliers, ways.winning_positions, scatterChance, multiChance);
    matrix = tumbled.matrix;
    multipliers = sanitizeMultipliersForMatrix(matrix, tumbled.multipliers);
    const scatters = countSymbol(matrix, SCATTER_SYMBOL);
    if (scatters > highestScatterSeen) highestScatterSeen = scatters;
  }

  // Safety: derive scatter peak from recorded tumble snapshots too, so
  // retrigger checks remain correct even if future loop flow changes.
  const scatterPeakFromSteps = tumbleSteps.reduce((maxSeen, step) => {
    const c = countSymbol(step?.matrix || [], SCATTER_SYMBOL);
    return c > maxSeen ? c : maxSeen;
  }, 0);
  const scatterPeak = Math.max(highestScatterSeen, scatterPeakFromSteps);

  const payoutScaler = isFreeSpin ? freeSpinPayoutScaler : basePayoutScaler;
  const scaledSequenceWin = Number((sequenceWin * payoutScaler).toFixed(2));
  const scatterWin = Number((scatterPayoutByCount(scatterPeak) * betAmount * payoutScaler).toFixed(2));
  const preMultiplierWin = Number((scaledSequenceWin + scatterWin).toFixed(2));

  let multiplierApplied = 1;
  let multiplierGainApplied = 0;
  if (isFreeSpin) {
    const prevPersistent = Number.isFinite(Number(session.freeSpinPersistentMultiplier))
      ? Number(session.freeSpinPersistentMultiplier)
      : 0;
    if (sequenceWin > 0) {
      multiplierGainApplied = Number(sequenceMultiplierSum.toFixed(2));
      const nextPersistent = Number((prevPersistent + sequenceMultiplierSum).toFixed(2));
      session.freeSpinPersistentMultiplier = nextPersistent;
      multiplierApplied = Math.max(1, nextPersistent);
    } else {
      multiplierGainApplied = 0;
      multiplierApplied = Math.max(1, prevPersistent);
    }
  } else if (sequenceWin > 0 && sequenceMultiplierSum > 0) {
    multiplierGainApplied = Number(sequenceMultiplierSum.toFixed(2));
    multiplierApplied = Number(sequenceMultiplierSum.toFixed(2));
  }
  const freeSpinMultiplierCurrentForResponse = isFreeSpin
    ? Number((session.freeSpinPersistentMultiplier || 0).toFixed(2))
    : 0;

  let totalWin = Number((preMultiplierWin * multiplierApplied).toFixed(2));
  const maxWinCap = Number((MAX_WIN_CAP_X * betAmount).toFixed(2));
  if (totalWin > maxWinCap) totalWin = maxWinCap;

  let freeSpinsAwarded = 0;
  if (!isFreeSpin && scatterPeak >= FREE_SPINS_TRIGGER) {
    freeSpinsAwarded = FREE_SPINS_AWARD;
    session.freeSpinsLeft += freeSpinsAwarded;
    session.freeSpinPersistentMultiplier = 0;
  }
  if (isFreeSpin && scatterPeak >= FREE_SPINS_RETRIGGER_TRIGGER) {
    freeSpinsAwarded = FREE_SPINS_RETRIGGER_AWARD;
    session.freeSpinsLeft += freeSpinsAwarded;
  }

  session.balance = Number((session.balance + totalWin).toFixed(2));

  if (session.freeSpinsLeft === 0) {
    session.freeSpinPersistentMultiplier = 0;
  }

  return {
    is_free_spin: isFreeSpin,
    ante_enabled: anteEnabled,
    bet_amount: betAmount,
    bet_charged: Number(betCharged.toFixed(2)),
    matrix,
    multipliers: toPublicMultipliers(multipliers),
    tumble_steps: tumbleSteps,
    ways_wins: sequenceWins,
    winning_positions: firstWinningPositions,
    scatter_count: scatterPeak,
    scatter_win: scatterWin,
    free_spins_awarded: freeSpinsAwarded,
    free_spins_left: session.freeSpinsLeft,
    multipliers_count_sequence: countedMultiplierIds.size,
    multipliers_sum_sequence: Number(sequenceMultiplierSum.toFixed(2)),
    multiplier_gain_applied: Number(multiplierGainApplied.toFixed(2)),
    multiplier_applied: Number(multiplierApplied.toFixed(2)),
    free_spin_multiplier_current: freeSpinMultiplierCurrentForResponse,
    total_win: totalWin,
    balance_after: session.balance
  };
}
function simulateOneBonusRound(betAmount, options = {}) {
  const session = {
    balance: 0,
    freeSpinsLeft: 1,
    freeSpinPersistentMultiplier: 0
  };
  let roundWin = 0;
  let spinsPlayed = 0;
  let awardedSpins = 0;
  const guardMax = 2000;
  while (session.freeSpinsLeft > 0 && spinsPlayed < guardMax) {
    const spin = evaluateSpinRound(session, betAmount, {
      ante_enabled: false,
      game_id: options.game_id,
      rtp_profile: options.rtp_profile
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

function resolveSpin(session, spinId, betAmount) {
  if (session.spinHistory.has(spinId)) {
    return session.spinHistory.get(spinId);
  }

  const round = evaluateSpinRound(session, betAmount, {
    ante_enabled: session.anteEnabled,
    game_id: session.gameId,
    rtp_profile: session.rtpProfile,
    force_multiplier_value: session.forceMultiplierValue
  });
  const payload = {
    spin_id: spinId,
    ...round,
    // Backward compatibility fields for older UI code paths.
    line_wins: [],
    scatter_win: 0
  };
  session.spinHistory.set(spinId, payload);
  session.forceMultiplierValue = null;
  return payload;
}

function createSession({ player_id, currency, locale, game_id }) {
  const sessionId = crypto.randomUUID();
  const resolvedGameId = game_id || DEFAULT_GAME_ID;
  const session = {
    sessionId,
    playerId: player_id || `player_${Date.now()}`,
    currency: currency || "GEL",
    locale: locale || "en",
    gameId: resolvedGameId,
    rtpProfile: getRtpProfileByGameId(resolvedGameId),
    balance: 1000,
    freeSpinsLeft: 0,
    freeSpinPersistentMultiplier: 0,
    forceMultiplierValue: null,
    anteEnabled: false,
    spinHistory: new Map(),
    createdAt: new Date().toISOString()
  };
  sessions.set(sessionId, session);
  return session;
}

function simulateProfile(steps, betAmount, options = {}) {
  const rtpProfile = options.rtp_profile || getRtpProfileByGameId(options.game_id);
  const bonusOnly = Boolean(options.bonus_only);
  const anteEnabled = Boolean(gameRules.features?.ante_bet?.enabled) && Boolean(options.ante_enabled);
  const chargedBet = Number((betAmount * (anteEnabled ? ANTE_MULTIPLIER : 1)).toFixed(2));
  const session = {
    balance: 0,
    freeSpinsLeft: 0,
    freeSpinPersistentMultiplier: 0
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

  for (let i = 0; i < steps; i += 1) {
    if (bonusOnly) {
      const br = simulateOneBonusRound(betAmount, {
        game_id: rtpProfile.game_id,
        rtp_profile: rtpProfile
      });
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
    const round = evaluateSpinRound(session, betAmount, {
      ante_enabled: anteEnabled,
      game_id: rtpProfile.game_id,
      rtp_profile: rtpProfile
    });
    const win = round.total_win;
    totalWin += win;
    if (round.is_free_spin) {
      bonusWinTotal += win;
    }
    if (!round.is_free_spin && Number(round.free_spins_awarded || 0) > 0) {
      bonusCatchCount += 1;
      bonusAwardedSpins += Number(round.free_spins_awarded || 0);
    }
    if (win > 0) hitSpins += 1;
    if (win >= betAmount * 20) big20 += 1;
    if (win >= betAmount * 50) huge50 += 1;
    if (win > maxWin) maxWin = win;
  }

  const rtp = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
  const casinoNet = paidWager - totalWin;
  const bigWinRatePercent = steps > 0 ? (big20 / steps) * 100 : 0;
  const hugeWinRatePercent = steps > 0 ? (huge50 / steps) * 100 : 0;
  const bonusCatchRatePercent = paidSpins > 0 ? (bonusCatchCount / paidSpins) * 100 : 0;
  const avgPaidSpinsPerBonusCatch = bonusCatchCount > 0 ? paidSpins / bonusCatchCount : null;
  return {
    steps,
    bet_amount: betAmount,
    ante_enabled: anteEnabled,
    bonus_only: bonusOnly,
    charged_bet_amount: bonusOnly ? Number(betAmount.toFixed(2)) : chargedBet,
    paid_spins: paidSpins,
    free_spin_steps: freeSpinSteps,
    paid_wager: Number(paidWager.toFixed(2)),
    player_total_win: Number(totalWin.toFixed(2)),
    casino_net: Number(casinoNet.toFixed(2)),
    rtp_percent: Number(rtp.toFixed(2)),
    house_edge_percent: Number((100 - rtp).toFixed(2)),
    hit_frequency_percent: Number(((hitSpins / steps) * 100).toFixed(2)),
    big_win_20x_count: big20,
    huge_win_50x_count: huge50,
    big_win_rate_percent: Number(bigWinRatePercent.toFixed(3)),
    huge_win_rate_percent: Number(hugeWinRatePercent.toFixed(3)),
    max_win_x: Number((maxWin / betAmount).toFixed(2)),
    bonus_catch_count: bonusCatchCount,
    bonus_catch_rate_percent: Number(bonusCatchRatePercent.toFixed(4)),
    avg_paid_spins_per_bonus_catch:
      avgPaidSpinsPerBonusCatch === null ? null : Number(avgPaidSpinsPerBonusCatch.toFixed(2)),
    bonus_awarded_spins_total: bonusAwardedSpins,
    bonus_win_total: Number(bonusWinTotal.toFixed(2))
  };
}

function runSimulationComparison(steps, betAmount, options = {}) {
  const current = simulateProfile(steps, betAmount, options);
  const baseline = { ...current };
  const profile = options.rtp_profile || getRtpProfileByGameId(options.game_id);
  const minWithTolerance = Number(profile.target_band_min) - Number(profile.target_tolerance_percent);
  const maxWithTolerance = Number(profile.target_band_max) + Number(profile.target_tolerance_percent);
  return {
    steps,
    bet_amount: betAmount,
    game_id: profile.game_id,
    slug: profile.slug,
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

function buildSimulationReport(steps, betAmount, current) {
  const baseline = { ...current };
  const profile = getRtpProfileByGameId(current.game_id);
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

function streamSimulationComparison(req, res, steps, betAmount, options = {}) {
  const rtpProfile = options.rtp_profile || getRtpProfileByGameId(options.game_id);
  const bonusOnly = Boolean(options.bonus_only);
  const anteEnabled = Boolean(gameRules.features?.ante_bet?.enabled) && Boolean(options.ante_enabled);
  const chargedBet = Number((betAmount * (anteEnabled ? ANTE_MULTIPLIER : 1)).toFixed(2));
  const chunkSize = 1000;
  let completed = 0;
  let closed = false;
  const session = {
    balance: 0,
    freeSpinsLeft: 0,
    freeSpinPersistentMultiplier: 0
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

  req.on("close", () => {
    closed = true;
  });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }
  if (res.socket && typeof res.socket.setNoDelay === "function") {
    res.socket.setNoDelay(true);
  }
  res.write("\n");

  const sendEvent = (name, payload) => {
    if (closed) return;
    res.write(`event: ${name}\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const tick = () => {
    if (closed) return;
    const end = Math.min(steps, completed + chunkSize);
    for (let i = completed; i < end; i += 1) {
      if (bonusOnly) {
        const br = simulateOneBonusRound(betAmount, {
          game_id: rtpProfile.game_id,
          rtp_profile: rtpProfile
        });
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
      const round = evaluateSpinRound(session, betAmount, {
        ante_enabled: anteEnabled,
        game_id: rtpProfile.game_id,
        rtp_profile: rtpProfile
      });
      const win = round.total_win;
      totalWin += win;
      if (round.is_free_spin) {
        bonusWinTotal += win;
      }
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

    sendEvent("progress", {
      steps_completed: completed,
      steps_total: steps,
      progress_percent: Number(((completed / steps) * 100).toFixed(2)),
      game_id: rtpProfile.game_id,
      slug: rtpProfile.slug,
      ante_enabled: anteEnabled,
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
      current_bonus_catch_rate_percent:
        Number((paidSpins > 0 ? (bonusCatchCount / paidSpins) * 100 : 0).toFixed(4)),
      current_bonus_awarded_spins_total: bonusAwardedSpins,
      current_bonus_win_total: Number(bonusWinTotal.toFixed(2)),
      baseline_rtp_percent: Number(liveRtp.toFixed(2)),
      baseline_casino_net: Number(casinoNet.toFixed(2)),
      baseline_bonus_catch_count: bonusCatchCount,
      baseline_bonus_win_total: Number(bonusWinTotal.toFixed(2))
    });

    if (completed < steps) {
      setTimeout(tick, 8);
      return;
    }

    const liveRtpFinal = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
    const current = {
      steps,
      bet_amount: betAmount,
      game_id: rtpProfile.game_id,
      ante_enabled: anteEnabled,
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
      avg_paid_spins_per_bonus_catch:
        bonusCatchCount > 0 ? Number((paidSpins / bonusCatchCount).toFixed(2)) : null,
      bonus_awarded_spins_total: bonusAwardedSpins,
      bonus_win_total: Number(bonusWinTotal.toFixed(2))
    };
    const report = buildSimulationReport(steps, betAmount, current);
    sendEvent("complete", { report });
    if (!closed) res.end();
  };

  tick();
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8"; // HTML files
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8"; // JavaScript files
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8"; // CSS files
  if (filePath.endsWith(".json")) return "application/json; charset=utf-8"; // JSON files
  if (filePath.endsWith(".png")) return "image/png"; // PNG images
  if (filePath.endsWith(".svg")) return "image/svg+xml"; // SVG images
  if (filePath.endsWith(".jpg") || filePath.endsWith(".jpeg")) return "image/jpeg"; // JPEG images
  if (filePath.endsWith(".gif")) return "image/gif"; // GIF images
  return "application/octet-stream";
}

function serveStatic(req, res, parsedUrl) {
  let requested = parsedUrl.pathname;
  if (requested === "/") requested = "/index.html";
  const baseDir = CLIENT_DIR;

  const filePath = path.normalize(path.join(baseDir, requested));
  if (!filePath.startsWith(baseDir)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { error: "NOT_FOUND" });
      return;
    }
    // Strip UTF-8 BOM (\ufeff / 0xEF 0xBB 0xBF) if present. 
    // Browsers often fail to render SVGs in <img> tags if they start with a BOM.
    let content = data;
    if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
      content = data.slice(3);
    }
    res.writeHead(200, { "Content-Type": contentTypeFor(filePath) });
    res.end(content);
  });
}

function handleApi(req, res, parsedUrl) {
  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/health") {
    return sendJson(res, 200, { status: "ok", uptime: process.uptime() });
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/game-rules") {
    const gameId = parsedUrl.searchParams.get("game_id") || DEFAULT_GAME_ID;
    const profile = getRtpProfileByGameId(gameId);
    return sendJson(res, 200, {
      ...gameRules,
      active_game_id: profile.game_id,
      active_slug: profile.slug,
      rtp: {
        ...gameRules.rtp,
        theoretical_percent: profile.theoretical_percent,
        ante_bet_percent: profile.ante_bet_percent,
        buy_free_spins_percent: profile.buy_free_spins_percent,
        target_band_min: profile.target_band_min,
        target_band_max: profile.target_band_max,
        target_tolerance_percent: profile.target_tolerance_percent
      }
    });
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
          slug: session.rtpProfile?.slug || "",
          rtp_profile: session.rtpProfile,
          math_config_id: "engine-v2",
          rules_config_id: gameRules.version
        });
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/spin") {
    return parseBody(req)
      .then((body) => {
        const session = sessions.get(body.session_id);
        if (!session) return sendJson(res, 404, { error: "SESSION_NOT_FOUND" });
        const betAmount = Number(body.bet_amount);
        session.anteEnabled = Boolean(gameRules.features?.ante_bet?.enabled) && Boolean(body.ante_enabled);
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          return sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
        }
        try {
          const spinId = body.spin_id || crypto.randomUUID();
          const forcedValue = Number(body.force_multiplier_value);
          session.forceMultiplierValue =
            Number.isFinite(forcedValue) && MULTIPLIER_VALUES.includes(forcedValue)
              ? forcedValue
              : null;
          const outcome = resolveSpin(session, spinId, betAmount);
          session.forceMultiplierValue = null;
          sendJson(res, 200, {
            ...outcome,
            game_id: session.gameId,
            slug: session.rtpProfile?.slug || "",
            theoretical_rtp_percent: Number(session.rtpProfile?.theoretical_percent || 0)
          });
        } catch (err) {
          sendJson(res, 400, { error: err.message || "INTERNAL_ERROR" });
        }
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/buy-free-spins") {
    return parseBody(req)
      .then((body) => {
        const session = sessions.get(body.session_id);
        if (!session) return sendJson(res, 404, { error: "SESSION_NOT_FOUND" });
        const betAmount = Number(body.bet_amount);
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          return sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
        }
        if (!Boolean(gameRules.features?.buy_free_spins?.enabled)) {
          return sendJson(res, 400, { error: "BUY_FREE_SPINS_DISABLED" });
        }
        if (session.anteEnabled) {
          return sendJson(res, 400, { error: "BUY_DISABLED_WHEN_ANTE_ENABLED" });
        }
        const cost = Number((betAmount * Number(gameRules.features?.buy_free_spins?.cost_multiplier || 100)).toFixed(2));
        if (session.balance < cost) {
          return sendJson(res, 400, { error: "INSUFFICIENT_FUNDS" });
        }
        session.balance = Number((session.balance - cost).toFixed(2));
        const round = evaluateSpinRound(session, betAmount, {
          ante_enabled: false,
          force_free_spin_trigger: true,
          skip_bet_charge: true,
          game_id: session.gameId,
          rtp_profile: session.rtpProfile
        });
        const spinId = crypto.randomUUID();
        const payload = {
          spin_id: spinId,
          buy_free_spins: true,
          buy_cost: cost,
          game_id: session.gameId,
          slug: session.rtpProfile?.slug || "",
          theoretical_rtp_percent: Number(session.rtpProfile?.theoretical_percent || 0),
          ...round,
          line_wins: [],
          scatter_win: 0
        };
        session.spinHistory.set(spinId, payload);
        sendJson(res, 200, payload);
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/v1/simulate/stream") {
    const steps = Number(parsedUrl.searchParams.get("steps"));
    const betAmount = Number(parsedUrl.searchParams.get("bet_amount"));
    const anteEnabled = parseBooleanLike(parsedUrl.searchParams.get("ante_enabled"), false);
    const bonusOnly = parseBooleanLike(parsedUrl.searchParams.get("bonus_only"), false);
    const gameId = parsedUrl.searchParams.get("game_id") || DEFAULT_GAME_ID;
    const rtpProfile = getRtpProfileByGameId(gameId);
    if (!Number.isInteger(steps) || steps < 1000 || steps > 1000000) {
      return sendJson(res, 400, { error: "INVALID_STEPS", min_steps: 1000, max_steps: 1000000 });
    }
    if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
      return sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
    }
    streamSimulationComparison(req, res, steps, betAmount, {
      ante_enabled: anteEnabled,
      bonus_only: bonusOnly,
      game_id: gameId,
      rtp_profile: rtpProfile
    });
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/v1/simulate") {
    return parseBody(req)
      .then((body) => {
        const steps = Number(body.steps);
        const betAmount = Number(body.bet_amount);
        const anteEnabled = parseBooleanLike(body.ante_enabled, false);
        const bonusOnly = parseBooleanLike(body.bonus_only, false);
        const gameId = body.game_id || DEFAULT_GAME_ID;
        const rtpProfile = getRtpProfileByGameId(gameId);
        if (!Number.isInteger(steps) || steps < 1000 || steps > 1000000) {
          return sendJson(res, 400, { error: "INVALID_STEPS", min_steps: 1000, max_steps: 1000000 });
        }
        if (!Number.isFinite(betAmount) || !ALLOWED_BETS.includes(betAmount)) {
          return sendJson(res, 400, { error: "INVALID_BET", allowed_bets: ALLOWED_BETS });
        }
        sendJson(
          res,
          200,
          runSimulationComparison(steps, betAmount, {
            ante_enabled: anteEnabled,
            bonus_only: bonusOnly,
            game_id: gameId,
            rtp_profile: rtpProfile
          })
        );
      })
      .catch((err) => sendJson(res, 400, { error: err.message }));
  }

  sendJson(res, 404, { error: "NOT_FOUND" });
}

const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  if (parsedUrl.pathname.startsWith("/api/")) return handleApi(req, res, parsedUrl);
  if (req.method === "GET") return serveStatic(req, res, parsedUrl);
  sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
});

let currentPort = BASE_PORT;

function startServerWithPortFallback(port) {
  currentPort = port;
  server.listen(port, () => {
    console.log(`Slot MVP running at http://localhost:${port}`);
  });
}

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    const nextPort = currentPort + 1;
    console.warn(`Port ${currentPort} is in use, retrying on ${nextPort}...`);
    setTimeout(() => startServerWithPortFallback(nextPort), 100);
    return;
  }
  throw err;
});

startServerWithPortFallback(BASE_PORT);

