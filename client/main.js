const $ = (id) => document.getElementById(id);

// Public/admin mode — default is public (player view). Add `?admin=1` to the
// URL (or set window.__adminMode = true before scripts load) for the dev view.
(() => {
  const params = new URLSearchParams(window.location.search);
  const isAdmin = params.has("admin") || Boolean(window.__adminMode);
  document.body.classList.add(isAdmin ? "admin-mode" : "public-mode");
})();

const el = {
  sessionId: $("sessionId"),
  balance: $("balance"),
  betView: $("betView"),
  winningLines: $("winningLines"),
  lastWin: $("lastWin"),
  freeSpins: $("freeSpins"),
  freeSpinsNode: $("freeSpinsNode"),
  activeMultiplier: $("activeMultiplier"),
  activeMultiplierNode: $("activeMultiplierNode"),
  bonusTotal: $("bonusTotal"),
  bonusTotalNode: $("bonusTotalNode"),
  betSelect: $("betSelect"),
  betDisplay: $("betDisplay"),
  betDownBtn: $("betDownBtn"),
  betUpBtn: $("betUpBtn"),
  spinBtn: $("spinBtn"),
  simulateBtn: $("simulateBtn"),
  simulateBonusBtn: $("simulateBonusBtn"),
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
  roundIdBar: $("roundIdBar"),
  roundIdValue: $("roundIdValue"),
  roundIdCopyBtn: $("roundIdCopyBtn"),
  roundIdCopied: $("roundIdCopied"),
  spinsPlayed: $("spinsPlayed"),
  sessionWagered: $("sessionWagered"),
  sessionWon: $("sessionWon"),
  sessionNet: $("sessionNet"),
  sessionRtp: $("sessionRtp"),
  sessionHitRate: $("sessionHitRate"),
  sessionMaxWinX: $("sessionMaxWinX"),
  sessionBonusHits: $("sessionBonusHits"),
  sessionWinLoss: $("sessionWinLoss"),
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
  multiplierInfo: $("multiplierInfo"),
  winCallout: $("winCallout"),
  winCalloutLabel: $("winCalloutLabel"),
  winCalloutAmount: $("winCalloutAmount"),
  testDropBtn: $("testDropBtn"),
  testExplodeBtn: $("testExplodeBtn"),
  testCelebrateBtn: $("testCelebrateBtn"),
  testCatchBtn: $("testCatchBtn"),
  testMultiButtons: $("testMultiButtons"),
  crazyToggleBtn: $("crazyToggleBtn"),
  featureScreen: $("featureScreen"),
  featureScreenKicker: $("featureScreenKicker"),
  featureScreenTitle: $("featureScreenTitle"),
  featureScreenCopy: $("featureScreenCopy"),
  eventBanner: $("eventBanner"),
  eventBannerText: $("eventBannerText"),
  vaultWindow: document.querySelector(".vault-window")
};

const state = {
  sessionId: null,
  gameId: "bananax",
  rules: null,
  rulesPageIndex: 0,
  bonusAutoplay: false,
  simulationAbort: null,
  featureResolver: null,
  spinLog: [],
  activityLog: [],
  spinSeq: 0,
  bannerTimer: null,
  calloutTimer: null,
  testBusy: false,
  forcedMultiplierLock: null,
  spinFlownSouls: new Set(),
  spinMultDisplay: 1,
  spinCelebratedMultis: new Set(),
  bonusMultiplierCarry: 0,
  roundAnimating: false,
  fastStopRequested: false,
  crazyMode: false
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
  TOP_CROWN: "assets/symbols/TOP_CROWN-removebg-preview.png",
  HOURGLASS: "assets/symbols/HOURGLASS-removebg-preview.png",
  RING: "assets/symbols/RING-removebg-preview.png",
  CHALICE: "assets/symbols/CHALICE-removebg-preview.png",
  RED_GEM: "assets/symbols/RED_GEM-removebg-preview.png",
  PURPLE_TRIANGLE: "assets/symbols/PURPLE_TRIANGLE-removebg-preview.png",
  YELLOW_HEX: "assets/symbols/YELLOW_HEX-removebg-preview.png",
  GREEN_TRIANGLE: "assets/symbols/GREEN_TRIANGLE-removebg-preview.png",
  BLUE_DIAMOND: "assets/symbols/BLUE_DIAMOND-removebg-preview.png",
  REEL: "assets/symbols/REEL.png",
  MULTI: "assets/symbols/multi.svg",
  MULTI2: "assets/symbols/MULTI2-removebg-preview.png",
  MULTI3: "assets/symbols/MULTI3-removebg-preview.png",
  MULTI4: "assets/symbols/MULTI4-removebg-preview.png",
  MULTI5: "assets/symbols/MULTI5-removebg-preview.png",
  MULTI6: "assets/symbols/MULTI6-removebg-preview.png",
  MULTI8: "assets/symbols/MULTI8-removebg-preview.png",
  MULTI10: "assets/symbols/MULTI10-removebg-preview.png",
  MULTI12: "assets/symbols/MULTI12-removebg-preview.png",
  MULTI15: "assets/symbols/MULTI15-removebg-preview.png",
  MULTI20: "assets/symbols/MULTI20-removebg-preview.png",
  MULTI25: "assets/symbols/MULTI25-removebg-preview.png",
  MULTI50: "assets/symbols/MULTI50-removebg-preview.png",
  MULTI100: "assets/symbols/MULTI100-removebg-preview.png",
  MULTI250: "assets/symbols/MULTI250-removebg-preview.png",
  MULTI500: "assets/symbols/MULTI500-removebg-preview.png",
  MULTI1000: "assets/symbols/MULTI1000-removebg-preview.png",
  SCATTER: "assets/symbols/SCATTER.png"
};

const stats = { spins: 0, wins: 0, losses: 0, wagered: 0, won: 0, maxWinX: 0, bonusHits: 0 };
const ANIMATION_TIMING = {
  spinBurst: 520,
  oldBoardDropOff: 1040,
  introDrop: 1040,
  tumbleDrop: 980,
  tumbleDropOverlap: 260,
  markSmall: 680,
  markMedium: 760,
  markGreat: 860,
  // Large clusters (8+ caught symbols) hold the mark longer so the player can
  // clearly read every symbol in the match before it explodes. The base mark
  // above is extended by markPerExtraSymbol for each symbol past the threshold,
  // capped by markBigClusterCap so very large boards stay responsive.
  markBigClusterThreshold: 8,
  markPerExtraSymbol: 34,
  markBigClusterCap: 540,
  explode: 540
};
const fmt = (v) => Number(v || 0).toFixed(2);
const mfmt = (v) => (Number.isInteger(Number(v || 0)) ? `${Number(v || 0)}x` : `${Number(v || 0).toFixed(1)}x`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const animationSleep = (ms) => sleep(state.fastStopRequested ? Math.min(50, ms) : ms);
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const easeOutBack = (t) => 1 + 1.6 * (t - 1) ** 3 + 0.6 * (t - 1) ** 2;

async function animateWinMeter(from, to, duration = 260) {
  const start = Number(from || 0);
  const end = Number(to || 0);
  if (state.fastStopRequested) duration = Math.min(duration, 80);
  if (!el.lastWin) return;
  if (!Number.isFinite(start) || !Number.isFinite(end) || duration <= 0 || Math.abs(end - start) < 0.01) {
    el.lastWin.textContent = fmt(end);
    return;
  }
  const t0 = performance.now();
  const span = Math.max(80, duration);
  while (true) {
    const t = clamp((performance.now() - t0) / span, 0, 1);
    const eased = 1 - (1 - t) ** 3;
    el.lastWin.textContent = fmt(lerp(start, end, eased));
    if (t >= 1) break;
    await sleep(16);
  }
  el.lastWin.textContent = fmt(end);
}
const easeOutCubic = (t) => 1 - (1 - t) ** 3;
const easeOutQuint = (t) => 1 - (1 - t) ** 5;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOutExpo = (t) => (t >= 1 ? 1 : 1 - 2 ** (-10 * t));
const easeOutElastic = (t) => {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c4 = (2 * Math.PI) / 3;
  return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
};
const easeOutBounce = (t) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) { const u = t - 1.5 / d1; return n1 * u * u + 0.75; }
  if (t < 2.5 / d1) { const u = t - 2.25 / d1; return n1 * u * u + 0.9375; }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
};

function setSigned(target, value) {
  target.classList.remove("positive", "negative");
  if (value > 0) target.classList.add("positive");
  if (value < 0) target.classList.add("negative");
}

const symbolTone = {
  TOP_CROWN: ["#9ce4ff", "#3f7cff"],
  HOURGLASS: ["#96fff8", "#2fa0c6"],
  RING: ["#f2b8ff", "#8b5cf6"],
  CHALICE: ["#b8d6ff", "#4d7dff"],
  RED_GEM: ["#ff8cb4", "#dc3f7a"],
  PURPLE_TRIANGLE: ["#d4bcff", "#7e56ff"],
  YELLOW_HEX: ["#bff6ff", "#3aa2ff"],
  GREEN_TRIANGLE: ["#b4ffd9", "#29b68f"],
  BLUE_DIAMOND: ["#98e8ff", "#2e8bff"],
  MULTI: ["#d8f6ff", "#5ea1ff"],
  SCATTER: ["#ffd2ff", "#8b5cf6"]
};

const MULTIPLIER_TIER_DEFS = [
  { key: "common", label: "Common", values: [2, 3, 4, 5, 6, 8], accent: "#7dd3fc", glow: "rgba(125, 211, 252, 0.5)" },
  { key: "rare", label: "Rare", values: [10, 12, 15, 20, 25], accent: "#a78bfa", glow: "rgba(167, 139, 250, 0.52)" },
  { key: "epic", label: "Epic", values: [50], accent: "#fb923c", glow: "rgba(251, 146, 60, 0.56)" },
  { key: "legendary", label: "Legendary", values: [100, 250, 500], accent: "#facc15", glow: "rgba(250, 204, 21, 0.62)" },
  { key: "mythic", label: "Mythic", values: [1000], accent: "#f472b6", glow: "rgba(244, 114, 182, 0.66)" }
];

const MULTIPLIER_TIER_BY_VALUE = new Map(
  MULTIPLIER_TIER_DEFS.flatMap((tier) => tier.values.map((v) => [v, tier]))
);
const TEST_MULTIPLIERS = MULTIPLIER_TIER_DEFS.flatMap((tier) => tier.values);

function getMultiplierTier(value) {
  return MULTIPLIER_TIER_BY_VALUE.get(Number(value)) || MULTIPLIER_TIER_DEFS[0];
}

function multiplierIconScale(value) {
  const v = Number(value || 0);
  if (v >= 1000) return 1.34;
  if (v >= 500) return 1.28;
  if (v >= 250) return 1.21;
  if (v >= 100) return 1.14;
  if (v >= 50) return 1.08;
  if (v >= 20) return 1.04;
  return 1;
}

