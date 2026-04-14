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
  multiplierInfo: $("multiplierInfo"),
  winCallout: $("winCallout"),
  winCalloutLabel: $("winCalloutLabel"),
  winCalloutAmount: $("winCalloutAmount"),
  testDropBtn: $("testDropBtn"),
  testExplodeBtn: $("testExplodeBtn"),
  testCatchBtn: $("testCatchBtn"),
  testMultiButtons: $("testMultiButtons"),
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
  forcedMultiplierLock: null
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
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const easeOutBack = (t) => 1 + 1.6 * (t - 1) ** 3 + 0.6 * (t - 1) ** 2;

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
      multiMap: new Map()
    };
    this.fx = {
      drop: null,
      pulse: null,
      blast: null,
      spinBurst: null,
      multiCatch: null,
      shockwaves: [],
      reelSlam: null,
      jackpotFlash: null
    };
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
    const safeMatrix = Array.isArray(matrix) && matrix.length ? matrix : this.board.matrix;
    this.board.matrix = safeMatrix;
    this.board.winningSet = new Set((winning || []).map((p) => `${p.row}-${p.col}`));
    this.board.multiMap = new Map((multipliers || []).map((m) => [`${m.row}-${m.col}`, Number(m.value || 1)]));
  }

  cellCenter(row, col) {
    const { padX, top, laneW, rowStep } = this.getLayout();
    return {
      x: padX + laneW * (col + 0.5),
      y: top + rowStep * (row + 0.5)
    };
  }

  spawnExplosionParticles(winning = [], strength = "medium") {
    if (!winning.length) return;
    const perCell = strength === "great" ? 28 : strength === "small" ? 14 : 20;
    const speed = strength === "great" ? 1.5 : strength === "small" ? 0.95 : 1.2;
    winning.forEach((p) => {
      if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col)) return;
      const center = this.cellCenter(p.row, p.col);
      const tone = symbolTone[this.board.matrix?.[p.row]?.[p.col] || "BLUE_DIAMOND"] || symbolTone.BLUE_DIAMOND;
      this.fx.shockwaves.push({
        x: center.x,
        y: center.y,
        born: performance.now(),
        life: strength === "great" ? 820 : 620,
        color: tone[0]
      });
      for (let i = 0; i < perCell; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = (1.8 + Math.random() * 2.7) * speed;
        this.particles.push({
          x: center.x,
          y: center.y,
          vx: Math.cos(a) * v,
          vy: Math.sin(a) * v - (0.4 + Math.random() * 0.9),
          life: 420 + Math.random() * 280,
          born: performance.now(),
          size: 1.8 + Math.random() * 2.2,
          colorA: tone[0],
          colorB: tone[1],
          mode: i % 3 === 0 ? "shard" : "spark",
          rot: Math.random() * Math.PI * 2,
          spin: (Math.random() - 0.5) * 0.22
        });
      }
    });
  }

  spawnMultiplierCatchParticles(multipliers = []) {
    multipliers.forEach((m) => {
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col)) return;
      const center = this.cellCenter(m.row, m.col);
      const valueNum = Number(m.value || 2);
      const tier = getMultiplierTier(valueNum);
      for (let i = 0; i < 26; i += 1) {
        const a = (Math.PI * 2 * i) / 26 + Math.random() * 0.2;
        const outward = 1.1 + Math.random() * 1.7;
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

  async preSpin(duration = 320) {
    this.fx.spinBurst = { start: performance.now(), duration };
    await sleep(duration);
    this.fx.spinBurst = null;
  }

  async intro(matrix, multipliers = []) {
    const introMap = {};
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) introMap[`${r}-${c}`] = this.rows;
    }
    return this.drop(matrix, multipliers, introMap, 1120);
  }

  async drop(matrix, multipliers = [], dropMap = {}, duration = 960) {
    this.setBoard(matrix, { multipliers });
    this.fx.drop = { start: performance.now(), duration, map: dropMap };
    const maxDelay = Object.entries(dropMap || {}).reduce((acc, [key, count]) => {
      const [row, col] = key.split("-").map((n) => Number(n));
      if (!Number.isFinite(row) || !Number.isFinite(col)) return acc;
      return Math.max(acc, this.dropDelay(row, col, Number(count || 0)));
    }, 0);
    await sleep(duration + maxDelay + 70);
    this.fx.drop = null;
  }

  async explode(winning = [], duration = 380, tier = "medium") {
    if (!winning.length) return;
    this.fx.blast = {
      start: performance.now(),
      duration,
      set: new Set(winning.map((p) => `${p.row}-${p.col}`))
    };
    this.spawnExplosionParticles(winning, tier === "blast-great" ? "great" : tier === "blast-small" ? "small" : "medium");
    await sleep(duration);
    this.fx.blast = null;
  }

  async highlight(matrix, { winning = [], multipliers = [] } = {}, duration = 420) {
    this.setBoard(matrix, { winning, multipliers });
    if (!winning.length) return;
    this.fx.pulse = {
      start: performance.now(),
      duration
    };
    await sleep(duration);
    this.fx.pulse = null;
  }

  async multiplierCatch(multipliers = [], duration = 460) {
    if (!Array.isArray(multipliers) || multipliers.length === 0) return;
    const catchSet = new Set(
      multipliers
        .filter((m) => Number.isInteger(m?.row) && Number.isInteger(m?.col))
        .map((m) => `${m.row}-${m.col}`)
    );
    if (!catchSet.size) return;
    this.fx.multiCatch = {
      start: performance.now(),
      duration,
      set: catchSet
    };
    this.spawnMultiplierCatchParticles(multipliers);
    await sleep(duration);
    this.fx.multiCatch = null;
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
    await sleep(duration);
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
    await sleep(duration);
    this.fx.jackpotFlash = null;
  }

  loop() {
    const now = performance.now();
    const dt = Math.max(0, Math.min(34, now - this.lastTick));
    this.lastTick = now;
    this.time += dt;
    this.draw();
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

  dropDelay(row, col, count) {
    return Math.max(0, col * 62 + row * 24 + Math.max(0, count - 1) * 26);
  }

  cellOffset(row, col, rowStep) {
    const drop = this.fx.drop;
    if (!drop) return 0;
    const count = Number(drop.map?.[`${row}-${col}`] || 0);
    if (count <= 0) return 0;
    const delay = this.dropDelay(row, col, count);
    const progress = clamp((performance.now() - drop.start - delay) / drop.duration, 0, 1);
    const eased = easeOutBack(progress);
    const distance = count * rowStep * 1.2;
    return lerp(-distance, 0, eased);
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

    for (let c = 0; c < this.cols; c += 1) {
      const x = padX + laneW * (c + 0.5);
      const spineTop = top * 0.5;
      const spineBottom = top + rowStep * (this.rows - 0.1);

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
    const pulseGlow = this.fx.pulse ? Math.sin(pulse * Math.PI) : 0;
    const blast = this.fx.blast
      ? clamp((performance.now() - this.fx.blast.start) / this.fx.blast.duration, 0, 1)
      : 0;
    const multiCatch = this.fx.multiCatch
      ? clamp((performance.now() - this.fx.multiCatch.start) / this.fx.multiCatch.duration, 0, 1)
      : 0;
    const multiCatchPulse = this.fx.multiCatch ? Math.sin(multiCatch * Math.PI) : 0;
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
        const symbol = this.board.matrix?.[r]?.[c] || "BLUE_DIAMOND";
        const key = `${r}-${c}`;
        const x = padX + laneW * (c + 0.5);
        const yBase = top + rowStep * (r + 0.5);
        const isSlamColumn = Boolean(this.fx.reelSlam?.columns?.has(c));
        const slamOffset = isSlamColumn ? reelSlamWave * radius * 0.46 : 0;
        const y = yBase + this.cellOffset(r, c, rowStep) + slamOffset;
        const tone = symbolTone[symbol] || symbolTone.BLUE_DIAMOND;
        const isWinner = this.board.winningSet.has(key);
        const isBlast = this.fx.blast?.set?.has(key);
        const blastFade = isBlast ? 1 - blast : 1;
        const floatOffset = Math.sin(this.time * 0.0016 + r * 0.5 + c * 0.7) * radius * 0.05;
        const yFloat = y + floatOffset;
        const idlePulse = 1 + Math.sin(this.time * 0.0012 + r * 0.41 + c * 0.57) * 0.02;
        const pulseScale = isWinner ? 1 + pulseGlow * 0.08 : 1;
        const isMultiCaught = symbol === "MULTI" && Boolean(this.fx.multiCatch?.set?.has(key));
        const catchScale = isMultiCaught ? 1 + multiCatchPulse * 0.18 : 1;
        const ringR = radius * 1.16 * pulseScale * idlePulse;
        const coreR = radius * 0.92 * pulseScale * catchScale * idlePulse;

        ctx.fillStyle = "rgba(0, 0, 0, 0.34)";
        ctx.beginPath();
        ctx.ellipse(x, yFloat + ringR * 0.94, ringR * 0.86, ringR * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(214, 235, 255, 0.32)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(x, yFloat - radius * 1.72);
        ctx.lineTo(x, yFloat - radius * 1.06);
        ctx.stroke();

        if (isWinner) {
          const halo = ctx.createRadialGradient(x, yFloat, coreR * 0.34, x, yFloat, ringR * 1.52);
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

        const rimOuter = ctx.createRadialGradient(x, yFloat - coreR * 0.64, coreR * 0.08, x, yFloat, ringR * 1.03);
        rimOuter.addColorStop(0, "rgba(228, 241, 255, 0.66)");
        rimOuter.addColorStop(0.3, tone[0]);
        rimOuter.addColorStop(0.75, tone[1]);
        rimOuter.addColorStop(1, "rgba(10, 14, 26, 0.9)");
        const shell = rimOuter;
        ctx.fillStyle = shell;
        ctx.globalAlpha = blastFade;
        ctx.beginPath();
        ctx.arc(x, yFloat, ringR, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(206, 231, 255, 0.42)";
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.arc(x, yFloat, ringR * 0.96, 0, Math.PI * 2);
        ctx.stroke();

        const innerGlass = ctx.createRadialGradient(x, yFloat - coreR * 0.76, coreR * 0.18, x, yFloat, coreR * 1.18);
        innerGlass.addColorStop(0, "rgba(255, 255, 255, 0.22)");
        innerGlass.addColorStop(0.25, "rgba(20, 29, 48, 0.95)");
        innerGlass.addColorStop(1, "rgba(7, 11, 21, 0.99)");
        ctx.fillStyle = innerGlass;
        ctx.beginPath();
        ctx.arc(x, yFloat, coreR, 0, Math.PI * 2);
        ctx.fill();

        const sheen = ctx.createLinearGradient(x - coreR, yFloat - coreR, x + coreR, yFloat + coreR);
        sheen.addColorStop(0, "rgba(255,255,255,0.22)");
        sheen.addColorStop(0.35, "rgba(255,255,255,0.04)");
        sheen.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = sheen;
        ctx.beginPath();
        ctx.arc(x, yFloat, coreR * 0.98, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "rgba(200, 226, 255, 0.46)";
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.arc(x, yFloat, coreR * 0.96, 0, Math.PI * 2);
        ctx.stroke();

        const img = this.images.get(symbol);
        if (img?.complete && img.naturalWidth) {
          const size = coreR * 1.28;
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, yFloat, coreR * 0.84, 0, Math.PI * 2);
          ctx.clip();
          ctx.globalAlpha = blastFade;
          ctx.drawImage(img, x - size / 2, yFloat - size / 2, size, size);
          ctx.restore();
        } else {
          ctx.fillStyle = "rgba(255, 238, 200, 0.9)";
          ctx.font = `${Math.max(10, coreR * 0.22)}px Trebuchet MS, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(symbol.slice(0, 2), x, yFloat);
        }

        if (symbol === "TOP_CROWN" || symbol === "MULTI") {
          const crownGlow = ctx.createRadialGradient(x, yFloat - coreR * 0.36, 0, x, yFloat - coreR * 0.36, coreR * 0.75);
          crownGlow.addColorStop(0, "rgba(185, 218, 255, 0.26)");
          crownGlow.addColorStop(1, "rgba(185, 218, 255, 0)");
          ctx.fillStyle = crownGlow;
          ctx.beginPath();
          ctx.arc(x, yFloat - coreR * 0.22, coreR * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }

        if (symbol === "MULTI") {
          const valueNum = Number(this.board.multiMap.get(key) || 1);
          const value = `${valueNum}x`;
          const tier = getMultiplierTier(valueNum);

          const tierGlow = ctx.createRadialGradient(x, yFloat, coreR * 0.12, x, yFloat, coreR * 1.22);
          tierGlow.addColorStop(0, tier.glow);
          tierGlow.addColorStop(1, "rgba(0,0,0,0)");
          ctx.globalAlpha = 0.72;
          ctx.fillStyle = tierGlow;
          ctx.beginPath();
          ctx.arc(x, yFloat, coreR * 1.22, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;

          if (isMultiCaught) {
            for (let b = 0; b < 3; b += 1) {
              const beamWobble = Math.sin(this.time * 0.01 + b * 1.8) * coreR * 0.24;
              const beam = ctx.createLinearGradient(x + beamWobble, yFloat - coreR * 1.5, x, yFloat);
              beam.addColorStop(0, "rgba(230, 244, 255, 0)");
              beam.addColorStop(0.4, `${tier.accent}66`);
              beam.addColorStop(1, `${tier.accent}22`);
              ctx.strokeStyle = beam;
              ctx.lineWidth = Math.max(1.5, coreR * 0.06);
              ctx.beginPath();
              ctx.moveTo(x + beamWobble, yFloat - coreR * (1.8 + b * 0.2));
              ctx.lineTo(x, yFloat - coreR * 0.12);
              ctx.stroke();
            }
            ctx.strokeStyle = tier.accent;
            ctx.globalAlpha = 0.8 * (1 - multiCatch * 0.5);
            ctx.lineWidth = Math.max(1.8, coreR * 0.07);
            ctx.beginPath();
            ctx.arc(x, yFloat, ringR * (1.03 + multiCatch * 0.34), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }

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

    if (this.particles.length) {
      const now = performance.now();
      this.particles = this.particles.filter((p) => now - p.born < p.life);
      this.particles.forEach((p) => {
        const age = now - p.born;
        const t = clamp(age / p.life, 0, 1);
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.mode === "orb" ? 0.015 : 0.05;
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

const reelRenderer = new ReelCanvasRenderer(el.reels, { rowsCount: rows, colsCount: cols });

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
  if (el.simulateBonusBtn) el.simulateBonusBtn.disabled = disabled;
  el.betSelect.disabled = disabled;
  el.buyFreeBtn.disabled = disabled || Boolean(el.anteToggle.checked);
  el.anteToggle.disabled = disabled;
  setTestButtonsDisabled(disabled || state.bonusAutoplay || state.testBusy);
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
    if (action === "catch") {
      const matrix = createDemoMatrix();
      const multipliers = [
        { row: 1, col: 2, value: 10 },
        { row: 2, col: 3, value: 50 },
        { row: 4, col: 4, value: 250 }
      ];
      multipliers.forEach((m) => { matrix[m.row][m.col] = "MULTI"; });
      reelRenderer.setBoard(matrix, { multipliers });
      await reelRenderer.multiplierCatch(multipliers, 800);
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

function showWinCallout(amount, label = "Win", duration = 980) {
  if (!el.winCallout || !el.winCalloutAmount || !el.winCalloutLabel) return;
  if (state.calloutTimer) {
    clearTimeout(state.calloutTimer);
    state.calloutTimer = null;
  }
  el.winCalloutLabel.textContent = label;
  el.winCalloutAmount.textContent = fmt(amount);
  el.winCallout.classList.remove("hidden", "live-callout");
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
  const computedMultiCount = multipliersByPos.size;
  const computedMultiSum = Number(Array.from(multipliersByPos.values()).reduce((s, v) => s + v, 0).toFixed(2));
  const backendMultiCount = Number(payload.multipliers_count_sequence);
  const backendMultiSum = Number(payload.multipliers_sum_sequence);
  const multiCount = Number.isFinite(backendMultiCount) ? backendMultiCount : computedMultiCount;
  const multiSum = Number.isFinite(backendMultiSum) ? Number(backendMultiSum.toFixed(2)) : computedMultiSum;
  const rawWin = Number(
    tumbleSteps.reduce((sum, step) => sum + Number(step?.win_total || 0), 0).toFixed(2)
  );
  const applied = Number(payload.multiplier_applied || 1);
  const mode = payload.is_free_spin ? "bonus" : "base";
  return {
    id: crypto.randomUUID(),
    ts: Date.now(),
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
      li.innerHTML = `<strong>EVENT</strong> ${entry.text}`;
    } else {
      li.innerHTML = `<strong>#${entry.seq || "-"}</strong> ${entry.mode.toUpperCase()} | Bet ${fmt(entry.bet)} | Wins: ${entry.winsText} | Tumble: ${entry.tumbling ? `${entry.tumbleCount}x` : "no"} | Multi caught: ${entry.multiCount} (sum ${mfmt(entry.multiSum)}) | Applied: ${mfmt(entry.applied)} | ${fmt(entry.rawWin)} -> ${fmt(entry.totalWin)}`;
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

  pulseBanner(payload.is_free_spin ? "Free Spin" : "Spin Started", "info", 640);
  pushGameMessage(payload.is_free_spin ? "Free spin started." : `Spin started (bet ${fmt(bet)}).`, "info");
  await reelRenderer.intro(steps[0].matrix, steps[0].multipliers || []);

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (i > 0) {
      const prev = steps[i - 1];
      const prevWinning = Array.isArray(prev?.winning_positions) ? prev.winning_positions : [];
      const prevWinTotal = Number(prev?.win_total || 0);
      if (prevWinning.length > 0 && prevWinTotal > 0) {
        await sleep(140);
        const prevTier = winTier(prev?.ways_wins || [], bet);
        pulseBanner(`Tumble ${i}`, "win", 700);
        pushGameMessage(`Tumble ${i} triggered.`, "info");
        shakeVault(prevTier === "blast-great" ? "strong" : "normal");
        await reelRenderer.explode(prevWinning, 360, prevTier);
        const dropMap = buildDropMap(prev.matrix, prevWinning);
        await reelRenderer.drop(step.matrix, step.multipliers || [], dropMap, 980);
      }
    }
    const tier = winTier(step?.ways_wins || [], bet);
    const pulseDuration = tier === "blast-great" ? 540 : tier === "blast-medium" ? 480 : 420;
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
      showWinCallout(stepWin, label, tier === "blast-great" ? 1200 : 940);
      pulseBanner(`${label} ${fmt(stepWin)}`, "win", 900);
      pushGameMessage(`${label}: ${fmt(stepWin)} on step ${i + 1}.`, "win");
      if (tier !== "blast-small" || winX >= 40) shakeVault(tier === "blast-great" || winX >= 80 ? "strong" : "normal");
      if (winX >= 100) {
        await reelRenderer.jackpotFlash({
          duration: 640,
          colorA: "rgba(170, 225, 255, 0.40)",
          colorB: "rgba(255, 214, 136, 0.34)"
        });
        const winCols = Array.from(new Set((step.winning_positions || []).map((p) => Number(p.col)).filter(Number.isFinite)));
        await reelRenderer.reelSlam(winCols.length ? winCols : [Math.floor(cols / 2)], {
          duration: 760,
          force: 1.9,
          accent: "rgba(255, 221, 156, 0.5)"
        });
      }
      if (Array.isArray(step.multipliers) && step.multipliers.length) {
        await reelRenderer.multiplierCatch(step.multipliers, mTier === "epic" || mTier === "legendary" || mTier === "mythic" ? 820 : 460);
        if (mTier === "epic" || mTier === "legendary" || mTier === "mythic") {
          const colsHit = Array.from(new Set(step.multipliers.map((m) => Number(m.col)).filter(Number.isFinite)));
          const catchLabel = mTier === "mythic"
            ? `MYTHIC CATCH ${stepMaxMultiplier}x`
            : mTier === "legendary"
              ? `LEGENDARY CATCH ${stepMaxMultiplier}x`
              : `EPIC CATCH ${stepMaxMultiplier}x`;
          pulseBanner(catchLabel, "bonus", 1200);
          showWinCallout(stepMaxMultiplier, "Multiplier Catch", 1200);
          pushGameMessage(`${catchLabel} on step ${i + 1}.`, "bonus");
          shakeVault(mTier === "mythic" || mTier === "legendary" ? "strong" : "normal");
          await reelRenderer.jackpotFlash({
            duration: mTier === "mythic" ? 900 : 700,
            colorA: mTier === "mythic" ? "rgba(255, 165, 224, 0.46)" : "rgba(190, 214, 255, 0.34)",
            colorB: mTier === "mythic" ? "rgba(255, 232, 184, 0.38)" : "rgba(149, 190, 255, 0.26)"
          });
          await reelRenderer.reelSlam(colsHit.length ? colsHit : [Math.floor(cols / 2)], {
            duration: mTier === "mythic" ? 980 : 760,
            force: mTier === "mythic" ? 2.2 : mTier === "legendary" ? 1.8 : 1.45,
            accent: mTier === "mythic" ? "rgba(255, 170, 227, 0.52)" : "rgba(167, 214, 255, 0.44)"
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

  if (Number(payload.free_spins_awarded || 0) > 0) {
    pulseBanner(`Bonus Triggered: +${payload.free_spins_awarded} Free Spins`, "bonus", 1400);
    showWinCallout(payload.total_win || 0, "Bonus Trigger", 1400);
    pushGameMessage(`Bonus triggered: +${payload.free_spins_awarded} free spins.`, "bonus");
    shakeVault("strong");
  } else if (Number(payload.total_win || 0) <= 0) {
    pulseBanner("No Win", "info", 460);
    pushGameMessage("No win this spin.", "info");
  } else {
    pulseBanner(`Total Win ${fmt(payload.total_win || 0)}`, "win", 900);
    pushGameMessage(`Total spin win: ${fmt(payload.total_win || 0)}.`, "win");
  }

  el.balance.textContent = fmt(payload.balance_after || 0);
  el.lastWin.textContent = fmt(payload.total_win || 0);
  el.freeSpins.textContent = String(payload.free_spins_left || 0);
  el.activeMultiplier.textContent = mfmt(payload.is_free_spin ? payload.free_spin_multiplier_current : payload.multiplier_applied || 1);
  el.winningLines.textContent = String((payload.ways_wins || []).length);
  const finalStep = steps[steps.length - 1] || {};
  renderCaughtLines(payload.ways_wins || [], finalStep.multipliers || payload.multipliers || []);
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
    pulseBanner(state.bonusAutoplay ? "Auto Free Spin..." : "Invoking Spin...", "info", 560);
    const payload = await api("/api/v1/spin", {
      session_id: state.sessionId,
      spin_id: crypto.randomUUID(),
      bet_amount: bet,
      ante_enabled: Boolean(el.anteToggle.checked),
      force_multiplier_value: Number.isFinite(Number(state.forcedMultiplierLock))
        ? Number(state.forcedMultiplierLock)
        : undefined
    });
    await animateRound(payload, bet);
    if (Number(payload.free_spins_awarded || 0) > 0 && !payload.is_free_spin) {
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
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
      await sleep(120);
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
  setControls(true);
  try {
    const bet = Number(el.betSelect.value || 1);
    pulseBanner("Buying Free Spins...", "bonus", 900);
    const payload = await api("/api/v1/buy-free-spins", { session_id: state.sessionId, bet_amount: bet });
    pushGameMessage(`Bought free spins for ${fmt(payload.buy_cost || 0)}.`, "bonus");
    await animateRound(payload, bet, Number(payload.buy_cost || 0));
    if (Number(payload.free_spins_awarded || 0) > 0) {
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
  const streamUrl = `/api/v1/simulate/stream?steps=1000000&bet_amount=${encodeURIComponent(String(bet))}&ante_enabled=${encodeURIComponent(String(ante))}&game_id=${encodeURIComponent(String(state.gameId || "bananax"))}&bonus_only=${encodeURIComponent(String(Boolean(bonusOnly)))}`;
  const modeLabel = bonusOnly ? "1M bonus-round simulation" : "1M simulation";

  el.simProgressBar.style.width = "0%";
  el.simProgressLabel.textContent = "Starting...";
  el.simulateDump.textContent = `Running live stream (${modeLabel})...`;
  pushGameMessage(`${modeLabel} started.`, "info");
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
        pushGameMessage(`${modeLabel} complete (stream).`, "info");
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
    const report = await api("/api/v1/simulate", {
      steps: 1000000,
      bet_amount: bet,
      ante_enabled: ante,
      game_id: state.gameId || "bananax",
      bonus_only: Boolean(bonusOnly)
    });
    if (fallbackTicker) {
      clearInterval(fallbackTicker);
      fallbackTicker = null;
    }
    el.simProgressBar.style.width = "100%";
    el.simProgressLabel.textContent = "Completed (Fallback)";
    el.simulateDump.textContent = JSON.stringify(report, null, 2);
    pushGameMessage(`${modeLabel} complete (fallback).`, "info");
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
    const rules = await fetch(`/api/v1/game-rules?game_id=${encodeURIComponent(state.gameId || "bananax")}`).then((r) => r.json());
    state.rules = rules;
    el.lineCount.textContent = String(rules.layout?.pays || "symbols_pay_anywhere").replaceAll("_", " ");
    const allowed = rules.features?.multipliers?.allowed_values || [];
    renderMultiplierInfo(allowed);
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
  const payload = await api("/api/v1/session/init", { player_id: `player_${Date.now()}`, currency: "GEL", locale: "en", game_id: state.gameId });
  state.sessionId = payload.session_id;
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
  renderPaytable(1);
  pushGameMessage(`Session ${state.sessionId.slice(0, 8)} initialized.`, "info");
}

el.betSelect.addEventListener("change", () => {
  el.betView.textContent = fmt(el.betSelect.value);
  renderPaytable(Number(el.betSelect.value || 1));
});
el.spinBtn.addEventListener("click", spin);
el.buyFreeBtn.addEventListener("click", buyFreeSpins);
el.simulateBtn.addEventListener("click", () => runSimulation({ bonusOnly: false }));
if (el.simulateBonusBtn) el.simulateBonusBtn.addEventListener("click", () => runSimulation({ bonusOnly: true }));
if (el.testDropBtn) el.testDropBtn.addEventListener("click", () => runVisualTest("drop"));
if (el.testExplodeBtn) el.testExplodeBtn.addEventListener("click", () => runVisualTest("explode"));
if (el.testCatchBtn) el.testCatchBtn.addEventListener("click", () => runVisualTest("catch"));
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
