const fs = require("fs");
const crypto = require("crypto");

const paytable = JSON.parse(fs.readFileSync("math/paytable-v1.json", "utf8"));
const reelStrips = JSON.parse(
  fs.readFileSync("math/reel-strips-v1.json", "utf8")
).reels;

const steps = Number(process.argv[2] || 300000);
const bet = Number(process.argv[3] || 1);

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

const regularSymbols = Object.keys(paytable.symbols).filter(
  (s) => s !== "SCATTER"
);

function randomInt(maxExclusive) {
  return crypto.randomInt(0, maxExclusive);
}

function generateMatrix() {
  const matrix = [[], [], []];
  for (let reelIndex = 0; reelIndex < reelStrips.length; reelIndex += 1) {
    const strip = reelStrips[reelIndex];
    const stop = randomInt(strip.length);
    for (let row = 0; row < 3; row += 1) {
      matrix[row][reelIndex] = strip[(stop + row) % strip.length];
    }
  }
  return matrix;
}

function maybeApplyExpandingWild(matrix, isFreeSpin) {
  const chance = isFreeSpin ? 0.04 : 0.02;
  if (Math.random() >= chance) return matrix;
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
  let best = 0;
  for (const symbol of regularSymbols) {
    let count = 0;
    for (let i = 0; i < lineSymbols.length; i += 1) {
      const sym = lineSymbols[i];
      if (sym === symbol || sym === "WILD") count += 1;
      else break;
    }
    if (count >= 3) {
      const payout = paytable.symbols[symbol]?.[String(count)] || 0;
      const value = payout * betPerLine * multiplier;
      if (value > best) best = value;
    }
  }
  return best;
}

let totalWin = 0;
let paidWager = 0;
let paidSpins = 0;
let hitSpins = 0;
let freeSpinSteps = 0;
let freeSpinsLeft = 0;
let bonusMultiplier = 1;

for (let i = 0; i < steps; i += 1) {
  const isFreeSpin = freeSpinsLeft > 0;
  if (isFreeSpin) {
    freeSpinsLeft -= 1;
    freeSpinSteps += 1;
  } else {
    paidWager += bet;
    paidSpins += 1;
  }

  let matrix = generateMatrix();
  matrix = maybeApplyExpandingWild(matrix, isFreeSpin);

  const lineBet = bet;
  const activeMultiplier = isFreeSpin ? bonusMultiplier : 1;
  let win = 0;
  for (const payline of PAYLINES) {
    const lineSymbols = payline.map((row, reel) => matrix[row][reel]);
    win += evaluateLine(lineSymbols, lineBet, activeMultiplier);
  }

  const scatterCount = countScatters(matrix);
  win += (paytable.symbols.SCATTER[String(scatterCount)] || 0) * bet;
  const trigger = paytable.scatter_triggers[String(scatterCount)];
  if (trigger) {
    if (isFreeSpin) {
      freeSpinsLeft += 5;
      bonusMultiplier = Math.min(5, bonusMultiplier + 1);
    } else {
      freeSpinsLeft += trigger.free_spins;
      bonusMultiplier = 2;
    }
  }
  if (freeSpinsLeft === 0) bonusMultiplier = 1;

  if (win > 0) hitSpins += 1;
  totalWin += win;
}

const rtp = paidWager > 0 ? (totalWin / paidWager) * 100 : 0;
const hitFreq = (hitSpins / steps) * 100;

console.log(
  JSON.stringify(
    {
      steps,
      paid_spins: paidSpins,
      free_spin_steps: freeSpinSteps,
      bet,
      rtp_percent: Number(rtp.toFixed(2)),
      hit_frequency_percent: Number(hitFreq.toFixed(2))
    },
    null,
    2
  )
);