class ReelCanvasRenderer {
  constructor(canvas, { rowsCount, colsCount }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rows = rowsCount;
    this.cols = colsCount;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.images = new Map();
    this.board = {
      matrix: Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => "BLUE_DIAMOND")),
      winningSet: new Set(),
      multiMap: new Map(),
      hidden: false
    };
    this.fx = {
      drop: null,
      pulse: null,
      blast: null,
      charge: null,
      spinBurst: null,
      multiCatch: null,
      shockwaves: [],
      reelSlam: null,
      jackpotFlash: null,
      spotlight: null,
      heavyDrop: null,
      impacts: [],
      rays: [],
      heavyReveals: new Map(),
      bangs: [],
      bangedKeys: new Set(),
      struckKeys: new Set(),
      lightning: [],
      landDust: [],
      cluster: null,
      sweeps: []
    };
    this.multiplierDecoyById = new Map();
    this.particles = [];
    this.time = 0;
    this.lastTick = performance.now();
    this.resizeObserver = new ResizeObserver(() => this.resize());
    const parent = this.canvas.parentElement;
    if (parent) this.resizeObserver.observe(parent);
    this.preloadSymbols();
    this.resize();
    this.loop();
  }

  preloadSymbols() {
    Object.entries(symbolAssets).forEach(([name, src]) => {
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      this.images.set(name, image);
    });
  }

  resize() {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.dpr = Math.max(1, window.devicePixelRatio || 1);
    this.canvas.width = Math.round(box.width * this.dpr);
    this.canvas.height = Math.round(box.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  setBoard(matrix, { winning = [], multipliers = [] } = {}) {
    // Strong commit: always deep-copy when we have a real matrix so future
    // mutations of the source array can't leak back into the rendered board.
    let safeMatrix;
    if (Array.isArray(matrix) && matrix.length) {
      safeMatrix = matrix.map((row) => (Array.isArray(row) ? row.slice() : []));
    } else {
      safeMatrix = this.board.matrix;
    }
    this.board.matrix = safeMatrix;
    this.board.winningSet = new Set((winning || []).map((p) => `${p.row}-${p.col}`));
    this.board.multiMap = new Map(
      (multipliers || []).map((m) => [`${m.row}-${m.col}`, Number(m.value || 1)])
    );
    this.board.hidden = false;
    this.dirty = true;
    if (typeof window !== "undefined") {
      window.__boardDebug = (safeMatrix?.[0] || []).slice(0, 3).join(",");
    }
    if (window.__renderDebug) {
      console.log(`[setBoard] row0=${(safeMatrix?.[0] || []).slice(0, 3).join(",")}`);
    }
  }

  forceDrawNow() {
    try { this.draw(); } catch (err) { console.error("forceDrawNow draw failed:", err); }
  }

  requestFastStop() {
    const now = performance.now();
    if (this.fx.drop) {
      this.fx.drop.duration = Math.min(this.fx.drop.duration || 120, 120);
      this.fx.drop.start = Math.min(this.fx.drop.start || now, now - 90);
    }
    if (this.fx.heavyDrop) {
      this.fx.heavyDrop.duration = Math.min(this.fx.heavyDrop.duration || 120, 120);
      this.fx.heavyDrop.start = Math.min(this.fx.heavyDrop.start || now, now - 90);
    }
    this.fx.cluster = null;
    this.fx.sweeps = [];
    this.fx.charge = null;
    this.fx.spotlight = null;
    this.particles = this.particles.slice(-40);
  }

  cellCenter(row, col) {
    const { padX, top, laneW, rowStep } = this.getLayout();
    return {
      x: padX + laneW * (col + 0.5),
      y: top + rowStep * (row + 0.5)
    };
  }

  spawnExplosionParticles(winning = [], strength = "medium", delays = null) {
    if (!winning.length) return;
    // Halved particle counts — explosions are now localized and readable
    // rather than chaotic. Great wins still get a noticeably stronger burst.
    const perCell = strength === "great" ? 12 : strength === "small" ? 4 : 8;
    const speed = strength === "great" ? 1.25 : strength === "small" ? 0.65 : 0.9;
    winning.forEach((p) => {
      if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col)) return;
      const key = `${p.row}-${p.col}`;
      const onset = delays?.get?.(key) || 0;
      const fire = () => this.emitCellExplosion(p, strength, perCell, speed);
      if (onset > 0) setTimeout(fire, onset);
      else fire();
    });
  }

  emitCellExplosion(p, strength, perCell, speed) {
      const center = this.cellCenter(p.row, p.col);
      const tone = symbolTone[this.board.matrix?.[p.row]?.[p.col] || "BLUE_DIAMOND"] || symbolTone.BLUE_DIAMOND;
      const now = performance.now();
      // One clean shockwave per cell. Great wins get a single extra accent
      // ring instead of the triple-stack — much more readable.
      this.fx.shockwaves.push({
        x: center.x,
        y: center.y,
        born: now,
        life: strength === "great" ? 460 : strength === "small" ? 260 : 340,
        color: tone[0]
      });
      if (strength === "great") {
        this.fx.shockwaves.push({ x: center.x, y: center.y, born: now + 70, life: 360, color: "rgba(255, 240, 196, 0.55)" });
      }
      // Rays only on great wins, and far fewer of them.
      if (strength === "great") {
        const rayCount = 3;
        for (let i = 0; i < rayCount; i += 1) {
          this.fx.rays.push({
            x: center.x,
            y: center.y,
            angle: (Math.PI * 2 * i) / rayCount + Math.random() * 0.18,
            born: now + Math.random() * 40,
            life: 360,
            len: 3.0,
            color: tone[0]
          });
        }
      }
      // Embers cut to a small drift — calm leftover heat rather than a plume.
      if (strength !== "small") {
        const emberCount = strength === "great" ? 4 : 2;
        for (let i = 0; i < emberCount; i += 1) {
          this.particles.push({
            x: center.x + (Math.random() - 0.5) * 12,
            y: center.y + (Math.random() - 0.5) * 8,
            vx: (Math.random() - 0.5) * 0.5,
            vy: -0.35 - Math.random() * 0.55,
            life: 640 + Math.random() * 260,
            born: now + 60 + Math.random() * 100,
            size: 0.9 + Math.random() * 0.9,
            colorA: tone[0],
            colorB: "#fff2c8",
            mode: "ember"
          });
        }
      }
      for (let i = 0; i < perCell; i += 1) {
        const a = Math.random() * Math.PI * 2;
          const v = (1.2 + Math.random() * 1.8) * speed;
        this.particles.push({
          x: center.x,
          y: center.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - (0.4 + Math.random() * 0.9),
          life: 300 + Math.random() * 220,
          born: performance.now(),
          size: 1.2 + Math.random() * 1.6,
          colorA: tone[0],
          colorB: tone[1],
          mode: i % 3 === 0 ? "shard" : "spark",
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.22
        });
      }
  }

  spawnMultiplierCatchParticles(multipliers = []) {
    multipliers.forEach((m) => {
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col)) return;
      const center = this.cellCenter(m.row, m.col);
      const valueNum = Number(m.value || 2);
      const tier = getMultiplierTier(valueNum);
      const tierBoost = tier.key === "mythic" ? 3.2 : tier.key === "legendary" ? 2.4 : tier.key === "epic" ? 1.7 : tier.key === "rare" ? 1.25 : 1;
      const count = Math.round(26 * tierBoost);
      for (let i = 0; i < count; i += 1) {
        const a = (Math.PI * 2 * i) / count + Math.random() * 0.2;
        const outward = (1.1 + Math.random() * 1.7) * Math.sqrt(tierBoost);
        this.particles.push({
          x: center.x,
          y: center.y,
          vx: Math.cos(a) * outward,
          vy: Math.sin(a) * outward,
          life: 500 + Math.random() * 220,
          born: performance.now(),
          size: 1.5 + Math.random() * 2,
          colorA: tier.accent,
          colorB: "#eaf3ff",
          mode: "orb"
        });
      }
      this.fx.shockwaves.push({
        x: center.x,
        y: center.y,
        born: performance.now(),
        life: 700,
        color: tier.accent
      });
    });
  }

  async preSpin(duration = ANIMATION_TIMING.spinBurst) {
    this.fx.spinBurst = { start: performance.now(), duration };
    await animationSleep(duration);
    this.fx.spinBurst = null;
  }

  async dropOff(duration = ANIMATION_TIMING.oldBoardDropOff) {
    const hasBoard = Array.isArray(this.board.matrix) && this.board.matrix.length > 0;
    if (!hasBoard) return;
    this.board.winningSet = new Set();
    this.fx.heavyReveals = new Map();
    const dropMap = {};
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) dropMap[`${r}-${c}`] = this.rows + 1;
    }
    this.fx.drop = {
      start: performance.now(),
      duration,
      map: dropMap,
      heavy: new Map(),
      exit: true
    };
    const maxDelay = Object.entries(dropMap).reduce((acc, [key, count]) => {
      const [row, col] = key.split("-").map((n) => Number(n));
      return Math.max(acc, this.dropDelay(row, col, Number(count || 0)));
    }, 0);
    await animationSleep(duration + maxDelay + 40);
    this.fx.drop = null;
    this.board.hidden = true;
  }

  async intro(matrix, multipliers = [], options = {}) {
    const introMap = {};
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) introMap[`${r}-${c}`] = this.rows;
    }
    return this.drop(matrix, multipliers, introMap, ANIMATION_TIMING.introDrop, options);
  }

  resetHeavyBangs() {
    this.fx.bangedKeys = new Set();
    this.fx.struckKeys = new Set();
    this.multiplierDecoyById = new Map();
  }

  pickStableMultiplierDecoy(multiplierId, forbiddenSymbols = [], salt = "") {
    const blocked = new Set((forbiddenSymbols || []).filter(Boolean));
    const regularSymbols = Object.keys(payouts);
    const pool = regularSymbols.filter((s) => !blocked.has(s));
    const pickPool = pool.length ? pool : regularSymbols;
    if (!pickPool.length) return "BLUE_DIAMOND";
    const seed = `${String(multiplierId || "anon")}|${String(salt || "")}`;
    let hash = 2166136261;
    for (let i = 0; i < seed.length; i += 1) {
      hash ^= seed.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
      hash >>>= 0;
    }
    return pickPool[hash % pickPool.length] || pickPool[0];
  }

  // Spawns a tier-scaled lightning strike at the given cell. Used both
  // standalone (for common/rare without the BANG) and inside spawnHeavyImpact.
  spawnLightningStrike(row, col, tier) {
    const center = this.cellCenter(row, col);
    const layout = this.getLayout();
    const now = performance.now();

    // Tier-scaled lightning parameters: small for common, escalating up.
    const params = {
      common:    { heaviness: 0.55, life: 360, forks: 0, jitter: 0.30, thick: 0.045 },
      rare:      { heaviness: 0.85, life: 520, forks: 1, jitter: 0.42, thick: 0.065 },
      epic:      { heaviness: 1.15, life: 640, forks: 2, jitter: 0.50, thick: 0.080 },
      legendary: { heaviness: 1.35, life: 720, forks: 2, jitter: 0.55, thick: 0.090 },
      mythic:    { heaviness: 1.60, life: 800, forks: 3, jitter: 0.62, thick: 0.105 }
    };
    const p = params[tier.key] || params.common;

    const buildBolt = (sx, sy, ex, ey, jitter) => {
      const segs = 7 + Math.floor(Math.random() * 4);
      const points = [{ x: sx, y: sy }];
      for (let i = 1; i < segs; i += 1) {
        const t = i / segs;
        const baseX = sx + (ex - sx) * t;
        const baseY = sy + (ey - sy) * t;
        const off = (Math.random() - 0.5) * jitter * (1 - Math.abs(t - 0.5) * 0.6);
        points.push({ x: baseX + off, y: baseY });
      }
      points.push({ x: ex, y: ey });
      return points;
    };

    const skyY = -8;
    const mainPoints = buildBolt(
      center.x + (Math.random() - 0.5) * 24,
      skyY,
      center.x,
      center.y,
      layout.laneW * p.jitter
    );
    this.fx.lightning.push({
      points: mainPoints,
      born: now - 20,
      life: p.life,
      thickness: Math.max(1.2, layout.radius * p.thick) * p.heaviness,
      color: tier.accent,
      glow: tier.glow
    });

    for (let f = 0; f < p.forks; f += 1) {
      const branchIdx = 2 + Math.floor(Math.random() * (mainPoints.length - 4));
      const branch = mainPoints[branchIdx];
      if (!branch) continue;
      const ex = branch.x + (Math.random() - 0.5) * layout.laneW * 1.4;
      const ey = branch.y + 30 + Math.random() * 60;
      this.fx.lightning.push({
        points: buildBolt(branch.x, branch.y, ex, ey, layout.laneW * 0.35),
        born: now - 20 + Math.random() * 30,
        life: Math.round(p.life * 0.8),
        thickness: Math.max(1, layout.radius * (p.thick * 0.55)) * p.heaviness,
        color: tier.accent,
        glow: tier.glow
      });
    }
    return p; // used by spawnHeavyImpact for shockwave scaling
  }

  async drop(matrix, multipliers = [], dropMap = {}, duration = 960, options = {}) {
    if (window.__renderDebug) {
      const incoming = (matrix?.[0] || []).slice(0, 3).join(",");
      console.log(`[drop:enter] incoming row0=${incoming} dropMap.size=${Object.keys(dropMap || {}).length}`);
    }
    // Two flows for incoming multipliers:
    //  • heavyCells: get the full BANG / conceal / reveal-pop treatment.
    //    Only ONE per spin (first non-common); subsequent tumbles skip the BANG.
    //  • lightOnlyCells: get just a tier-scaled lightning strike on landing.
    //    Used for common tier and for any non-common multipliers after the
    //    first BANG has already fired this spin.
    const animateMultipliers = Boolean(options.animateMultipliers);
    const heavyCells = new Map();
    const lightOnlyCells = new Map();
    let peakTier = null;
    let peakValue = 0;
    const alreadyBanged = this.fx.bangedKeys.size > 0;
    if (animateMultipliers) (multipliers || []).forEach((m) => {
      const v = Number(m?.value || 0);
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col) || v <= 0) return;
      const tier = getMultiplierTier(v);
      // Track by stable multiplier id when available so a multiplier that drops
      // during tumbles stays the same logical object (no re-conceal/re-reveal).
      const k = m?.id ? `id:${m.id}` : `${m.row}-${m.col}-${v}`;
      if (this.fx.struckKeys.has(k)) return; // already struck this spin
      const isHeavyEligible =
        tier.key !== "common" && !alreadyBanged && heavyCells.size === 0;
      if (isHeavyEligible) {
        heavyCells.set(`${m.row}-${m.col}`, { tier, value: v, dedupeKey: k, id: m?.id || "" });
        if (v > peakValue) { peakValue = v; peakTier = tier; }
      } else {
        lightOnlyCells.set(`${m.row}-${m.col}`, { tier, value: v, dedupeKey: k, id: m?.id || "" });
      }
      this.fx.struckKeys.add(k);
    });
    const heavyKeyMatchesDropMap = Array.from(heavyCells.keys()).some((k) => Object.prototype.hasOwnProperty.call(dropMap || {}, k));
    // Snappier drop slow-down — the previous values dragged the moment out.
    const dropDuration = state.fastStopRequested
      ? 120
      : (peakTier && heavyKeyMatchesDropMap)
      ? Math.round(duration * (peakTier.key === "mythic" ? 1.18 : peakTier.key === "legendary" ? 1.12 : peakTier.key === "epic" ? 1.06 : 1.02))
      : duration;

    // Clear any stale reveal leftovers from the previous tumble step so
    // decoy state cannot leak and briefly show an old symbol on this step.
    this.fx.heavyReveals = new Map();

    const previousBoard = Array.isArray(this.board.matrix)
      ? this.board.matrix.map((row) => (Array.isArray(row) ? row.slice() : []))
      : [];
    this.setBoard(matrix, { multipliers });
    this.fx.drop = { start: performance.now(), duration: dropDuration, map: dropMap, heavy: heavyCells };
    if (peakTier && heavyKeyMatchesDropMap) {
      this.fx.heavyDrop = {
        start: performance.now(),
        duration: dropDuration,
        cells: heavyCells,
        peakTier,
        map: dropMap
      };
    }
    const maxDelay = Object.entries(dropMap || {}).reduce((acc, [key, count]) => {
      const [row, col] = key.split("-").map((n) => Number(n));
      if (!Number.isFinite(row) || !Number.isFinite(col)) return acc;
      return Math.max(acc, this.dropDelay(row, col, Number(count || 0)));
    }, 0);

    // Schedule landing impacts and conceal each heavy cell's symbol until it
    // BANGs into place — the player should not see the multiplier value mid-air.
    const startTime = performance.now();
    // Lightning/impact should be visible before the multiplier icon appears.
    const heavyRevealLeadMs = 260;
    const lightRevealLeadMs = 320;
    // Only allow the multiplier-reveal tail when this drop actually contains
    // multiplier cells; ordinary drops shouldn't pay that cost.
    const hasRevealCells = heavyCells.size > 0 || lightOnlyCells.size > 0;
    const revealLeadMaxMs = hasRevealCells ? Math.max(heavyRevealLeadMs, lightRevealLeadMs) : 0;
    heavyCells.forEach((info, key) => {
      const [r, c] = key.split("-").map(Number);
      const count = Number(dropMap?.[key] || 0);
      if (!Number.isFinite(r) || !Number.isFinite(c) || count <= 0) return;
      const land = this.dropDelay(r, c, count) + dropDuration;
      // Mark this cell concealed; render skips its icon until revealAt.
      // Show a real symbol as decoy during fall (picked once per cell and
      // kept stable for the full drop), then reveal multiplier on landing.
      const prevSymbol = previousBoard?.[r]?.[c];
      const sourceRow = r - count;
      const sourceSymbol = Number.isInteger(sourceRow) && sourceRow >= 0 ? previousBoard?.[sourceRow]?.[c] : null;
      const blockedColSymbols = (previousBoard || [])
        .map((rowArr) => (Array.isArray(rowArr) ? rowArr[c] : null))
        .filter(Boolean);
      const decoy = this.pickStableMultiplierDecoy(
        info.id,
        [prevSymbol, sourceSymbol, "MULTI", "SCATTER", ...blockedColSymbols],
        `${r}-${c}-${count}-heavy`
      );
      this.fx.heavyReveals.set(key, {
        revealAt: startTime + land + heavyRevealLeadMs,
        revealDuration: 320,
        tier: info.tier,
        value: info.value,
        decoy
      });
      this.fx.bangedKeys.add(info.dedupeKey);
      setTimeout(() => this.spawnHeavyImpact(r, c, info.tier, info.value), land);
    });

    // Light-only multipliers: still concealed during fall like the heavy ones,
    // but reveal on a tier-scaled lightning strike instead of a BANG. The
    // player sees a regular decoy symbol fall, then the lightning hits and
    // the multiplier pops in. No BANG, no shake, no shockwaves.
    lightOnlyCells.forEach((info, key) => {
      const [r, c] = key.split("-").map(Number);
      const count = Number(dropMap?.[key] || 0);
      if (!Number.isFinite(r) || !Number.isFinite(c) || count <= 0) return;
      const land = this.dropDelay(r, c, count) + dropDuration;
      // Tier-scaled reveal pop — common is quick, escalates with rank.
      const revealDuration = info.tier.key === "mythic" ? 320
        : info.tier.key === "legendary" ? 300
        : info.tier.key === "epic" ? 280
        : info.tier.key === "rare" ? 250
        : 220; // common
      const prevSymbol = previousBoard?.[r]?.[c];
      const sourceRow = r - count;
      const sourceSymbol = Number.isInteger(sourceRow) && sourceRow >= 0 ? previousBoard?.[sourceRow]?.[c] : null;
      const blockedColSymbols = (previousBoard || [])
        .map((rowArr) => (Array.isArray(rowArr) ? rowArr[c] : null))
        .filter(Boolean);
      this.fx.heavyReveals.set(key, {
        revealAt: startTime + land + lightRevealLeadMs,
        revealDuration,
        tier: info.tier,
        value: info.value,
        decoy: this.pickStableMultiplierDecoy(
          info.id,
          [prevSymbol, sourceSymbol, "MULTI", "SCATTER", ...blockedColSymbols],
          `${r}-${c}-${count}-light`
        )
      });
      setTimeout(() => this.spawnLightningStrike(r, c, info.tier), Math.max(0, land));
    });

    // Landing dust only on real tumble drops (post-win), and only for cells
    // that fell a meaningful distance (count >= 2). No dust on intro, no
    // dust on every cell. Vault shake intentionally removed here — the only
    // shakes are for big wins / multiplier impacts / crazy moments, fired
    // by animateRound or spawnHeavyImpact, not by routine landings.
    const isIntro = !Object.keys(dropMap || {}).length;
    if (!isIntro) {
      Object.entries(dropMap || {}).forEach(([key, count]) => {
        const n = Number(count || 0);
        if (n < 2) return;
        const [r, c] = key.split("-").map(Number);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;
        if (heavyCells.has(key) || lightOnlyCells.has(key)) return;
        const land = this.dropDelay(r, c, n) + dropDuration;
        setTimeout(() => this.spawnLandingDust(r, c, 0.7), land);
      });
    }

    // Tail buffer: 30ms when no reveal cells (just settles the landing
    // frame), 90ms when reveals are running (lets the reveal-pop finish).
    await animationSleep(dropDuration + maxDelay + revealLeadMaxMs + (hasRevealCells ? 90 : 30));
    this.fx.drop = null;
    this.fx.heavyDrop = null;
    if (window.__renderDebug) {
      const committed = (this.board.matrix?.[0] || []).slice(0, 3).join(",");
      console.log(`[drop:exit]  committed row0=${committed}`);
    }
  }

  spawnHeavyImpact(row, col, tier, value) {
    const center = this.cellCenter(row, col);
    const now = performance.now();
    const heaviness = tier.key === "mythic" ? 1.35 : tier.key === "legendary" ? 1.2 : tier.key === "epic" ? 1.08 : 0.92;
    // Triple ground shockwave — fast bright ring, slower wide ring, slow afterburn.
    this.fx.shockwaves.push({ x: center.x, y: center.y, born: now, life: 360, color: tier.accent });
    if (tier.key === "epic" || tier.key === "legendary" || tier.key === "mythic") {
      this.fx.shockwaves.push({ x: center.x, y: center.y, born: now + 70, life: 520 * heaviness, color: "rgba(255, 255, 255, 0.58)" });
    }
    // Dust dome — particles spraying outward and downward.
    const dustCount = Math.round(8 * heaviness);
    for (let i = 0; i < dustCount; i += 1) {
      const a = -Math.PI + Math.random() * Math.PI; // lower hemisphere bias
      const v = (0.8 + Math.random() * 1.2) * heaviness;
      this.particles.push({
        x: center.x + (Math.random() - 0.5) * 8,
        y: center.y + 4,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.6 - 0.4,
        life: 380 + Math.random() * 240,
        born: now,
        size: 1.1 + Math.random() * 1.4,
        colorA: tier.accent,
        colorB: "#fff8e8",
        mode: "shard",
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.18
      });
    }
    // Cell-anchored impact record drives a brief vertical squash + ground ring.
    this.fx.impacts.push({
      row, col, x: center.x, y: center.y,
      born: now, life: 520 * heaviness,
      tier, value, heaviness
    });
    // Lightning strike — delegated to the shared tier-scaled method.
    this.spawnLightningStrike(row, col, tier);

    // BANG: full-screen tier-colored radial flash centered on the impact.
    // Short and punchy — long flashes feel laggy.
    this.fx.bangs.push({
      x: center.x,
      y: center.y,
      born: now,
      life: 240 + 60 * heaviness,
      tier,
      heaviness
    });
    // Extra concentric ray burst on landing for legendary+.
    if (tier.key === "legendary" || tier.key === "mythic") {
      const rayN = tier.key === "mythic" ? 8 : 6;
      for (let i = 0; i < rayN; i += 1) {
        this.fx.rays.push({
          x: center.x,
          y: center.y,
          angle: (Math.PI * 2 * i) / rayN,
          born: now,
          life: 420,
          len: tier.key === "mythic" ? 4.2 : 3.4,
          color: tier.accent
        });
      }
    }
    // Vault shake on landing — ramps with tier weight.
    try {
      if (tier.key === "mythic" || tier.key === "legendary") shakeVault("normal");
    } catch (_) { /* shakeVault may not be in scope at construction; ignore */ }
  }

  async explode(winning = [], duration = 380, tier = "medium") {
    if (!winning.length) return;
    const strength = tier === "blast-great" ? "great" : tier === "blast-small" ? "small" : "medium";
    // Anticipation charge: cells brighten and "inhale" before they pop. Length
    // scales with tier — small wins get none, big wins get a real beat.
    const chargeMs = strength === "great" ? 260 : strength === "medium" ? 110 : 0;
    const keys = winning.map((p) => `${p.row}-${p.col}`);
    if (chargeMs > 0) {
      this.fx.charge = {
        start: performance.now(),
        duration: chargeMs,
        set: new Set(keys)
      };
      // Spotlight dim for great wins so the eye locks onto the action.
      if (strength === "great") {
        this.fx.spotlight = {
          start: performance.now(),
          duration: chargeMs + duration + 220,
          set: new Set(keys),
          intensity: 0.55
        };
      }
      await animationSleep(chargeMs);
      this.fx.charge = null;
    }

    // Tight per-cell stagger only on great wins (calmer than before).
    const delays = new Map();
    if (strength === "great") {
      const sorted = winning
        .slice()
        .sort((a, b) => (a.col - b.col) * 1000 + (a.row - b.row));
      sorted.forEach((p, idx) => {
        delays.set(`${p.row}-${p.col}`, idx * 14);
      });
    }
    const maxDelay = Math.max(0, ...delays.values());

    this.fx.blast = {
      start: performance.now(),
      duration: duration + maxDelay,
      cellDuration: duration,
      set: new Set(keys),
      delays
    };
    this.spawnExplosionParticles(winning, strength, delays);
    await animationSleep(duration + maxDelay + 40);
    this.fx.blast = null;
    if (this.fx.spotlight) {
      // Let it fade naturally; just clear the reference once expired.
      const left = this.fx.spotlight.start + this.fx.spotlight.duration - performance.now();
      if (left > 0) setTimeout(() => { this.fx.spotlight = null; }, left);
      else this.fx.spotlight = null;
    }
  }

  async highlight(matrix, { winning = [], multipliers = [] } = {}, duration = 560) {
    this.setBoard(matrix, { winning, multipliers });
    if (!winning.length) return;
    this.fx.pulse = {
      start: performance.now(),
      duration
    };
    await animationSleep(duration);
    this.fx.pulse = null;
  }

  async multiplierCatch(multipliers = [], duration = 620) {
    if (!Array.isArray(multipliers) || multipliers.length === 0) return;
    const catchSet = new Set(
      multipliers
        .filter((m) => Number.isInteger(m?.row) && Number.isInteger(m?.col))
        .map((m) => `${m.row}-${m.col}`)
    );
    if (!catchSet.size) return;
    const peakValue = multipliers.reduce((acc, m) => Math.max(acc, Number(m?.value || 0)), 0);
    const peakTier = getMultiplierTier(peakValue).key;
    // Anticipation buildup: charge each multiplier symbol before it pops.
    // Higher-tier catches get longer, more dramatic wind-up.
    const chargeMs = peakTier === "mythic" ? 520
      : peakTier === "legendary" ? 380
      : peakTier === "epic" ? 240
      : peakTier === "rare" ? 140
      : 80;
    this.fx.charge = {
      start: performance.now(),
      duration: chargeMs,
      set: catchSet
    };
    if (peakTier === "mythic" || peakTier === "legendary") {
      this.fx.spotlight = {
        start: performance.now(),
        duration: chargeMs + duration + 240,
        set: catchSet,
        intensity: peakTier === "mythic" ? 0.7 : 0.55
      };
    }
      await animationSleep(chargeMs);
    this.fx.charge = null;
    this.fx.multiCatch = {
      start: performance.now(),
      duration,
      set: catchSet,
      tier: peakTier
    };
    this.spawnMultiplierCatchParticles(multipliers);
    await animationSleep(duration);
    this.fx.multiCatch = null;
    if (this.fx.spotlight) {
      const left = this.fx.spotlight.start + this.fx.spotlight.duration - performance.now();
      if (left > 0) setTimeout(() => { this.fx.spotlight = null; }, left);
      else this.fx.spotlight = null;
    }
  }

  async reelSlam(columns = [], {
    duration = 620,
    force = 1,
    accent = "rgba(170, 214, 255, 0.38)"
  } = {}) {
    const colSet = new Set(
      (columns || [])
        .filter((c) => Number.isInteger(c) && c >= 0 && c < this.cols)
        .map((c) => Number(c))
    );
    if (!colSet.size) return;
    this.fx.reelSlam = {
      start: performance.now(),
      duration,
      force: clamp(force, 0.6, 2.4),
      columns: colSet,
      accent
    };
    await animationSleep(duration);
    this.fx.reelSlam = null;
  }

  async jackpotFlash({
    duration = 520,
    colorA = "rgba(163, 220, 255, 0.34)",
    colorB = "rgba(255, 213, 106, 0.24)"
  } = {}) {
    this.fx.jackpotFlash = {
      start: performance.now(),
      duration,
      colorA,
      colorB
    };
    await animationSleep(duration);
    this.fx.jackpotFlash = null;
  }

  isVisuallyBusy() {
    const now = performance.now();
    const timedFxActive =
      (this.fx.drop && now < this.fx.drop.start + this.fx.drop.duration + 120) ||
      (this.fx.pulse && now < this.fx.pulse.start + this.fx.pulse.duration + 80) ||
      (this.fx.blast && now < this.fx.blast.start + this.fx.blast.duration + 100) ||
      (this.fx.spinBurst && now < this.fx.spinBurst.start + this.fx.spinBurst.duration + 80) ||
      (this.fx.multiCatch && now < this.fx.multiCatch.start + this.fx.multiCatch.duration + 120) ||
      (this.fx.reelSlam && now < this.fx.reelSlam.start + this.fx.reelSlam.duration + 120) ||
      (this.fx.jackpotFlash && now < this.fx.jackpotFlash.start + this.fx.jackpotFlash.duration + 120) ||
      (this.fx.charge && now < this.fx.charge.start + this.fx.charge.duration + 120) ||
      (this.fx.spotlight && now < this.fx.spotlight.start + this.fx.spotlight.duration + 120) ||
      (this.fx.heavyDrop && now < this.fx.heavyDrop.start + this.fx.heavyDrop.duration + 140);
    return Boolean(
      timedFxActive ||
      this.fx.heavyReveals.size ||
      this.fx.shockwaves.length ||
      this.fx.lightning.length ||
      this.fx.impacts.length ||
      this.fx.bangs.length ||
      this.fx.rays.length ||
      this.particles.length
    );
  }

  async waitForIdle({ timeout = 4200, stableMs = 160, pollMs = 16 } = {}) {
    const start = performance.now();
    let stableFor = 0;
    while (performance.now() - start < timeout) {
      const busy = this.isVisuallyBusy();
      if (busy) stableFor = 0;
      else stableFor += pollMs;
      if (!busy && stableFor >= stableMs) return;
      await animationSleep(pollMs);
    }
  }

  loop() {
    const now = performance.now();
    const dt = Math.max(0, Math.min(34, now - this.lastTick));
    this.lastTick = now;
    this.time += dt;
    try {
      this.draw();
    } catch (err) {
      // Never let a draw exception kill the rAF loop — that would freeze the
      // canvas on the last successful frame even though state updates.
      console.error("[reelRenderer.draw] exception (continuing loop):", err);
    }
    // Schedule the next frame UNCONDITIONALLY, even if draw threw.
    requestAnimationFrame(() => this.loop());
  }

  getLayout() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    const padX = clamp(width * 0.04, 20, 40);
    const top = clamp(height * 0.08, 34, 62);
    const bottom = clamp(height * 0.08, 30, 60);
    const laneW = (width - padX * 2) / this.cols;
    const rowStep = (height - top - bottom) / this.rows;
    const radius = Math.min(laneW, rowStep) * 0.42;
    return { width, height, padX, top, bottom, laneW, rowStep, radius };
  }

  cellOffset(row, col, rowStep) {
    const drop = this.fx.drop;
    if (!drop) return 0;
    const count = Number(drop.map?.[`${row}-${col}`] || 0);
    if (count <= 0) return 0;
    const delay = this.dropDelay(row, col, count);
    const elapsed = performance.now() - drop.start - delay;
    const distance = count * rowStep * 1.15;
    if (drop.exit && elapsed < 0) return 0;
    if (elapsed < 0) return -distance;
    const progress = clamp(elapsed / drop.duration, 0, 1);
    const fallT = easeOutQuint(progress);
    if (drop.exit) {
      const exitT = progress ** 4;
      return lerp(0, distance, exitT);
    }
    const fallY = lerp(-distance, 0, fallT);
    if (progress < 0.82) return fallY;
    // Single small landing bounce — short, quick settle (no pendulum sway).
    const settleT = (progress - 0.82) / 0.18;
    const damp = 1 - settleT;
    return Math.sin(settleT * Math.PI) * damp * rowStep * 0.05;
  }

  dropDelay(row, col, count) {
    // Subtle per-column stagger (~25ms); per-row stagger kept light.
    return Math.max(0, col * 25 + row * 10 + Math.max(0, count - 1) * 14);
  }

  computeWinningBBox(winning) {
    if (!winning.length) return null;
    const layout = this.getLayout();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of winning) {
      const c = this.cellCenter(p.row, p.col);
      if (c.x < minX) minX = c.x;
      if (c.x > maxX) maxX = c.x;
      if (c.y < minY) minY = c.y;
      if (c.y > maxY) maxY = c.y;
    }
    return {
      minX: minX - layout.laneW * 0.5,
      maxX: maxX + layout.laneW * 0.5,
      minY: minY - layout.rowStep * 0.5,
      maxY: maxY + layout.rowStep * 0.5,
      centerX: (minX + maxX) / 2,
      centerY: (minY + maxY) / 2
    };
  }

  computeCentroid(winning) {
    if (!winning.length) return { x: 0, y: 0 };
    let sx = 0, sy = 0;
    for (const p of winning) {
      const c = this.cellCenter(p.row, p.col);
      sx += c.x; sy += c.y;
    }
    return { x: sx / winning.length, y: sy / winning.length };
  }

  spawnGreatSweep(winning) {
    const bbox = this.computeWinningBBox(winning);
    if (!bbox) return;
    const dominantSymbol = this._dominantSymbolAt(winning);
    const tone = symbolTone[dominantSymbol] || symbolTone.BLUE_DIAMOND;
    this.fx.sweeps.push({
      start: performance.now(),
      duration: 380,
      bbox,
      color: tone[0]
    });
  }

  _dominantSymbolAt(winning) {
    const counts = new Map();
    for (const p of winning) {
      const sym = this.board.matrix?.[p.row]?.[p.col];
      if (!sym) continue;
      counts.set(sym, (counts.get(sym) || 0) + 1);
    }
    let best = "BLUE_DIAMOND", bestCount = -1;
    for (const [sym, c] of counts) {
      if (c > bestCount) { best = sym; bestCount = c; }
    }
    return best;
  }

  async celebrateCluster(winning, dominantSymbol, tier, duration = null) {
    if (!winning || !winning.length) return;
    if (tier === "blast-small") return;
    // Calmer celebration: short focal bloom from cluster center, no
    // edge-spawned sparkles, no full-screen color cascade. Great wins get
    // a slightly longer, brighter bloom — that's the whole difference.
    const ms = duration ?? (tier === "blast-great" ? 560 : 280);
    const centroid = this.computeCentroid(winning);
    const bbox = this.computeWinningBBox(winning);
    if (!bbox) return;
    const tone = symbolTone[dominantSymbol] || symbolTone.BLUE_DIAMOND;
    this.fx.cluster = {
      start: performance.now(),
      duration: ms,
      centroid,
      bbox,
      tier,
      tone,
      useSweep: false
    };
    await animationSleep(ms);
    this.fx.cluster = null;
  }

  spawnLandingDust(row, col, intensity = 1) {
    const center = this.cellCenter(row, col);
    const { rowStep, laneW } = this.getLayout();
    const baseY = center.y + rowStep * 0.42;
    const now = performance.now();
    const count = Math.max(1, Math.round(2 * intensity));
    for (let i = 0; i < count; i += 1) {
      const a = -Math.PI + (i / count) * Math.PI + (Math.random() - 0.5) * 0.4;
      const v = (0.25 + Math.random() * 0.4) * intensity;
      this.particles.push({
        x: center.x + (Math.random() - 0.5) * laneW * 0.16,
        y: baseY,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 0.15,
        born: now,
        life: 200 + Math.random() * 100,
        size: 0.8 + Math.random() * 1.0,
        colorA: "rgba(220, 210, 200, 0.35)",
        colorB: "rgba(220, 210, 200, 0.35)",
        mode: "ember"
      });
    }
  }

  roundedRectPath(ctx, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w * 0.5, h * 0.5));
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  draw() {
    const ctx = this.ctx;
    const { width, height, padX, top, laneW, rowStep, radius } = this.getLayout();
    ctx.clearRect(0, 0, width, height);

    const driftA = Math.sin(this.time * 0.00017);
    const driftB = Math.cos(this.time * 0.00013);
    const idleWave = Math.sin(this.time * 0.0012);
    const idleWave2 = Math.cos(this.time * 0.00092);
    const glowX = width * (0.5 + driftA * 0.08);
    const glowY = height * (0.2 + driftB * 0.04);
    const stageBase = ctx.createLinearGradient(0, 0, 0, height);
    stageBase.addColorStop(0, "#111728");
    stageBase.addColorStop(0.35, "#0b101d");
    stageBase.addColorStop(1, "#060a14");
    ctx.fillStyle = stageBase;
    ctx.fillRect(0, 0, width, height);

    const amberFog = ctx.createRadialGradient(glowX, glowY, 24, glowX, glowY, height * 0.84);
    amberFog.addColorStop(0, "rgba(120, 198, 255, 0.24)");
    amberFog.addColorStop(0.5, "rgba(86, 124, 255, 0.16)");
    amberFog.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = amberFog;
    ctx.fillRect(0, 0, width, height);

    const meshGlow = ctx.createLinearGradient(0, 0, width, height);
    meshGlow.addColorStop(0, `rgba(129, 198, 255, ${(0.06 + (idleWave + 1) * 0.015).toFixed(3)})`);
    meshGlow.addColorStop(0.5, "rgba(128, 171, 255, 0.02)");
    meshGlow.addColorStop(1, `rgba(111, 227, 210, ${(0.05 + (idleWave2 + 1) * 0.012).toFixed(3)})`);
    ctx.fillStyle = meshGlow;
    ctx.fillRect(0, 0, width, height);

    const vignette = ctx.createRadialGradient(width * 0.5, height * 0.5, height * 0.12, width * 0.5, height * 0.5, height * 0.95);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,0,0.52)");
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, width, height);

    const tableX = Math.max(8, padX * 0.34);
    const tableY = Math.max(8, top * 0.2);
    const tableW = width - tableX * 2;
    const tableH = height - tableY - Math.max(10, top * 0.22);
    const frameR = Math.min(24, Math.max(10, laneW * 0.18));

    const tableShadow = ctx.createRadialGradient(width * 0.5, tableY + tableH * 0.45, tableW * 0.1, width * 0.5, tableY + tableH * 0.45, tableW * 0.7);
    tableShadow.addColorStop(0, "rgba(0,0,0,0.16)");
    tableShadow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = tableShadow;
    this.roundedRectPath(ctx, tableX - 14, tableY - 14, tableW + 28, tableH + 28, frameR + 10);
    ctx.fill();

    const frame = ctx.createLinearGradient(tableX, tableY, tableX, tableY + tableH);
    frame.addColorStop(0, "#2f4c8f");
    frame.addColorStop(0.26, "#5888ff");
    frame.addColorStop(0.52, "#2d4e98");
    frame.addColorStop(0.78, "#1b2b5d");
    frame.addColorStop(1, "#111b39");
    ctx.fillStyle = frame;
    this.roundedRectPath(ctx, tableX, tableY, tableW, tableH, frameR);
    ctx.fill();

    const inX = tableX + 8;
    const inY = tableY + 8;
    const inW = tableW - 16;
    const inH = tableH - 16;
    const inR = Math.max(8, frameR - 4);
    const tableCore = ctx.createLinearGradient(inX, inY, inX, inY + inH);
    tableCore.addColorStop(0, "rgba(15, 24, 42, 0.98)");
    tableCore.addColorStop(0.4, "rgba(11, 18, 34, 0.99)");
    tableCore.addColorStop(1, "rgba(8, 12, 24, 1)");
    ctx.fillStyle = tableCore;
    this.roundedRectPath(ctx, inX, inY, inW, inH, inR);
    ctx.fill();

    ctx.strokeStyle = "rgba(185, 219, 255, 0.32)";
    ctx.lineWidth = 1.2;
    this.roundedRectPath(ctx, inX + 0.6, inY + 0.6, inW - 1.2, inH - 1.2, inR - 1);
    ctx.stroke();

    if (this.fx.spinBurst) {
      const t = clamp((performance.now() - this.fx.spinBurst.start) / this.fx.spinBurst.duration, 0, 1);
      const a = (1 - t) * 0.22;
      ctx.fillStyle = `rgba(255, 205, 139, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

    ctx.save();
    this.roundedRectPath(ctx, inX + 2, inY + 2, inW - 4, inH - 4, inR - 2);
    ctx.clip();

    const gridStep = Math.max(24, Math.min(44, laneW * 0.42));
    ctx.strokeStyle = "rgba(184, 220, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let y = inY + 8; y < inY + inH; y += gridStep) {
      ctx.beginPath();
      ctx.moveTo(inX, y);
      ctx.lineTo(inX + inW, y);
      ctx.stroke();
    }

    const emberNoise = 48;
    for (let i = 0; i < emberNoise; i += 1) {
      const nx = inX + ((i * 97) % 1000) / 1000 * inW;
      const ny = inY + ((i * 67 + 137) % 1000) / 1000 * inH;
      const a = 0.008 + (((i * 23) % 10) / 10) * 0.02;
      ctx.fillStyle = `rgba(255, 191, 133, ${a.toFixed(3)})`;
      ctx.fillRect(nx, ny, 1, 1);
    }

    // Reel back panel — REEL.png drawn once per column behind the symbols.
    const reelBack = this.images.get("REEL");
    const reelBackReady = Boolean(reelBack?.complete && reelBack?.naturalWidth);

    for (let c = 0; c < this.cols; c += 1) {
      const x = padX + laneW * (c + 0.5);
      const spineTop = top * 0.5;
      const spineBottom = top + rowStep * (this.rows - 0.1);

      if (reelBackReady) {
        const reelW = laneW * 0.96;
        const reelH = rowStep * this.rows + Math.min(28, rowStep * 0.3);
        const reelX = padX + laneW * c + (laneW - reelW) / 2;
        const reelY = top - Math.min(14, rowStep * 0.15);
        // Static, lighter reel back — no blur, just reduced opacity so the
        // symbols pop and the reel feels less heavy.
        ctx.save();
        ctx.globalAlpha = 0.55;
        ctx.drawImage(reelBack, reelX, reelY, reelW, reelH);
        ctx.restore();
      }

      const laneGlow = ctx.createLinearGradient(x, top * 0.22, x, height);
      laneGlow.addColorStop(0, "rgba(172, 214, 255, 0.05)");
      laneGlow.addColorStop(0.45, "rgba(172, 214, 255, 0.02)");
      laneGlow.addColorStop(1, "rgba(172, 214, 255, 0)");
      ctx.fillStyle = laneGlow;
      ctx.fillRect(x - laneW * 0.42, top * 0.2, laneW * 0.84, height - top * 0.2);

      const spine = ctx.createLinearGradient(x, spineTop, x, spineBottom);
      spine.addColorStop(0, "rgba(206, 230, 255, 0.52)");
      spine.addColorStop(0.3, "rgba(115, 155, 255, 0.3)");
      spine.addColorStop(1, "rgba(42, 64, 130, 0.24)");
      ctx.strokeStyle = spine;
      ctx.lineWidth = Math.max(3, laneW * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, spineTop);
      ctx.lineTo(x, spineBottom);
      ctx.stroke();

      const cap = ctx.createRadialGradient(x, top * 0.26, radius * 0.06, x, top * 0.26, radius * 0.54);
      cap.addColorStop(0, "rgba(210, 233, 255, 0.42)");
      cap.addColorStop(1, "rgba(210, 233, 255, 0.04)");
      ctx.fillStyle = cap;
      ctx.beginPath();
      ctx.arc(x, top * 0.26, radius * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(200, 227, 255, 0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();

      if (this.fx.drop) {
        const streak = ctx.createLinearGradient(x, top * 0.15, x, top + rowStep * this.rows);
        streak.addColorStop(0, "rgba(208, 233, 255, 0.18)");
        streak.addColorStop(0.3, "rgba(178, 216, 255, 0.09)");
        streak.addColorStop(1, "rgba(178, 216, 255, 0)");
        ctx.strokeStyle = streak;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x, top * 0.1);
        ctx.lineTo(x, top + rowStep * this.rows);
        ctx.stroke();
      }
    }

    const pulse = this.fx.pulse
      ? clamp((performance.now() - this.fx.pulse.start) / this.fx.pulse.duration, 0, 1)
      : 0;
    // Sharper attack, longer glow tail — feels punchier than a symmetric sine.
    const pulseGlow = this.fx.pulse
      ? (pulse < 0.28 ? easeOutCubic(pulse / 0.28) : 1 - easeInOutCubic((pulse - 0.28) / 0.72))
      : 0;
    const blast = this.fx.blast
      ? clamp((performance.now() - this.fx.blast.start) / this.fx.blast.duration, 0, 1)
      : 0;
    const multiCatch = this.fx.multiCatch
      ? clamp((performance.now() - this.fx.multiCatch.start) / this.fx.multiCatch.duration, 0, 1)
      : 0;
    // Elastic overshoot for multiplier catch — feels like a snap-grab.
    const multiCatchPulse = this.fx.multiCatch
      ? (multiCatch < 0.45
          ? easeOutElastic(multiCatch / 0.45)
          : 1 - easeOutCubic((multiCatch - 0.45) / 0.55))
      : 0;
    const reelSlamProgress = this.fx.reelSlam
      ? clamp((performance.now() - this.fx.reelSlam.start) / this.fx.reelSlam.duration, 0, 1)
      : 0;
    const reelSlamWave = this.fx.reelSlam
      ? Math.sin(reelSlamProgress * Math.PI * 3.4) * (1 - reelSlamProgress) * this.fx.reelSlam.force
      : 0;

    if (this.fx.shockwaves.length) {
      const now = performance.now();
      this.fx.shockwaves = this.fx.shockwaves.filter((w) => now - w.born < w.life);
      this.fx.shockwaves.forEach((w) => {
        const t = clamp((now - w.born) / w.life, 0, 1);
        if (w.crunch) {
          // Thicker, darker-edged crunch ring for explode impact.
          const r = radius * (0.6 + t * 1.2);
          ctx.globalAlpha = (1 - t) * 0.72;
          ctx.strokeStyle = w.color || "rgba(255, 240, 196, 0.95)";
          ctx.lineWidth = Math.max(2, radius * 0.12 * (1 - t * 0.5));
          ctx.shadowColor = "rgba(20, 12, 6, 0.6)";
          ctx.shadowBlur = 12 * (1 - t);
          ctx.beginPath();
          ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
          ctx.stroke();
          ctx.shadowBlur = 0;
          return;
        }
        const r = radius * (0.8 + t * 3.4);
        ctx.globalAlpha = (1 - t) * 0.52;
        ctx.strokeStyle = w.color || "rgba(182, 219, 255, 0.9)";
        ctx.lineWidth = Math.max(1.4, radius * 0.07 * (1 - t * 0.6));
        ctx.beginPath();
        ctx.arc(w.x, w.y, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // Wave-front sweep across the winning bounding box (great-tier explodes).
    if (this.fx.sweeps.length) {
      const now = performance.now();
      this.fx.sweeps = this.fx.sweeps.filter((s) => now - s.start < s.duration);
      this.fx.sweeps.forEach((s) => {
        const t = clamp((now - s.start) / s.duration, 0, 1);
        const bbox = s.bbox;
        const sweepW = (bbox.maxX - bbox.minX) * 0.55;
        const cx = bbox.minX + t * (bbox.maxX - bbox.minX + sweepW) - sweepW * 0.5;
        const grad = ctx.createLinearGradient(cx - sweepW, 0, cx + sweepW, 0);
        const peak = (1 - Math.abs(t - 0.5) * 2) * 0.45;
        grad.addColorStop(0, "rgba(255, 255, 255, 0)");
        grad.addColorStop(0.5, s.color);
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        ctx.globalAlpha = peak;
        ctx.fillStyle = grad;
        ctx.fillRect(bbox.minX - sweepW, bbox.minY, (bbox.maxX - bbox.minX) + sweepW * 2, bbox.maxY - bbox.minY);
        ctx.restore();
      });
      ctx.globalAlpha = 1;
    }

    // Cluster Resonance Bloom — phase-driven celebration for winning clusters.
    if (this.fx.cluster) {
      const now = performance.now();
      const c = this.fx.cluster;
      const t = clamp((now - c.start) / c.duration, 0, 1);
      // Phase 1: centroid iris (0 → 0.08)
      if (t < 0.12) {
        const iT = t / 0.12;
        const r = radius * (0.4 + iT * 0.9);
        ctx.save();
        ctx.globalAlpha = (1 - iT) * 0.85;
        ctx.strokeStyle = c.tone[0] || "rgba(255, 240, 196, 0.95)";
        ctx.lineWidth = Math.max(2, radius * 0.10);
        ctx.beginPath();
        ctx.arc(c.centroid.x, c.centroid.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = (1 - iT) * 0.5;
        ctx.lineWidth = Math.max(1.5, radius * 0.06);
        ctx.beginPath();
        ctx.arc(c.centroid.x, c.centroid.y, r * 1.7, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
      // Phase 2: subtle energy bloom — smaller radius, lower alpha, no
      // screen-blend cascade. Just a brief glow at the cluster center.
      if (t >= 0.05 && t < 0.7) {
        const bT = clamp((t - 0.05) / 0.65, 0, 1);
        const diag = Math.hypot(c.bbox.maxX - c.bbox.minX, c.bbox.maxY - c.bbox.minY);
        const rOuter = (diag * 0.5) * (0.45 + bT * 0.7);
        const alphaProfile = bT < 0.5 ? bT / 0.5 : 1 - (bT - 0.5) / 0.5;
        const peakAlpha = c.tier === "blast-great" ? 0.55 : 0.35;
        ctx.save();
        ctx.globalCompositeOperation = "screen";
        const bloom = ctx.createRadialGradient(c.centroid.x, c.centroid.y, 0, c.centroid.x, c.centroid.y, rOuter);
        bloom.addColorStop(0, `rgba(255, 250, 220, ${(0.45 * alphaProfile).toFixed(3)})`);
        bloom.addColorStop(0.5, c.tone[0]);
        bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.globalAlpha = peakAlpha * alphaProfile;
        ctx.fillStyle = bloom;
        ctx.beginPath();
        ctx.arc(c.centroid.x, c.centroid.y, rOuter, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      if (t >= 1) this.fx.cluster = null;
    }

    // Spotlight dim — draws a darkening overlay during epic+ events so the
    // active cells visually pop. The envelope fades in then out over the
    // spotlight's full duration.
    let spotlightAlpha = 0;
    if (this.fx.spotlight) {
      const t = clamp((performance.now() - this.fx.spotlight.start) / this.fx.spotlight.duration, 0, 1);
      const env = t < 0.2 ? t / 0.2 : t > 0.85 ? (1 - t) / 0.15 : 1;
      spotlightAlpha = clamp(env * (this.fx.spotlight.intensity || 0.5), 0, 0.9);
      if (spotlightAlpha > 0) {
        ctx.fillStyle = `rgba(2, 5, 12, ${spotlightAlpha.toFixed(3)})`;
        ctx.fillRect(0, 0, width, height);
      }
    }

    // Heavy-drop falls completely silent — no beam, no comet, no glow. The
    // player gets no telegraph that a big multiplier is incoming; the symbol
    // is concealed during descent and the BANG on landing is the reveal.

    // Heavy-impact ground rings — drawn as hard flashing rings on top of
    // shockwaves at the landing cell with a ground-flash ellipse.
    if (this.fx.impacts.length) {
      const now = performance.now();
      this.fx.impacts = this.fx.impacts.filter((im) => now - im.born < im.life);
      this.fx.impacts.forEach((im) => {
        const t = clamp((now - im.born) / im.life, 0, 1);
        const ringR = radius * (0.5 + t * 3.0 * im.heaviness);
        ctx.globalAlpha = (1 - t) * 0.6;
        ctx.strokeStyle = im.tier.accent;
        ctx.lineWidth = Math.max(2, radius * 0.12 * (1 - t * 0.7));
        ctx.beginPath();
        ctx.arc(im.x, im.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        // Ground flash ellipse — short-lived.
        if (t < 0.35) {
          const fT = t / 0.35;
          ctx.globalAlpha = (1 - fT) * 0.42;
          const flashGrad = ctx.createRadialGradient(im.x, im.y, 0, im.x, im.y, radius * 1.8);
          flashGrad.addColorStop(0, "rgba(255, 255, 255, 1)");
          flashGrad.addColorStop(0.4, im.tier.accent);
          flashGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = flashGrad;
          ctx.beginPath();
          ctx.ellipse(im.x, im.y + radius * 0.5, radius * 1.7, radius * 0.6, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    }

    // Lightning bolts — jagged tier-colored strikes from the top of the
    // playfield arriving at impact cells right before the BANG.
    if (this.fx.lightning.length) {
      const now = performance.now();
      this.fx.lightning = this.fx.lightning.filter((b) => now - b.born < b.life);
      this.fx.lightning.forEach((b) => {
        const age = now - b.born;
        if (age < 0) return;
        const t = clamp(age / b.life, 0, 1);
        // Brightness envelope: stays hot for most of the life, then fades.
        // A subtle flicker keeps it feeling electric rather than static.
        const flicker = 0.85 + 0.15 * Math.sin(age * 0.06 + b.points[0].x);
        const a = (t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3) * flicker;
        // Outer glow halo.
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = b.glow;
        ctx.lineWidth = b.thickness * 4;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        b.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        // Mid layer — tier-accent.
        ctx.globalAlpha = a * 0.85;
        ctx.strokeStyle = b.color;
        ctx.lineWidth = b.thickness * 2;
        ctx.beginPath();
        b.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
        // White-hot core.
        ctx.globalAlpha = a;
        ctx.strokeStyle = "rgba(255, 255, 255, 1)";
        ctx.lineWidth = b.thickness;
        ctx.beginPath();
        b.points.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        });
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // BANG flashes — short, intense, tier-colored radial bursts on impact.
    if (this.fx.bangs.length) {
      const now = performance.now();
      this.fx.bangs = this.fx.bangs.filter((b) => now - b.born < b.life);
      this.fx.bangs.forEach((b) => {
        const t = clamp((now - b.born) / b.life, 0, 1);
        const env = t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82;
        const a = clamp(env, 0, 1);
        // Full-frame white-hot punch.
        ctx.globalAlpha = a * 0.55;
        ctx.fillStyle = "rgba(255, 255, 255, 1)";
        ctx.fillRect(0, 0, width, height);
        // Tier-colored radial bloom centered on impact.
        const reach = Math.max(width, height);
        const bloom = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, reach * 0.7);
        bloom.addColorStop(0, b.tier.accent);
        bloom.addColorStop(0.25, b.tier.glow);
        bloom.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.globalAlpha = a * 0.85;
        ctx.fillStyle = bloom;
        ctx.fillRect(0, 0, width, height);
      });
      ctx.globalAlpha = 1;
    }

    if (this.fx.jackpotFlash) {
      const t = clamp((performance.now() - this.fx.jackpotFlash.start) / this.fx.jackpotFlash.duration, 0, 1);
      const p = Math.sin(t * Math.PI);
      const flash = ctx.createRadialGradient(width * 0.5, height * 0.48, 24, width * 0.5, height * 0.48, Math.max(width, height) * 0.8);
      flash.addColorStop(0, this.fx.jackpotFlash.colorA);
      flash.addColorStop(0.55, this.fx.jackpotFlash.colorB);
      flash.addColorStop(1, "rgba(0,0,0,0)");
      ctx.globalAlpha = p * 0.95;
      ctx.fillStyle = flash;
      ctx.fillRect(0, 0, width, height);
      ctx.globalAlpha = 1;
    }

    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.board.hidden) continue;
        const symbol = this.board.matrix?.[r]?.[c] || "BLUE_DIAMOND";
        const key = `${r}-${c}`;
        const x = padX + laneW * (c + 0.5);
        const yBase = top + rowStep * (r + 0.5);
        const isSlamColumn = Boolean(this.fx.reelSlam?.columns?.has(c));
        const slamOffset = isSlamColumn ? reelSlamWave * radius * 0.46 : 0;
        const y = yBase + this.cellOffset(r, c, rowStep) + slamOffset;
        const isWinner = this.board.winningSet.has(key);
        const isBlast = this.fx.blast?.set?.has(key);
        // Per-cell blast progress — staggered across cells so big wins ripple
        // outward instead of all popping at the same instant.
        let cellBlast = 0;
        if (isBlast) {
          const cellDelay = this.fx.blast.delays?.get(key) || 0;
          const cellDur = this.fx.blast.cellDuration || this.fx.blast.duration;
          cellBlast = clamp((performance.now() - this.fx.blast.start - cellDelay) / cellDur, 0, 1);
        }
        const blastFade = isBlast ? 1 - cellBlast : 1;
        // Charge: anticipation phase before pop. Cell shrinks slightly and
        // brightens — the visual "inhale" before the burst.
        const isCharging = Boolean(this.fx.charge?.set?.has(key));
        let chargeT = 0;
        let chargeShrink = 1;
        let chargeGlow = 0;
        if (isCharging) {
          chargeT = clamp((performance.now() - this.fx.charge.start) / this.fx.charge.duration, 0, 1);
          chargeShrink = 1 - easeOutCubic(chargeT) * 0.08;
          chargeGlow = easeOutCubic(chargeT);
        }
        const isSpotlit = Boolean(this.fx.spotlight?.set?.has(key));
        const floatOffset = Math.sin(this.time * 0.0016 + r * 0.5 + c * 0.7) * radius * 0.05;
        const yFloat = y + floatOffset;
        const idlePulse = 1 + Math.sin(this.time * 0.0012 + r * 0.41 + c * 0.57) * 0.02;
        const pulseScale = isWinner ? 1 + pulseGlow * 0.16 : 1;
        const isMultiCaught = symbol === "MULTI" && Boolean(this.fx.multiCatch?.set?.has(key));
        const catchScale = isMultiCaught ? 1 + multiCatchPulse * 0.26 : 1;
        // Vertical squash if a heavy impact just landed on this cell.
        let squashY = 1;
        let squashX = 1;
        const impact = this.fx.impacts.find((im) => im.row === r && im.col === c);
        if (impact) {
          const it = clamp((performance.now() - impact.born) / 240, 0, 1);
          if (it < 1) {
            const env = Math.sin(it * Math.PI);
            squashY = 1 - 0.18 * env * impact.heaviness;
            squashX = 1 + 0.12 * env * impact.heaviness;
          }
        }
        const baseScale = pulseScale * catchScale * idlePulse * chargeShrink;
        // Heavy-drop concealment: while a high-tier multiplier is falling,
        // hide its symbol entirely so the player only sees the descending
        // beam and BANG impact. After landing, the symbol pops in.
        const reveal = this.fx.heavyReveals.get(key);
        let concealIcon = false;
        let revealScale = 1;
        let revealAlpha = 1;
        if (reveal) {
          const nowMs = performance.now();
          if (nowMs < reveal.revealAt) {
            concealIcon = true;
          } else {
            const rt = clamp((nowMs - reveal.revealAt) / reveal.revealDuration, 0, 1);
            // Pop-in: overshoot scale, alpha ramp.
            revealScale = rt < 0.4
              ? 0.2 + easeOutBack(rt / 0.4) * 1.05
              : 1.25 - easeOutCubic((rt - 0.4) / 0.6) * 0.25;
            revealAlpha = clamp(rt * 2, 0, 1);
            if (rt >= 1) this.fx.heavyReveals.delete(key);
          }
        }
        const ringR = radius * 1.05 * baseScale * revealScale;
        const coreR = radius * 1.05 * baseScale * revealScale;
        const scatterSizeBoost = symbol === "SCATTER" ? 1.22 : 1;
        const multiScale = symbol === "MULTI" ? multiplierIconScale(this.board.multiMap.get(key)) : 1;
        const maxIconBase = Math.min(laneW, rowStep) * (symbol === "MULTI" ? 1.16 : 1.02);
        const iconBase = Math.min(
          radius * 2.25 * baseScale * scatterSizeBoost * revealScale * multiScale,
          maxIconBase * baseScale * revealScale
        );
        const iconW = iconBase * squashX;
        const iconH = iconBase * squashY;

        // Spotlight halo: brighten cells on the spotlight set during big
        // events, working with the dim overlay to draw the eye in.
        if (isSpotlit && spotlightAlpha > 0.05) {
          const sp = ctx.createRadialGradient(x, yFloat, 0, x, yFloat, coreR * 2.4);
          sp.addColorStop(0, `rgba(255, 240, 210, ${(0.32 * spotlightAlpha / 0.7).toFixed(3)})`);
          sp.addColorStop(0.55, `rgba(255, 220, 170, ${(0.14 * spotlightAlpha / 0.7).toFixed(3)})`);
          sp.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = sp;
          ctx.beginPath();
          ctx.arc(x, yFloat, coreR * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isCharging) {
          // Building glow during the wind-up.
          const cg = ctx.createRadialGradient(x, yFloat, 0, x, yFloat, coreR * 1.9);
          cg.addColorStop(0, `rgba(255, 245, 215, ${(0.55 * chargeGlow).toFixed(3)})`);
          cg.addColorStop(0.5, `rgba(255, 210, 150, ${(0.25 * chargeGlow).toFixed(3)})`);
          cg.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(x, yFloat, coreR * 1.9, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isWinner) {
          const halo = ctx.createRadialGradient(x, yFloat, coreR * 0.28, x, yFloat, ringR * 1.55);
          halo.addColorStop(0, `rgba(215, 236, 255, ${0.6 * blastFade})`);
          halo.addColorStop(0.35, `rgba(150, 188, 255, ${0.24 * blastFade})`);
          halo.addColorStop(1, "rgba(150, 188, 255, 0)");
          ctx.fillStyle = halo;
          ctx.beginPath();
          ctx.arc(x, yFloat, ringR * 1.52, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isSlamColumn) {
          const slamGlow = ctx.createRadialGradient(x, yFloat - coreR * 0.8, 0, x, yFloat, coreR * 1.7);
          slamGlow.addColorStop(0, this.fx.reelSlam.accent || "rgba(170, 214, 255, 0.36)");
          slamGlow.addColorStop(1, "rgba(170, 214, 255, 0)");
          ctx.globalAlpha = Math.max(0, 0.62 * (1 - reelSlamProgress));
          ctx.fillStyle = slamGlow;
          ctx.beginPath();
          ctx.arc(x, yFloat, coreR * 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        const multiValueNum = symbol === "MULTI" ? Number(this.board.multiMap.get(key) || 1) : null;
        const multiImageKey = symbol === "MULTI" ? `MULTI${multiValueNum}` : null;
        const img = (multiImageKey && this.images.get(multiImageKey)) || this.images.get(symbol);
        if (concealIcon) {
          // Show the decoy regular symbol falling in this cell. It gets
          // visually "replaced" by the multiplier on the BANG impact.
          const decoyImg = reveal?.decoy ? this.images.get(reveal.decoy) : null;
          if (decoyImg?.complete && decoyImg.naturalWidth) {
            ctx.globalAlpha = blastFade;
            ctx.drawImage(decoyImg, x - iconW / 2, yFloat - iconH / 2, iconW, iconH);
          }
        } else if (img?.complete && img.naturalWidth) {
          ctx.globalAlpha = blastFade * revealAlpha;
          ctx.drawImage(img, x - iconW / 2, yFloat - iconH / 2, iconW, iconH);
        } else {
          ctx.fillStyle = "rgba(255, 238, 200, 0.9)";
          ctx.font = `${Math.max(10, coreR * 0.22)}px Trebuchet MS, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(symbol.slice(0, 2), x, yFloat);
        }

        if (symbol === "TOP_CROWN") {
          const crownGlow = ctx.createRadialGradient(x, yFloat - coreR * 0.36, 0, x, yFloat - coreR * 0.36, coreR * 0.75);
          crownGlow.addColorStop(0, "rgba(185, 218, 255, 0.26)");
          crownGlow.addColorStop(1, "rgba(185, 218, 255, 0)");
          ctx.fillStyle = crownGlow;
          ctx.beginPath();
          ctx.arc(x, yFloat - coreR * 0.22, coreR * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }

        if (symbol === "MULTI" && !concealIcon) {
          const valueNum = multiValueNum;
          const value = `${valueNum}x`;
          const hasDedicatedMultiImage = Boolean(this.images.get(multiImageKey)?.complete && this.images.get(multiImageKey)?.naturalWidth);

          if (!hasDedicatedMultiImage) {
            const tier = getMultiplierTier(valueNum);
            ctx.fillStyle = tier.accent;
            ctx.font = `900 ${Math.max(18, coreR * 0.62)}px "Trebuchet MS", "Segoe UI", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.strokeStyle = "rgba(7, 13, 24, 0.92)";
            ctx.lineWidth = Math.max(2.4, coreR * 0.1);
            ctx.strokeText(value, x, yFloat + coreR * 0.02);
            ctx.fillText(value, x, yFloat + coreR * 0.02);

            const tagW = Math.max(46, coreR * 1.15);
            const tagH = Math.max(14, coreR * 0.28);
            const tagX = x - tagW / 2;
            const tagY = yFloat + coreR * 0.5;
            ctx.fillStyle = "rgba(8, 16, 30, 0.86)";
            ctx.fillRect(tagX, tagY, tagW, tagH);
            ctx.strokeStyle = tier.accent;
            ctx.lineWidth = 1;
            ctx.strokeRect(tagX, tagY, tagW, tagH);
            ctx.fillStyle = "#e8f2ff";
            ctx.font = `800 ${Math.max(7, coreR * 0.13)}px Trebuchet MS, sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(tier.label.toUpperCase(), x, tagY + tagH / 2);
          }
        }

        if (symbol === "SCATTER") {
          const orbit = 0.82 + Math.sin(this.time * 0.006 + c + r * 0.5) * 0.12;
          ctx.strokeStyle = `rgba(198, 211, 255, ${0.38 * blastFade})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, yFloat, ringR * orbit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = `rgba(224, 235, 255, ${0.22 * blastFade})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, yFloat, ringR * (orbit + 0.15), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }

    // Radial light rays from explosion centers — fast-growing, fading streaks
    // that telegraph an audible "crack" on the upcoming sound layer.
    if (this.fx.rays.length) {
      const now = performance.now();
      this.fx.rays = this.fx.rays.filter((ray) => now - ray.born < ray.life);
      this.fx.rays.forEach((ray) => {
        const age = now - ray.born;
        if (age < 0) return;
        const t = clamp(age / ray.life, 0, 1);
        const reach = radius * ray.len * easeOutQuint(t);
        const ex = ray.x + Math.cos(ray.angle) * reach;
        const ey = ray.y + Math.sin(ray.angle) * reach;
        const grad = ctx.createLinearGradient(ray.x, ray.y, ex, ey);
        grad.addColorStop(0, `rgba(255, 255, 255, ${(0.85 * (1 - t)).toFixed(3)})`);
        grad.addColorStop(0.4, ray.color);
        grad.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.strokeStyle = grad;
        ctx.lineWidth = Math.max(1.4, radius * 0.06 * (1 - t * 0.6));
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(ray.x, ray.y);
        ctx.lineTo(ex, ey);
        ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    if (this.particles.length) {
      const now = performance.now();
      this.particles = this.particles.filter((p) => now - p.born < p.life);
      this.particles.forEach((p) => {
        const age = now - p.born;
        if (age < 0) return; // not yet born
        const t = clamp(age / p.life, 0, 1);
        p.x += p.vx;
        p.y += p.vy;
        if (p.mode === "convergent" && p.target) {
          const dx = p.target.x - p.x;
          const dy = p.target.y - p.y;
          const d = Math.hypot(dx, dy) || 1;
          const accel = 0.16;
          p.vx += (dx / d) * accel;
          p.vy += (dy / d) * accel;
          p.vx *= 0.94;
          p.vy *= 0.94;
        } else if (p.mode === "ember") {
          p.vy += -0.004; // gentle upward drift
          p.vx *= 0.985;
        } else {
          p.vy += p.mode === "orb" ? 0.015 : 0.05;
        }
        p.rot = (p.rot || 0) + (p.spin || 0);
        const alpha = 1 - t;
        const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 3.2);
        glow.addColorStop(0, `${p.colorA}dd`);
        glow.addColorStop(1, "rgba(0,0,0,0)");
        ctx.globalAlpha = alpha * 0.7;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * 3.2, 0, Math.PI * 2);
        ctx.fill();
        if (p.mode === "shard") {
          ctx.save();
          ctx.globalAlpha = alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot || 0);
          ctx.fillStyle = p.colorB;
          ctx.beginPath();
          ctx.moveTo(p.size * 1.8, 0);
          ctx.lineTo(-p.size * 0.6, p.size * 0.66);
          ctx.lineTo(-p.size * 0.9, -p.size * 0.66);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else if (p.mode === "ember") {
          // Soft hot-coal twinkle that fades slowly.
          const flicker = 0.6 + 0.4 * Math.sin(age * 0.02 + p.x * 0.13);
          ctx.globalAlpha = alpha * flicker;
          ctx.fillStyle = p.colorB;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.globalAlpha = alpha;
          ctx.fillStyle = p.colorB;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      });
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
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

function normalizeStepMultiplierIds(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return;
  let seq = 0;
  let prevTracked = [];
  steps.forEach((step) => {
    const source = Array.isArray(step?.multipliers) ? step.multipliers : [];
    const current = source.map((m) => ({ ...m }));
    const usedPrev = new Set();
    current.forEach((m) => {
      if (typeof m?.id === "string" && m.id) return;
      const value = Number(m?.value || 0);
      if (!Number.isFinite(value) || !Number.isInteger(m?.row) || !Number.isInteger(m?.col)) {
        m.id = `local_m_${seq += 1}`;
        return;
      }
      let bestIdx = -1;
      let bestScore = Infinity;
      for (let i = 0; i < prevTracked.length; i += 1) {
        if (usedPrev.has(i)) continue;
        const p = prevTracked[i];
        if (Number(p.value) !== value) continue;
        const score = (p.col === m.col ? 0 : 4) + Math.abs(p.col - m.col) * 2 + Math.abs(p.row - m.row);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }
      if (bestIdx >= 0 && bestScore <= 8) {
        m.id = prevTracked[bestIdx].id;
        usedPrev.add(bestIdx);
      } else {
        m.id = `local_m_${seq += 1}`;
      }
    });
    step.multipliers = current;
    prevTracked = current
      .filter((m) => Number.isInteger(m?.row) && Number.isInteger(m?.col) && Number.isFinite(Number(m?.value)))
      .map((m) => ({ id: String(m.id), row: Number(m.row), col: Number(m.col), value: Number(m.value) }));
  });
}

const reelRenderer = new ReelCanvasRenderer(el.reels, { rowsCount: rows, colsCount: cols });

function winTier(waysWins = [], bet = 1) {
  let totalAmount = 0;
  waysWins.forEach((w) => { totalAmount += Number(w?.amount || 0); });
  const winX = bet > 0 ? totalAmount / bet : 0;
  // Tier purely by payout magnitude (× bet). Calmer thresholds so the
  // strongest celebration is reserved for genuinely big wins.
  if (winX >= 20) return "blast-great";
  if (winX >= 5) return "blast-medium";
  return "blast-small";
}

function maxMultiplierInStep(step = {}) {
  return Number(
    (step.multipliers || []).reduce((m, entry) => Math.max(m, Number(entry?.value || 0)), 0)
  );
}

function multiplierEventTier(maxValue) {
  const v = Number(maxValue || 0);
  if (v >= 1000) return "mythic";
  if (v >= 250) return "legendary";
  if (v >= 50) return "epic";
  if (v >= 20) return "rare";
  return "common";
}

let _enginePromise = null;
function getEngine() {
  if (!_enginePromise) {
    if (!window.SlotEngine || !window.SlotEngine.SpinEngine) {
      return Promise.reject(new Error("Engine scripts failed to load"));
    }
    _enginePromise = window.SlotEngine.SpinEngine.create({ rulesUrl: "math/game-rules-v2.json" });
  }
  return _enginePromise;
}

// ─── Platform mode ──────────────────────────────────────────────────────────
// When the page is opened with a launch token (?lt=…), this client stops
// computing spins locally and instead talks to the Banana X platform's
// server-authoritative Game API. The local engine is still loaded so the UI
// can read rules/paytable/symbol art from it, but every real money operation
// (session init, spin) hits the platform over HTTP.
const _platform = (() => {
  const params = new URLSearchParams(window.location.search);
  const launchToken = params.get("lt");
  return {
    enabled: Boolean(launchToken),
    launchToken,
    sessionToken: null,
    /** Snapshot of the platform's session/init response (so spin can reuse it). */
    sessionMeta: null
  };
})();

async function platformInitSession() {
  const res = await fetch("/game/v1/session/init", {
    method: "POST",
    headers: { authorization: `Bearer ${_platform.launchToken}` }
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code || `HTTP_${res.status}`;
    const msg = body?.error?.message || "session init failed";
    throw new Error(`${code}: ${msg}`);
  }
  _platform.sessionToken = body.session_token;
  _platform.sessionMeta = body;
  // Adapt the platform response to the shape the local engine returns so the
  // rest of the client (initSession()) needs no changes.
  return {
    session_id: body.session_id,
    currency: body.currency,
    game_id: body.game?.code || "bananax",
    slug: body.game?.code || "bananax",
    balance: Number(body.balance?.amount ?? 0),
    allowed_bets: body.allowed_bets || [],
    free_spins_left: Number(body.free_spins_left || 0),
    free_spin_multiplier_current: 0,
    bonus_round_win: 0,
    ante_enabled: false,
    crazy_mode: false
  };
}

async function platformSpin(payload) {
  if (!_platform.sessionToken) {
    throw new Error("NO_SESSION: platform session not initialised");
  }
  const idem =
    payload?.spin_id ||
    (window.crypto?.randomUUID ? window.crypto.randomUUID() : `idem_${Date.now()}_${Math.random()}`);
  const res = await fetch("/game/v1/spin", {
    method: "POST",
    headers: {
      authorization: `Bearer ${_platform.sessionToken}`,
      "content-type": "application/json",
      "idempotency-key": idem
    },
    body: JSON.stringify({
      bet_amount: Number(payload?.bet_amount),
      ante_enabled: Boolean(payload?.ante_enabled)
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = body?.error?.code || `HTTP_${res.status}`;
    const msg = body?.error?.message || "spin failed";
    throw new Error(`${code}: ${msg}`);
  }
  // The platform returns the full SpinResult + money fields. Adapt the few
  // engine-shaped fields the client UI relies on.
  return {
    ...body,
    balance_after: Number(body.balance?.amount ?? body.balance_after ?? 0),
    // The animation/log code reads spin_id as a stable round identifier — we
    // hand it the (also unique) round_ref so logs and the round-id badge agree.
    spin_id: body.round_ref || body.spin_id || idem,
    round_ref: body.round_ref || null
  };
}

/** Surface the server-authoritative Round ID for the just-completed spin so a
 * player can hand it to support and have an admin look it up in the Round
 * Inspector. No-op outside platform mode (no `round_ref` is generated locally). */
function showRoundId(roundRef) {
  if (!roundRef || !el.roundIdBar || !el.roundIdValue) return;
  el.roundIdValue.textContent = roundRef;
  el.roundIdBar.classList.remove("hidden");
  if (el.roundIdCopied) el.roundIdCopied.hidden = true;
}

if (el.roundIdCopyBtn) {
  el.roundIdCopyBtn.addEventListener("click", async () => {
    const text = el.roundIdValue?.textContent || "";
    if (!text || text === "—") return;
    try {
      await navigator.clipboard.writeText(text);
      if (el.roundIdCopied) {
        el.roundIdCopied.hidden = false;
        setTimeout(() => { if (el.roundIdCopied) el.roundIdCopied.hidden = true; }, 1600);
      }
    } catch {
      // Clipboard not allowed (insecure context, denied permission, etc.);
      // the player can still triple-click the value (user-select: all).
    }
  });
}

async function api(path, payload) {
  if (_platform.enabled && path === "/api/v1/session/init") {
    return platformInitSession();
  }
  if (_platform.enabled && path === "/api/v1/spin") {
    const result = await platformSpin(payload || {});
    showRoundId(result.round_ref);
    return result;
  }
  // /api/v1/buy-free-spins and /api/v1/simulate stay on the local engine even
  // in platform mode — they're either not server-authoritative (simulate is a
  // dev sandbox) or not yet wired into the platform API.
  const engine = await getEngine();
  if (path === "/api/v1/session/init") return engine.initSession(payload || {});
  if (path === "/api/v1/spin") return engine.spin(payload || {});
  if (path === "/api/v1/buy-free-spins") return engine.buyFreeSpins(payload || {});
  if (path === "/api/v1/simulate") {
    return window.SlotEngine.Simulator.simulate(engine, {
      steps: payload.steps,
      betAmount: payload.bet_amount,
      anteEnabled: payload.ante_enabled,
      bonusOnly: payload.bonus_only,
      gameId: payload.game_id
    });
  }
  throw new Error(`Unknown api path: ${path}`);
}

function updateBonusHud({ freeSpinsLeft, multiplier, bonusTotal }) {
  const spins = Number(freeSpinsLeft || 0);
  const mult = Number(multiplier || 1);
  const total = Number(bonusTotal || 0);
  const inBonus = spins > 0 || total > 0;
  if (el.bonusTotal) el.bonusTotal.textContent = fmt(total);
  if (el.bonusTotalNode) el.bonusTotalNode.classList.toggle("hidden", !inBonus);
  if (el.freeSpinsNode) el.freeSpinsNode.classList.toggle("hidden", spins <= 0);
  if (el.activeMultiplierNode) el.activeMultiplierNode.classList.toggle("hidden", !inBonus && mult <= 1);
}

function setControls(disabled) {
  el.spinBtn.disabled = false;
  el.spinBtn.classList.toggle("is-spinning", Boolean(disabled || state.roundAnimating));
  el.spinBtn.setAttribute("aria-label", disabled || state.roundAnimating ? "Stop spin" : "Spin");
  el.simulateBtn.disabled = disabled;
  if (el.simulateBonusBtn) el.simulateBonusBtn.disabled = disabled;
  el.betSelect.disabled = disabled;
  // Buy-free-spins isn't wired into the platform API yet, so disable it in
  // platform mode to avoid running a local-only feature against a server session.
  el.buyFreeBtn.disabled = disabled || Boolean(el.anteToggle.checked) || _platform.enabled;
  el.anteToggle.disabled = disabled;
  setTestButtonsDisabled(disabled || state.bonusAutoplay || state.testBusy);
}

function requestFastStop() {
  if (!state.roundAnimating) return false;
  state.fastStopRequested = true;
  el.spinBtn?.classList.add("is-fast-stopping");
  reelRenderer.requestFastStop?.();
  pushGameMessage("Fast stop requested.", "info");
  return true;
}

function pushGameMessage(text, tone = "info") {
  state.activityLog.unshift({
    id: crypto.randomUUID(),
    type: "event",
    ts: Date.now(),
    tone,
    text
  });
  if (state.activityLog.length > 24) state.activityLog = state.activityLog.slice(0, 24);
  renderSpinLog();
}

function renderMultiplierInfo(allowedValues = []) {
  if (!el.multiplierInfo) return;
  const allowed = new Set((Array.isArray(allowedValues) ? allowedValues : []).map((v) => Number(v)));
  const lines = MULTIPLIER_TIER_DEFS.map((tier) => {
    const present = tier.values.filter((v) => allowed.has(v));
    if (!present.length) return null;
    return `<span class="multi-tier-line"><span class="multi-tier-name tier-${tier.key}">${tier.label}</span>: ${present.map((v) => `${v}x`).join(", ")}</span>`;
  }).filter(Boolean);
  el.multiplierInfo.innerHTML = lines.length ? lines.join("<br>") : "Not available";
}

function randomPlayableSymbol() {
  const symbols = Object.keys(payouts);
  return symbols[Math.floor(Math.random() * symbols.length)] || "BLUE_DIAMOND";
}

function createDemoMatrix() {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => randomPlayableSymbol()));
}

function randomWinPositions(count = 8) {
  const picks = new Set();
  while (picks.size < count) {
    const r = Math.floor(Math.random() * rows);
    const c = Math.floor(Math.random() * cols);
    picks.add(`${r}-${c}`);
  }
  return Array.from(picks).map((k) => {
    const [row, col] = k.split("-").map((n) => Number(n));
    return { row, col };
  });
}

function setTestButtonsDisabled(disabled) {
  [el.testDropBtn, el.testExplodeBtn, el.testCatchBtn]
    .filter(Boolean)
    .forEach((btn) => { btn.disabled = disabled; });
  if (el.testMultiButtons) {
    el.testMultiButtons.querySelectorAll("button").forEach((btn) => {
      btn.disabled = disabled;
    });
  }
}

async function runVisualTest(action) {
  if (state.testBusy) return;
  state.testBusy = true;
  setTestButtonsDisabled(true);
  try {
    if (action === "drop") {
      const matrix = createDemoMatrix();
      const multipliers = [{ row: 1, col: 1, value: 8 }, { row: 3, col: 4, value: 25 }];
      await reelRenderer.intro(matrix, multipliers);
      pushGameMessage("FX test: drop animation.", "info");
    }
    if (action === "explode") {
      const matrix = createDemoMatrix();
      const wins = randomWinPositions(10);
      reelRenderer.setBoard(matrix, { winning: wins });
      await reelRenderer.highlight(matrix, { winning: wins }, 420);
      await reelRenderer.explode(wins, 540, "blast-great");
      pushGameMessage("FX test: explosion animation.", "info");
    }
    if (action === "celebrate") {
      const matrix = createDemoMatrix();
      const wins = randomWinPositions(12);
      const dominantSymbol = matrix[wins[0].row][wins[0].col];
      // Force the dominant symbol across all winning cells so the celebration
      // tints correctly.
      wins.forEach((w) => { matrix[w.row][w.col] = dominantSymbol; });
      reelRenderer.setBoard(matrix, { winning: wins });
      await reelRenderer.highlight(matrix, { winning: wins }, 360);
      await Promise.all([
        reelRenderer.celebrateCluster(wins, dominantSymbol, "blast-great"),
        flyWinChip({ winningPositions: wins, amount: 42.5, tier: "blast-great" })
      ]);
      await reelRenderer.explode(wins, 540, "blast-great");
      pushGameMessage("FX test: cluster celebration.", "info");
    }
    if (action === "catch") {
      const matrix = createDemoMatrix();
      const multipliers = [
        { row: 1, col: 2, value: 10 },
        { row: 2, col: 3, value: 50 },
        { row: 4, col: 4, value: 250 }
      ];
      multipliers.forEach((m) => { matrix[m.row][m.col] = "MULTI"; });
      reelRenderer.setBoard(matrix, { multipliers });
      await Promise.all([
        reelRenderer.multiplierCatch(multipliers, 800),
        flyMultiplierSouls(multipliers)
      ]);
      pushGameMessage("FX test: multiplier catch animation.", "info");
    }
  } finally {
    state.testBusy = false;
    setTestButtonsDisabled(false);
  }
}

async function triggerMultiplierVisual(value) {
  const numeric = Number(value || 2);
  if (!Number.isFinite(numeric)) return;
  if (Number(state.forcedMultiplierLock) === numeric) {
    state.forcedMultiplierLock = null;
    updateArmedMultiplierUi();
    pulseBanner(`Unlocked multiplier`, "info", 760);
    pushGameMessage(`Multiplier lock removed.`, "info");
    return;
  }
  state.forcedMultiplierLock = numeric;
  updateArmedMultiplierUi();
  pulseBanner(`Locked ${numeric}x multiplier`, "bonus", 1000);
  pushGameMessage(`Locked ${numeric}x multiplier for spins. Click again to unlock.`, "bonus");
}

function updateArmedMultiplierUi() {
  if (!el.testMultiButtons) return;
  const armed = Number(state.forcedMultiplierLock);
  el.testMultiButtons.querySelectorAll("button").forEach((btn) => {
    const value = Number(btn.dataset.multiplier || 0);
    btn.classList.toggle("is-armed", Number.isFinite(armed) && value === armed);
  });
}

function renderTestPanel() {
  if (!el.testMultiButtons) return;
  el.testMultiButtons.innerHTML = "";
  TEST_MULTIPLIERS.forEach((value) => {
    const tier = getMultiplierTier(value);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `test-multi-btn tier-${tier.key}`;
    btn.textContent = `${value}x`;
    btn.dataset.multiplier = String(value);
    btn.addEventListener("click", () => triggerMultiplierVisual(value));
    el.testMultiButtons.appendChild(btn);
  });
  updateArmedMultiplierUi();
}

function ensureSoulLayer() {
  let layer = document.getElementById("soulLayer");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "soulLayer";
    layer.className = "soul-layer";
    document.body.appendChild(layer);
  }
  return layer;
}

function winChipTierFromStrength(tier) {
  if (tier === "blast-great") return "great";
  if (tier === "blast-medium") return "medium";
  return "small";
}

function pulseWinMeter() {
  const node = el.lastWin?.closest(".hud-node") || el.lastWin?.parentElement;
  if (!node) return;
  node.classList.remove("win-meter-pulse");
  // Force reflow so the animation restarts cleanly each time.
  void node.offsetWidth;
  node.classList.add("win-meter-pulse");
  setTimeout(() => node.classList.remove("win-meter-pulse"), 420);
}

function flyWinChip({ winningPositions, amount, tier = "blast-medium", delay = 0, onLand = null }) {
  return new Promise((resolve) => {
    if (!Array.isArray(winningPositions) || !winningPositions.length || !el.lastWin || !el.reels) {
      resolve();
      return;
    }
    // Fast-stop: skip the chip visual entirely. Just sync the meter and pulse.
    if (state.fastStopRequested) {
      pulseWinMeter();
      if (typeof onLand === "function") { try { onLand(); } catch {} }
      resolve();
      return;
    }
    const target = el.lastWin;
    const layer = ensureSoulLayer();
    const canvasRect = el.reels.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const canvasW = el.reels.clientWidth || canvasRect.width;
    const canvasH = el.reels.clientHeight || canvasRect.height;
    const scaleX = canvasRect.width / Math.max(1, canvasW);
    const scaleY = canvasRect.height / Math.max(1, canvasH);
    const centroidCanvas = reelRenderer.computeCentroid(winningPositions);
    const sx = canvasRect.left + centroidCanvas.x * scaleX;
    const sy = canvasRect.top + centroidCanvas.y * scaleY;
    const tx = targetRect.left + targetRect.width / 2;
    const ty = targetRect.top + targetRect.height / 2;

    const chip = document.createElement("div");
    chip.className = "win-chip";
    chip.dataset.tier = winChipTierFromStrength(tier);
    chip.textContent = `+${fmt(amount)}`;
    chip.style.left = `${sx}px`;
    chip.style.top = `${sy}px`;
    layer.appendChild(chip);

    const cleanup = () => {
      if (chip.parentNode) chip.parentNode.removeChild(chip);
      resolve();
    };

    // Track timers so we can flush them all if fast-stop is requested mid-flight.
    const timers = [];
    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      pulseWinMeter();
      if (typeof onLand === "function") { try { onLand(); } catch {} }
    };
    const flushFast = () => {
      timers.forEach(clearTimeout);
      land();
      cleanup();
    };

    timers.push(setTimeout(() => {
      if (state.fastStopRequested) return flushFast();
      chip.classList.add("is-rising");
    }, delay));

    // Phase: rise (220ms), brief hold (140ms), gentle drift to counter (360ms).
    const flyAt = delay + 220 + 140;
    timers.push(setTimeout(() => {
      if (state.fastStopRequested) return flushFast();
      chip.style.setProperty("--to-x", `${tx - sx}px`);
      chip.style.setProperty("--to-y", `${ty - sy}px`);
      chip.classList.add("is-flying");
    }, flyAt));
    timers.push(setTimeout(() => {
      if (state.fastStopRequested) return flushFast();
      land();
    }, flyAt + 250));
    timers.push(setTimeout(() => {
      if (state.fastStopRequested) return flushFast();
      cleanup();
    }, flyAt + 360 + 40));
  });
}

function flyMultiplierSouls(multipliers = []) {
  const all = (multipliers || []).filter(
    (m) => Number.isInteger(m?.row) && Number.isInteger(m?.col) && Number(m?.value) > 0
  );
  if (!all.length) return Promise.resolve();
  // Dedupe across tumble cascades within the same spin: each multiplier
  // captured on the board only sends its soul once, even if it persists
  // through multiple tumble steps.
  const valid = [];
  for (const m of all) {
    const key = m?.id ? `id:${m.id}` : `${m.row}-${m.col}-${m.value}`;
    if (state.spinFlownSouls.has(key)) continue;
    state.spinFlownSouls.add(key);
    valid.push(m);
  }
  if (!valid.length) return Promise.resolve();
  const target = el.activeMultiplier;
  const meterNode = target?.closest(".hud-node-multi, .meter-node-multi");
  if (!target || !meterNode) return Promise.resolve();
  const layer = ensureSoulLayer();
  const canvasRect = el.reels.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const tx = targetRect.left + targetRect.width / 2;
  const ty = targetRect.top + targetRect.height / 2;

  const canvasW = el.reels.clientWidth || canvasRect.width;
  const canvasH = el.reels.clientHeight || canvasRect.height;
  const scaleX = canvasRect.width / Math.max(1, canvasW);
  const scaleY = canvasRect.height / Math.max(1, canvasH);

  const promises = valid.map((m, idx) => {
    const cell = reelRenderer.cellCenter(m.row, m.col);
    const sx = canvasRect.left + cell.x * scaleX;
    const sy = canvasRect.top + cell.y * scaleY;
    const tier = getMultiplierTier(Number(m.value));
    const delay = idx * 80;
    const duration = 620 + Math.min(280, idx * 40);
    return animateSoul({
      sx, sy, tx, ty,
      value: Number(m.value),
      tier,
      delay,
      duration,
      layer,
      meterNode,
      target
    });
  });
  return Promise.all(promises);
}

function animateSoul({ sx, sy, tx, ty, value, tier, delay, duration, layer, meterNode, target }) {
  return new Promise((resolve) => {
    const orb = document.createElement("div");
    orb.className = "soul-orb";
    orb.textContent = `${value}x`;
    orb.style.setProperty("--soul-color", tier.accent);
    orb.style.setProperty("--soul-glow", tier.glow);
    orb.style.opacity = "0";
    orb.style.transform = `translate3d(${sx}px, ${sy}px, 0) scale(0.4)`;
    layer.appendChild(orb);

    // Curved arc: control point biased upward and slightly toward target.
    const midX = (sx + tx) / 2 + (Math.random() - 0.5) * 80;
    const arcLift = Math.min(220, Math.max(120, Math.abs(tx - sx) * 0.35 + Math.abs(ty - sy) * 0.25));
    const midY = Math.min(sy, ty) - arcLift;

    const trails = [];
    const startTime = performance.now() + delay;

    function tick(now) {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        orb.style.opacity = "0";
        requestAnimationFrame(tick);
        return;
      }
      const tRaw = clamp(elapsed / duration, 0, 1);
      // Ease in then accelerate at end for "pulled-in" feel.
      const t = tRaw < 0.6 ? easeOutCubic(tRaw / 0.6) * 0.7 : 0.7 + easeOutQuint((tRaw - 0.6) / 0.4) * 0.3;
      const u = 1 - t;
      const x = u * u * sx + 2 * u * t * midX + t * t * tx;
      const y = u * u * sy + 2 * u * t * midY + t * t * ty;
      const scale = lerp(0.85, 0.35, easeInOutCubic(tRaw));
      const fadeIn = clamp(elapsed / 120, 0, 1);
      const fadeOut = tRaw > 0.85 ? 1 - (tRaw - 0.85) / 0.15 : 1;
      orb.style.opacity = String(fadeIn * fadeOut);
      orb.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale.toFixed(3)})`;

      if (tRaw < 0.95 && Math.random() < 0.55) {
        const trail = document.createElement("div");
        trail.className = "soul-trail";
        trail.style.setProperty("--soul-color", tier.accent);
        trail.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${(0.6 + Math.random() * 0.6).toFixed(2)})`;
        layer.appendChild(trail);
        const born = now;
        const tlife = 360;
        trails.push({ el: trail, born, life: tlife });
      }

      const stillAlive = [];
      for (const tr of trails) {
        const age = now - tr.born;
        if (age >= tr.life) {
          tr.el.remove();
        } else {
          tr.el.style.opacity = String(1 - age / tr.life);
          stillAlive.push(tr);
        }
      }
      trails.length = 0;
      trails.push(...stillAlive);

      if (tRaw < 1) {
        requestAnimationFrame(tick);
      } else {
        orb.remove();
        trails.forEach((tr) => tr.el.remove());
        onSoulArrive({ tx, ty, value, tier, layer, meterNode, target });
        resolve();
      }
    }
    requestAnimationFrame(tick);
  });
}

function onSoulArrive({ tx, ty, value, tier, layer, meterNode, target }) {
  // Increment the displayed multiplier as each soul lands. If the meter is
  // sitting at the 1x base (no catches yet this spin), replace it; otherwise
  // sum onto the running total. The authoritative server value will overwrite
  // this at the end of the spin.
  const current = Number(state.spinMultDisplay) || 1;
  const next = current <= 1 ? Number(value) : current + Number(value);
  state.spinMultDisplay = next;
  if (target) target.textContent = mfmt(next);

  meterNode.style.setProperty("--soul-glow", tier.glow);
  meterNode.classList.remove("soul-hit");
  void meterNode.offsetWidth;
  meterNode.classList.add("soul-hit");
  setTimeout(() => meterNode.classList.remove("soul-hit"), 620);

  const plus = document.createElement("div");
  plus.className = "soul-plus";
  plus.textContent = `+${value}x`;
  plus.style.setProperty("--soul-color", tier.accent);
  plus.style.setProperty("--soul-glow", tier.glow);
  plus.style.left = `${tx}px`;
  plus.style.top = `${ty - 6}px`;
  layer.appendChild(plus);
  setTimeout(() => plus.remove(), 950);
}

function playWinCombineSequence(rawWin, multiplier, totalWin) {
  return new Promise((resolve) => {
    if (!el.reels?.parentElement) { resolve(); return; }
    const stage = el.reels.parentElement;
    const overlay = document.createElement("div");
    overlay.className = "win-combine-overlay";

    const amount = document.createElement("div");
    amount.className = "combine-chip combine-amount";
    amount.innerHTML = `<span class="combine-kicker">Win</span><span class="combine-value">${fmt(rawWin)}</span>`;

    const multi = document.createElement("div");
    multi.className = "combine-chip combine-multi";
    const tier = getMultiplierTier(Number(multiplier));
    multi.style.setProperty("--combine-color", tier.accent);
    multi.style.setProperty("--combine-glow", tier.glow);
    multi.innerHTML = `<span class="combine-kicker">Multiplier</span><span class="combine-value">${mfmt(multiplier)}</span>`;

    const flash = document.createElement("div");
    flash.className = "combine-flash";

    const total = document.createElement("div");
    total.className = "combine-chip combine-total";
    total.innerHTML = `<span class="combine-kicker">Total Win</span><span class="combine-value">${fmt(totalWin)}</span>`;

    overlay.append(amount, multi, flash, total);
    stage.appendChild(overlay);

    // Phase timings (ms)
    const ENTER = 480;
    const HOLD  = 320;
    const SLAM  = 360;
    const REVEAL = 1500;

    // Enter from sides.
    requestAnimationFrame(() => {
      amount.classList.add("is-entered");
      multi.classList.add("is-entered");
    });
    setTimeout(() => {
      // Slam together.
      amount.classList.add("is-slamming");
      multi.classList.add("is-slamming");
    }, ENTER + HOLD);
    setTimeout(() => {
      // Collision flash + total reveal.
      amount.classList.add("is-merged");
      multi.classList.add("is-merged");
      flash.classList.add("is-live");
      total.classList.add("is-live");
      shakeVault("strong");
    }, ENTER + HOLD + SLAM);
    setTimeout(() => {
      overlay.classList.add("is-fading");
    }, ENTER + HOLD + SLAM + REVEAL - 320);
    setTimeout(() => {
      overlay.remove();
      resolve();
    }, ENTER + HOLD + SLAM + REVEAL);
  });
}

function confirmBuy({ cost, currency, costMultiplier }) {
  return new Promise((resolve) => {
    const modal = document.getElementById("buyConfirmModal");
    const amountEl = document.getElementById("buyCostAmount");
    const currencyEl = document.getElementById("buyCostCurrency");
    const metaEl = document.getElementById("buyCostMeta");
    const confirmBtn = document.getElementById("buyConfirmBtn");
    const cancelBtn = document.getElementById("buyCancelBtn");
    if (!modal || !amountEl || !currencyEl || !confirmBtn || !cancelBtn) {
      // Fall back to a native confirm if the modal markup isn't present.
      resolve(window.confirm(`Buy Feature for ${fmt(cost)} ${currency}?`));
      return;
    }
    amountEl.textContent = fmt(cost);
    currencyEl.textContent = currency;
    if (metaEl) metaEl.textContent = `${costMultiplier}× your current bet`;

    let resolved = false;
    const cleanup = (result) => {
      if (resolved) return;
      resolved = true;
      modal.classList.add("hidden");
      modal.setAttribute("aria-hidden", "true");
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKey);
      resolve(result);
    };
    const onConfirm = () => cleanup(true);
    const onCancel = () => cleanup(false);
    const onBackdrop = (e) => { if (e.target === modal) cleanup(false); };
    const onKey = (e) => {
      if (e.key === "Escape") cleanup(false);
      else if (e.key === "Enter") cleanup(true);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKey);

    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    setTimeout(() => confirmBtn.focus(), 30);
  });
}

function pulseBanner(text, tone = "info", duration = 860) {
  if (!el.eventBanner || !el.eventBannerText) return;
  if (state.bannerTimer) {
    clearTimeout(state.bannerTimer);
    state.bannerTimer = null;
  }
  el.eventBannerText.textContent = text;
  el.eventBanner.classList.remove("hidden", "banner-info", "banner-win", "banner-bonus", "live-banner");
  el.eventBanner.classList.add(`banner-${tone}`);
  void el.eventBanner.offsetWidth;
  el.eventBanner.classList.add("live-banner");
  state.bannerTimer = setTimeout(() => {
    el.eventBanner.classList.add("hidden");
    el.eventBanner.classList.remove("live-banner", "banner-info", "banner-win", "banner-bonus");
    state.bannerTimer = null;
  }, duration);
}

function showWinCallout(amount, label = "Win", duration = 980, tier = null) {
  if (!el.winCallout || !el.winCalloutAmount || !el.winCalloutLabel) return;
  if (state.calloutTimer) {
    clearTimeout(state.calloutTimer);
    state.calloutTimer = null;
  }
  el.winCalloutLabel.textContent = label;
  el.winCalloutAmount.textContent = fmt(amount);
  // Infer a tier from the amount/bet ratio if not explicitly provided. Drives
  // the callout's color, glow, and size via CSS.
  let inferredTier = tier;
  if (!inferredTier) {
    const bet = Number(el.betSelect?.value || 1) || 1;
    const x = Number(amount || 0) / bet;
    inferredTier = x >= 100 ? "epic" : x >= 50 ? "great" : x >= 12 ? "medium" : "small";
  }
  el.winCallout.classList.remove(
    "hidden", "live-callout",
    "callout-tier-small", "callout-tier-medium",
    "callout-tier-great", "callout-tier-epic", "callout-tier-bonus"
  );
  el.winCallout.classList.add(`callout-tier-${inferredTier}`);
  void el.winCallout.offsetWidth;
  el.winCallout.classList.add("live-callout");
  state.calloutTimer = setTimeout(() => {
    el.winCallout.classList.add("hidden");
    el.winCallout.classList.remove("live-callout");
    state.calloutTimer = null;
  }, duration);
}

function shakeVault(strength = "normal") {
  if (!el.vaultWindow) return;
  const cls = strength === "strong" ? "event-shake-strong" : "event-shake";
  el.vaultWindow.classList.remove("event-shake", "event-shake-strong");
  void el.vaultWindow.offsetWidth;
  el.vaultWindow.classList.add(cls);
  const duration = strength === "strong" ? 700 : 520;
  setTimeout(() => {
    el.vaultWindow.classList.remove("event-shake", "event-shake-strong");
  }, duration);
}

function renderExamples() {
  el.lineExamples.innerHTML = "";
  [
    "Grid: 6 reels x 5 rows",
    "Symbols pay anywhere",
    "Minimum 8 matching symbols for a win",
    "Tumble continues while wins keep appearing",
    "Wild multipliers and bonus spins can trigger high-volatility sequences"
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

function renderCaughtLines(wins = [], multipliers = []) {
  el.caughtLines.innerHTML = "";
  if (!wins.length && !multipliers.length) {
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
  multipliers.forEach((m) => {
    if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col)) return;
    const tier = getMultiplierTier(Number(m.value || 1));
    const li = document.createElement("li");
    li.textContent = `MULTI ${mfmt(m.value || 1)} | ${tier.label} | row ${m.row + 1}, col ${m.col + 1}`;
    el.caughtLines.appendChild(li);
  });
}

function delayedDropAfter(ms, ...dropArgs) {
  return animationSleep(ms).then(() => reelRenderer.drop(...dropArgs));
}

function scatterPositionsFromPayload(payload = {}) {
  const steps = Array.isArray(payload.tumble_steps) && payload.tumble_steps.length
    ? payload.tumble_steps
    : [{ matrix: payload.matrix }];
  const positions = [];
  const seen = new Set();
  for (const step of steps) {
    const matrix = Array.isArray(step?.matrix) ? step.matrix : [];
    for (let row = 0; row < matrix.length; row += 1) {
      for (let col = 0; col < (matrix[row] || []).length; col += 1) {
        if (matrix[row][col] !== "SCATTER") continue;
        const key = `${row}-${col}`;
        if (seen.has(key)) continue;
        seen.add(key);
        positions.push({ row, col });
      }
    }
  }
  return positions;
}

async function celebrateScatterCatch(payload, label = "Bonus Catch") {
  const scatters = scatterPositionsFromPayload(payload);
  if (!scatters.length) return;
  const matrix = payload?.matrix || payload?.tumble_steps?.[payload.tumble_steps.length - 1]?.matrix;
  const multipliers = payload?.multipliers || payload?.tumble_steps?.[payload.tumble_steps.length - 1]?.multipliers || [];
  pulseBanner(label, "bonus", 900);
  pushGameMessage(`${label}: ${scatters.length} scatters caught.`, "bonus");
  await Promise.all([
    reelRenderer.highlight(matrix, { winning: scatters, multipliers }, 1180),
    reelRenderer.celebrateCluster(scatters, "SCATTER", scatters.length >= 5 ? "blast-great" : "blast-medium", 980)
  ]);
}

function summarizeSpin(payload, bet) {
  const tumbleSteps = Array.isArray(payload.tumble_steps) ? payload.tumble_steps : [];
  const tumbleCount = Math.max(0, tumbleSteps.length - 1);
  const allWins = Array.isArray(payload.ways_wins) ? payload.ways_wins : [];
  // Pre-scaler amounts as returned by the engine — these need to be scaled
  // so the displayed math matches reality (raw × multiplier = totalWin).
  const rawSumPreScaler = allWins.reduce((s, w) => s + Number(w.amount || 0), 0);
  const applied = Number(payload.multiplier_applied || 1);
  const totalWin = Number(payload.total_win || 0);
  const scatterWin = Number(payload.scatter_win || 0);
  // Post-scaler, pre-multiplier total for the cluster wins. Derive it from
  // totalWin / multiplier (minus scatter) so the math the player sees
  // actually agrees with what they got paid.
  const preMultPostScaler = applied > 0 ? Math.max(0, totalWin / applied - scatterWin) : 0;
  const scaler = rawSumPreScaler > 0 ? preMultPostScaler / rawSumPreScaler : 1;
  const wins = allWins.map((w) => ({
    symbol: String(w.symbol || ""),
    count: Number(w.count || 0),
    amount: Number((Number(w.amount || 0) * scaler).toFixed(2))
  }));
  const winsText = wins.length
    ? wins.map((w) => `${w.symbol}(${w.count})`).slice(0, 4).join(", ")
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
  const computedMultiCount = multipliersByPos.size;
  const computedMultiSum = Number(Array.from(multipliersByPos.values()).reduce((s, v) => s + v, 0).toFixed(2));
  const backendMultiCount = Number(payload.multipliers_count_sequence);
  const backendMultiSum = Number(payload.multipliers_sum_sequence);
  const multiCount = Number.isFinite(backendMultiCount) ? backendMultiCount : computedMultiCount;
  const multiSum = Number.isFinite(backendMultiSum) ? Number(backendMultiSum.toFixed(2)) : computedMultiSum;
  // Post-scaler pre-multiplier total — so rawWin × applied displays the
  // actual totalWin (e.g. 29.80 × 4 = 119.20, not the misleading 20 × 4).
  const rawWin = Number((preMultPostScaler + scatterWin).toFixed(2));
  const mode = payload.is_free_spin ? "bonus" : "base";
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
    mode,
    bet: Number(bet || payload.bet_amount || 0),
    tumbling: tumbleCount > 0,
    tumbleCount,
    winsText,
    wins,
    multiCount,
    multiSum,
    applied,
    rawWin,
    totalWin: Number(payload.total_win || 0)
  };
}

function spinCardTier(entry) {
  const bet = Number(entry?.bet || 0);
  const win = Number(entry?.totalWin || 0);
  if (win <= 0) return "loss";
  const x = bet > 0 ? win / bet : 0;
  if (x >= 50) return "great";
  if (x >= 12) return "medium";
  return "small";
}

function renderSpinCardInto(li, entry) {
  const tier = spinCardTier(entry);
  const isBonus = entry.mode === "bonus";
  li.className = `spin-card spin-tier-${tier}${isBonus ? " spin-bonus" : ""}`;

  const head = document.createElement("div");
  head.className = "spin-card-head";

  const seq = document.createElement("span");
  seq.className = "spin-seq";
  seq.textContent = `#${entry.seq || "-"}`;
  head.appendChild(seq);

  const mode = document.createElement("span");
  mode.className = `spin-chip mode-${isBonus ? "bonus" : "base"}`;
  mode.textContent = isBonus ? "FREE" : "BASE";
  head.appendChild(mode);

  if (entry.tumbling && entry.tumbleCount > 0) {
    const tumble = document.createElement("span");
    tumble.className = "spin-chip mode-tumble";
    tumble.textContent = `×${entry.tumbleCount + 1}`;
    tumble.title = `${entry.tumbleCount} tumble${entry.tumbleCount === 1 ? "" : "s"}`;
    head.appendChild(tumble);
  }

  const bet = document.createElement("span");
  bet.className = "spin-bet";
  bet.textContent = `Bet ${fmt(entry.bet)}`;
  head.appendChild(bet);

  const win = document.createElement("span");
  win.className = "spin-win";
  if (Number(entry.totalWin || 0) > 0) {
    win.textContent = `+${fmt(entry.totalWin)}`;
  } else {
    win.textContent = "—";
    win.classList.add("spin-win-none");
  }
  head.appendChild(win);

  li.appendChild(head);

  const body = document.createElement("div");
  body.className = "spin-card-body";

  const wins = Array.isArray(entry.wins) ? entry.wins : [];
  if (wins.length) {
    const pills = document.createElement("div");
    pills.className = "spin-pills";
    wins.slice(0, 6).forEach((w) => {
      const pill = document.createElement("span");
      pill.className = "spin-pill";
      const tone = symbolTone[w.symbol] || symbolTone.BLUE_DIAMOND;
      const dot = document.createElement("span");
      dot.className = "spin-pill-dot";
      dot.style.background = tone[0];
      dot.style.boxShadow = `0 0 6px ${tone[0]}`;
      const txt = document.createElement("span");
      txt.className = "spin-pill-count";
      txt.textContent = `×${w.count}`;
      pill.title = `${w.symbol} — ${w.count} symbols, ${fmt(w.amount)}`;
      pill.append(dot, txt);
      pills.appendChild(pill);
    });
    if (wins.length > 6) {
      const more = document.createElement("span");
      more.className = "spin-pill spin-pill-more";
      more.textContent = `+${wins.length - 6}`;
      pills.appendChild(more);
    }
    body.appendChild(pills);
  } else {
    const noWin = document.createElement("span");
    noWin.className = "spin-no-win";
    noWin.textContent = "No win";
    body.appendChild(noWin);
  }

  if (Number(entry.applied || 1) > 1) {
    const mathBox = document.createElement("span");
    mathBox.className = "spin-math";

    const raw = document.createElement("span");
    raw.className = "spin-raw";
    raw.textContent = fmt(entry.rawWin);
    mathBox.appendChild(raw);

    const times = document.createElement("span");
    times.className = "spin-math-op";
    times.textContent = "×";
    mathBox.appendChild(times);

    const mult = document.createElement("span");
    mult.className = "spin-mult";
    mult.textContent = mfmt(entry.applied);
    mathBox.appendChild(mult);

    body.appendChild(mathBox);
  }

  li.appendChild(body);
}

function renderSpinLog() {
  if (!el.spinLogList) return;
  el.spinLogList.innerHTML = "";
  const combined = [...state.spinLog, ...state.activityLog]
    .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
    .slice(0, 14);
  if (!combined.length) {
    const li = document.createElement("li");
    li.textContent = "No spins yet.";
    el.spinLogList.appendChild(li);
    if (el.spinLogStatus) el.spinLogStatus.textContent = "Waiting for spins...";
    return;
  }
  combined.forEach((entry) => {
    const li = document.createElement("li");
    if (entry.type === "event") {
      li.className = `log-event event-${entry.tone || "info"}`;
      const tag = document.createElement("span");
      tag.className = "event-tag";
      tag.textContent = "EVENT";
      const text = document.createElement("span");
      text.className = "event-text";
      text.textContent = entry.text;
      li.append(tag, text);
    } else {
      renderSpinCardInto(li, entry);
    }
    el.spinLogList.appendChild(li);
  });
  if (el.spinLogStatus) {
    const latestSpin = state.spinLog[0];
    if (latestSpin) el.spinLogStatus.textContent = `${latestSpin.mode.toUpperCase()} | last win ${fmt(latestSpin.totalWin)}`;
    else {
      const latestEvent = state.activityLog[0];
      el.spinLogStatus.textContent = latestEvent ? latestEvent.text : "Waiting for spins...";
    }
  }
}

function pushSpinLog(payload, bet) {
  const item = summarizeSpin(payload, bet);
  state.spinSeq += 1;
  item.seq = state.spinSeq;
  state.spinLog.unshift(item);
  if (state.spinLog.length > 10) state.spinLog = state.spinLog.slice(0, 10);
  renderSpinLog();
}

function applyRoundStats(payload, bet, wagerOverride) {
  const totalWin = Number(payload.total_win || 0);
  stats.spins += 1;
  if (totalWin > 0) stats.wins += 1;
  else stats.losses += 1;
  if (Number.isFinite(wagerOverride)) stats.wagered += wagerOverride;
  else if (!payload.is_free_spin) stats.wagered += Number(payload.bet_charged || bet);
  stats.won += totalWin;
  if (Number(payload.free_spins_awarded || 0) > 0) stats.bonusHits += 1;
  const winX = bet > 0 ? totalWin / bet : 0;
  if (winX > stats.maxWinX) stats.maxWinX = winX;

  el.spinsPlayed.textContent = String(stats.spins);
  el.sessionWagered.textContent = fmt(stats.wagered);
  el.sessionWon.textContent = fmt(stats.won);
  const net = Number((stats.won - stats.wagered).toFixed(2));
  el.sessionNet.textContent = fmt(net);
  setSigned(el.sessionNet, net);

  if (el.sessionWinLoss) el.sessionWinLoss.textContent = `${stats.wins} / ${stats.losses}`;
  if (el.sessionHitRate) {
    const hr = stats.spins > 0 ? (stats.wins / stats.spins) * 100 : 0;
    el.sessionHitRate.textContent = `${hr.toFixed(2)}%`;
  }
  if (el.sessionRtp) {
    if (stats.wagered > 0) {
      const rtp = (stats.won / stats.wagered) * 100;
      el.sessionRtp.textContent = `${rtp.toFixed(2)}%`;
      setSigned(el.sessionRtp, rtp - 100);
    } else {
      el.sessionRtp.textContent = "—";
    }
  }
  if (el.sessionMaxWinX) el.sessionMaxWinX.textContent = `${stats.maxWinX.toFixed(2)}x`;
  if (el.sessionBonusHits) el.sessionBonusHits.textContent = String(stats.bonusHits);
}

async function animateRound(payload, bet, wagerOverride, options = {}) {
  state.roundAnimating = true;
  el.spinBtn?.classList.add("is-spinning");
  el.spinBtn?.setAttribute("aria-label", "Stop spin");
  try {
  // Clone tumble_steps into a fresh local array of step objects with
  // deep-copied matrices so renderer state can't be polluted by any later
  // mutation of the payload (or the engine's internal references).
  const rawSteps = Array.isArray(payload.tumble_steps) && payload.tumble_steps.length
    ? payload.tumble_steps
    : [{ matrix: payload.matrix, multipliers: payload.multipliers || [], winning_positions: payload.winning_positions || [], ways_wins: payload.ways_wins || [], win_total: payload.total_win || 0 }];
  const steps = rawSteps.map((s) => ({
    matrix: Array.isArray(s?.matrix) ? s.matrix.map((row) => (Array.isArray(row) ? row.slice() : [])) : [],
    multipliers: Array.isArray(s?.multipliers) ? s.multipliers.map((m) => ({ ...m })) : [],
    winning_positions: Array.isArray(s?.winning_positions) ? s.winning_positions.slice() : [],
    ways_wins: Array.isArray(s?.ways_wins) ? s.ways_wins.slice() : [],
    win_total: Number(s?.win_total || 0)
  }));
  normalizeStepMultiplierIds(steps);

  state.spinFlownSouls = new Set();
  state.spinCelebratedMultis = new Set();
  state.spinMultDisplay = parseFloat(el.activeMultiplier.textContent) || 1;
  let liveRawWin = 0;
  // Derive the engine's effective payout scaler so chip amounts AND meter
  // updates reflect post-scaler values. Without this, a raw 1.6 cluster
  // would render the chip "+1.60" yet the meter would settle at 2.38
  // (1.60 × 1.49 base scaler), which looks like math broke.
  const rawSumAllSteps = steps.reduce((s, st) => s + Number(st?.win_total || 0), 0);
  const appliedForScaler = Number(payload.multiplier_applied || 1);
  const totalWinForScaler = Number(payload.total_win || 0);
  const scatterWinForScaler = Number(payload.scatter_win || 0);
  const preMultPostScaler = appliedForScaler > 0
    ? Math.max(0, totalWinForScaler / appliedForScaler - scatterWinForScaler)
    : 0;
  const winScaler = rawSumAllSteps > 0 ? preMultPostScaler / rawSumAllSteps : 1;
  el.lastWin.textContent = "0.00";
  reelRenderer.resetHeavyBangs();
  // Defensive: clear any leftover animation/celebration state so the new
  // spin's intro renders the new matrix cleanly, never stale data from a
  // prior spin's lingering fx state.
  reelRenderer.fx.drop = null;
  reelRenderer.fx.heavyDrop = null;
  reelRenderer.fx.blast = null;
  reelRenderer.fx.charge = null;
  reelRenderer.fx.cluster = null;
  reelRenderer.fx.pulse = null;
  reelRenderer.fx.multiCatch = null;
  reelRenderer.fx.spotlight = null;
  reelRenderer.fx.heavyReveals = new Map();
  if (options.preparedTransition) {
    await options.preparedTransition;
  } else {
    await reelRenderer.dropOff();
  }
  // Commit the new spin's first matrix to the canvas immediately so the
  // visible board is always the current payload, even if intro is aborted
  // or the prior round left fx state mid-animation.
  reelRenderer.setBoard(steps[0].matrix, { multipliers: steps[0].multipliers || [] });
  reelRenderer.forceDrawNow();
  try {
    const m = steps[0].matrix || [];
    const tag = `[anim] id=${String(payload?.spin_id || "?").slice(0, 8)} m[0][0]=${m?.[0]?.[0] || "?"}`;
    console.log(tag);
    if (el.resultDump) el.resultDump.dataset.lastSpinTag = tag;
  } catch {}
  if (payload.is_free_spin) pulseBanner("Free Spin", "info", 640);
  pushGameMessage(payload.is_free_spin ? "Free spin started." : `Spin started (bet ${fmt(bet)}).`, "info");
  // Multipliers only animate when they are part of a win. On the initial board
  // reveal that means the first step must itself be a winning step; otherwise
  // multipliers simply drop in silently and only come alive on a later
  // winning tumble (handled by the tumble drop below with animateMultipliers).
  const step0Winning = (steps[0].winning_positions || []).length > 0 && Number(steps[0].win_total || 0) > 0;
  await reelRenderer.intro(steps[0].matrix, steps[0].multipliers || [], { animateMultipliers: step0Winning });

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (i > 0) {
      const prev = steps[i - 1];
      const prevWinning = Array.isArray(prev?.winning_positions) ? prev.winning_positions : [];
      const prevWinTotal = Number(prev?.win_total || 0);
      if (prevWinning.length > 0 && prevWinTotal > 0) {
        await animationSleep(140);
        const prevTier = winTier(prev?.ways_wins || [], bet);
        pushGameMessage(`Tumble ${i} triggered.`, "info");
        // Shake only on great-tier tumble (no shake on routine medium/small).
        if (prevTier === "blast-great") shakeVault("normal");
        // Win chip + cluster celebration fire IN PARALLEL with the explode so
        // the floating amount visually emerges from the cluster at the same
        // moment its symbols disappear. The chip + meter use the SCALED
        // amount so the numbers the player sees agree with the totals.
        const scaledStepWin = Number((prevWinTotal * winScaler).toFixed(2));
        const prevMeterStart = Number(el.lastWin.textContent || 0);
        liveRawWin = Number((liveRawWin + scaledStepWin).toFixed(2));
        const prevDominant = reelRenderer._dominantSymbolAt(prevWinning);
        const chipPromise = flyWinChip({
          winningPositions: prevWinning,
          amount: scaledStepWin,
          tier: prevTier,
          onLand: () => animateWinMeter(prevMeterStart, liveRawWin, 280)
        });
        const celebratePromise = prevTier !== "blast-small"
          ? reelRenderer.celebrateCluster(prevWinning, prevDominant, prevTier)
          : Promise.resolve();
        const dropMap = buildDropMap(prev.matrix, prevWinning);
        const dropPromise = delayedDropAfter(
          ANIMATION_TIMING.tumbleDropOverlap,
          step.matrix,
          step.multipliers || [],
          dropMap,
          ANIMATION_TIMING.tumbleDrop,
          { animateMultipliers: true }
        );
        await Promise.all([
          reelRenderer.explode(prevWinning, ANIMATION_TIMING.explode, prevTier),
          chipPromise,
          celebratePromise,
          dropPromise
        ]);
      } else if (prevWinning.length === 0 && Array.isArray(prev?.multipliers) && prev.multipliers.length > 0) {
        // multipliers may persist on a non-winning matrix; nothing to do.
      }
    }
    const tier = winTier(step?.ways_wins || [], bet);
    let pulseDuration = tier === "blast-great"
      ? ANIMATION_TIMING.markGreat
      : tier === "blast-medium"
        ? ANIMATION_TIMING.markMedium
        : ANIMATION_TIMING.markSmall;
    // Slow the mark further the more symbols were caught (8+), so the player
    // can clearly see every symbol that is part of a large match before it
    // resolves. Scales with cluster size and is capped to stay responsive.
    const markedCount = (step.winning_positions || []).length;
    if (markedCount >= ANIMATION_TIMING.markBigClusterThreshold) {
      pulseDuration += Math.min(
        ANIMATION_TIMING.markBigClusterCap,
        (markedCount - ANIMATION_TIMING.markBigClusterThreshold) * ANIMATION_TIMING.markPerExtraSymbol
      );
    }
    const stepWin = Number(step?.win_total || 0);
    const stepMaxMultiplier = maxMultiplierInStep(step);
    const mTier = multiplierEventTier(stepMaxMultiplier);
    if ((step.winning_positions || []).length && stepWin > 0) {
      const winX = bet > 0 ? stepWin / bet : 0;
      const label = winX >= 100
        ? "Epic Win"
        : tier === "blast-great"
          ? "Great Win"
          : tier === "blast-medium"
            ? "Big Win"
            : "Win";
      // Only surface the on-screen callout/banner for medium+ wins. Small
      // wins keep the visuals on the reels and the running balance update.
      if (tier !== "blast-small") {
        showWinCallout(stepWin, label, tier === "blast-great" ? 1200 : 940);
        pulseBanner(`${label} ${fmt(stepWin)}`, "win", 900);
      }
      pushGameMessage(`${label}: ${fmt(stepWin)} on step ${i + 1}.`, "win");
      // Shake only on great-tier (and stronger above 100x). Medium wins stay calm.
      if (tier === "blast-great") shakeVault(winX >= 100 ? "strong" : "normal");
      if (winX >= 100) {
        await reelRenderer.jackpotFlash({
          duration: 520,
          colorA: "rgba(170, 225, 255, 0.32)",
          colorB: "rgba(255, 214, 136, 0.28)"
        });
      }
    }
    // Multiplier symbols always keep the normal reel drop. The multiplier
    // lightning/catch/fly-to-total sequence only runs on wins or tumbles.
    const isWinningStep = (step.winning_positions || []).length > 0 && stepWin > 0;
    const isTumbleStep = i > 0;
    if ((isWinningStep || isTumbleStep) && Array.isArray(step.multipliers) && step.multipliers.length) {
      const fresh = step.multipliers.filter((m) => {
        const k = m?.id ? `id:${m.id}` : `${m?.row}-${m?.col}-${Number(m?.value || 0)}`;
        if (state.spinCelebratedMultis.has(k)) return false;
        state.spinCelebratedMultis.add(k);
        return true;
      });
      if (fresh.length) {
        const freshMaxMultiplier = maxMultiplierInStep({ multipliers: fresh });
        const freshTier = multiplierEventTier(freshMaxMultiplier);
        await Promise.all([
          reelRenderer.multiplierCatch(fresh, freshTier === "epic" || freshTier === "legendary" || freshTier === "mythic" ? 820 : 460),
          flyMultiplierSouls(fresh)
        ]);
        if (freshTier === "epic" || freshTier === "legendary" || freshTier === "mythic") {
          const catchLabel = freshTier === "mythic"
            ? `MYTHIC CATCH ${freshMaxMultiplier}x`
            : freshTier === "legendary"
              ? `LEGENDARY CATCH ${freshMaxMultiplier}x`
              : `EPIC CATCH ${freshMaxMultiplier}x`;
          pulseBanner(catchLabel, "bonus", 1200);
          showWinCallout(freshMaxMultiplier, "Multiplier Catch", 1200);
          pushGameMessage(`${catchLabel} on step ${i + 1}.`, "bonus");
          shakeVault(freshTier === "mythic" || freshTier === "legendary" ? "strong" : "normal");
          await reelRenderer.jackpotFlash({
            duration: freshTier === "mythic" ? 900 : 700,
            colorA: freshTier === "mythic" ? "rgba(255, 165, 224, 0.46)" : "rgba(190, 214, 255, 0.34)",
            colorB: freshTier === "mythic" ? "rgba(255, 232, 184, 0.38)" : "rgba(149, 190, 255, 0.26)"
          });
        }
      }
    }
    await reelRenderer.highlight(
      step.matrix,
      { winning: step.winning_positions || [], multipliers: step.multipliers || [] },
      (step.winning_positions || []).length ? pulseDuration : 0
    );
  }

  // Finale combine sequence: when an epic+ (≥50x) multiplier was caught, fly
  // the raw win and the multiplier together visually and reveal the total.
  const appliedMult = Number(payload.multiplier_applied || 1);
  const totalWinAmt = Number(payload.total_win || 0);
  const meterBeforeFinal = Number(el.lastWin.textContent || 0);
  // Only run the multiplier-applied finale when there's actually a multiplier
  // AND a meaningful diff to bridge. With the chip already showing scaled
  // amounts, multiplier=1 spins now skip this entirely (no extra delay).
  if (appliedMult > 1 && totalWinAmt > meterBeforeFinal + 0.009) {
    pulseBanner(`Multiplier Applied ${mfmt(appliedMult)}`, "bonus", 520);
    await animateWinMeter(meterBeforeFinal, totalWinAmt, 360);
  } else if (totalWinAmt > meterBeforeFinal + 0.009) {
    // Tiny rounding gap (no multiplier) — snap the meter, no animation tail.
    el.lastWin.textContent = fmt(totalWinAmt);
  }
  if (appliedMult >= 50 && totalWinAmt > 0) {
    const rawWin = appliedMult > 0 ? totalWinAmt / appliedMult : totalWinAmt;
    await playWinCombineSequence(rawWin, appliedMult, totalWinAmt);
  }

  // Surface server-style events from the engine payload (max-win cap etc.).
  if (Array.isArray(payload.events) && payload.events.length) {
    for (const evt of payload.events) {
      if (evt?.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP") {
        const capX = Number(evt.cap_x || 0);
        pulseBanner(`MAX WIN ${capX.toLocaleString()}× CAPPED`, "bonus", 2400);
        showWinCallout(Number(evt.total_win || 0), "Max Win Cap", 2200);
        shakeVault("strong");
        await reelRenderer.jackpotFlash({
          duration: 1200,
          colorA: "rgba(255, 80, 60, 0.5)",
          colorB: "rgba(255, 220, 100, 0.4)"
        });
        pushGameMessage(`Free spins ended because max win cap (${capX}×) was reached.`, "bonus");
      } else if (evt?.type === "MAX_WIN_CAP_REACHED") {
        const capX = Number(evt.cap_x || 0);
        pulseBanner(`MAX WIN ${capX.toLocaleString()}× CAPPED`, "bonus", 2000);
        pushGameMessage(`Max win cap (${capX}×) reached.`, "bonus");
      }
    }
  }

  // Optional subtle hint for near-miss outcomes (no win, but board teases).
  if (payload.near_miss && Number(payload.total_win || 0) <= 0) {
    pushGameMessage("So close!", "info");
  }

  if (Number(payload.free_spins_awarded || 0) > 0) {
    // Retriggers and initial triggers are announced via the showFeature
    // panel in spin(); no in-flow banner/callout/shake is needed here.
    pushGameMessage(`Bonus triggered: +${payload.free_spins_awarded} free spins.`, "bonus");
  } else if (Number(payload.total_win || 0) <= 0) {
    // No on-screen "No Win" banner — silence is fine, the player can see it.
    pushGameMessage("No win this spin.", "info");
  } else {
    const totalWinX = bet > 0 ? Number(payload.total_win || 0) / bet : 0;
    if (payload.is_free_spin) {
      const bonusLabel = totalWinX >= 50
        ? "Sensational Win"
        : totalWinX >= 25
          ? "Huge Win"
          : totalWinX >= 10
            ? "Big Win"
            : "";
      if (bonusLabel) {
        showWinCallout(payload.total_win || 0, bonusLabel, totalWinX >= 50 ? 1300 : 1100);
        pulseBanner(`${bonusLabel} ${fmt(payload.total_win || 0)}`, "win", totalWinX >= 50 ? 1200 : 1000);
        // Hold the round slightly longer on notable bonus wins so the player
        // can actually read and feel the moment before the next spin starts.
        await animationSleep(totalWinX >= 50 ? 1200 : totalWinX >= 25 ? 900 : 700);
      } else if (totalWinX >= 12) {
        pulseBanner(`Total Win ${fmt(payload.total_win || 0)}`, "win", 900);
      }
    } else if (totalWinX >= 12) {
      pulseBanner(`Total Win ${fmt(payload.total_win || 0)}`, "win", 900);
    }
    pushGameMessage(`Total spin win: ${fmt(payload.total_win || 0)}.`, "win");
  }

  el.balance.textContent = fmt(payload.balance_after || 0);
  el.lastWin.textContent = fmt(payload.total_win || 0);
  el.freeSpins.textContent = String(payload.free_spins_left || 0);
  if (payload.is_free_spin) {
    const reportedBonusMult = Number(payload.free_spin_multiplier_current);
    state.bonusMultiplierCarry = Number.isFinite(reportedBonusMult) && reportedBonusMult >= 0
      ? reportedBonusMult
      : Number(state.bonusMultiplierCarry || 0);
    el.activeMultiplier.textContent = mfmt(state.bonusMultiplierCarry);
  } else {
    state.bonusMultiplierCarry = 0;
    el.activeMultiplier.textContent = mfmt(payload.multiplier_applied || 1);
  }
  updateBonusHud({
    freeSpinsLeft: payload.free_spins_left || 0,
    multiplier: state.bonusMultiplierCarry,
    bonusTotal: payload.bonus_round_win || 0
  });
  el.winningLines.textContent = String((payload.ways_wins || []).length);
  const finalStep = steps[steps.length - 1] || {};
  renderCaughtLines(payload.ways_wins || [], finalStep.multipliers || payload.multipliers || []);
  pushSpinLog(payload, bet);
  el.resultDump.textContent = JSON.stringify(payload, null, 2);
  applyRoundStats(payload, bet, wagerOverride);
  // Hard commit the final tumble step's board immediately — no waitForIdle
  // tail. Lingering particles / embers fade out asynchronously in the rAF
  // loop without blocking the spin from resolving. The round is "done" the
  // moment the drops finish.
  const commitStep = steps[steps.length - 1] || steps[0];
  if (commitStep && commitStep.matrix) {
    reelRenderer.setBoard(commitStep.matrix, { multipliers: commitStep.multipliers || [] });
    reelRenderer.forceDrawNow();
  }
  } finally {
    state.roundAnimating = false;
    state.fastStopRequested = false;
    el.spinBtn?.classList.remove("is-spinning", "is-fast-stopping");
    el.spinBtn?.setAttribute("aria-label", "Spin");
  }
}

async function spin(options = {}) {
  if (!state.sessionId) return;
  if (state.bonusAutoplay && !options.autoplay) return;
  if (state.roundAnimating) {
    requestFastStop();
    return;
  }
  state.fastStopRequested = false;
  el.spinBtn?.classList.remove("is-fast-stopping");
  setControls(true);
  try {
    const bet = Number(el.betSelect.value || 1);
    el.betView.textContent = fmt(bet);
    if (state.bonusAutoplay) pulseBanner("Auto Free Spin...", "info", 560);
    const preparedTransition = reelRenderer.dropOff();
    await preparedTransition;
    const spinId = (window.SlotEngine?.RNG?.uuid?.()) || crypto.randomUUID();
    const payload = await api("/api/v1/spin", {
      session_id: state.sessionId,
      spin_id: spinId,
      bet_amount: bet,
      ante_enabled: Boolean(el.anteToggle.checked),
      force_multiplier_value: Number.isFinite(Number(state.forcedMultiplierLock))
        ? Number(state.forcedMultiplierLock)
        : undefined
    });
    // Diagnostic: confirm each spin produces a unique id and a fresh first matrix.
    try {
      const firstMatrix = payload?.tumble_steps?.[0]?.matrix || payload?.matrix || [];
      const firstRow = (firstMatrix[0] || []).slice(0, 3).join(",");
      console.log(`[spin] id=${String(payload?.spin_id || spinId).slice(0, 8)} steps=${payload?.tumble_steps?.length ?? 0} row0=${firstRow}`);
    } catch {}
    // Drop the spinning indicator the instant the result is in. The reels
    // themselves animate the round; the button square is purely a
    // "spin is in flight" cue that should not linger across the animation
    // or the trailing waitForIdle settle window.
    el.spinBtn?.classList.remove("is-spinning", "is-fast-stopping");
    await animateRound(payload, bet, undefined, { preparedTransition });
    if (Number(payload.free_spins_awarded || 0) > 0 && !payload.is_free_spin) {
      await celebrateScatterCatch(payload, "Bonus Catch");
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
    } else if (
      state.bonusAutoplay &&
      payload.is_free_spin &&
      Number(payload.free_spins_awarded || 0) > 0 &&
      Number(payload.free_spins_left || 0) > 0
    ) {
      // Retrigger during the active bonus autoplay — always +5 spins.
      // Show the feature panel briefly then auto-dismiss so the autoplay
      // continues without requiring a click. Player can still click to
      // skip it sooner.
      await celebrateScatterCatch(payload, "Retrigger Catch");
      const sf = showFeature(`You won ${payload.free_spins_awarded} more Free Spins`, "Spins resume in a moment...");
      const autoDismiss = setTimeout(() => dismissFeature(), 1800);
      try { await sf; } finally { clearTimeout(autoDismiss); }
    }
    return payload;
  } catch (err) {
    reelRenderer.setBoard(randomMatrix());
    el.resultDump.textContent = `Error: ${err.message}`;
    pushGameMessage(`Spin error: ${err.message}`, "error");
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
    pushGameMessage("Bonus autoplay started.", "bonus");
    while (Number(el.freeSpins.textContent || "0") > 0) {
      const payload = await spin({ autoplay: true });
      total += Number(payload?.total_win || 0);
      const capEvent = (payload?.events || []).find((evt) => evt?.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP");
      if (capEvent) {
        total = Number(capEvent.bonus_total_win || total);
        break;
      }
      await animationSleep(120);
    }
    await showFeature(`Bonus Win ${fmt(total)}`, "Press anywhere to continue.");
    pushGameMessage(`Bonus autoplay complete. Total bonus win: ${fmt(total)}.`, "bonus");
  } finally {
    state.bonusAutoplay = false;
    setControls(false);
  }
}

async function buyFreeSpins() {
  if (!state.sessionId || state.bonusAutoplay) return;
  if (el.anteToggle.checked) return;
  const bet = Number(el.betSelect.value || 1);
  const costMultiplier = Number(state.rules?.features?.buy_free_spins?.cost_multiplier || 100);
  const cost = Number((bet * costMultiplier).toFixed(2));
  const ok = await confirmBuy({ cost, currency: state.currency || "GEL", costMultiplier });
  if (!ok) return;
  setControls(true);
  try {
    pulseBanner("Buying Free Spins...", "bonus", 900);
    const payload = await api("/api/v1/buy-free-spins", { session_id: state.sessionId, bet_amount: bet });
    pushGameMessage(`Bought free spins for ${fmt(payload.buy_cost || 0)}.`, "bonus");
    await animateRound(payload, bet, Number(payload.buy_cost || 0));
    if (Number(payload.free_spins_awarded || 0) > 0) {
      await celebrateScatterCatch(payload, "Bonus Catch");
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
    }
  } catch (err) {
    el.resultDump.textContent = `Error: ${err.message}`;
    pushGameMessage(`Buy error: ${err.message}`, "error");
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

async function runSimulation({ bonusOnly = false } = {}) {
  if (!state.sessionId) return;
  setControls(true);
  const bet = Number(el.betSelect.value || 1);
  const ante = Boolean(el.anteToggle.checked);
  const modeLabel = bonusOnly ? "1M bonus-round simulation" : "1M simulation";

  el.simProgressBar.style.width = "0%";
  el.simProgressLabel.textContent = "Starting...";
  el.simulateDump.textContent = `Running (${modeLabel}) on client engine...`;
  pushGameMessage(`${modeLabel} started.`, "info");

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
    const engine = await getEngine();
    for await (const evt of window.SlotEngine.Simulator.simulateStreamAsync(engine, {
      steps: 1000000,
      betAmount: bet,
      anteEnabled: ante,
      bonusOnly: Boolean(bonusOnly),
      gameId: state.gameId || "bananax"
    })) {
      if (state.simulationAbort?.signal?.aborted) break;
      if (evt.type === "progress") applyProgress(evt.payload);
      if (evt.type === "complete") {
        complete = true;
        el.simProgressBar.style.width = "100%";
        el.simProgressLabel.textContent = "Completed";
        el.simulateDump.textContent = JSON.stringify(evt.payload.report, null, 2);
        pushGameMessage(`${modeLabel} complete.`, "info");
      }
    }
  } catch (err) {
    el.simulateDump.textContent = `Simulation error: ${err.message}`;
    pushGameMessage(`Simulation error: ${err.message}`, "error");
  } finally {
    state.simulationAbort = null;
    if (!state.bonusAutoplay) setControls(false);
    if (!complete) el.simProgressLabel.textContent = "Stopped";
  }
}

async function loadRules() {
  try {
    const engine = await getEngine();
    const rules = engine.getDecoratedRules();
    state.rules = rules;
    el.lineCount.textContent = String(rules.layout?.pays || "symbols_pay_anywhere").replaceAll("_", " ");
    const allowed = rules.features?.multipliers?.allowed_values || [];
    renderMultiplierInfo(allowed);
    renderRulesPage();
  } catch (err) {
    pushGameMessage(`Rules load failed: ${err.message}`, "error");
  }
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
  if (new URLSearchParams(window.location.search).has("reset")) {
    try { window.SlotEngine?.SessionStore?.clearSession?.(); } catch {}
  }
  const payload = await api("/api/v1/session/init", { player_id: `player_${Date.now()}`, currency: "GEL", locale: "en", game_id: state.gameId });
  state.sessionId = payload.session_id;
  state.currency = payload.currency || "GEL";
  state.gameId = payload.game_id || state.gameId;
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
  if (el.betDisplay) el.betDisplay.textContent = "1.00";
  renderPaytable(1);
  const pendingFreeSpins = Number(payload.free_spins_left || 0);
  if (pendingFreeSpins > 0) {
    el.freeSpins.textContent = String(pendingFreeSpins);
    state.bonusMultiplierCarry = Number.isFinite(Number(payload.free_spin_multiplier_current))
      ? Number(payload.free_spin_multiplier_current)
      : 0;
    el.activeMultiplier.textContent = mfmt(state.bonusMultiplierCarry);
  }
  updateBonusHud({
    freeSpinsLeft: pendingFreeSpins,
    multiplier: state.bonusMultiplierCarry,
    bonusTotal: Number(payload.bonus_round_win || 0)
  });
  if (el.anteToggle && payload.ante_enabled) {
    el.anteToggle.checked = true;
    el.anteToggle.dispatchEvent(new Event("change"));
  }
  setCrazyMode(Boolean(payload.crazy_mode), { silent: true });
  pushGameMessage(`Session ${state.sessionId.slice(0, 8)} initialized.`, "info");
  // If a persisted session left the player mid-bonus, auto-resume the
  // autoplay instead of leaving stale free spins lying around. Otherwise
  // the player would unknowingly burn them by clicking spin manually, and
  // any 4+ scatter catch during base game would be impossible (every spin
  // would be a free spin, so it'd retrigger +5 instead of triggering 15).
  if (pendingFreeSpins > 0) {
    await showFeature(`Resuming Bonus — ${pendingFreeSpins} Free Spins`, "Press anywhere to continue.");
    await autoplayBonus();
  }
}

function setCrazyMode(on, opts = {}) {
  const next = Boolean(on);
  const wasOn = state.crazyMode;
  state.crazyMode = next;
  document.body.classList.toggle("crazy-mode-on", next);
  if (el.crazyToggleBtn) {
    el.crazyToggleBtn.classList.toggle("is-on", next);
    const stateLabel = el.crazyToggleBtn.querySelector(".crazy-toggle-state");
    if (stateLabel) stateLabel.textContent = next ? "ON" : "OFF";
  }
  getEngine().then((engine) => engine.setCrazyMode(next)).catch(() => {});
  if (opts.silent) return;
  pushGameMessage(`Crazy Mode ${next ? "ENABLED" : "disabled"}.`, next ? "bonus" : "info");
  if (next !== wasOn) {
    pulseBanner(next ? "CRAZY MODE ON" : "Crazy Mode Off", next ? "bonus" : "info", 1100);
  }
}

el.betSelect.addEventListener("change", () => {
  el.betView.textContent = fmt(el.betSelect.value);
  if (el.betDisplay) el.betDisplay.textContent = fmt(el.betSelect.value);
  renderPaytable(Number(el.betSelect.value || 1));
});

function stepBet(direction) {
  if (!el.betSelect || el.betSelect.disabled) return;
  const opts = Array.from(el.betSelect.options);
  if (!opts.length) return;
  const idx = Math.max(0, opts.findIndex((o) => o.value === el.betSelect.value));
  const next = Math.max(0, Math.min(opts.length - 1, idx + direction));
  if (opts[next].value === el.betSelect.value) return;
  el.betSelect.value = opts[next].value;
  el.betSelect.dispatchEvent(new Event("change"));
}
if (el.betDownBtn) el.betDownBtn.addEventListener("click", () => stepBet(-1));
if (el.betUpBtn) el.betUpBtn.addEventListener("click", () => stepBet(1));

const anteToggleImg = $("anteToggleImg");
if (el.anteToggle && anteToggleImg) {
  const updateAnteImg = () => {
    anteToggleImg.src = el.anteToggle.checked
      ? "assets/symbols/ANTE_ACTIVE-removebg-preview.png"
      : "assets/symbols/ANTE_INACTIVE-removebg-preview.png";
  };
  el.anteToggle.addEventListener("change", updateAnteImg);
  updateAnteImg();
}
el.spinBtn.addEventListener("click", spin);
el.buyFreeBtn.addEventListener("click", buyFreeSpins);
el.simulateBtn.addEventListener("click", () => runSimulation({ bonusOnly: false }));
if (el.simulateBonusBtn) el.simulateBonusBtn.addEventListener("click", () => runSimulation({ bonusOnly: true }));
if (el.testDropBtn) el.testDropBtn.addEventListener("click", () => runVisualTest("drop"));
if (el.testExplodeBtn) el.testExplodeBtn.addEventListener("click", () => runVisualTest("explode"));
if (el.testCelebrateBtn) el.testCelebrateBtn.addEventListener("click", () => runVisualTest("celebrate"));
if (el.testCatchBtn) el.testCatchBtn.addEventListener("click", () => runVisualTest("catch"));
if (el.crazyToggleBtn) el.crazyToggleBtn.addEventListener("click", () => setCrazyMode(!state.crazyMode));
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

reelRenderer.setBoard(randomMatrix());
renderExamples();
renderSpinLog();
renderTestPanel();
el.symbolLegend.textContent = "Top Crown, Hourglass, Ring, Chalice, Red Gem, Purple Triangle, Yellow Hex, Green Triangle, Blue Diamond, Wild Multiplier, Scatter";
el.payoutRuleText.textContent = "High-volatility pays-anywhere model. Wild multipliers and scatter-triggered bonus spins drive peak wins.";
el.multiplierInfo.textContent = "Loading...";
el.activeMultiplier.textContent = "1x";
requestAnimationFrame(() => document.body.classList.add("app-ready"));
initSession().catch((err) => {
  el.resultDump.textContent = `Init failed: ${err.message}`;
  pushGameMessage(`Init failed: ${err.message}`, "error");
});
loadRules();
