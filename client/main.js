const $ = (id) => document.getElementById(id);

// Public/admin mode — default is public (player view). Add `?admin=1` to the
// URL (or set window.__adminMode = true before scripts load) for the dev view.
// Never on a platform launch (`?lt=` or served under /play/): a real-money player
// gets no simulator or crazy-mode controls. The RGS would ignore them anyway (it
// resolves every round itself), but they have no business on a casino's page.
(() => {
  const params = new URLSearchParams(window.location.search);
  const onPlatform = params.has("lt") || /^\/play(\/|$)/.test(window.location.pathname);
  const isAdmin = !onPlatform && (params.has("admin") || Boolean(window.__adminMode));
  document.body.classList.add(isAdmin ? "admin-mode" : "public-mode");
})();

const el = {
  balance: $("balance"),
  betView: $("betView"),
  lastWin: $("lastWin"),
  betNode: $("betNode"),
  freeSpins: $("freeSpins"),
  freeSpinsNode: $("freeSpinsNode"),
  activeMultiplier: $("activeMultiplier"),
  activeMultiplierNode: $("activeMultiplierNode"),
  bonusMultiBadge: $("bonusMultiBadge"),
  bonusMultiBadgeValue: $("bonusMultiBadgeValue"),
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
  psMenuBtn: $("psMenuBtn"),
  psInfoBtn: $("psInfoBtn"),
  psInfoModal: $("psInfoModal"),
  frModal: $("frModal"),
  frCount: $("frCount"),
  frNoun: $("frNoun"),
  frBet: $("frBet"),
  frCurrency: $("frCurrency"),
  frMeta: $("frMeta"),
  frPlayBtn: $("frPlayBtn"),
  betReadoutLabel: $("betReadoutLabel"),
  psTicker: $("psTicker"),
  psTickerText: $("psTickerText"),
  symbolLegend: $("symbolLegend"),
  payoutRuleText: $("payoutRuleText"),
  multiplierInfo: $("multiplierInfo"),
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
  turboBtn: $("turboBtn"),
  soundToggle: $("soundToggle"),
  autoplayBtn: $("autoplayBtn"),
  autoplayPopover: $("autoplayPopover"),
  footerBalance: $("footerBalance"),
  footerBet: $("footerBet"),
  vaultWindow: document.querySelector(".vault-window")
};

const state = {
  sessionId: null,
  gameId: "bananax",
  rules: null,
  bonusAutoplay: false,
  simulationAbort: null,
  spinLog: [],
  activityLog: [],
  spinSeq: 0,
  bannerTimer: null,
  testBusy: false,
  forcedMultiplierLock: null,
  spinFlownSouls: new Set(),
  spinMultDisplay: 1,
  spinCelebratedMultis: new Set(),
  bonusMultiplierCarry: 0,
  roundAnimating: false,
  fastStopRequested: false,
  crazyMode: false,
  turbo: false,
  autoplayActive: false,
  // The embedding casino paused the game (embed-bridge "pause"): no new round may
  // start; a bonus waits before its next free spin. Cleared by "resume".
  embedPaused: false,
  // True while initSession applies the restored bet/ante, so that is not mistaken
  // for a player choice (see saveBetPref).
  restoringBet: false,
  // performance.now() when the last round (or autoplay run) fully settled.
  roundSettledAt: -Infinity,
  autoplayLeft: 0,
  autoplayInitial: 0
};

// Single lifecycle lock guarding the whole spin (dropOff → network → animation).
// Set the instant a spin is requested — before any await — so spamming the spin
// button can never start a second concurrent spin. See engine/spin-lock.js.
const spinLock = window.SlotEngine.SpinLock.createSpinLock();

const rows = 5;
const cols = 6;
// Symbol keys only (symbol list, art lookups). Displayed pays come from the
// rules file via paytableRows(), scaled like the engine scales them.
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

// All art is WebP, generated from the source PNGs by `npm run assets:optimize`
// (tools/optimize-assets.js). The PNGs stay in the repo as the authoring
// originals; only the .webp files are ever fetched by the game.
const symbolAssets = {
  TOP_CROWN: "assets/symbols/Crown.webp",
  HOURGLASS: "assets/symbols/HourGlass.webp",
  RING: "assets/symbols/Ring.webp",
  CHALICE: "assets/symbols/Chaile.webp",
  RED_GEM: "assets/symbols/RedGem.webp",
  PURPLE_TRIANGLE: "assets/symbols/PurpleGem.webp",
  YELLOW_HEX: "assets/symbols/YellowGem.webp",
  GREEN_TRIANGLE: "assets/symbols/GreenGem.webp",
  BLUE_DIAMOND: "assets/symbols/BlueGem.webp",
  // Multipliers have no art file: they are drawn in code (MULTI_EMBLEM).
  SCATTER: "assets/symbols/Scatter.webp"
};

// Art that is NOT drawn on the canvas: <img> buttons and CSS backgrounds. None
// of it used to be preloaded, so the free-spins panel and the active-ante plate
// were fetched at the moment they first appeared and painted in progressively
// mid-game. Routing them through the same loader as the symbols means the boot
// bar waits for them too and nothing is ever fetched after the game reveals.
//
// IMPORTANT: these strings must byte-match the URLs in index.html/styles.css,
// otherwise the browser treats them as different resources and the preload is
// wasted. See the note on <base href> in index.html.
const uiAssets = {
  UI_BACKGROUND: "assets/symbols/Background.webp",
  UI_FREESPINS_INFO: "assets/symbols/FREESPINS_INFO-removebg-preview.webp"
};

const stats = { spins: 0, wins: 0, losses: 0, wagered: 0, won: 0, maxWinX: 0, bonusHits: 0 };
const ANIMATION_TIMING = {
  // Pacing (#48; calmer pace 2026-10-08: players could not keep up). Every
  // value is a real-time ms budget before turbo (TURBO_SCALE); a Stop
  // collapses the one it lands in.
  spinBurst: 420,
  // GRAVITY (#47): every drop falls under the same gravity, so these three
  // are equal: the time a full-reel fall (5 rows) takes. Old board out, new
  // board in, tumble refills. Cascade momentum still quickens a chain.
  oldBoardDropOff: 480,
  introDrop: 480,
  tumbleDrop: 480,
  // The win beat: the caught cluster is held, glowing, with the rest of the
  // board stepped back (win focus) for 400-500ms, then it bursts, and the
  // refill falls in as soon as the burst's symbols are gone (BLAST_GONE),
  // under the still-flying shards. The opening catch gets the longer hold;
  // chained catches are snappier so a cascade accelerates.
  celebrateHoldFirst: 500,
  celebrateHoldChain: 400,
  explode: 460
};
// The burst's lead-in (#48): the winners "inhale" for charge[strength] ms
// before they pop, and on a great win pop in a sweep, burstStaggerMs apart.
const PACING = { charge: { small: 0, medium: 80, great: 150 }, burstStaggerMs: 6 };

// Reel release (#47). A reel's symbols are all released at the same moment and
// fall under one gravity (GRAVITY), so the reel falls as a stack: symbols that
// fall the same distance travel and land together, and on a tumble the lower
// ones (shorter falls) land first. Reels release left to right, ranked among
// the reels that actually drop: `spinColMs` apart on a spin (each old reel
// falls out and its new reel follows straight behind it) and `tumbleColMs`
// apart on a tumble refill. Turbo-scaled; cascade momentum tightens tumbles.
const WATERFALL = { spinColMs: 100, tumbleColMs: 40 };
// The reel mask. A symbol IN FLIGHT is clipped to the grid: entering from
// above, it is only visible below row 0's top edge; leaving on the spin-out,
// only above the last row's bottom edge. Symbol art is drawn larger than its
// cell (1.12×; a multiplier's emblem fits its cell), so a RESTING symbol overhangs its cell a little;
// over a symbol's last `settleRows` of travel the mask edge eases out to that
// overhang (and back in as it leaves), so the art is never cropped at rest
// and no edge pops. A symbol entering from above waits `spawnPad` rows higher
// than its slot (at least the largest overhang, (1.12 - 1) / 2), so not even
// its bottom edge is inside the grid before it is released.
const REEL_MASK = { spawnPad: 0.14, settleRows: 0.5 };
// Base autoplay: a fixed, NOT turbo-scaled gap between rounds, so the player can
// read each settled board even at full speed.
const AUTOPLAY_GAP_MS = 500;
const fmt = (v) => Number(v || 0).toFixed(2);
const mfmt = (v) => (Number.isInteger(Number(v || 0)) ? `${Number(v || 0)}x` : `${Number(v || 0).toFixed(1)}x`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Turbo (#48) compresses EVERY animated duration and hold to TURBO_SCALE: the
// spin-out, the drops (gravity scales with it, so the motion keeps its shape),
// explosions, tumbles, the celebration hold, multiplier catches and flashes all
// speed up together. 0.6 = about 1.7x the pace (2026-10-08: 0.45 was too fast
// to follow; the shapes and the order of events stay the same). Applied
// centrally inside the renderer animation methods + animationSleep. A Stop
// still wins: it slams the board in the air (FAST_ZIP).
const TURBO_SCALE = 0.6;
const turboScale = () => (state.turbo ? TURBO_SCALE : 1);
// Fast-stop / skip (Stop): the board in the air zips into place (FAST_ZIP);
// a board that starts falling while a Stop is pending is born zipping. Only
// under reduced motion does a drop run for FAST_STOP_DROP_MS (drawn landed).
const FAST_STOP_SETTLE_MS = 0;
// With skip now instant, a round can resolve ~200ms after the skip press, so a
// player hammering spin would start fresh PAID spins with taps meant as skips.
// A manual press this soon after a round settles is treated as a late skip and
// ignored. Autoplay is unaffected.
const SPIN_SETTLE_GUARD_MS = 250;
const FAST_STOP_DROP_MS = 1;
// For a duration ALREADY turbo-scaled (a renderer method scales its own, so
// its fx timing and its wait agree): waits it in real time; a Stop pressed
// before OR during it cuts it to ≤50ms. animationSleep on it would scale twice.
const holdReal = (ms) => new Promise((resolve) => {
  const t0 = performance.now();
  const tick = () => {
    const e = performance.now() - t0;
    if (e >= ms || (state.fastStopRequested && e >= Math.min(50, ms))) return resolve();
    setTimeout(tick, 16);
  };
  tick();
});
const animationSleep = (ms) =>
  sleep(state.fastStopRequested ? Math.min(50, ms) : Math.round(ms * turboScale()));
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

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
  const counting = end > start;
  while (true) {
    const t = clamp((performance.now() - t0) / span, 0, 1);
    const eased = 1 - (1 - t) ** 3;
    el.lastWin.textContent = fmt(lerp(start, end, eased));
    if (counting) window.Sound?.play("win_tick", { progress: t });
    if (t >= 1) break;
    await sleep(16);
  }
  el.lastWin.textContent = fmt(end);
}
const easeInCubic = (t) => t * t * t;
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

// ── Reel-drop physics (#22) ────────────────────────────────────────────────
// Gravity (#47). One constant gravity for every drop, solved in closed form
// (frame-rate independent; probes can sample it exactly). A drop's `duration`
// is the time a full-reel fall (`rows` rows) takes, so g = 2·rows / duration²
// and a fall of d rows takes duration·√(d / rows): s = ½·g·t² from rest.
// Landing is a real collision: the symbol hits its slot at v = g·t and
// rebounds at e·v (e = `restitution`), rising e²·d above the slot and falling
// back in 2e·t under the same gravity. One bounce, then it rests (the next
// would rise e⁴·d: under a pixel). So the moment of impact, as a fraction of
// a symbol's whole motion, is the same for every fall: contact = 1/(1 + 2e).
// squash: compression on impact for a full-reel fall, scaled by impact speed.
const GRAVITY = { restitution: 0.18, squash: 0.035 };
const REEL_PROFILE = Object.freeze({
  name: "gravity",
  contact: 1 / (1 + 2 * GRAVITY.restitution),
  bounce: GRAVITY.restitution * GRAVITY.restitution, // bounce height, as a fraction of the fall
  squash: GRAVITY.squash
});
// Reduced motion: the same fall, no bounce, no squash.
const REEL_PROFILE_RIGID = Object.freeze({ name: "rigid", contact: 1, bounce: 0, squash: 0 });
/** Fraction of its fall a dropping symbol has covered at t ∈ [0, 1] of its
 *  motion: (t / contact)² while it falls, then 1 − bounce·4u(1 − u) through
 *  the rebound (u ∈ [0, 1] over the bounce: a parabola, i.e. the same
 *  gravity), exactly 1 from t = 1. */
function dropTravel(t, prof) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  const c = prof.contact;
  if (t < c) {
    const u = t / c;
    return u * u;
  }
  const u = (t - c) / (1 - c);
  return 1 - prof.bounce * 4 * u * (1 - u);
}

// Cascade momentum: each tumble in a chain falls (and staggers) in `perStep`
// of the previous one's time, floored so long chains stay readable.
const TUMBLE_MOMENTUM = { perStep: 0.92, floor: 0.6 };
const tumbleTempo = (step) => Math.max(TUMBLE_MOMENTUM.floor, TUMBLE_MOMENTUM.perStep ** Math.max(0, step - 1));
// Fast-stop zip: every reel still moving zips from where it is into its slot,
// left to right, the k-th moving reel locking at firstMs + k·colMs (≤ 110ms
// for six), then a double latch-click (clickGapMs apart) seals the board.
const FAST_ZIP = { firstMs: 30, colMs: 16, clickGapMs: 50 };
// A fast-stop during the spin-out runs the old board's fall this much faster.
const EXIT_FAST = 6;

// Symbol shatter (win explosions). Counts are per cell, before the quality
// tier's fxCount scaling; up is the upward kick and flash the cell flare size,
// both in cell sizes; gravity is in cell sizes per ms².
const SHATTER = {
  small:  { gems: 6,  gold: 2, steel: 1, sparks: 4, up: 0.0016, flash: 1.3 },
  medium: { gems: 9,  gold: 3, steel: 2, sparks: 6, up: 0.002,  flash: 1.5 },
  great:  { gems: 13, gold: 5, steel: 3, sparks: 9, up: 0.0026, flash: 1.8 },
  gravity: 0.000012
};
// Cluster blast (#54). A cluster of `minCells`+ symbols does not just fade:
//   pop:  each blasting symbol scales up by `pop` (uniform, never squashed)
//         as it fades, so it bursts outward instead of dissolving.
//   wave: a shockwave leaves the cluster's centre and travels `reach` cells
//         past its farthest symbol in `waveMs` (easeOutCubic, turbo-scaled).
//         As the front passes a symbol it lights it (additive glow, peak
//         `glow`, a Gaussian band `band` cells wide). Light only: nothing
//         moves, the board never shakes.
//   dust: `dust[strength]` soft puffs (before fxCount) radiate from the
//         centre at `dustSpeed` cells/ms, brake hard (drag) and grow as they
//         thin out. Pooled on the ShardEmitter, at most `maxDust` alive.
// The share of a symbol's burst after which its art is gone (#50). explode()
// resolves right then, so a tumble refill falls ~115ms after the pop, under the
// still-flying shards. Nothing on the board moves in between: no neighbour
// lean or shake (user rule).
const BLAST_GONE = 0.25;
const CLUSTER_BLAST = {
  minCells: 8, pop: 0.14, waveMs: 520, reach: 1.6, band: 0.45, glow: 0.42,
  dust: { small: 10, medium: 16, great: 26 }, dustSpeed: [0.003, 0.007], maxDust: 256
};

// Reel anticipation (Step 5b). When the columns that have already landed show
// one scatter short of the trigger, every later column waits (holdMs each,
// stacking left to right) and falls slower (slowFall ×). Turbo-scaled; a
// fast-stop cancels it.
const ANTICIPATION = { holdMs: 650, slowFall: 1.6 };

// Pure function of the board: columns land left to right, so scan them in that
// order and find the first column after which the scatters on screen are one
// short of the trigger. Every board is RNG-natural (the engine fabricates no
// near-misses), so anticipation always reflects a real chance.
function findAnticipation(matrix, triggerCount, scatter = "SCATTER") {
  const cols = matrix?.[0]?.length || 0;
  let seen = 0;
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < matrix.length; r++) if (matrix[r]?.[c] === scatter) seen++;
    if (seen >= triggerCount) return null;                 // already triggered: nothing to tease
    if (seen === triggerCount - 1 && c < cols - 1) return { fromCol: c + 1 };
  }
  return null;
}

// Symbol motion feel (Step 4). Amplitudes are fractions of the symbol's size.
// Reduced-motion zeroes the movement ones (see ReelCanvasRenderer.motion()).
const MOTION = {
  squashRelax: 0.45,  // an impact squash springs back over this much of the bounce (GRAVITY)
  squash: 1,          // gain on the impact squash (GRAVITY.squash)
  breathBase: 0.03,   // winning symbols' resting swell during the hold (scale-up ≈ 3%)
  breathDepth: 0.02,  // extra swell at the top of each breath: peak 1.05, a micro-lift, not a bounce
  breathMs: 1100,     // one breath (in + out)
  breathRipple: 0.9   // phase lag, in half-breaths, from cluster centre to edge
};
// A multiplier's landing punch: swells by `scale` and settles over `ms`
// (sin arc: never below 1, never transparent). Its art is visible the whole
// fall: no decoy, no hide-and-pop (user: symbols must never vanish).
const MULTI_PUNCH = { scale: 0.08, ms: 200 };
// Multiplier strike (user, 2026-10-08: the player must not know a multiplier
// is coming, and it should arrive like a lightning strike). Every board lands
// FULL: a new multiplier falls in its reel's stack as a stand-in symbol (one
// that can never form or suggest a win, see pickStandIn). Once the whole drop
// has landed, after beatMs, lightning strikes the cell: a short crackle at
// the top of its lane (flickerMs), the bolt, and a white-gold flash; at the
// flash's peak (flashPeakMs) the art turns into the multiplier (always at
// full opacity), which then punches and BANGs. Several strike left to right,
// gapMs apart. Turbo-scaled; a Stop strikes at once (stopMs per strike).
const STRIKE = { beatMs: 140, gapMs: 160, flickerMs: 60, flashPeakMs: 90, flashMs: 220, stopMs: 120, flash: "#fff4c8" };
const MOTION_REDUCED = Object.freeze({ ...MOTION, squash: 0, breathDepth: 0, breathRipple: 0 });

// Win focus (#55). From the moment a cluster is caught until the board moves
// again, every symbol outside it is drawn at 1 − `dim` opacity and the board's
// backdrop darkens by `backdrop`, so the winners and their aura are the
// brightest thing on screen. Fades in over inMs, out over outMs (both
// easeInOutCubic, turbo-scaled) from wherever it is. One fillRect plus each
// symbol's own globalAlpha: no extra layers, no filters.
const FOCUS = { dim: 0.4, backdrop: 0.32, inMs: 250, outMs: 260 };

// A resting board is perfectly still: no idle float, bob or scale wobble on
// any symbol (user rule 2026-10-08: idle motion looked bad on phones).

// A time-based 0..1 envelope ({ from, to, t0, ms }) that can be retargeted at
// any moment and always continues from where it is (no jumps).
const makeEnvelope = () => ({ from: 0, to: 0, t0: 0, ms: 0 });
function envelopeLevel(e, now) {
  const u = e.ms > 0 ? clamp((now - e.t0) / e.ms, 0, 1) : 1;
  return lerp(e.from, e.to, easeInOutCubic(u));
}
function envelopeTo(e, to, ms, now) {
  if (e.to === to) return;
  e.from = envelopeLevel(e, now);
  e.to = to;
  e.t0 = now;
  e.ms = ms;
}

// Symbol sprite cache band (see getSymbolSprite): reuse a bake while the wanted
// size is within [min, max] of it; new bakes are made at headroom × wanted.
// max 1.6 covers the 20% landing squash (bake 1.2x / wanted 0.8x = 1.5x) with
// room to spare; at 1.5 every landing symbol sat on the edge and rebaked.
const SPRITE_BAND = { min: 0.75, max: 1.6, headroom: 1.2 };

function setSigned(target, value) {
  target.classList.remove("positive", "negative");
  if (value > 0) target.classList.add("positive");
  if (value < 0) target.classList.add("negative");
}

// ─── THEME ──────────────────────────────────────────────────────────────────
// Canvas mirror of the design tokens in styles.css (:root). CSS is the source
// of truth: every value below is READ from the computed tokens at boot, and the
// literals are only fallbacks for a stylesheet that failed to load. A palette
// change is therefore a one-line CSS edit and the canvas follows automatically.
// main.js is a parser-blocking script placed after the stylesheet, so the
// tokens are resolved by the time this runs.
// Purely presentational: nothing here touches SlotEngine or its RNG.
const THEME = (() => {
  const css = getComputedStyle(document.documentElement);
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const tok = (name, fallback) => {
    const v = css.getPropertyValue(name).trim();
    if (HEX6.test(v)) return v.toLowerCase();
    if (v) console.warn(`[THEME] ${name} must be #rrggbb, got "${v}"; using fallback`);
    return fallback;
  };
  const str = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  // #rrggbb + alpha → rgba(). The only way canvas code should make a translucent
  // colour, so every alpha variant stays tied to a token.
  const alpha = (hex, a) => {
    const n = parseInt(String(hex).slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  };
  const deepFreeze = (o) => {
    Object.values(o).forEach((v) => { if (v && typeof v === "object") deepFreeze(v); });
    return Object.freeze(o);
  };

  const c = {
    vaultDoor:     tok("--bg-vault-door",     "#07080a"),
    gunmetal:      tok("--bg-gunmetal",       "#111418"),
    panel:         tok("--bg-panel",          "#191d22"),
    panelRaised:   tok("--bg-panel-raised",   "#22272e"),
    steelEdge:     tok("--steel-edge",        "#3a414a"),
    steelBrushed:  tok("--steel-brushed",     "#6b7480"),
    steelSheen:    tok("--steel-sheen",       "#b7bfc9"),
    tungsten:      tok("--tungsten",          "#ffb86b"),
    tungstenSoft:  tok("--tungsten-soft",     "#ffd9a8"),
    laser:         tok("--accent-laser",      "#ff2a3a"),
    laserDeep:     tok("--accent-laser-deep", "#a30a16"),
    laserHot:      tok("--accent-laser-hot",  "#ff7a84"),
    gold:          tok("--win-gold",          "#f2c14e"),
    goldBright:    tok("--win-gold-bright",   "#ffe7a3"),
    goldDeep:      tok("--win-gold-deep",     "#9c6b12"),
    textHud:       tok("--text-hud",          "#eef1f4"),
    textMuted:     tok("--text-muted",        "#8e98a4"),
    textDim:       tok("--text-dim",          "#5a636e"),
    signalOk:      tok("--signal-ok",         "#3fd68a"),
    signalWarn:    tok("--signal-warn",       "#ffb020")
  };

  const multTier = (name, fallback, glowA) => {
    const accent = tok(name, fallback);
    return { accent, glow: alpha(accent, glowA) };
  };

  const font = {
    ui:      str("--font-ui", 'system-ui, "Segoe UI", sans-serif'),
    display: str("--font-display", '"Arial Narrow", Impact, sans-serif')
  };

  return deepFreeze({
    color: c,
    font,
    alpha,
    /** ctx.font string: THEME.canvasFont(700, 24) → display face; pass font.ui for body text. */
    canvasFont: (weight, px, family = font.display) => `${weight} ${Math.round(px)}px ${family}`,

    // Ambient stage behind the board (draw()). Hex bases; draw() applies the
    // animated alpha via THEME.alpha so the gradient memo keys stay stable.
    stage: {
      fogCore:   alpha(c.tungsten, 0.16),   // warm lamp pool, top-centre
      fogMid:    alpha(c.laserDeep, 0.07),  // faint red security spill
      fogEdge:   "rgba(0, 0, 0, 0)",
      meshA:     c.steelSheen,              // + idle-wave alpha
      meshMid:   alpha(c.steelEdge, 0.02),
      meshB:     c.laserDeep,               // + idle-wave alpha
      spinFlash: c.tungsten,                // + burst alpha
      vignette:  alpha(c.vaultDoor, 0.85),
      cellWell:  alpha(c.gunmetal, 0.72),
      cellEdge:  alpha(c.steelSheen, 0.10),
      gridDot:   alpha(c.steelSheen, 0.22),   // frameless board: where four cells meet
      gridTick:  alpha(c.steelSheen, 0.08)    // the faint cross arms around each dot
    },

    // Win aura behind a winning symbol, by symbol (getGlowSprite #rrggbb). Scatter
    // keeps the laser, multipliers the bright gold; anything unlisted: win gold.
    aura: {
      TOP_CROWN:       tok("--aura-crown",     "#ffc94a"),
      HOURGLASS:       tok("--aura-hourglass", "#3fe0b5"),
      RING:            tok("--aura-ring",      "#ffb86b"),
      CHALICE:         tok("--aura-chalice",   "#e070ff"),
      RED_GEM:         tok("--aura-red",       "#ff4d5e"),
      PURPLE_TRIANGLE: tok("--aura-purple",    "#a66bff"),
      YELLOW_HEX:      tok("--aura-yellow",    "#ffd23f"),
      GREEN_TRIANGLE:  tok("--aura-green",     "#3fe07a"),
      BLUE_DIAMOND:    tok("--aura-blue",      "#4fd8ff"),
      SCATTER:         c.laser,
      MULTI:           c.goldBright
    },

    // Glow-sprite colours (getGlowSprite takes #rrggbb and adds its own alpha).
    glow: {
      win:     c.gold,
      winHot:  c.goldBright,
      scatter: c.laser,
      laser:   c.laser,
      steel:   c.steelSheen
    },

    // Particle palettes: picked with Math.random() — never SlotEngine.RNG.
    particles: {
      breach: [c.laserHot, c.tungsten, c.tungstenSoft, "#ffffff"], // tumble "breach" burst
      sparks: [c.tungstenSoft, c.goldBright, "#ffffff"],           // metal-on-metal impact
      gold:   [c.gold, c.goldBright, c.goldDeep],                   // win fountains
      dust:   c.steelBrushed                                        // landing dust
    },

    // Win-figure text rendered on canvas.
    text: {
      winFill:      c.gold,
      winHighlight: c.goldBright,
      winStroke:    c.goldDeep,
      winShadow:    alpha(c.vaultDoor, 0.85),
      label:        c.textHud,
      labelMuted:   c.textMuted
    },

    // Per-symbol [light, deep] glow pair, same keys and shape as the old
    // symbolTone. Premiums read warm (gold/tungsten); gems keep their hue
    // identity (players tell symbols apart by colour first) but in a colder,
    // steel-desaturated key; scatter owns the laser red.
    symbolGlow: {
      TOP_CROWN:       [c.goldBright, c.gold],
      HOURGLASS:       [c.tungstenSoft, c.tungsten],
      RING:            [c.goldBright, c.goldDeep],
      CHALICE:         [c.tungstenSoft, c.goldDeep],
      RED_GEM:         ["#ff9aa2", "#c4202f"],
      PURPLE_TRIANGLE: ["#c9b8f0", "#6c4fc4"],
      YELLOW_HEX:      ["#fff0b8", "#c99a1a"],
      GREEN_TRIANGLE:  ["#a8f0cf", "#1f9a6e"],
      BLUE_DIAMOND:    ["#a9dcf7", "#2a77c4"],
      MULTI:           [c.textHud, c.steelSheen],
      SCATTER:         [c.laserHot, c.laser]
    },

    // Multiplier rarity, cold → hot. Shape matches MULTIPLIER_TIER_DEFS.
    multiplier: {
      common:    multTier("--mult-common",    "#9aa8b6", 0.50),
      rare:      multTier("--mult-rare",      "#4fc3f7", 0.52),
      epic:      multTier("--mult-epic",      "#ff7a2b", 0.56),
      legendary: multTier("--mult-legendary", "#f2c14e", 0.62),
      mythic:    multTier("--mult-mythic",    "#ff2a3a", 0.66)
    },

    // Win-tier colours, consumed by WIN_TIERS.
    winTier: {
      nice: tok("--tier-nice", "#b7bfc9"),
      big:  tok("--tier-big",  "#f2c14e"),
      mega: tok("--tier-mega", "#ff2a3a"),
      epic: tok("--tier-epic", "#ffe7a3"),
      max:  tok("--tier-max",  "#ffffff")
    },

    // Resolves when both faces are usable. The boot loader waits on it so
    // canvas text never paints in a fallback font and then swaps.
    fontsReady: document.fonts
      ? Promise.all([
          document.fonts.load(`600 16px ${font.ui}`),
          document.fonts.load(`700 16px ${font.display}`)
        ]).then(() => undefined, () => undefined)
      : Promise.resolve()
  });
})();

const symbolTone = THEME.symbolGlow;

const MULTIPLIER_TIER_DEFS = [
  { key: "common", label: "Common", values: [2, 3, 4, 5, 6, 8], ...THEME.multiplier.common },
  { key: "rare", label: "Rare", values: [10, 12, 15, 20, 25], ...THEME.multiplier.rare },
  { key: "epic", label: "Epic", values: [50], ...THEME.multiplier.epic },
  { key: "legendary", label: "Legendary", values: [100, 250, 500], ...THEME.multiplier.legendary },
  { key: "mythic", label: "Mythic", values: [1000], ...THEME.multiplier.mythic }
];

const MULTIPLIER_TIER_BY_VALUE = new Map(
  MULTIPLIER_TIER_DEFS.flatMap((tier) => tier.values.map((v) => [v, tier]))
);
const TEST_MULTIPLIERS = MULTIPLIER_TIER_DEFS.flatMap((tier) => tier.values);

function getMultiplierTier(value) {
  return MULTIPLIER_TIER_BY_VALUE.get(Number(value)) || MULTIPLIER_TIER_DEFS[0];
}

// The multiplier emblem (user, 2026-10-09): a WINGED SUN DISC, drawn as
// vectors in code, not a coin. A silhouette no other symbol has (two spread
// wings), sized to its cell (boxW × boxH of the lane/row; no per-value
// scale), and the number is the hero: as large as fits over the disc (the
// text box may cover the rim), with a smaller "x". Tiers share the shape
// and differ in metal, feathers, rays and extras. One table, so a second
// game re-skins it by values; baked per value + size (multiplierSprite), so
// drawing one is a single drawImage. Static: the board is still at rest.
const MULTI_EMBLEM = {
  boxW: 0.98, boxH: 0.92,     // the emblem's box, fractions of the cell
  discR: 0.31,                // disc radius, fraction of min(box w, h)
  rays: { inner: 0.96, long: 1.26, short: 1.12 },
  text: { w: 1.02, cap: 0.66, x: 0.6 }, // text box (× disc diameter), "x" size (× number)
  outline: "#120a04",
  tiers: {
    common:    { metal: ["#ffd9b0", "#c07a43", "#5a2f12"], face: ["#fff0dc", "#d79a62", "#7a4219"], text: "#ffe3c4", feathers: 5, rays: 16 },
    rare:      { metal: ["#f2fbff", "#8fb9d4", "#24435a"], face: ["#f6fcff", "#86cdf2", "#1b5a85"], text: "#d8f3ff", feathers: 6, rays: 18, glow: "#4fc3f7" },
    epic:      { metal: ["#ffe6cc", "#ff8a3d", "#6e2405"], face: ["#fff2e2", "#ffa45e", "#8a3104"], text: "#ffe0c0", feathers: 7, rays: 20, glow: "#ff7a2b" },
    legendary: { metal: ["#fff7cf", "#f2c14e", "#6f4a0b"], face: ["#fffbe8", "#f7d77a", "#8a6212"], text: "#fff2b8", feathers: 8, rays: 22, glow: "#f2c14e", flames: true },
    mythic:    { metal: ["#ffe3f1", "#ff4d6d", "#4f0819"], face: ["#fff2f8", "#ff7aa8", "#6e0d33"], text: "#ffd6e6", feathers: 9, rays: 24, glow: "#ff2a3a", flames: true, prism: true }
  }
};

/** Draw the winged sun disc for multiplier `value` into a W×H box on `ctx`
 *  (CSS px, origin top-left). Pure: no renderer state. */
function drawWingedSun(ctx, W, H, tierKey, value) {
  const E = MULTI_EMBLEM;
  const T = E.tiers[tierKey] || E.tiers.common;
  const cx = W / 2;
  const cy = H * 0.5;
  const R = Math.min(W, H) * E.discR;
  const edge = Math.max(0.8, R * 0.035);
  const metal = (y0, y1) => {
    const g = ctx.createLinearGradient(0, y0, 0, y1);
    g.addColorStop(0, T.metal[0]);
    g.addColorStop(0.55, T.metal[1]);
    g.addColorStop(1, T.metal[2]);
    return g;
  };
  ctx.save();
  ctx.lineJoin = "round";

  // Wings: layered feathers each side, behind everything. The top feather
  // reaches furthest and curls up; lower ones are shorter and droop.
  const n = T.feathers;
  const reach = W * 0.49 - R * 0.5; // horizontal room from the root to the box edge
  for (const side of [-1, 1]) {
    for (let i = n - 1; i >= 0; i -= 1) {
      const k = n > 1 ? i / (n - 1) : 0; // 0 = top feather, 1 = bottom
      const ang = (-18 + 52 * k) * Math.PI / 180;
      const rootX = cx + side * R * 0.5;
      const rootY = cy - R * 0.42 + R * 0.84 * k;
      const len = reach * (1 - 0.45 * k);
      const tipX = rootX + side * len;
      const tipY = clamp(rootY + Math.tan(ang) * len - (1 - k) * R * 0.28, H * 0.05, H * 0.95);
      const wRoot = R * (0.36 - 0.12 * k);
      const mx = (rootX + tipX) / 2;
      const my = (rootY + tipY) / 2;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY - wRoot / 2);
      ctx.quadraticCurveTo(mx, my - wRoot * 0.95, tipX, tipY);
      ctx.quadraticCurveTo(mx + side * len * 0.05, my + wRoot * 0.55, rootX, rootY + wRoot / 2);
      ctx.closePath();
      ctx.fillStyle = metal(rootY - R * 0.6, rootY + R * 0.6);
      ctx.fill();
      ctx.strokeStyle = "rgba(18, 10, 4, 0.6)";
      ctx.lineWidth = edge;
      ctx.stroke();
      // The feather's vein: a thin highlight from the root toward the tip.
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(mx, my - wRoot * 0.25, rootX + (tipX - rootX) * 0.85, rootY + (tipY - rootY) * 0.85);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = Math.max(0.6, R * 0.02);
      ctx.stroke();
    }
  }

  // Sun rays around the disc: alternating long and short points. Top tiers
  // turn the long rays into (static) flames.
  for (let j = 0; j < T.rays; j += 1) {
    const a = (j / T.rays) * Math.PI * 2 - Math.PI / 2;
    const long = j % 2 === 0;
    const out = R * (long ? E.rays.long : E.rays.short);
    const half = (Math.PI / T.rays) * 0.85;
    const bx1 = cx + Math.cos(a - half) * R * E.rays.inner;
    const by1 = cy + Math.sin(a - half) * R * E.rays.inner;
    const bx2 = cx + Math.cos(a + half) * R * E.rays.inner;
    const by2 = cy + Math.sin(a + half) * R * E.rays.inner;
    const tx = cx + Math.cos(a) * out;
    const ty = cy + Math.sin(a) * out;
    ctx.beginPath();
    ctx.moveTo(bx1, by1);
    if (T.flames && long) {
      // A flame: the tip leans a little and the sides bow out.
      const lean = Math.cos(a) * R * 0.06;
      ctx.quadraticCurveTo(cx + Math.cos(a - half * 0.6) * out * 0.9 - lean, cy + Math.sin(a - half * 0.6) * out * 0.9, tx + lean, ty);
      ctx.quadraticCurveTo(cx + Math.cos(a + half * 0.6) * out * 0.9 - lean, cy + Math.sin(a + half * 0.6) * out * 0.9, bx2, by2);
      const g = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, out);
      g.addColorStop(0, "#ff7a1a");
      g.addColorStop(0.6, "#ffc23a");
      g.addColorStop(1, "#fff4b0");
      ctx.fillStyle = g;
    } else {
      ctx.lineTo(tx, ty);
      ctx.lineTo(bx2, by2);
      ctx.fillStyle = metal(cy - out, cy + out);
    }
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "rgba(18, 10, 4, 0.45)";
    ctx.lineWidth = edge * 0.8;
    ctx.stroke();
  }

  // The disc: a metal rim (a prism ring on mythic), then the bevelled face.
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  if (T.prism && typeof ctx.createConicGradient === "function") {
    const g = ctx.createConicGradient(0, cx, cy);
    ["#ff5b8a", "#ffb84a", "#fff07a", "#7dffb0", "#6ad5ff", "#b98bff", "#ff5b8a"].forEach((col, i, arr) => g.addColorStop(i / (arr.length - 1), col));
    ctx.fillStyle = g;
  } else {
    const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
    g.addColorStop(0, T.metal[0]);
    g.addColorStop(0.6, T.metal[1]);
    g.addColorStop(1, T.metal[2]);
    ctx.fillStyle = g;
  }
  ctx.fill();
  ctx.strokeStyle = "rgba(18, 10, 4, 0.75)";
  ctx.lineWidth = edge * 1.4;
  ctx.stroke();
  const faceR = R * 0.84;
  ctx.beginPath();
  ctx.arc(cx, cy, faceR, 0, Math.PI * 2);
  const face = ctx.createRadialGradient(cx - faceR * 0.35, cy - faceR * 0.45, faceR * 0.05, cx, cy, faceR);
  face.addColorStop(0, T.face[0]);
  face.addColorStop(0.55, T.face[1]);
  face.addColorStop(1, T.face[2]);
  ctx.fillStyle = face;
  ctx.fill();
  ctx.strokeStyle = "rgba(18, 10, 4, 0.5)";
  ctx.lineWidth = edge;
  ctx.stroke();
  if (T.glow) {
    ctx.beginPath();
    ctx.arc(cx, cy, faceR * 0.97, 0, Math.PI * 2);
    ctx.strokeStyle = T.glow;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(1, R * 0.06);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Bevel highlight across the top-left of the face.
  ctx.beginPath();
  ctx.arc(cx, cy, faceR * 0.86, Math.PI * 1.05, Math.PI * 1.55);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.45)";
  ctx.lineWidth = Math.max(1, R * 0.05);
  ctx.lineCap = "round";
  ctx.stroke();

  // The number: as large as the text box allows (it may cover the rim),
  // a smaller "x", a light gradient fill, a heavy dark outline.
  const num = String(value);
  const fit = (size) => {
    ctx.font = THEME.canvasFont(700, size);
    const m = ctx.measureText(num);
    ctx.font = THEME.canvasFont(700, size * E.text.x);
    const mx = ctx.measureText("x");
    const cap = (m.actualBoundingBoxAscent || size * 0.72);
    return { w: m.width + mx.width * 0.92, cap, numW: m.width };
  };
  const boxW = 2 * R * E.text.w;
  const boxCap = 2 * R * E.text.cap;
  let size = R * 2;
  let mt = fit(size);
  size *= Math.min(boxW / mt.w, boxCap / mt.cap);
  mt = fit(size);
  const left = cx - mt.w / 2;
  const base = cy + mt.cap / 2;
  const fill = ctx.createLinearGradient(0, base - mt.cap, 0, base);
  fill.addColorStop(0, "#ffffff");
  fill.addColorStop(1, T.text);
  ctx.lineJoin = "round";
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.shadowColor = "rgba(0, 0, 0, 0.45)";
  ctx.shadowBlur = size * 0.12;
  ctx.shadowOffsetY = size * 0.04;
  ctx.strokeStyle = E.outline;
  ctx.lineWidth = Math.max(2, size * 0.16);
  ctx.font = THEME.canvasFont(700, size);
  ctx.strokeText(num, left, base);
  ctx.font = THEME.canvasFont(700, size * E.text.x);
  ctx.strokeText("x", left + mt.numW + size * 0.02, base);
  ctx.shadowColor = "transparent";
  ctx.fillStyle = fill;
  ctx.font = THEME.canvasFont(700, size);
  ctx.fillText(num, left, base);
  ctx.font = THEME.canvasFont(700, size * E.text.x);
  ctx.fillText("x", left + mt.numW + size * 0.02, base);
  ctx.restore();
  return { capPx: mt.cap, size };
}

// True when the player has asked the OS to minimise motion. Re-read live so a
// settings change mid-session is respected. Used to calm screen shake / flashes
// and to thin out particle bursts for comfort + battery.
const prefersReducedMotion = () =>
  Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

// Quality tiers. "high" is the full desktop experience; "mid"/"low" progressively
// trade visual richness for framerate on weaker hardware. Each tier maps to the
// three knobs that actually move the needle: backing-store resolution (maxDpr),
// a ceiling on particle density (fxCeil), and how hard idle frames are throttled.
// Quality tiers. "high" is the full desktop experience; "mid"/"low" progressively
// trade visual richness for framerate on weaker hardware. Four knobs:
//   maxDpr         — backing-store resolution cap (fill rate).
//   fxCeil         — ceiling on particle density.
//   idleThrottleMs — minimum gap between frames when nothing is animating.
//   maxFrameMs     — minimum gap between frames when something IS animating.
// idleThrottleMs is non-zero on every tier: a resting board is still (only
// lingering fades and ambient light change), so a full redraw at 60fps would be
// wasted heat on phones. A drop counts as busy until its last symbol has
// landed (fx.drop.endAt), so no fall is ever drawn at the idle rate.
const TIER_PROFILES = {
  // Throttles sit just BELOW a whole number of 60Hz frames (16.7ms each), so
  // they land on every Nth vsync: 30 → every 2nd (30fps), 45 → every 3rd
  // (20fps), 62 → every 4th (15fps). They used to sit exactly ON the boundary
  // (33 vs 33.3, 50 vs 50.0), so ordinary vsync jitter made frames skip one
  // more vsync: phones measured ~24fps while spinning instead of 30.
  low:  { maxDpr: 1,   fxCeil: 0.5, idleThrottleMs: 62, maxFrameMs: 30 },
  mid:  { maxDpr: 1.5, fxCeil: 0.8, idleThrottleMs: 45, maxFrameMs: 30 },
  high: { maxDpr: 2,   fxCeil: 1,   idleThrottleMs: 45, maxFrameMs: 0  }
};
const TIER_RANK = { low: 0, mid: 1, high: 2 };

// True on phones/tablets: a coarse primary pointer with no hover is the reliable
// signal, with touch-point count and viewport size as corroboration for browsers
// that report the media queries oddly. Deliberately NOT user-agent sniffing.
function isHandheld() {
  const mm = window.matchMedia;
  const coarse = Boolean(mm && mm("(pointer: coarse)").matches);
  const noHover = Boolean(mm && mm("(hover: none)").matches);
  const touch = Number(navigator.maxTouchPoints) > 0;
  const smallScreen = Math.min(window.screen?.width || 0, window.screen?.height || 0) <= 900;
  return (coarse && noHover) || (touch && smallScreen);
}

// Coarse device-capability guess, used only as the STARTING tier. The runtime FPS
// governor (see ReelCanvasRenderer.monitorPerformance) can drop it further if real
// frames come in slow, but never raises it above this — so a phone that lies about
// its specs still gets throttled by measured performance. `deviceMemory` and
// `connection` are Chromium-only; unknown values assume a capable mid device.
// QA/testing override: `?perf=low|mid|high` forces a tier and is remembered in
// localStorage (so it survives the launch-token redirect into /play). `?perf=auto`
// clears it. Lets us exercise every device configuration without the hardware.
function tierOverride() {
  let forced = null;
  try {
    const q = new URLSearchParams(window.location.search).get("perf");
    if (q) {
      if (q === "auto") localStorage.removeItem("perfTier");
      else if (TIER_PROFILES[q]) localStorage.setItem("perfTier", q);
    }
    forced = localStorage.getItem("perfTier");
  } catch (_) { /* private mode / no storage — fall through to auto-detect */ }
  return TIER_PROFILES[forced] ? forced : null;
}

function detectDeviceTier() {
  const forced = tierOverride();
  if (forced) return forced;   // QA override wins over every heuristic below.
  const nav = window.navigator || {};
  // NaN when the API isn't exposed (deviceMemory is Chromium-only). We compare
  // with <= so an *absent* signal never demotes — NaN <= n is always false — which
  // keeps Safari/Firefox at high and lets the FPS governor demote if truly needed.
  const mem = Number(nav.deviceMemory);        // GB
  const cores = Number(nav.hardwareConcurrency);
  const conn = nav.connection || {};
  const et = conn.effectiveType || "";
  let tier = "high";
  if (conn.saveData || /(^|\b)(slow-2g|2g)$/.test(et) || mem <= 2 || cores <= 2) tier = "low";
  else if (/(^|\b)3g$/.test(et) || mem <= 4 || cores <= 4) tier = "mid";
  // Cap handhelds at "mid" regardless of reported specs. The checks above are
  // all desktop-shaped: a modern phone reports 8 cores, and iOS never exposes
  // deviceMemory at all (NaN, which never demotes), so phones were landing on
  // "high" and getting the full desktop budget — uncapped framerate, DPR 2 and
  // 100% FX density. That is why they ran hot. A phone with a genuinely weak
  // signal still falls through to "low".
  if (tier === "high" && isHandheld()) tier = "mid";
  return tier;
}

// ─── Shard emitter ───────────────────────────────────────────────────────────
// Symbol destruction as physical fragments: faceted gem shards in the symbol's
// own colours, gold flakes and steel splinters, hot additive sparks, and a
// short localised light flash on the cell. Every fragment has its own
// velocity (a radial burst pushed outward from the cluster's centre and kicked
// upward), gravity, air drag, spin and an eased fade.
//
// Built the way Pixi/Phaser particle containers are built: one fixed pool in
// struct-of-arrays typed storage (no per-particle objects, so no GC churn), a
// swap-remove on death, sprites baked once per colour, and integration on
// elapsed TIME (px/ms), so a burst travels the same distance at 30fps on a
// phone as at 120fps on a desktop.
// Visual randomness only: Math.random(), never SlotEngine.RNG.
const SHARD = { GEM: 0, GOLD: 1, STEEL: 2, SPARK: 3, FLASH: 4, DUST: 5 };
const SHARD_SPRITE_PX = 48;

class ShardEmitter {
  constructor(capacity = 480) {
    this.cap = capacity;
    this.live = 0;
    this.dust = 0; // live DUST puffs (capped at CLUSTER_BLAST.maxDust)
    const f32 = () => new Float32Array(capacity);
    this.x = f32(); this.y = f32(); this.vx = f32(); this.vy = f32();
    this.rot = f32(); this.vr = f32(); this.age = f32(); this.life = f32();
    this.size = f32(); this.aspect = f32(); this.grav = f32(); this.drag = f32(); this.peak = f32();
    this.kind = new Uint8Array(capacity);
    this.look = new Array(capacity); // baked sprite (solids, flashes) or colour (sparks)
    this._sprites = new Map();
    this._last = 0;
  }

  _bake(key, paint) {
    let c = this._sprites.get(key);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = SHARD_SPRITE_PX;
    paint(c.getContext("2d"), SHARD_SPRITE_PX);
    this._sprites.set(key, c);
    return c;
  }

  /** A faceted triangular gem shard: lit edge to dark edge, a hard highlight
   *  along one facet so it catches light as it spins. */
  gemSprite(light, deep) {
    return this._bake(`gem|${light}|${deep}`, (g, s) => {
      const grad = g.createLinearGradient(0, 0, s, s);
      grad.addColorStop(0, light);
      grad.addColorStop(0.55, deep);
      grad.addColorStop(1, THEME.color.vaultDoor);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(s * 0.5, s * 0.04);
      g.lineTo(s * 0.96, s * 0.88);
      g.lineTo(s * 0.06, s * 0.7);
      g.closePath();
      g.fill();
      g.strokeStyle = "rgba(255, 255, 255, 0.75)";
      g.lineWidth = s * 0.05;
      g.beginPath();
      g.moveTo(s * 0.5, s * 0.06);
      g.lineTo(s * 0.12, s * 0.68);
      g.stroke();
    });
  }

  goldSprite() {
    return this._bake("gold", (g, s) => {
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, THEME.color.goldBright);
      grad.addColorStop(0.5, THEME.color.gold);
      grad.addColorStop(1, THEME.color.goldDeep);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(s * 0.5, s * 0.08);
      g.lineTo(s * 0.92, s * 0.5);
      g.lineTo(s * 0.5, s * 0.92);
      g.lineTo(s * 0.08, s * 0.5);
      g.closePath();
      g.fill();
    });
  }

  /** A thin steel splinter, drawn 3:1 so it reads as a sliver. */
  steelSprite() {
    return this._bake("steel", (g, s) => {
      const grad = g.createLinearGradient(0, 0, 0, s);
      grad.addColorStop(0, THEME.color.steelSheen);
      grad.addColorStop(0.5, "#ffffff");
      grad.addColorStop(1, THEME.color.steelBrushed);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, s * 0.5);
      g.lineTo(s * 0.8, s * 0.12);
      g.lineTo(s, s * 0.5);
      g.lineTo(s * 0.8, s * 0.88);
      g.closePath();
      g.fill();
    });
  }

  /** A soft dust puff tinted with `color`: a dim core feathering to nothing. */
  dustSprite(color) {
    return this._bake(`dust|${color}`, (g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, color);
      grad.addColorStop(0.5, THEME.color.steelSheen);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.globalAlpha = 0.85;
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    });
  }

  flashSprite(color) {
    return this._bake(`flash|${color}`, (g, s) => {
      const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      grad.addColorStop(0, "rgba(255, 255, 255, 1)");
      grad.addColorStop(0.25, color);
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, s, s);
    });
  }

  /** Low-level add. Units: px, px/ms, px/ms², ms. Drops silently when full. */
  add(kind, x, y, vx, vy, size, life, look, opts = {}) {
    if (this.live >= this.cap) return;
    if (kind === SHARD.DUST) {
      if (this.dust >= CLUSTER_BLAST.maxDust) return;
      this.dust += 1;
    }
    const i = this.live++;
    this.kind[i] = kind;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.size[i] = size; this.life[i] = life; this.age[i] = 0;
    this.rot[i] = opts.rot ?? Math.random() * Math.PI * 2;
    this.vr[i] = opts.vr ?? (Math.random() - 0.5) * 0.024;
    this.grav[i] = opts.grav ?? 0;
    this.drag[i] = opts.drag ?? 0.985;
    this.aspect[i] = opts.aspect ?? 1;
    this.peak[i] = opts.peak ?? 1;
    this.look[i] = look;
  }

  _remove(i) {
    if (this.kind[i] === SHARD.DUST) this.dust -= 1;
    const j = --this.live;
    if (i === j) return;
    this.kind[i] = this.kind[j];
    this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
    this.rot[i] = this.rot[j]; this.vr[i] = this.vr[j]; this.age[i] = this.age[j]; this.life[i] = this.life[j];
    this.size[i] = this.size[j]; this.aspect[i] = this.aspect[j]; this.grav[i] = this.grav[j];
    this.drag[i] = this.drag[j]; this.peak[i] = this.peak[j];
    this.look[i] = this.look[j];
    this.look[j] = null;
  }

  /** Step on elapsed time, then draw. Restores the DPR base transform. */
  render(ctx, dpr) {
    const now = performance.now();
    const dt = this._last ? Math.min(50, now - this._last) : 16.7;
    this._last = now;
    if (!this.live) return;
    // Integrate (semi-implicit Euler) in fixed sub-steps of at most 8ms, so a
    // 30fps phone and a 120fps desktop integrate at about the same resolution
    // and a burst lands in the same place on both. Cull with swap-remove.
    const steps = Math.max(1, Math.ceil(dt / 8));
    const h = dt / steps;
    const frames = h / 16.7;
    let i = 0;
    while (i < this.live) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._remove(i); continue; }
      const d = Math.pow(this.drag[i], frames);
      const g = this.grav[i] * h;
      for (let k = 0; k < steps; k += 1) {
        this.vx[i] *= d;
        this.vy[i] = this.vy[i] * d + g;
        this.x[i] += this.vx[i] * h;
        this.y[i] += this.vy[i] * h;
      }
      this.rot[i] += this.vr[i] * dt;
      i += 1;
    }
    // Solids: one setTransform per fragment (rotation + scale + DPR folded in).
    for (let k = 0; k < this.live; k += 1) {
      const kind = this.kind[k];
      if (kind === SHARD.SPARK || kind === SHARD.FLASH) continue;
      const t = this.age[k] / this.life[k];
      // Dust thins out as it spreads (grows 2.2x); solids hold, then go.
      const dust = kind === SHARD.DUST;
      ctx.globalAlpha = dust ? 0.7 * (1 - t) * (1 - t) : 1 - t * t * t;
      const s = (dust ? 1 + 1.2 * t : 1 - 0.3 * t) * dpr;
      const c = Math.cos(this.rot[k]) * s;
      const n = Math.sin(this.rot[k]) * s;
      ctx.setTransform(c, n, -n, c, this.x[k] * dpr, this.y[k] * dpr);
      const w = this.size[k];
      const h = w * this.aspect[k];
      ctx.drawImage(this.look[k], -w / 2, -h / 2, w, h);
    }
    // Light: sparks (streaks along their velocity) and flashes, additive.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.lineCap = "round";
    for (let k = 0; k < this.live; k += 1) {
      const kind = this.kind[k];
      const t = this.age[k] / this.life[k];
      if (kind === SHARD.SPARK) {
        ctx.globalAlpha = 1 - t;
        ctx.strokeStyle = this.look[k];
        ctx.lineWidth = this.size[k];
        ctx.beginPath();
        ctx.moveTo(this.x[k], this.y[k]);
        ctx.lineTo(this.x[k] - this.vx[k] * 26, this.y[k] - this.vy[k] * 26);
        ctx.stroke();
      } else if (kind === SHARD.FLASH) {
        // Quick attack, smooth release; grows slightly as it fades.
        const env = t < 0.2 ? t / 0.2 : 1 - easeOutCubic((t - 0.2) / 0.8);
        ctx.globalAlpha = env * this.peak[k];
        const w = this.size[k] * (0.85 + 0.3 * t);
        const h = w * this.aspect[k];
        ctx.drawImage(this.look[k], this.x[k] - w / 2, this.y[k] - h / 2, w, h);
      }
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
  }
}

class ReelCanvasRenderer {
  constructor(canvas, { rowsCount, colsCount }) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.rows = rowsCount;
    this.cols = colsCount;
    // Quality tier drives resolution + FX budget. Starts from device capability;
    // the FPS governor can only lower it. applyTier() publishes it to the DOM so
    // CSS can degrade in step (body.perf-low / perf-mid).
    this.tier = detectDeviceTier();
    this.applyTier(this.tier);
    // Cap the backing-store resolution: phones report DPR up to 3-4, but drawing
    // 3x+ pixels every frame is the single biggest mobile perf cost for almost no
    // visible gain. The per-tier maxDpr (set by applyTier) keeps fill-rate sane.
    this.dpr = Math.min(this.maxDpr, Math.max(1, window.devicePixelRatio || 1));
    // Particle-density multiplier, recomputed on resize from viewport size +
    // reduced-motion, then clamped to the tier's fxCeil. 1 = full desktop FX;
    // lower thins bursts on small/low-power screens to hold framerate.
    this.fxScale = 1;
    // FPS-governor state. We sample frame intervals only while the scene is
    // visually busy (idle frames are throttled and would skew the average slow),
    // and re-evaluate about once a second.
    this._frameSamples = [];
    this._governorCheckedAt = performance.now();
    this._lastDrawAt = 0;
    // rAF bookkeeping: the handle so the loop can be cancelled when the tab is
    // hidden, and the flag that keeps it cancelled until we resume.
    this._rafId = 0;
    this._paused = false;
    this.images = new Map();
    this.board = {
      matrix: Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => "BLUE_DIAMOND")),
      winningSet: new Set(),
      multiMap: new Map(),
      // Cells whose symbols exploded (#50): gone from the board the moment the
      // burst starts, until the refill commits a new matrix (setBoard).
      cleared: new Set(),
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
      exit: null,     // the old board falling out on a spin (dropOff, drawExitBoard)
      waves: [],      // cluster-blast shockwaves that light the symbols they pass (#54)
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
      sweeps: [],
      reticles: [],   // 5a: scatter landing reticles
      lockOn: null    // 5c/5d: trigger lock-on
    };
    this.particles = [];
    this.shards = new ShardEmitter(480);
    // Win focus (FOCUS): `set` = the focused cells (null = none, dims all).
    this.focus = { ...makeEnvelope(), set: null };
    // Per-frame perf caches (built lazily, invalidated on resize):
    //  • glowSprites: one pre-rendered radial-glow PNG per particle colour, so
    //    the hot particle loop blits instead of building a gradient every frame.
    //  • stageCacheBack/Front: the static stage (frameless: only the cell-corner
    //    marks) baked to offscreen canvases and blitted once per frame.
    //  • symbolSprites: each symbol bitmap pre-scaled to ~2x its on-screen cell
    //    size, so the 30 per-frame cell blits are near-1:1 instead of resampling
    //    the full-resolution source art every time.
    this.glowSprites = new Map();
    this.symbolSprites = new Map();
    this.emblemSprites = new Map(); // multiplier emblems, per value + size (multiplierSprite)
    this.stageCacheBack = null;
    this.stageCacheFront = null;
    this.time = 0;
    this.lastTick = performance.now();
    // Debounced: resize() throws away the stage cache, the glow sprites and the
    // pre-scaled symbol bitmaps, all of which then get re-baked. On mobile the
    // URL bar collapsing/expanding fires this observer repeatedly, so running it
    // per-callback meant rebuilding several full-size offscreen canvases many
    // times during a single scroll gesture.
    this._resizeTimer = 0;
    this.resizeObserver = new ResizeObserver(() => {
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.resize(), 150);
    });
    const parent = this.canvas.parentElement;
    if (parent) this.resizeObserver.observe(parent);
    this.preloadSymbols();
    this.resize();
    this.loop();
  }

  preloadSymbols() {
    // Load every image the game will ever need — canvas symbols AND the <img>
    // buttons / CSS backgrounds in uiAssets — exactly once, and remember a
    // per-asset promise so the boot loader can drive its progress bar from
    // THESE loads instead of re-requesting the same URLs with a second
    // `new Image()`. Handlers are attached before `.src` so a synchronously
    // cached image still resolves.
    //
    // The uiAssets entries are deliberately loaded here even though nothing on
    // the canvas draws them: warming the HTTP cache under the identical URL is
    // what stops the free-spins panel and the ante plate from streaming in the
    // first time they are shown. Their HTMLImageElements go into `this.images`
    // too, so they stay referenced and cannot be evicted mid-session.
    this.imageLoads = new Map();
    Object.entries({ ...symbolAssets, ...uiAssets }).forEach(([name, src]) => {
      const image = new Image();
      image.decoding = "async";
      this.imageLoads.set(name, new Promise((resolve) => {
        const settle = () => resolve();
        // `decode()` is the important one: onload only means the bytes arrived,
        // while decode() resolves once the bitmap is rasterized and ready to
        // paint. Waiting on onload alone is what let a fully "loaded" image
        // still paint in progressively.
        //
        // Two escape hatches, both load-bearing:
        //  • document.hidden — Chrome defers image decoding entirely while the
        //    document is hidden, so awaiting decode() there never resolves and
        //    the boot gate hangs until its safety timeout. That is a real case:
        //    a game opened in a background tab, or a casino iframe that starts
        //    hidden. Nothing is painting, so there is nothing to pop in either.
        //  • the cap — decode() also rejects on a broken image, and a decode
        //    slow enough to hit 2s is not worth holding the player behind the
        //    splash for.
        // resolve() is idempotent, so a late decode after either is harmless.
        image.onload = () => {
          if (typeof image.decode !== "function" || document.hidden) return settle();
          const cap = setTimeout(settle, 2000);
          const done = () => { clearTimeout(cap); settle(); };
          image.decode().then(done, done);
        };
        image.onerror = settle;
      }));
      image.src = src;
      this.images.set(name, image);
    });
  }

  /** Adopt a quality tier: update the resolution/FX budget and mirror it onto the
   *  <body> so CSS can degrade (drop the fixed background, blur, heavy art). */
  applyTier(tier) {
    this.tier = TIER_PROFILES[tier] ? tier : "high";
    const p = TIER_PROFILES[this.tier];
    this.maxDpr = p.maxDpr;
    this.idleThrottleMs = p.idleThrottleMs;
    this.maxFrameMs = p.maxFrameMs;
    const body = document.body;
    if (body) {
      body.classList.toggle("perf-low", this.tier === "low");
      body.classList.toggle("perf-mid", this.tier === "mid");
      // Published separately from the tier so CSS can drop the expensive
      // always-on effects (fixed background, backdrop blur) on any handheld,
      // not only when the device has been demoted all the way to perf-low.
      body.classList.toggle("perf-handheld", isHandheld());
    }
  }

  /** Drop one quality tier (high→mid→low). Returns true if it actually changed.
   *  Downgrade-only by design: auto-upgrading invites oscillation, and a device
   *  that struggled once will usually struggle again. */
  downgradeTier() {
    const next = this.tier === "high" ? "mid" : this.tier === "mid" ? "low" : null;
    if (!next) return false;
    this.applyTier(next);
    // Forced: a downgrade can move fxCeil without moving the backing store (on a
    // dpr-1 device high→mid changes maxDpr 2→1.5, which changes nothing), and
    // the new FX budget still has to be cashed in.
    this.resize(true); // re-derive dpr + fxScale + rebuild caches at the new budget
    return true;
  }

  /** Runtime FPS governor. Collects frame intervals while the scene is busy and,
   *  about once a second, steps the tier down if the median frame is too slow
   *  (median resists one-off GC/hitch spikes better than a mean would). */
  monitorPerformance(now, dt, busy) {
    if (busy && dt > 0) {
      this._frameSamples.push(dt);
      if (this._frameSamples.length > 120) this._frameSamples.shift();
    }
    if (now - this._governorCheckedAt < 1000) return;
    this._governorCheckedAt = now;
    const samples = this._frameSamples;
    this._frameSamples = [];
    if (TIER_RANK[this.tier] === 0 || samples.length < 30) return;
    const sorted = samples.slice().sort((a, b) => a - b);
    const medianMs = sorted[sorted.length >> 1];
    // "Too slow" is judged against what THIS tier asked for: a capped tier is
    // only slow when its frames run well past its own cap (1.25×). Judging a
    // 30fps-capped tier against a flat 30ms would demote every phone the
    // moment the cap worked as designed (33.3ms frames).
    const slowMs = Math.max(30, this.maxFrameMs * 1.25);
    if (medianMs > slowMs) this.downgradeTier();
  }

  /** @param {boolean} [force] rebuild the caches even if the backing store is
   *  unchanged — used by a quality-tier change, where fxCeil moves but the
   *  pixel dimensions may not. */
  resize(force) {
    const box = this.canvas.getBoundingClientRect();
    if (!box.width || !box.height) return;
    this.dpr = Math.min(this.maxDpr, Math.max(1, window.devicePixelRatio || 1));
    const nextW = Math.round(box.width * this.dpr);
    const nextH = Math.round(box.height * this.dpr);
    // A ResizeObserver fires for ANY layout nudge near the board — a message
    // banner, a HUD node un-hiding, a mobile URL bar sliding away. The rebuild
    // below re-rasterizes every symbol sprite and both stage caches, which lands
    // as a frame hitch; doing that mid-spin is exactly the "assets are loading
    // during gameplay" glitch (#26). If the backing store did not actually
    // change, there is nothing to rebuild — just re-publish the board box (which
    // is cheap and already diffed) and leave the caches alone.
    if (!force && nextW === this.canvas.width && nextH === this.canvas.height) {
      this.publishBoardBox();
      return;
    }
    // Assigning to canvas.width/height resets the 2D context, so the transform
    // and every cache below have to be re-established whenever we get here.
    this.canvas.width = nextW;
    this.canvas.height = nextH;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Thin particle bursts on small canvases (phones) and when the player asked
    // for reduced motion. CSS-px width is the proxy for "how much room/power".
    const cssWidth = box.width;
    let scale = cssWidth < 380 ? 0.5 : cssWidth < 560 ? 0.7 : cssWidth < 820 ? 0.85 : 1;
    if (prefersReducedMotion()) scale = Math.min(scale, 0.4);
    // Never exceed the current tier's FX budget — this is what a governor
    // downgrade (and low-end devices) actually cash in for a steadier framerate.
    scale = Math.min(scale, TIER_PROFILES[this.tier].fxCeil);
    this.fxScale = scale;
    // Layout/DPR changed → rebuild everything that was baked at the old
    // size/resolution: the static stage, the colour glow sprites, the pre-scaled
    // symbol bitmaps, and the memoized ambient gradients.
    this.stageCacheBack = null;
    this.stageCacheFront = null;
    this.glowSprites.clear();
    this.symbolSprites.clear();
    this.emblemSprites.clear();
    this._fogKey = null;
    this._meshKey = null;
    this.publishBoardBox();
  }

  /** Publish the board's real on-screen box as CSS custom properties so overlays
   *  can anchor to the GRID rather than to the surrounding panel.
   *
   *  The board is letterboxed/pillarboxed inside .vault-window (it holds a 6/5
   *  aspect while the window is whatever shape the layout leaves), so the two
   *  boxes rarely match. Overlays used to be positioned in raw pixels against
   *  the window — `top: 12px` on the multiplier badge — which put them in the
   *  dead space above the board on any viewport where the letterbox was tall.
   *  With these vars, CSS can express "the top edge of the actual grid".
   *
   *  Written on .vault-window so the values are scoped to the board's own
   *  stacking context, and only when they actually change — this runs from
   *  resize(), which a ResizeObserver drives. */
  publishBoardBox() {
    const stage = this.canvas.closest(".reels-stage") || this.canvas;
    const host = this.canvas.closest(".vault-window");
    if (!host) return;
    const s = stage.getBoundingClientRect();
    const h = host.getBoundingClientRect();
    if (!s.width || !h.width) return;
    // Offsets of the board inside the window, as a fraction of the window — so
    // the CSS stays resolution independent and needs no second unit conversion.
    const next = {
      "--board-w": `${(100 * s.width / h.width).toFixed(3)}%`,
      "--board-h": `${(100 * s.height / h.height).toFixed(3)}%`,
      "--board-x": `${(100 * (s.left - h.left) / h.width).toFixed(3)}%`,
      "--board-y": `${(100 * (s.top - h.top) / h.height).toFixed(3)}%`
    };
    for (const [k, v] of Object.entries(next)) {
      if (this._boardBox?.[k] !== v) host.style.setProperty(k, v);
    }
    this._boardBox = next;
  }

  /** Scale a particle/effect count by fxScale, never below `min` so an effect
   *  never vanishes entirely (unless the caller passes min=0). */
  fxCount(n, min = 1) {
    return Math.max(min, Math.round(Number(n || 0) * this.fxScale));
  }

  /** A blank offscreen canvas of `w`×`h` CSS px backed at device resolution.
   *  The returned 2D context is pre-scaled by dpr so callers draw in CSS px. */
  /** The baked winged-sun emblem for multiplier `value` at a w×h box (CSS
   *  px), number included: one drawImage per multiplier cell. */
  multiplierSprite(value, w, h) {
    const key = `${value}|${Math.round(w)}x${Math.round(h)}`;
    let cvs = this.emblemSprites.get(key);
    if (!cvs) {
      const off = this.makeOffscreen(w, h);
      drawWingedSun(off.ctx, w, h, getMultiplierTier(value).key, value);
      cvs = off.cvs;
      this.emblemSprites.set(key, cvs);
    }
    return cvs;
  }

  makeOffscreen(w, h) {
    const dpr = this.dpr || 1;
    const cvs = document.createElement("canvas");
    cvs.width = Math.max(1, Math.round(w * dpr));
    cvs.height = Math.max(1, Math.round(h * dpr));
    const c = cvs.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { cvs, ctx: c, w, h };
  }

  /** A symbol bitmap pre-scaled to roughly the size it is actually drawn at.
   *
   *  The source art is 256px square (and the reel/scatter plates larger still)
   *  but a grid cell is only ~60-100 CSS px, so drawing straight from the source
   *  made the browser resample the full bitmap on every one of the 30 cell blits,
   *  every frame. Baking each symbol once per layout into a right-sized offscreen
   *  canvas turns that into a near-1:1 blit.
   *
   *  Cached by symbol key and invalidated with the stage caches on resize, so the
   *  bake size always tracks the current cell size and DPR. Returns the original
   *  image if it is not yet decoded or is already small enough to be free.
   */
  getSymbolSprite(key, img, drawW, drawH) {
    if (!img?.complete || !img.naturalWidth) return img;
    // Bake at 2x the draw size so the result still holds up during the scale-up
    // that pulse/slam effects apply, then clamp to the source's own resolution —
    // upscaling here would cost memory and buy nothing.
    const targetW = Math.min(img.naturalWidth, Math.max(1, Math.round(drawW * 2)));
    const targetH = Math.min(img.naturalHeight, Math.max(1, Math.round(drawH * 2)));
    // Already close to 1:1 — the bake would not pay for itself.
    if (img.naturalWidth <= targetW * 1.25) return img;

    // Reuse any bake within a band around the wanted size. Every per-frame scale
    // animation (win breath, landing squash, landing punch) changes drawW
    // a little each frame, and the old exact-size match rebaked every animated
    // symbol every frame: measured ~420 bakes/s on an idle 390px phone board.
    // drawImage scales the cached bake to the exact size; within this band the
    // resample is invisible.
    let sprite = this.symbolSprites.get(key);
    if (sprite
      && sprite.w >= targetW * SPRITE_BAND.min && sprite.w <= targetW * SPRITE_BAND.max
      && sprite.h >= targetH * SPRITE_BAND.min && sprite.h <= targetH * SPRITE_BAND.max) {
      return sprite.cvs;
    }

    // A new bake gets headroom above the wanted size, so the scale-UP effects
    // (breath, landing punch) stay inside its band instead of forcing a rebake.
    const bakeW = Math.min(img.naturalWidth, Math.round(targetW * SPRITE_BAND.headroom));
    const bakeH = Math.min(img.naturalHeight, Math.round(targetH * SPRITE_BAND.headroom));
    const { cvs, ctx } = this.makeOffscreen(bakeW, bakeH);
    ctx.drawImage(img, 0, 0, bakeW, bakeH);
    this.symbolSprites.set(key, { cvs, w: bakeW, h: bakeH });
    return cvs;
  }

  /** Pre-rendered soft radial glow for `color`, cached by colour string. The
   *  particle loop blits this (cheap) instead of allocating a gradient/particle/
   *  frame. Drawn at a fixed sprite radius; callers scale via drawImage. */
  getGlowSprite(color) {
    const key = String(color || "#ffffff");
    let sprite = this.glowSprites.get(key);
    if (sprite) return sprite;
    const R = 32; // sprite core radius in CSS px; scaled down per particle
    const { cvs, ctx } = this.makeOffscreen(R * 2, R * 2);
    const grad = ctx.createRadialGradient(R, R, 0, R, R, R);
    // Soft-glow core. The `dd` alpha suffix is only valid on a 6-digit hex
    // (#rrggbb → #rrggbbdd); appending it to rgba()/rgb()/named colors yields an
    // invalid color that throws in addColorStop and kills the frame. Only add
    // the alpha suffix for 6-digit hex; otherwise use the color as-is.
    const core = /^#[0-9a-fA-F]{6}$/.test(key) ? `${key}dd` : key;
    grad.addColorStop(0, core);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(R, R, R, 0, Math.PI * 2);
    ctx.fill();
    sprite = { cvs, r: R };
    this.glowSprites.set(key, sprite);
    return sprite;
  }

  /** Table/inner-panel geometry derived from the current layout. Shared by the
   *  stage cache builder and the live render (which re-clips to the inner panel). */
  getTableRect() {
    const { width, height, padX, top, laneW } = this.getLayout();
    const tableX = Math.max(8, padX * 0.34);
    const tableY = Math.max(8, top * 0.2);
    const tableW = width - tableX * 2;
    const tableH = height - tableY - Math.max(10, top * 0.22);
    const frameR = Math.min(24, Math.max(10, laneW * 0.18));
    const inX = tableX + 8;
    const inY = tableY + 8;
    const inW = tableW - 16;
    const inH = tableH - 16;
    const inR = Math.max(8, frameR - 4);
    return { tableX, tableY, tableW, tableH, frameR, inX, inY, inW, inH, inR };
  }

  /**
   * Bake the static stage into offscreen canvases (blitted once per frame).
   *
   * Frameless glass (v10): the board has no painted bezel, table, reel strips or grid
   * lines any more. The glass surface itself is CSS on .reels-stage (a dark,
   * backdrop-blurred panel), so the canvas stays TRANSPARENT and the symbols float
   * on the glass. All that is baked here is a delicate mark where four cells meet:
   * a dot with faint cross arms, so the 6x5 grid stays readable without boxes.
   *   • stageCacheBack  — empty (kept so callers and the rebuild logic stay simple).
   *   • stageCacheFront — the cell-corner marks.
   * Rebuilt on resize.
   */
  buildStageCache() {
    const { width, height, padX, top, laneW, rowStep } = this.getLayout();
    this.stageCacheBack = this.makeOffscreen(width, height);

    const front = this.makeOffscreen(width, height);
    const fctx = front.ctx;
    const dotR = Math.max(1, Math.min(laneW, rowStep) * 0.012);
    const arm = Math.max(3, Math.min(laneW, rowStep) * 0.06);
    for (let r = 1; r < this.rows; r += 1) {
      for (let c = 1; c < this.cols; c += 1) {
        const x = Math.round(padX + laneW * c) + 0.5;
        const y = Math.round(top + rowStep * r) + 0.5;
        fctx.strokeStyle = THEME.stage.gridTick;
        fctx.lineWidth = 1;
        fctx.beginPath();
        fctx.moveTo(x - arm, y);
        fctx.lineTo(x + arm, y);
        fctx.moveTo(x, y - arm);
        fctx.lineTo(x, y + arm);
        fctx.stroke();
        fctx.fillStyle = THEME.stage.gridDot;
        fctx.beginPath();
        fctx.arc(x, y, dotR, 0, Math.PI * 2);
        fctx.fill();
      }
    }
    this.stageCacheFront = front;
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
    this.board.cleared = new Set(); // a new matrix: nothing on it has exploded
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

  /** Re-time an in-flight drop so it CONTINUES from its current visual position
   *  and finishes smoothly in ~`remainingMs`, i.e. it appears to speed up rather
   *  than snapping. (The old code jumped progress to 0.75 instantly, which read
   *  as a glitchy teleport.) Preserves the current progress `p` and compresses
   *  only the remaining (1 - p) of the fall. */
  _accelerateDrop(fx, remainingMs) {
    if (!fx) return;
    const now = performance.now();
    const dur = fx.duration || 1;
    const p = clamp((now - fx.start) / dur, 0, 1);
    if (p >= 1) return;
    const newDur = Math.max(1, remainingMs / (1 - p));
    fx.duration = newDur;
    fx.start = now - p * newDur;
  }

  /** Does a pending Stop act on `drop` (default: the one in the air)? Stop
   *  slams only a SPIN board (or, under reduced motion, lands anything at
   *  once). A tumble refill always falls under gravity: never zipped, never
   *  pre-placed. */
  _stopHits(drop = this.fx.drop) {
    return state.fastStopRequested && (!drop || drop.spin || this._reducedMotion);
  }

  requestFastStop() {
    const drop = this.fx.drop;
    if (drop?.zip) return; // already zipping: let it lock
    if (drop && !drop.spin && !this._reducedMotion) {
      // A tumble refill in the air keeps its fall; the Stop only ends the
      // celebration bits and is spent when this refill lands. A multiplier
      // waiting for its strike is struck at once.
      this._quickStrikes(drop);
      this._zipPending = false;
      this.fx.charge = null;
      this.fx.spotlight = null;
      return;
    }
    // A board dropping in zips into place (FAST_ZIP). Its positions are
    // snapshotted on the drop's live timing, so this runs before anything
    // below changes that timing (anticipation, acceleration).
    const zip = Boolean(drop && !this._reducedMotion);
    // The old board still falling out (fx.exit) clears at EXIT_FAST× speed.
    if (this.fx.exit && !this.fx.exit.fastAt) this.fx.exit.fastAt = performance.now();
    if (zip) {
      this._startZip(drop);
    } else if (this._columnStops?.size) {
      // Reduced motion: everything lands at once, so one thud.
      this.cancelColumnStops();
      this._queueColumnStop(0, 0, null);
    }
    // No board in the air yet (only the old one leaving): the next drop is
    // born zipping (see drop()).
    this._zipPending = !drop;
    // Scatters still in the air land now (zipping: as their reel locks);
    // anticipation ends with the skip.
    if (!zip) this.flushScatterLandings();
    if (drop?.antic) {
      drop.antic = null;
      this.onAnticipation?.("end");
    }
    if (!zip) this._accelerateDrop(drop, FAST_STOP_DROP_MS);
    this._accelerateDrop(this.fx.heavyDrop, zip ? Math.max(1, this._zipEnd - performance.now()) : FAST_STOP_DROP_MS);
    this.fx.cluster = null;
    this.fx.sweeps = [];
    this.fx.charge = null;
    this.fx.spotlight = null;
    this.particles = this.particles.slice(-40);
  }

  /** Wait `realMs` (already in real / turbo-adjusted ms — do NOT pass raw values
   *  through animationSleep, which would double-scale in turbo and resolve before
   *  the fall visually finishes, making symbols vanish mid-air). Resolves early on
   *  a fast-stop, but only ~FAST_STOP_SETTLE_MS after the request so the sped-up
   *  drop has time to visibly land first. */
  _dropSettle(realMs, { honorStop = true, until = null } = {}) {
    const start = performance.now();
    return new Promise((resolve) => {
      let stopAt = honorStop && state.fastStopRequested ? start : null;
      const tick = () => {
        const now = performance.now();
        if (honorStop && stopAt === null && state.fastStopRequested) stopAt = now;
        if (stopAt !== null) {
          // A fast-stop zip (FAST_ZIP) is still the drop: let it lock first.
          if (now - stopAt >= FAST_STOP_SETTLE_MS && now >= (this._zipEnd || 0)) return resolve();
        } else if (until ? now >= until() : now - start >= realMs) {
          return resolve();
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
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
    const centroid = this.computeCentroid(winning);
    winning.forEach((p) => {
      if (!Number.isInteger(p?.row) || !Number.isInteger(p?.col)) return;
      const key = `${p.row}-${p.col}`;
      const onset = delays?.get?.(key) || 0;
      const fire = () => this.emitCellExplosion(p, strength, centroid);
      if (onset > 0) setTimeout(fire, onset);
      else fire();
    });
  }

  /** A winning symbol SHATTERS: the cell flares (local light), faceted shards
   *  in the symbol's own colours, gold flakes and steel splinters burst
   *  outward from the cluster's centre with an upward kick, then fall,
   *  tumble and fade; a few hot sparks streak out. All on the pooled,
   *  time-based ShardEmitter. Counts scale with the quality tier (fxCount). */
  emitCellExplosion(p, strength, centroid) {
    const center = this.cellCenter(p.row, p.col);
    const symbol = this.board.matrix?.[p.row]?.[p.col] || "BLUE_DIAMOND";
    const tone = symbolTone[symbol] || symbolTone.BLUE_DIAMOND;
    const { laneW, rowStep } = this.getLayout();
    const cs = Math.min(laneW, rowStep);
    const now = performance.now();
    const P = SHATTER[strength] || SHATTER.medium;
    const E = this.shards;
    // One clean shockwave ring per cell: local and readable.
    this.fx.shockwaves.push({
      x: center.x, y: center.y, born: now,
      life: strength === "great" ? 460 : strength === "small" ? 260 : 340,
      color: tone[0]
    });
    // The cell itself flares as it breaks.
    E.add(SHARD.FLASH, center.x, center.y, 0, 0, cs * P.flash, 240, E.flashSprite(tone[0]),
      { peak: 0.85, vr: 0, rot: 0, drag: 1 });
    // Fragments fly outward from the cluster's centre; a lone cell (or 35% of
    // fragments, for a full look) bursts evenly in every direction.
    const ox = center.x - (centroid ? centroid.x : center.x);
    const oy = center.y - (centroid ? centroid.y : center.y);
    const away = Math.hypot(ox, oy) > 1 ? Math.atan2(oy, ox) : null;
    const angle = (spread) => (away === null || Math.random() < 0.35
      ? Math.random() * Math.PI * 2
      : away + (Math.random() - 0.5) * spread);
    const g = cs * SHATTER.gravity;
    const up = cs * P.up;
    const fire = (kind, n, look, size, speed, life, opts = {}) => {
      for (let i = 0; i < this.fxCount(n); i += 1) {
        const a = angle(2.2);
        const v = cs * (speed[0] + Math.random() * (speed[1] - speed[0]));
        E.add(kind,
          center.x + (Math.random() - 0.5) * cs * 0.3,
          center.y + (Math.random() - 0.5) * cs * 0.3,
          Math.cos(a) * v, Math.sin(a) * v - up,
          cs * (size[0] + Math.random() * (size[1] - size[0])),
          life[0] + Math.random() * (life[1] - life[0]),
          typeof look === "function" ? look() : look,
          { grav: g, ...opts });
      }
    };
    fire(SHARD.GEM, P.gems, () => E.gemSprite(tone[0], tone[1]), [0.14, 0.28], [0.002, 0.0055], [650, 950]);
    fire(SHARD.GOLD, P.gold, E.goldSprite(), [0.06, 0.1], [0.0025, 0.006], [700, 1000]);
    fire(SHARD.STEEL, P.steel, E.steelSprite(), [0.18, 0.3], [0.003, 0.007], [500, 750], { aspect: 1 / 3 });
    const sparks = THEME.particles.sparks;
    for (let i = 0; i < this.fxCount(P.sparks); i += 1) {
      const a = angle(2.6);
      const v = cs * (0.006 + Math.random() * 0.006);
      E.add(SHARD.SPARK, center.x, center.y, Math.cos(a) * v, Math.sin(a) * v - up,
        1.4 + Math.random() * 0.8, 200 + Math.random() * 140,
        sparks[(Math.random() * sparks.length) | 0], { grav: g * 0.3, drag: 0.95, vr: 0 });
    }
  }

  /** Cluster blast (CLUSTER_BLAST): for every symbol cluster of minCells+ in
   *  `winning`, a shockwave leaves the cluster's centre (lighting the symbols
   *  it passes, see waveLight) and dust radiates from it. */
  spawnClusterBlast(winning, strength) {
    const groups = new Map(); // symbol → its winning cells
    for (const p of winning) {
      const sym = this.board.matrix?.[p.row]?.[p.col];
      if (!sym) continue;
      if (!groups.has(sym)) groups.set(sym, []);
      groups.get(sym).push(p);
    }
    const { laneW, rowStep } = this.getLayout();
    const cs = Math.min(laneW, rowStep);
    const now = performance.now();
    const E = this.shards;
    for (const [sym, cells] of groups) {
      if (cells.length < CLUSTER_BLAST.minCells) continue;
      const centre = this.computeCentroid(cells);
      let far = 0;
      for (const p of cells) {
        const c = this.cellCenter(p.row, p.col);
        far = Math.max(far, Math.hypot(c.x - centre.x, c.y - centre.y));
      }
      const tone = symbolTone[sym] || symbolTone.BLUE_DIAMOND;
      this.fx.waves.push({
        x: centre.x, y: centre.y, born: now,
        life: Math.round(CLUSTER_BLAST.waveMs * turboScale()),
        reach: far + CLUSTER_BLAST.reach * cs, band: CLUSTER_BLAST.band * cs,
        color: tone[0], glow: this.getGlowSprite(tone[0])
      });
      const n = this.fxCount(CLUSTER_BLAST.dust[strength] || CLUSTER_BLAST.dust.medium);
      const look = E.dustSprite(tone[0]);
      const [v0, v1] = CLUSTER_BLAST.dustSpeed;
      for (let i = 0; i < n; i += 1) {
        // Evenly around the centre (jittered), launched from the cluster's rim.
        const a = ((i + Math.random() * 0.8) / n) * Math.PI * 2;
        const r = far * (0.6 + Math.random() * 0.4);
        const v = cs * (v0 + Math.random() * (v1 - v0));
        E.add(SHARD.DUST, centre.x + Math.cos(a) * r, centre.y + Math.sin(a) * r,
          Math.cos(a) * v, Math.sin(a) * v, cs * (0.3 + Math.random() * 0.25), 520 + Math.random() * 260,
          look, { drag: 0.93, vr: (Math.random() - 0.5) * 0.004 });
      }
    }
  }

  /** Shockwave light on a symbol at (x, y) this frame: 0 (untouched) to
   *  CLUSTER_BLAST.glow as the wave's front passes it; also the wave to tint
   *  it with. Reuses one object. */
  waveLight(x, y, now) {
    const out = this._waveLit || (this._waveLit = { a: 0, wave: null });
    out.a = 0;
    out.wave = null;
    for (const w of this.fx.waves) {
      const t = (now - w.born) / w.life;
      if (t < 0 || t >= 1) continue;
      const off = (Math.hypot(x - w.x, y - w.y) - w.reach * easeOutCubic(t)) / w.band;
      const a = CLUSTER_BLAST.glow * Math.exp(-off * off) * (1 - t);
      if (a > out.a) { out.a = a; out.wave = w; }
    }
    return out;
  }

  spawnMultiplierCatchParticles(multipliers = []) {
    multipliers.forEach((m) => {
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col)) return;
      const center = this.cellCenter(m.row, m.col);
      const valueNum = Number(m.value || 2);
      const tier = getMultiplierTier(valueNum);
      const tierBoost = tier.key === "mythic" ? 3.2 : tier.key === "legendary" ? 2.4 : tier.key === "epic" ? 1.7 : tier.key === "rare" ? 1.25 : 1;
      const count = this.fxCount(Math.round(26 * tierBoost));
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

  /** Spin-out (#47). The old board falls out of the bottom, reel by reel
   *  (WATERFALL.spinColMs apart), each reel as one stack under GRAVITY from
   *  rest: no wind-up, gravity from the press. It runs on its own layer
   *  (fx.exit, drawn by drawExitBoard), so the new board drops in straight
   *  behind it the moment the round's result is in: reel k of the new board
   *  is released spinColMs·k after the result, which is reel k's exit beat
   *  when the result is immediate, and the two stacks fall together like one
   *  continuous strip. Resolves at once. */
  dropOff(duration = ANIMATION_TIMING.oldBoardDropOff) {
    const hasBoard = Array.isArray(this.board.matrix) && this.board.matrix.length > 0 && !this.board.hidden;
    if (!hasBoard) return Promise.resolve();
    this.board.winningSet = new Set();
    this.fx.heavyReveals = new Map();
    this.cancelColumnStops();
    this.focusOff(); // a new spin releases any win focus still held
    this.fx.exit = {
      matrix: this.board.matrix.map((row) => row.slice()),
      multi: new Map(this.board.multiMap),
      start: performance.now(),
      duration: Math.round(duration * turboScale()),
      colMs: Math.round(WATERFALL.spinColMs * turboScale()),
      fastAt: 0
    };
    this.board.hidden = true;
    return Promise.resolve();
  }

  /** The spin-out's clock (ms since it started); after a fast-stop it runs
   *  EXIT_FAST× quicker, so the old board clears at once but still falls. */
  exitClock(exit, now) {
    if (!exit.fastAt || now <= exit.fastAt) return now - exit.start;
    return exit.fastAt - exit.start + (now - exit.fastAt) * EXIT_FAST;
  }

  /** How far (rows) reel `col` of the old board has fallen: ½·g·t² from rest. */
  exitOffsetRows(exit, col, now) {
    const t = this.exitClock(exit, now) - col * exit.colMs;
    if (t <= 0) return 0;
    const u = t / exit.duration;
    return this.rows * u * u;
  }

  /** Draws the old board falling out (fx.exit), clipped to the reels, and
   *  drops the layer once its last reel is below the board. */
  drawExitBoard(ctx, { width, top, padX, laneW, rowStep, radius }) {
    const exit = this.fx.exit;
    const now = performance.now();
    if (this.exitOffsetRows(exit, this.cols - 1, now) > this.rows + 1) {
      this.fx.exit = null;
      return;
    }
    const over = Math.max(0, (Math.min(laneW, rowStep) * 1.12 - rowStep) / 2);
    const gridBottom = top + rowStep * this.rows;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, top - over, width, gridBottom + over - (top - over));
    ctx.clip();
    for (let c = 0; c < this.cols; c += 1) {
      const off = this.exitOffsetRows(exit, c, now) * rowStep;
      for (let r = 0; r < this.rows; r += 1) {
        const y = top + rowStep * (r + 0.5) + off;
        if (y - rowStep * 0.62 > gridBottom + over) continue;
        const symbol = exit.matrix[r]?.[c];
        if (!symbol) continue;
        const x = padX + laneW * (c + 0.5);
        if (symbol === "MULTI") {
          // A multiplier: its winged-sun emblem, sized to the cell.
          const ew = laneW * MULTI_EMBLEM.boxW;
          const eh = rowStep * MULTI_EMBLEM.boxH;
          const value = Number(exit.multi.get(`${r}-${c}`) || 1);
          ctx.drawImage(this.multiplierSprite(value, ew, eh), x - ew / 2, y - eh / 2, ew, eh);
          continue;
        }
        const img = this.images.get(symbol);
        if (!img?.complete || !img.naturalWidth) continue;
        const boost = symbol === "SCATTER" ? 1.22 : 1;
        const size = Math.min(radius * 2.5 * boost, Math.min(laneW, rowStep) * 1.12);
        let w = size;
        let h = size;
        if (symbol === "SCATTER") {
          const ar = img.naturalWidth / img.naturalHeight;
          if (ar > 1) h = size / ar;
          else w = size * ar;
        }
        ctx.drawImage(this.getSymbolSprite(symbol, img, w, h), x - w / 2, y - h / 2, w, h);
      }
    }
    ctx.restore();
  }

  async intro(matrix, multipliers = [], options = {}) {
    const introMap = {};
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) introMap[`${r}-${c}`] = this.rows;
    }
    return this.drop(matrix, multipliers, introMap, ANIMATION_TIMING.introDrop, { ...options, spin: true });
  }

  resetHeavyBangs() {
    this.fx.bangedKeys = new Set();
    this.fx.struckKeys = new Set();
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
    // Cascade momentum (options.tempo, see tumbleTempo) scales the fall and,
    // through dropDelay, the waterfall stagger. Turbo speeds the whole spin.
    const tempo = Number(options.tempo) > 0 ? Number(options.tempo) : 1;
    duration = Math.round(duration * tempo * turboScale());
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
    const alreadyBanged = this.fx.bangedKeys.size > 0;
    if (animateMultipliers) (multipliers || []).forEach((m) => {
      const v = Number(m?.value || 0);
      if (!Number.isInteger(m?.row) || !Number.isInteger(m?.col) || v <= 0) return;
      const tier = getMultiplierTier(v);
      // Track by stable multiplier id when available so a multiplier that drops
      // during tumbles stays the same logical object (no re-conceal/re-reveal).
      const k = m?.id ? `id:${m.id}` : `${m.row}-${m.col}-${v}`;
      if (this.fx.struckKeys.has(k)) return; // already struck this spin
      // User rule: every multiplier plays the full BANG reveal (lightning +
      // flash + shockwave) the FIRST time it appears — deduped by struckKeys
      // above — regardless of tier or whether another already banged this spin.
      const isHeavyEligible = true;
      if (isHeavyEligible) {
        heavyCells.set(`${m.row}-${m.col}`, { tier, value: v, dedupeKey: k, id: m?.id || "" });
      } else {
        lightOnlyCells.set(`${m.row}-${m.col}`, { tier, value: v, dedupeKey: k, id: m?.id || "" });
      }
      this.fx.struckKeys.add(k);
    });
    // A drop with a multiplier in it falls exactly like any other (no
    // slow-down): nothing may tell the player one is coming (STRIKE).
    // A Stop pressed before this board falls slams it in with the visible zip
    // (below), so it keeps its real timing; only reduced motion lands at once.
    const isSpin = Boolean(options.spin);
    const slam = state.fastStopRequested && !this._reducedMotion && isSpin;
    // A tumble refill under a pending Stop falls at (at least) turbo pace:
    // visibly, under the same gravity. Never zipped, never pre-placed.
    const hurried = state.fastStopRequested && !this._reducedMotion && !isSpin;
    if (hurried) duration = Math.min(duration, Math.round(ANIMATION_TIMING.tumbleDrop * TURBO_SCALE * tempo));
    const dropDuration = state.fastStopRequested && this._reducedMotion ? FAST_STOP_DROP_MS : duration;

    // Landing punches belong to one drop: clear the previous step's.
    this.fx.heavyReveals = new Map();

    this.setBoard(matrix, { multipliers });
    this.focusOff(); // the refill brings the board back up as it falls
    this.fx.drop = {
      start: performance.now(),
      duration: dropDuration,
      map: dropMap,
      heavy: heavyCells,
      antic: this.makeAnticipation(options.anticipation),
      need: Number(options.scatterTarget) || 0,
      order: this._dropOrder(dropMap),
      spin: Boolean(options.spin), // a spin's board (WATERFALL.spinColMs), not a tumble refill
      tempo
    };
    this.scheduleColumnStops(dropMap, dropDuration);
    // Stop pressed before this SPIN board started falling (during the
    // spin-out): it is born zipping, so it visibly falls into place in ≤110ms.
    if (slam) {
      this._zipPending = false;
      this._startZip(this.fx.drop);
    }
    const maxDelay = Object.entries(dropMap || {}).reduce((acc, [key, count]) => {
      const [row, col] = key.split("-").map((n) => Number(n));
      if (!Number.isFinite(row) || !Number.isFinite(col)) return acc;
      return Math.max(acc, this.dropDelay(row, col, Number(count || 0)));
    }, 0);

    // New multipliers (STRIKE): they fall as stand-ins and are struck into
    // place once the whole drop has landed; the strikes are fired frame by
    // frame (_fireStrikes), timed off the drop's real landing.
    const startTime = performance.now();
    const multiCells = new Map([...heavyCells, ...lightOnlyCells]);
    for (const [key, info] of heavyCells) if (Number(dropMap?.[key]) > 0) this.fx.bangedKeys.add(info.dedupeKey);
    this._planStrikes(this.fx.drop, multiCells, heavyCells);
    const revealEndMs = this._strikesEndMs(this.fx.drop);

    // Landing dust only on real tumble drops (post-win), and only for cells
    // that fell a meaningful distance (count >= 2). No dust on intro, no
    // dust on every cell. The board never shakes: a landing's weight is its
    // thud and the local floor glint (landingGlints).
    const isIntro = !Object.keys(dropMap || {}).length;
    if (!isIntro) {
      Object.entries(dropMap || {}).forEach(([key, count]) => {
        const n = Number(count || 0);
        if (n < 2) return;
        const [r, c] = key.split("-").map(Number);
        if (!Number.isFinite(r) || !Number.isFinite(c)) return;
        if (heavyCells.has(key) || lightOnlyCells.has(key)) return;
        const land = this.cellLandMs(r, c, n);
        setTimeout(() => this.spawnLandingDust(r, c, 0.7), land);
      });
    }

    // Settle once the last symbol has landed (bounce included) AND the last
    // multiplier reveal-pop has finished, plus one frame. dropDuration /
    // maxDelay are already turbo-adjusted: wait the REAL time so the fall fully
    // lands before the board commits (animationSleep would scale again).
    const settleMs = Math.max(dropDuration + maxDelay, this.dropEndMs(dropMap), revealEndMs) + 30;
    // The loop runs at its busy cadence until the LAST symbol has landed
    // (isVisuallyBusy reads endAt): a spin's reels release up to 500ms apart,
    // so the drop's own duration (one reel's fall) ends long before it does.
    // A Stop that hurries the strikes moves endAt; the settle follows it.
    const thisDrop = this.fx.drop;
    thisDrop.endAt = startTime + settleMs;
    await this._dropSettle(settleMs, { honorStop: !hurried && (isSpin || this._reducedMotion), until: () => thisDrop.endAt });
    this._fireStrikes(Infinity); // a strike a skipped frame left pending lands now: never leave a stand-in
    this.fx.drop = null;
    this.fx.heavyDrop = null;
    // A Stop slams ONE board: once the board it caught has landed, the rest of
    // the round (holds, bursts, the next refills) plays at its normal pace.
    // Press again to slam the next one.
    if (state.fastStopRequested) this.onSlamLanded?.();
    if (window.__renderDebug) {
      const committed = (this.board.matrix?.[0] || []).slice(0, 3).join(",");
      console.log(`[drop:exit]  committed row0=${committed}`);
    }
  }

  spawnHeavyImpact(row, col, tier, value, { bolt = true } = {}) {
    // Fire the multiplier drop sound + lightning reaction at the EXACT moment
    // the multiplier bangs into place (this is the visual reveal), so the audio
    // is perfectly in sync with each multiplier's landing and scales with its
    // value. Deduped upstream via struckKeys, so it plays once per multiplier.
    window.Sound?.play("multiplier_drop", { value });
    window.Ambiance?.react("multiplier", { value });
    const center = this.cellCenter(row, col);
    const now = performance.now();
    const heaviness = tier.key === "mythic" ? 1.35 : tier.key === "legendary" ? 1.2 : tier.key === "epic" ? 1.08 : 0.92;
    // Triple ground shockwave — fast bright ring, slower wide ring, slow afterburn.
    this.fx.shockwaves.push({ x: center.x, y: center.y, born: now, life: 360, color: tier.accent });
    if (tier.key === "epic" || tier.key === "legendary" || tier.key === "mythic") {
      this.fx.shockwaves.push({ x: center.x, y: center.y, born: now + 70, life: 520 * heaviness, color: "rgba(255, 255, 255, 0.58)" });
    }
    // Dust dome — particles spraying outward and downward.
    const dustCount = this.fxCount(Math.round(8 * heaviness));
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
    // Cell-anchored impact record drives the ground ring (no squash: rigid).
    this.fx.impacts.push({
      row, col, x: center.x, y: center.y,
      born: now, life: 520 * heaviness,
      tier, value, heaviness
    });
    // Lightning strike — delegated to the shared tier-scaled method (a
    // STRIKE reveal has already struck: bolt: false, so it never hits twice).
    if (bolt) this.spawnLightningStrike(row, col, tier);

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
    // An anvil, not a jelly: weight through its own bell (whose weight follows
    // the value) and LOCAL light only: the board never moves. A short
    // spotlight flash on the landing cell. Never over a cluster
    // spotlight that is already running: that one belongs to a win.
    if (!this.fx.spotlight) {
      this.fx.spotlight = {
        start: now,
        duration: 420,
        set: new Set([`${row}-${col}`]),
        intensity: tier.key === "legendary" || tier.key === "mythic" ? 0.6 : 0.45
      };
      const flash = this.fx.spotlight;
      setTimeout(() => { if (this.fx.spotlight === flash) this.fx.spotlight = null; }, 440);
    }
  }

  async explode(winning = [], duration = 380, tier = "medium") {
    duration = Math.round(duration * turboScale()); // turbo speeds the whole spin
    if (!winning.length) return;
    const strength = tier === "blast-great" ? "great" : tier === "blast-small" ? "small" : "medium";
    // Anticipation charge: cells brighten and "inhale" before they pop. Length
    // scales with tier (PACING.charge): small wins get none, big wins a beat.
    const chargeMs = PACING.charge[strength] || 0;
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
        delays.set(`${p.row}-${p.col}`, Math.round(idx * PACING.burstStaggerMs * turboScale()));
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
    // The exploded symbols leave the board NOW (#50): from here on only the
    // burst draws them, and once it ends nothing does, so the gap before the
    // refill commits can never show them again.
    this.board.cleared = new Set(keys);
    this.spawnExplosionParticles(winning, strength, delays);
    this.spawnClusterBlast(winning, strength);
    // The burst plays out on its own (shards, flare, shockwave); the round
    // moves on as soon as the last symbol's art is gone (BLAST_GONE), so the
    // refill falls in under the flying shards instead of after them (#48).
    // `duration` is already turbo-scaled: wait real time (_dropSettle, which
    // also resolves on a fast-stop), not animationSleep, which would scale again.
    const blast = this.fx.blast;
    setTimeout(() => {
      if (this.fx.blast === blast) this.fx.blast = null;
      if (this.fx.spotlight) {
        // Let it fade naturally; just clear the reference once expired.
        const left = this.fx.spotlight.start + this.fx.spotlight.duration - performance.now();
        if (left > 0) setTimeout(() => { this.fx.spotlight = null; }, left);
        else this.fx.spotlight = null;
      }
    }, duration + maxDelay + 40);
    await this._dropSettle(Math.round(duration * BLAST_GONE) + maxDelay);
  }

  async highlight(matrix, { winning = [], multipliers = [] } = {}, duration = 560) {
    duration = Math.round(duration * turboScale()); // turbo speeds the celebration hold
    this.setBoard(matrix, { winning, multipliers });
    if (!winning.length) return;
    const start = performance.now();
    this.fx.pulse = { start, duration, phase: this.breathPhases(winning) };
    // Win focus: everything that did not win steps back, and stays back
    // through the blast until the board moves again (focusOff).
    this.focusOn(this.board.winningSet);
    await holdReal(duration);
    this.fx.pulse = null;
  }

  /** Win focus (FOCUS) on `keys`: the rest of the board fades back. */
  focusOn(keys) {
    const now = performance.now();
    this.focus.set = new Set(keys);
    envelopeTo(this.focus, 1, Math.round(FOCUS.inMs * turboScale()), now);
  }

  /** Release the win focus: the whole board fades back up together. */
  focusOff() {
    const f = this.focus;
    if (f.to === 0) return;
    f.set = null; // the old winners are gone: brighten everything as one
    envelopeTo(f, 0, state.fastStopRequested ? 1 : Math.round(FOCUS.outMs * turboScale()), performance.now());
  }

  async multiplierCatch(multipliers = [], duration = 620) {
    duration = Math.round(duration * turboScale()); // turbo speeds the whole spin
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
    await holdReal(duration);
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
    duration = Math.round(duration * turboScale()); // turbo speeds the whole spin
    // Reduced-motion: keep the beat (so the win sequence still paces correctly)
    // but skip the full-screen flash, which is the harshest effect for
    // photosensitive players.
    if (prefersReducedMotion()) {
      await holdReal(Math.min(duration, 260));
      return;
    }
    this.fx.jackpotFlash = {
      start: performance.now(),
      duration,
      colorA,
      colorB
    };
    await holdReal(duration);
    this.fx.jackpotFlash = null;
  }

  isVisuallyBusy() {
    const now = performance.now();
    const timedFxActive =
      (this.fx.drop && now < Math.max(this.fx.drop.endAt || 0, this.fx.drop.start + this.fx.drop.duration) + 60) ||
      (this.fx.pulse && now < this.fx.pulse.start + this.fx.pulse.duration + 80) ||
      (this.fx.blast && now < this.fx.blast.start + this.fx.blast.duration + 100) ||
      (this.fx.spinBurst && now < this.fx.spinBurst.start + this.fx.spinBurst.duration + 80) ||
      (this.fx.multiCatch && now < this.fx.multiCatch.start + this.fx.multiCatch.duration + 120) ||
      (this.fx.reelSlam && now < this.fx.reelSlam.start + this.fx.reelSlam.duration + 120) ||
      (this.fx.jackpotFlash && now < this.fx.jackpotFlash.start + this.fx.jackpotFlash.duration + 120) ||
      (this.fx.charge && now < this.fx.charge.start + this.fx.charge.duration + 120) ||
      (this.fx.spotlight && now < this.fx.spotlight.start + this.fx.spotlight.duration + 120) ||
      (this.fx.heavyDrop && now < this.fx.heavyDrop.start + this.fx.heavyDrop.duration + 140) ||
      (this.fx.drop?.antic && now < this.fx.drop.antic.endAt + 260) ||
      Boolean(this.fx.lockOn) ||
      this.fx.reticles.length > 0;
    return Boolean(
      timedFxActive ||
      this.fx.heavyReveals.size ||
      this.fx.shockwaves.length ||
      this.fx.waves.length ||
      Boolean(this.fx.exit) ||
      this.fx.lightning.length ||
      this.fx.impacts.length ||
      this.fx.bangs.length ||
      this.fx.rays.length ||
      this.particles.length ||
      this.shards.live > 0
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
    this._rafId = 0;
    const now = performance.now();
    // Two throttles, both expressed as a minimum gap since the last real draw:
    //   • idleThrottleMs — nothing is animating, so the stage is essentially the
    //     cached static board plus slow ambient drift. ~20fps is indistinguishable
    //     here and costs a third of the CPU. Applies on EVERY tier now.
    //   • maxFrameMs — a cap on busy frames too, used on handhelds/low-end. The
    //     spin animation reads fine at 30fps and the halved frame count is the
    //     difference between a warm phone and a hot one.
    // We always re-arm the rAF, so we still react on the very next frame when
    // work starts — the throttle only skips the expensive draw().
    const busy = this.isVisuallyBusy();
    const throttle = busy ? this.maxFrameMs : this.idleThrottleMs;
    if (throttle && now - this._lastDrawAt < throttle) {
      this._scheduleFrame();
      return;
    }
    const rawDelta = now - this.lastTick;
    const dt = Math.max(0, Math.min(34, rawDelta));
    this.lastTick = now;
    this._lastDrawAt = now;
    this.time += dt;
    // Governor needs the true frame interval, not the animation-clamped dt.
    this.monitorPerformance(now, rawDelta, busy);
    try {
      this.draw();
    } catch (err) {
      // Never let a draw exception kill the rAF loop — that would freeze the
      // canvas on the last successful frame even though state updates.
      console.error("[reelRenderer.draw] exception (continuing loop):", err);
    }
    // Schedule the next frame UNCONDITIONALLY, even if draw threw.
    this._scheduleFrame();
  }

  /** Arm the next frame, keeping the handle so it can actually be cancelled.
   *  Guarded against double-arming: two live rAF chains would fork the loop
   *  permanently and there would be no way to get back to one. */
  _scheduleFrame() {
    if (this._rafId || this._paused) return;
    this._rafId = requestAnimationFrame(() => this.loop());
  }

  /** Stop rendering entirely. Used when the tab/app is hidden — a backgrounded
   *  game has no reason to burn battery, and while most browsers stop firing rAF
   *  on hidden documents, Android WebViews and casino iframe wrappers do not
   *  reliably do so. Explicit beats incidental. */
  pauseRendering() {
    this._paused = true;
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
  }

  /** Resume after pauseRendering(). Resets the tick clock first: `lastTick` is
   *  minutes stale after a long background, and feeding that delta in would jump
   *  every time-driven animation forward in a single frame. */
  resumeRendering() {
    if (!this._paused) return;
    this._paused = false;
    this.lastTick = performance.now();
    this._lastDrawAt = 0;
    this._frameSamples = [];
    this._governorCheckedAt = performance.now();
    this._scheduleFrame();
  }

  getLayout() {
    const width = this.canvas.width / this.dpr;
    const height = this.canvas.height / this.dpr;
    // Tighter frame padding so the 6×5 grid claims more of the canvas → bigger
    // cells and bigger symbols (was 0.04 padX / 0.08 top+bottom, which wasted
    // ~17% of the height on margins). Kept a small top band for the reel-frame
    // crown/spine that draws above the first row.
    const padX = clamp(width * 0.022, 8, 22);
    const top = clamp(height * 0.045, 14, 34);
    const bottom = clamp(height * 0.04, 12, 30);
    const laneW = (width - padX * 2) / this.cols;
    const rowStep = (height - top - bottom) / this.rows;
    const radius = Math.min(laneW, rowStep) * 0.46;
    return { width, height, padX, top, bottom, laneW, rowStep, radius };
  }

  cellOffset(row, col, rowStep, now = performance.now()) {
    const drop = this.fx.drop;
    if (!drop) return 0;
    const key = `${row}-${col}`;
    const count = Number(drop.map?.[key] || 0);
    if (count <= 0) return 0;
    if (drop.zip) return this.zipOffset(drop.zip, key, col, rowStep, now);
    const elapsed = now - drop.start - this.dropDelay(row, col, count);
    // A dropping symbol STARTS exactly where it was last seen (one cell per
    // `count` above its slot) and falls
    // under GRAVITY from its reel's release (dropDelay). A NEW symbol (from
    // above the board) starts REEL_MASK.spawnPad higher, fully above the reel
    // mask, so no part of it shows before it enters the grid. Its fall time
    // is set by `count` alone, so it lands together with the old symbols that
    // fall as far: the reel lands as one stack.
    const fresh = row - count < 0 ? REEL_MASK.spawnPad * rowStep : 0;
    const start = -count * rowStep - fresh;
    if (elapsed < 0) return start;
    const t = clamp(elapsed / this.cellFallMs(col, count, drop), 0, 1);
    return lerp(start, 0, dropTravel(t, this.reelProfile(col)));
  }

  /** px a dropping cell moved over the last 16ms frame (signed, + = down;
   *  0 at rest). Read off the analytic motion, so it is exact at any fps. */
  cellVelocity(row, col, rowStep, now = performance.now()) {
    if (!this.fx.drop) return 0;
    return this.cellOffset(row, col, rowStep, now) - this.cellOffset(row, col, rowStep, now - 16);
  }

  /** The landing profile of a reel (GRAVITY). Every reel falls under the same
   *  gravity; reduced motion lands without the bounce. */
  reelProfile(col) { // eslint-disable-line no-unused-vars
    return this._reducedMotion ? REEL_PROFILE_RIGID : REEL_PROFILE;
  }

  /** When a dropping cell hits its slot, in ms from the drop's start: its zip
   *  lock on a fast-stop, otherwise the moment of impact (before the bounce). */
  cellLandMs(row, col, count) {
    const zip = this.fx.drop?.zip;
    if (zip) return zip.ends[col] || 0;
    return this.dropDelay(row, col, count) + this.cellFallMs(col, count) * this.reelProfile(col).contact;
  }

  // ── Fast-stop zip (FAST_ZIP) ──

  /** Freeze every dropping symbol where it is NOW, on the drop's live timing,
   *  and zip it into its slot: the reels still in the air lock left to right,
   *  each with its thud and glint, then a double click seals the board. A reel
   *  that already hit its slot (thud played, only settling through its lock)
   *  snaps in silently with the first one: it never thuds twice. */
  _startZip(drop) {
    const now = performance.now();
    const { rowStep } = this.getLayout();
    const from = new Map(); // key → start offset, in rows
    const rowsByCol = new Map(); // airborne reels → their dropping rows
    const settling = new Set();  // reels already in their slot, still locking
    this._liveTiming = true; // dropDelay: the real waterfall, not the fast-stop collapse
    for (const key of Object.keys(drop.map || {})) {
      const n = Number(drop.map[key]);
      if (!(n > 0)) continue;
      const [r, c] = key.split("-").map(Number);
      const y = this.cellOffset(r, c, rowStep) / rowStep;
      const progress = (now - drop.start - this.dropDelay(r, c, n)) / this.cellFallMs(c, n, drop);
      if (progress < this.reelProfile(c).contact) {
        if (!rowsByCol.has(c)) rowsByCol.set(c, []);
        rowsByCol.get(c).push(r);
      } else if (Math.abs(y) >= 1e-4) {
        settling.add(c);
      }
      if (Math.abs(y) >= 1e-4) from.set(key, y);
    }
    this._liveTiming = false;
    const ends = new Array(this.cols).fill(0);
    let k = 0;
    for (let c = 0; c < this.cols; c += 1) {
      if (rowsByCol.has(c)) ends[c] = FAST_ZIP.firstMs + FAST_ZIP.colMs * k++;
      else if (settling.has(c)) ends[c] = FAST_ZIP.firstMs;
    }
    const total = k ? FAST_ZIP.firstMs + FAST_ZIP.colMs * (k - 1) : 1;
    drop.zip = { t0: now, from, ends };
    // The drop's own clock now ends with the zip (busy checks read it).
    drop.start = now;
    drop.duration = total;
    drop.endAt = now + total + 30;
    this._quickStrikes(drop); // the zip lands everything; its strikes follow at once
    this._zipEnd = now + total;
    this.cancelColumnStops();
    for (const [c, rows] of rowsByCol) this._queueColumnStop(c, ends[c], rows);
    // Scatters still in the air ping as their reel locks.
    const pending = this._pendingScatters?.cells || [];
    // Same column = same frame: one ping per reel, at the count it brings.
    const byCol = new Map();
    for (const sc of pending) { if (!byCol.has(sc.col)) byCol.set(sc.col, []); byCol.get(sc.col).push(sc); }
    for (const [c, group] of byCol) this._queueTimer(ends[c] || 0, () => this._landScatters(group));
    if (k) {
      this._queueTimer(total, () => window.Sound?.play("click"));
      this._queueTimer(total + FAST_ZIP.clickGapMs, () => window.Sound?.play("click"));
    }
  }

  /** Zip position: from its frozen offset straight into the slot, gathering
   *  speed (u^1.5) so it locks at full speed: a hard stop, not an ease. */
  zipOffset(zip, key, col, rowStep, now) {
    const y0 = zip.from.get(key);
    const end = zip.ends[col];
    if (!y0 || !end) return 0;
    const u = clamp((now - zip.t0) / end, 0, 1);
    return y0 * rowStep * (1 - u * Math.sqrt(u));
  }

  /** Reduced-motion aware amplitudes for this frame (read once per draw). */
  motion() {
    return this._reducedMotion ? MOTION_REDUCED : MOTION;
  }

  /** Impact squash for a dropping symbol, on the same clock as cellOffset():
   *  the frame it hits its slot it flattens by the reel's squash, scaled by
   *  how hard it hit (impact speed grows with √distance: a full-reel fall gets
   *  all of it, a one-row refill ~45%), widening by half as much, and springs
   *  back to its shape over the first part of its bounce. Rigid in flight.
   *  Writes into a reused object: this runs for every cell, every frame. */
  dropDeform(row, col) {
    const out = this._deform || (this._deform = { sx: 1, sy: 1 });
    out.sx = 1;
    out.sy = 1;
    const m = this.motion();
    if (!m.squash) return out;
    const drop = this.fx.drop;
    if (!drop || drop.zip) return out;
    const count = Number(drop.map?.[`${row}-${col}`] || 0);
    if (count <= 0) return out;
    const prof = this.reelProfile(col);
    const progress = (performance.now() - drop.start - this.dropDelay(row, col, count)) / this.cellFallMs(col, count, drop);
    if (progress < prof.contact || progress >= 1) return out;
    const u = (progress - prof.contact) / (1 - prof.contact); // 0..1 through the bounce
    if (u >= MOTION.squashRelax) return out;
    const k = 1 - u / MOTION.squashRelax;
    const squash = m.squash * prof.squash * Math.min(1, Math.sqrt(count / this.rows)) * k * k;
    out.sy = 1 - squash;
    out.sx = 1 + squash * 0.5;
    return out;
  }

  /** Breath phase per winning cell: lags with distance from the cluster
   *  centre, so each breath ripples outward through the cluster. */
  breathPhases(winning) {
    const centre = this.computeCentroid(winning);
    const dists = winning.map((p) => {
      const c = this.cellCenter(p.row, p.col);
      return Math.hypot(c.x - centre.x, c.y - centre.y);
    });
    const maxD = Math.max(1, ...dists);
    const phases = new Map();
    winning.forEach((p, i) => phases.set(`${p.row}-${p.col}`, (dists[i] / maxD) * Math.PI * MOTION.breathRipple));
    return phases;
  }

  /** Per-column landing thud, in sync with the column waterfall: one
   *  reel_stop per column that actually received symbols, fired when that
   *  column's last symbol hits its floor (its stagger delay + the fall to
   *  fallEnd). Columns a tumble left untouched stay silent. On a fast-stop the
   *  board lands at once, so it gets one thud instead of a stack of them. */
  scheduleColumnStops(dropMap, duration) {
    this.cancelColumnStops();
    const drop = this.fx.drop;
    const landAt = new Map(); // col → ms from now
    const landings = []; // { row, col, t }: every symbol lands on its own
    const scatterLands = [];  // { row, col, t }
    for (const [key, count] of Object.entries(dropMap || {})) {
      const n = Number(count || 0);
      if (n <= 0) continue;
      const [row, col] = key.split("-").map(Number);
      if (!Number.isFinite(row) || !Number.isFinite(col)) continue;
      const t = this.dropDelay(row, col, n) + this.cellFallMs(col, n) * this.reelProfile(col).contact;
      landAt.set(col, Math.max(landAt.get(col) || 0, t));
      landings.push({ row, col, t });
      if (this.board.matrix?.[row]?.[col] === "SCATTER") scatterLands.push({ row, col, t });
    }
    if (!landAt.size) return;
    const last = Math.max(...landAt.values());
    this.scheduleScatterLandings(dropMap, scatterLands);
    const a = drop?.antic;
    if (a) {
      // Tension runs from the moment the column before the anticipated ones
      // lands (the board is visibly one short) until the last column lands.
      const startMs = landAt.get(a.fromCol - 1) ?? 0;
      a.startAt = drop.start + startMs;
      a.endAt = drop.start + last;
      a.landAt = new Map([...landAt].map(([c, t]) => [c, drop.start + t]));
      this._queueTimer(startMs, () => this.onAnticipation?.("start", last - startMs));
      this._queueTimer(last, () => this.onAnticipation?.("end"));
    }
    if (this._stopHits()) {
      this._queueColumnStop(0, last, null);
      return;
    }
    // Symbols of a reel that land together (a stack) land as one: one glint
    // pass over their floors and one tick. The reel's thud accents its last.
    const groups = new Map(); // "col|ms" → rows
    for (const s of landings) {
      const k = `${s.col}|${Math.round(s.t)}`;
      if (!groups.has(k)) groups.set(k, { col: s.col, t: s.t, rows: [] });
      groups.get(k).rows.push(s.row);
    }
    for (const g of groups.values()) this._queueTimer(g.t, () => this.symbolsLanded(g.rows, g.col));
    for (const [col, t] of landAt) this._queueColumnStop(col, t, null);
  }

  /** Symbols of reel `col` just hit their slots together: their floor
   *  glints and one landing tick (onSymbolLand, wired to Sound "tick"). */
  symbolsLanded(rows, col) {
    this.landingGlints(col, rows);
    this.onSymbolLand?.(Math.max(...rows), col);
  }

  /** A landing, felt where it happens: along the floor seam of each symbol
   *  that just landed, a steel hairline flares across the lane and a hot
   *  laser glint sweeps it left to right. Fired per symbol as it lands (and
   *  per reel on a fast-stop zip). Local light only, on the pooled
   *  ShardEmitter; the board itself never moves. */
  landingGlints(col, rows) {
    if (!rows?.length) return;
    const { laneW, rowStep } = this.getLayout();
    const E = this.shards;
    const line = E.flashSprite(THEME.color.steelSheen);
    const hot = E.flashSprite(THEME.color.tungstenSoft);
    const sweep = laneW * 0.84;
    for (const r of rows) {
      const c = this.cellCenter(r, col);
      const y = c.y + rowStep * 0.46;
      E.add(SHARD.FLASH, c.x, y, 0, 0, laneW * 1.05, 200, line,
        { aspect: 0.05, peak: 0.55, vr: 0, rot: 0, drag: 1 });
      E.add(SHARD.FLASH, c.x - sweep / 2, y, sweep / 150, 0, laneW * 0.5, 150, hot,
        { aspect: 0.1, peak: 0.95, vr: 0, rot: 0, drag: 1 });
    }
  }

  /** A timer owned by the current drop: cancelColumnStops() clears it. */
  _queueTimer(ms, fn) {
    if (!this._columnStops) this._columnStops = new Set();
    const id = setTimeout(() => {
      this._columnStops.delete(id);
      fn();
    }, Math.max(0, Math.round(ms)));
    this._columnStops.add(id);
  }

  /** 5a: a laser reticle and an ascending ping as each scatter lands, counted
   *  together with the scatters already resting on the board. */
  scheduleScatterLandings(dropMap, lands) {
    const need = this.fx.drop?.need || 0;
    this._pendingScatters = null;
    if (!lands.length || !need) return;
    let resting = 0;
    (this.board.matrix || []).forEach((rowArr, r) => (rowArr || []).forEach((sym, c) => {
      if (sym === "SCATTER" && !(Number(dropMap?.[`${r}-${c}`] || 0) > 0)) resting += 1;
    }));
    lands.sort((x, y) => x.t - y.t);
    this._pendingScatters = { need, resting, landed: 0, cells: lands.slice() };
    // Fast-stop: land them all now, unless this board is about to zip in
    // (_startZip re-times them to their reels' locks).
    if (this._stopHits() && !this._zipPending) {
      this.flushScatterLandings();
      return;
    }
    // Scatters that land on the same frame ring once, at their final count, so
    // the climb never skips a step (two bells on one frame would be debounced).
    const groups = new Map();
    for (const s of lands) {
      const f = Math.round(s.t / (1000 / 60));
      if (!groups.has(f)) groups.set(f, []);
      groups.get(f).push(s);
    }
    for (const group of groups.values()) this._queueTimer(Math.min(...group.map((s) => s.t)), () => this._landScatters(group));
  }

  _landScatters(group) {
    const p = this._pendingScatters;
    if (!p) return;
    let landed = 0;
    for (const s of group) {
      const i = p.cells.indexOf(s);
      if (i < 0) continue;
      p.cells.splice(i, 1);
      p.landed += 1;
      landed += 1;
      this.spawnReticle(s.row, s.col);
    }
    if (landed) this._announceScatters();
  }

  /** Fast-stop: every scatter still in the air lands now: one ping, final count. */
  flushScatterLandings() {
    const p = this._pendingScatters;
    if (!p || !p.cells.length) return;
    p.cells.forEach((s) => this.spawnReticle(s.row, s.col));
    p.landed += p.cells.length;
    p.cells = [];
    this._announceScatters();
  }

  _announceScatters() {
    const p = this._pendingScatters;
    const n = p.resting + p.landed;
    // Each scatter chimes a step higher: 1st, 2nd, 3rd… climb.
    window.Sound?.play("scatter_land", { n, need: p.need });
    this.onScatterCount?.(n, p.need);
  }

  spawnReticle(row, col) {
    const c = this.cellCenter(row, col);
    this.fx.reticles.push({ x: c.x, y: c.y, born: performance.now(), life: 900 });
  }

  /** 5c/5d: wide reticles converge on every scatter, then pulse locked. */
  async lockOn(cells, duration = 760) {
    if (!cells?.length) return;
    this.fx.lockOn = {
      start: performance.now(),
      duration: Math.round(duration * turboScale()),
      cells: cells.map((p) => this.cellCenter(p.row, p.col))
    };
    await animationSleep(duration);
    this.fx.lockOn = null;
  }

  /** Canvas layer for 5a reticles and the 5c/5d lock-on (over the symbols). */
  drawScatterLocks(ctx, radius) {
    const now = performance.now();
    const spinOk = !this._reducedMotion;
    const reticle = (x, y, r, spin, alpha, width) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(spin);
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.strokeStyle = THEME.color.laserHot;
      ctx.lineWidth = width;
      ctx.lineCap = "round";
      for (let k = 0; k < 4; k += 1) {
        const a0 = (k * Math.PI) / 2 + 0.28;
        ctx.beginPath();
        ctx.arc(0, 0, r, a0, a0 + Math.PI / 2 - 0.56);
        ctx.stroke();
      }
      ctx.beginPath();
      for (let k = 0; k < 4; k += 1) {
        const a = (k * Math.PI) / 2;
        ctx.moveTo(Math.cos(a) * r * 1.14, Math.sin(a) * r * 1.14);
        ctx.lineTo(Math.cos(a) * r * 0.8, Math.sin(a) * r * 0.8);
      }
      ctx.stroke();
      ctx.restore();
    };
    // 5a: snaps in from slightly wide, holds, fades.
    this.fx.reticles = this.fx.reticles.filter((q) => now - q.born < q.life);
    for (const q of this.fx.reticles) {
      const t = (now - q.born) / q.life;
      const r = radius * (1.25 - 0.35 * easeOutCubic(Math.min(1, t * 2.5)));
      const alpha = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
      reticle(q.x, q.y, r, spinOk ? t * 1.2 : 0, alpha, Math.max(1.5, radius * 0.06));
    }
    // 5c/5d: laser sights sweep in along the row and column of each scatter
    // while wide reticles converge on it, then the locks pulse.
    const L = this.fx.lockOn;
    if (!L) return;
    const t = clamp((now - L.start) / L.duration, 0, 1);
    const conv = easeOutCubic(Math.min(1, t / 0.7));
    const pulse = t > 0.7 ? 0.6 + 0.4 * Math.sin((t - 0.7) * Math.PI * 8) : 1;
    const { inX, inY, inW, inH } = this.getTableRect();
    for (const p of L.cells) {
      if (conv < 1) {
        ctx.save();
        ctx.globalAlpha = (1 - conv) * 0.7;
        ctx.strokeStyle = THEME.color.laser;
        ctx.lineWidth = Math.max(1, radius * 0.03);
        ctx.beginPath();
        ctx.moveTo(inX, p.y); ctx.lineTo(inX + inW, p.y);
        ctx.moveTo(p.x, inY); ctx.lineTo(p.x, inY + inH);
        ctx.stroke();
        ctx.restore();
      }
      reticle(p.x, p.y, radius * (2.6 - 1.75 * conv), spinOk ? (1 - conv) * Math.PI : 0,
        (0.35 + 0.65 * conv) * pulse, Math.max(2, radius * 0.08));
    }
  }

  /** 5b: the anticipated lanes glow security-laser red while they wait and
   *  fall, building with the wait; each lane releases as its column lands. */
  drawAnticipationLanes(ctx, a, layout) {
    const now = performance.now();
    if (!a.landAt || now < a.startAt) return;
    const { padX, top, laneW, rowStep } = layout;
    const h = rowStep * this.rows;
    const build = clamp((now - a.startAt) / Math.max(1, a.endAt - a.startAt), 0, 1);
    for (let c = a.fromCol; c < this.cols; c += 1) {
      const land = a.landAt.get(c);
      if (land == null) continue;
      const fade = now < land ? 1 : 1 - clamp((now - land) / 220, 0, 1);
      if (fade <= 0) continue;
      const x = padX + laneW * c;
      const strength = (0.35 + 0.45 * build) * fade;
      const g = ctx.createLinearGradient(x, 0, x + laneW, 0);
      g.addColorStop(0, THEME.alpha(THEME.color.laser, (0.55 * strength).toFixed(3)));
      g.addColorStop(0.18, THEME.alpha(THEME.color.laser, (0.12 * strength).toFixed(3)));
      g.addColorStop(0.82, THEME.alpha(THEME.color.laser, (0.12 * strength).toFixed(3)));
      g.addColorStop(1, THEME.alpha(THEME.color.laser, (0.55 * strength).toFixed(3)));
      ctx.fillStyle = g;
      ctx.fillRect(x, top, laneW, h);
      if (!this._reducedMotion && now < land) {
        const sy = top + ((now * 0.55 + c * 90) % h);
        ctx.fillStyle = THEME.alpha(THEME.color.laserHot, (0.5 * strength).toFixed(3));
        ctx.fillRect(x + 2, sy, laneW - 4, 2);
      }
    }
  }

  _queueColumnStop(col, ms, glintRows = null) {
    if (!this._columnStops) this._columnStops = new Set();
    const id = setTimeout(() => {
      this._columnStops.delete(id);
      // index raises the synth's pitch a step per reel, so the waterfall
      // reads left to right by ear as well as by eye.
      window.Sound?.play("reel_stop", { index: col });
      if (glintRows) this.landingGlints(col, glintRows);
    }, Math.max(0, Math.round(ms)));
    this._columnStops.add(id);
  }

  cancelColumnStops() {
    if (!this._columnStops) return;
    this._columnStops.forEach(clearTimeout);
    this._columnStops.clear();
  }

  /** A stand-in for a new multiplier that falls before its strike: the
   *  regular symbol with the fewest copies on `matrix` (multiplier cells and
   *  stand-ins already chosen counted), never SCATTER or MULTI, so it can never
   *  form or suggest a win (count + 1 ≤ min_match − 2). Ties break on the cell,
   *  so the choice is stable. Cosmetic only: nothing is evaluated on it. */
  pickStandIn(matrix, skip, key, extra = new Map()) {
    const counts = new Map(Object.keys(payouts).map((sym) => [sym, extra.get(sym) || 0]));
    for (let r = 0; r < matrix.length; r += 1) {
      for (let c = 0; c < (matrix[r] || []).length; c += 1) {
        const sym = matrix[r][c];
        if (skip.has(`${r}-${c}`) || !counts.has(sym)) continue;
        counts.set(sym, counts.get(sym) + 1);
      }
    }
    let h = 2166136261;
    for (let i = 0; i < key.length; i += 1) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const syms = [...counts.keys()];
    let best = null;
    for (let i = 0; i < syms.length; i += 1) {
      const sym = syms[(h + i) % syms.length];
      if (best === null || counts.get(sym) < counts.get(best)) best = sym;
    }
    return best;
  }

  /** STRIKE plan for the new multipliers of `drop` (cells: key → info). */
  _planStrikes(drop, cells, heavy) {
    const keys = [...cells.keys()].filter((k) => Number(drop.map?.[k]) > 0);
    keys.sort((a, b) => { const [ra, ca] = a.split("-").map(Number); const [rb, cb] = b.split("-").map(Number); return ca - cb || rb - ra; });
    const skip = new Set(keys);
    const chosen = new Map();
    drop.strikes = keys.map((key, i) => {
      const [r, c] = key.split("-").map(Number);
      const info = cells.get(key);
      const standIn = this.pickStandIn(this.board.matrix, skip, key, chosen);
      chosen.set(standIn, (chosen.get(standIn) || 0) + 1);
      return { key, r, c, i, tier: info.tier, value: info.value, heavy: heavy.has(key), standIn, bolted: false, swapped: false };
    });
    drop.strikeMap = new Map(drop.strikes.map((st) => [st.key, st]));
    drop.strikeQuick = state.fastStopRequested;
  }

  /** When the whole drop has landed (bounce included), ms from its start. */
  _landedMs(drop) {
    if (drop.zip) return Math.max(0, ...drop.zip.ends);
    return this.dropEndMs(drop.map);
  }

  /** When strike `st` hits (its bolt), ms from the drop's start. */
  _strikeAt(drop, st) {
    const t = turboScale();
    if (drop.strikeQuick) return this._landedMs(drop) + st.i * Math.round(STRIKE.stopMs * 0.5);
    return this._landedMs(drop) + Math.round((STRIKE.beatMs + st.i * STRIKE.gapMs) * t);
  }

  /** When strike `st` turns the stand-in into the multiplier (flash peak). */
  _strikeSwapAt(drop, st) {
    return this._strikeAt(drop, st) + (drop.strikeQuick ? 40 : Math.round(STRIKE.flashPeakMs * turboScale()));
  }

  /** When the last strike's punch ends, ms from the drop's start. */
  _strikesEndMs(drop) {
    let end = 0;
    for (const st of drop?.strikes || []) end = Math.max(end, this._strikeSwapAt(drop, st) + MULTI_PUNCH.ms);
    return end;
  }

  /** A Stop: every pending strike fires at once (quick), never skipped. */
  _quickStrikes(drop) {
    if (!drop?.strikes?.length || drop.strikeQuick) return;
    drop.strikeQuick = true;
    drop.endAt = Math.max(drop.endAt || 0, drop.start + Math.max(this._landedMs(drop), this._strikesEndMs(drop)) + 30);
  }

  /** Fire each strike's bolt and swap on the frame they are due. `now` =
   *  Infinity fires everything still pending. */
  _fireStrikes(now = performance.now()) {
    const d = this.fx.drop;
    if (!d?.strikes?.length) return;
    const e = now - d.start;
    for (const st of d.strikes) {
      if (!st.bolted && e >= this._strikeAt(d, st)) {
        st.bolted = true;
        st.boltAt = Number.isFinite(now) ? now : performance.now();
        if (!this._reducedMotion) this.spawnLightningStrike(st.r, st.c, st.tier);
      }
      if (!st.swapped && e >= this._strikeSwapAt(d, st)) {
        st.swapped = true;
        const at = Number.isFinite(now) ? now : performance.now();
        if (!st.boltAt) st.boltAt = at;
        this.fx.heavyReveals.set(st.key, { revealAt: at, revealDuration: MULTI_PUNCH.ms, tier: st.tier, value: st.value });
        // The crack + thunder lands on the flash's peak, the frame the art turns.
        window.Sound?.play("multiplier_strike", { value: st.value });
        if (st.heavy) this.spawnHeavyImpact(st.r, st.c, st.tier, st.value, { bolt: false });
        else window.Sound?.play("multiplier_drop", { value: st.value });
      }
    }
  }

  /** The strikes' light: a crackle at the top of the lane just before the
   *  bolt, then a white-gold flash over the cell that peaks as the art turns
   *  (drawn ON TOP of the cells, additive; the art itself never fades). */
  drawStrikes(ctx, { padX, top, laneW, rowStep }) {
    const d = this.fx.drop;
    if (!d?.strikes?.length) return;
    const now = performance.now();
    const e = now - d.start;
    const cs = Math.min(laneW, rowStep);
    const t = turboScale();
    const calm = this._reducedMotion;
    const flashMs = Math.max(60, Math.round(STRIKE.flashMs * (d.strikeQuick ? 0.5 : t)));
    const flash = this.getGlowSprite(STRIKE.flash);
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const st of d.strikes) {
      const at = this._strikeAt(d, st);
      const x = padX + laneW * (st.c + 0.5);
      const y = top + rowStep * (st.r + 0.5);
      // Crackle at the top of the lane, flickering in just before the bolt.
      const flick = Math.round(STRIKE.flickerMs * t);
      if (!calm && !d.strikeQuick && e >= at - flick && e < at) {
        const k = (e - (at - flick)) / Math.max(1, flick);
        ctx.globalAlpha = (0.35 + 0.5 * k) * (0.6 + 0.4 * Math.random());
        const fr = cs * (0.18 + 0.12 * k);
        ctx.drawImage(flash.cvs, x - fr, top - fr * 0.5, fr * 2, fr * 2);
      }
      // The impact flash, peaking as the art turns into the multiplier.
      if (e >= at && e < at + flashMs) {
        const peak = Math.max(1, this._strikeSwapAt(d, st) - at);
        const u = e - at;
        const a = u < peak ? u / peak : 1 - (u - peak) / Math.max(1, flashMs - peak);
        ctx.globalAlpha = clamp(a, 0, 1) * (calm ? 0.5 : 0.95);
        const fr = cs * (0.7 + 0.35 * (u / flashMs));
        ctx.drawImage(flash.cvs, x - fr, y - fr, fr * 2, fr * 2);
      }
    }
    ctx.restore();
  }

  dropDelay(row, col, count) {
    // A Stop collapses a spin board's waterfall (a zip snapshot reads the
    // live one); a tumble refill keeps its waterfall.
    if (this._stopHits() && !this._liveTiming) return 0;
    // Reel release (WATERFALL): the whole reel goes at once (it falls as a
    // stack), reels left to right by their rank among the reels that drop.
    // A spin uses spinColMs, a tumble refill tumbleColMs; cascade momentum
    // (drop.tempo) tightens it. Scaled by turbo.
    const drop = this.fx.drop;
    const o = drop?.order;
    const rank = o ? o.rank[col] : col;
    const colMs = drop?.spin ? WATERFALL.spinColMs : WATERFALL.tumbleColMs;
    const raw = rank * colMs * (drop?.tempo || 1);
    // Anticipated columns (5b) wait an extra beat each, stacking left to right.
    const a = drop?.antic;
    const hold = a && col >= a.fromCol ? a.holdMs * (col - a.fromCol + 1) : 0;
    return Math.max(0, Math.round(raw * turboScale()) + hold);
  }

  /** Per-drop release order: each reel's rank among the reels that drop (and
   *  its lowest dropping row). Computed once per drop; dropDelay falls back to
   *  plain column order without it. */
  _dropOrder(map) {
    const bottom = new Int8Array(this.cols).fill(-1);
    for (const key of Object.keys(map || {})) {
      if (!(Number(map[key]) > 0)) continue;
      const [r, c] = key.split("-").map(Number);
      if (Number.isFinite(r) && Number.isFinite(c) && r > bottom[c]) bottom[c] = r;
    }
    const rank = new Int8Array(this.cols);
    let k = 0;
    for (let c = 0; c < this.cols; c += 1) rank[c] = bottom[c] >= 0 ? k++ : 0;
    return { bottom, rank };
  }

  /** One symbol's whole motion, in ms: its fall under GRAVITY (a full-reel
   *  fall takes colDropMs, a fall of `count` rows √(count / rows) of that)
   *  plus its bounce, so impact comes at `contact` of it. */
  cellFallMs(col, count, drop = this.fx.drop) {
    const fall = this.colDropMs(col, drop) * Math.sqrt(clamp(count / this.rows, 0, 4));
    return fall / this.reelProfile(col).contact;
  }

  /** Full-reel fall time of one column of the current drop (its gravity).
   *  Anticipated columns fall slower. Every drop timing (landing, sound,
   *  reveals, dust, settle) goes through this, so they cannot disagree. */
  colDropMs(col, drop = this.fx.drop) {
    if (!drop) return 0;
    const a = drop.antic;
    return a && col >= a.fromCol ? drop.duration * a.slow : drop.duration;
  }

  /** When the last cell of the current drop has fully landed, ms from start. */
  dropEndMs(dropMap) {
    let end = 0;
    for (const [key, count] of Object.entries(dropMap || {})) {
      const n = Number(count || 0);
      if (n <= 0) continue;
      const [r, c] = key.split("-").map(Number);
      if (!Number.isFinite(r) || !Number.isFinite(c)) continue;
      end = Math.max(end, this.dropDelay(r, c, n) + this.cellFallMs(c, n));
    }
    return end;
  }

  /** Anticipation state for a new drop, or null. Never on a fast-stop. */
  makeAnticipation(a) {
    if (!a || !(a.fromCol > 0) || a.fromCol >= this.cols || state.fastStopRequested) return null;
    return {
      fromCol: a.fromCol,
      holdMs: Math.round(ANTICIPATION.holdMs * turboScale()),
      slow: ANTICIPATION.slowFall,
      startAt: 0,   // absolute ms: set by scheduleColumnStops()
      endAt: 0,
      landAt: null
    };
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
    const ms = Math.round((duration ?? (tier === "blast-great" ? 560 : 280)) * turboScale());
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
    // Once per frame, not per cell: matchMedia is not free.
    this._reducedMotion = prefersReducedMotion();
    const { width, height, padX, top, laneW, rowStep, radius } = this.getLayout();
    ctx.clearRect(0, 0, width, height);

    // Static stage (the cell-corner marks) is baked once, rebuilt on resize.
    if (!this.stageCacheBack || !this.stageCacheFront) {
      this.buildStageCache();
    }
    // Frameless glass: the canvas is transparent over the CSS glass (.reels-stage),
    // so there is no back layer or ambient fog to paint, only the baked cell-corner
    // marks.
    ctx.drawImage(this.stageCacheFront.cvs, 0, 0, width, height);

    if (this.fx.spinBurst) {
      const t = clamp((performance.now() - this.fx.spinBurst.start) / this.fx.spinBurst.duration, 0, 1);
      const a = (1 - t) * 0.22;
      ctx.fillStyle = THEME.alpha(THEME.stage.spinFlash, a.toFixed(3));
      ctx.fillRect(0, 0, width, height);
    }

    // Live (animated) content. With no painted frame the glass edge IS the board
    // edge, and CSS already clips the canvas to it (.reels-stage: overflow hidden,
    // rounded), so there is no inner table clip any more: the old one cut the art of
    // the outer columns and boxed the spotlight dim inside the glass. In-flight
    // symbols are still masked to the grid per cell (REEL_MASK).
    ctx.save();

    // Falling-symbol streaks down each column — only while a drop is in flight.
    if (this.fx.drop) {
      for (let c = 0; c < this.cols; c += 1) {
        const x = padX + laneW * (c + 0.5);
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
    // Celebration glow: quick attack, then SUSTAIN at a high plateau with a
    // gentle shimmer for the whole (now multi-second) hold, then a short
    // release at the tail. The old curve faded back to 0 by the end, so a 2.5s
    // celebration visibly "died" before the explosion — this keeps the caught
    // cluster alive and breathing right up until it bursts.
    const pulseGlow = this.fx.pulse
      ? (() => {
          const attack = 0.1;
          const release = 0.16;
          const plateau = 0.84;
          let env;
          if (pulse < attack) env = easeOutCubic(pulse / attack);
          else if (pulse > 1 - release) env = 1 - easeInOutCubic((pulse - (1 - release)) / release);
          else env = 1;
          const shimmer = 0.16 * (0.5 + 0.5 * Math.sin((performance.now() - this.fx.pulse.start) * 0.011));
          return clamp(env * (plateau + shimmer), 0, 1);
        })()
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

    if (this.fx.waves.length) {
      // Cluster-blast shockwave (#54): a thin ring riding the wave's front,
      // fading as it spreads. The symbols it passes light up in the cell pass.
      const now = performance.now();
      this.fx.waves = this.fx.waves.filter((w) => now - w.born < w.life);
      for (const w of this.fx.waves) {
        const t = clamp((now - w.born) / w.life, 0, 1);
        ctx.globalAlpha = 0.5 * (1 - t) * (1 - t);
        ctx.strokeStyle = w.color;
        ctx.lineWidth = Math.max(1.2, w.band * 0.22 * (1 - t));
        ctx.beginPath();
        ctx.arc(w.x, w.y, Math.max(1, w.reach * easeOutCubic(t)), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

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
        // Localised impact light (it used to white out the whole frame and
        // bloom across the canvas): a tier-coloured bloom about two cells
        // across plus a white-hot core, centred on the landing cell.
        const r = radius * (1.6 + 0.6 * b.heaviness) * (0.85 + 0.15 * a);
        const bloom = this.getGlowSprite(b.tier.accent);
        const core = this.getGlowSprite("#ffffff");
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = a * 0.9;
        ctx.drawImage(bloom.cvs, b.x - r, b.y - r, r * 2, r * 2);
        ctx.globalAlpha = a * 0.7;
        ctx.drawImage(core.cvs, b.x - r * 0.45, b.y - r * 0.45, r * 0.9, r * 0.9);
        ctx.globalCompositeOperation = "source-over";
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

    // 5b: anticipation lanes, behind the symbols.
    if (this.fx.drop?.antic) this.drawAnticipationLanes(ctx, this.fx.drop.antic, { padX, top, laneW, rowStep });
    // Multiplier strikes due this frame (bolt, then the swap at the flash).
    this._fireStrikes();

    // Win focus (FOCUS, #55): one backdrop darkening behind the symbols; the
    // symbols outside the focus set step back through their own alpha below.
    const frameNow = performance.now();
    const focusLevel = envelopeLevel(this.focus, frameNow);
    const focusSet = this.focus.set;
    if (focusLevel > 0.001) {
      ctx.fillStyle = `rgba(2, 5, 12, ${(FOCUS.backdrop * focusLevel).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }

    // Spin-out (#47): the old board falling out, behind the new one.
    if (this.fx.exit) this.drawExitBoard(ctx, { width, top, padX, laneW, rowStep, radius });

    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        if (this.board.hidden) continue;
        // A new multiplier shows its stand-in until its strike turns it (STRIKE).
        const strike = this.fx.drop?.strikeMap?.get(`${r}-${c}`);
        const symbol = strike && !strike.swapped ? strike.standIn : this.board.matrix?.[r]?.[c] || "BLUE_DIAMOND";
        const key = `${r}-${c}`;
        const x = padX + laneW * (c + 0.5);
        const yBase = top + rowStep * (r + 0.5);
        const isSlamColumn = Boolean(this.fx.reelSlam?.columns?.has(c));
        const slamOffset = isSlamColumn ? reelSlamWave * radius * 0.46 : 0;
        const y = yBase + this.cellOffset(r, c, rowStep) + slamOffset;
        const isWinner = this.board.winningSet.has(key);
        // A cell that is actively falling (refilled by the tumble drop) must not
        // inherit the explode fade. The drop commits the new board ~200ms into
        // the 540ms explode, so the former winning-cell positions now hold the
        // NEW dropping symbols; without this guard they'd be faded to invisible
        // by the still-running blast and then snap back in — the "disappear for a
        // second" glitch. Old winners still fade normally in the pre-drop window
        // (they aren't in the drop map yet).
        const isFalling = Number(this.fx.drop?.map?.[key] || 0) > 0;
        // The reel mask (REEL_MASK): everything a symbol in flight draws (its
        // art and any glow on it) is clipped to the grid, so it appears exactly
        // as it crosses into row 0 and never over the frame above (or below,
        // leaving). Near its slot the edge eases out to the art's resting
        // overhang (sized for the largest art, 1.12×). Resting symbols
        // are never clipped; only moving cells pay for a cheap rect clip.
        const offY = y - yBase - slamOffset;
        const inFlight = isFalling && offY !== 0;
        if (inFlight) {
          const over = Math.max(0, (Math.min(laneW, rowStep) * 1.12 - rowStep) / 2);
          const edge = over * clamp(1 - Math.abs(offY) / (rowStep * REEL_MASK.settleRows), 0, 1);
          const y0 = top - edge;
          const y1 = top + rowStep * this.rows + over;
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, y0, width, y1 - y0);
          ctx.clip();
        }
        // Blasting = THIS symbol exploded (it is on board.cleared). A refill's
        // setBoard() resets cleared, so a new symbol landing while the burst's
        // timer still runs never inherits its fade (it used to blink out for
        // up to ~100ms at the end of its bounce).
        const isBlast = !isFalling && Boolean(this.fx.blast?.set?.has(key)) && this.board.cleared.has(key);
        // Per-cell blast progress — staggered across cells so big wins ripple
        // outward instead of all popping at the same instant.
        let cellBlast = 0;
        if (isBlast) {
          const cellDelay = this.fx.blast.delays?.get(key) || 0;
          const cellDur = this.fx.blast.cellDuration || this.fx.blast.duration;
          cellBlast = clamp((performance.now() - this.fx.blast.start - cellDelay) / cellDur, 0, 1);
        }
        // A cleared cell (#50) draws nothing once its symbol's art is gone
        // (BLAST_GONE into its burst, or after it): its symbol has left the board.
        if (!isFalling && this.board.cleared.has(key) && (!isBlast || cellBlast >= BLAST_GONE)) {
          if (inFlight) ctx.restore(); // reel mask
          continue;
        }
        if (this._traceCells) this._traceCells.add(key); // probes: cells drawn this frame
        // Blast (#50): the symbol pops (swells CLUSTER_BLAST.pop) and is gone by
        // BLAST_GONE of its burst: no lingering see-through ghost. The shards,
        // flare and shockwave carry the rest of the burst.
        const goneT = clamp(cellBlast / BLAST_GONE, 0, 1);
        const blastFade = isBlast ? 1 - easeInCubic(goneT) : 1;
        const blastPop = isBlast && !this._reducedMotion ? 1 + CLUSTER_BLAST.pop * easeOutCubic(goneT) : 1;
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
        // Winners breathe during the hold: a resting swell plus a slow in-out,
        // phase-lagged from the cluster centre (breathPhases) so it ripples.
        let pulseScale = 1;
        if (isWinner && this.fx.pulse) {
          const m = this.motion();
          const lag = this.fx.pulse.phase?.get(key) || 0;
          const w = ((performance.now() - this.fx.pulse.start) / m.breathMs) * Math.PI * 2 - lag;
          const breath = 0.5 - 0.5 * Math.cos(w);
          pulseScale = 1 + pulseGlow * (m.breathBase + m.breathDepth * breath);
        }
        const isMultiCaught = symbol === "MULTI" && Boolean(this.fx.multiCatch?.set?.has(key));
        const catchScale = isMultiCaught ? 1 + multiCatchPulse * 0.26 : 1;
        // Rigid: a multiplier BANG never squashes its symbol. Its weight is the
        // thud, the local bloom and the spotlight flash fired in
        // spawnHeavyImpact(). squashX/Y stay as the hook dropDeform() feeds.
        let squashY = 1;
        let squashX = 1;
        const deform = this.dropDeform(r, c);
        squashX *= deform.sx;
        squashY *= deform.sy;
        const baseScale = pulseScale * catchScale * chargeShrink * blastPop;
        // A multiplier that just landed punches (MULTI_PUNCH): it swells and
        // settles back, never shrinking, never fading, never hidden.
        const reveal = this.fx.heavyReveals.get(key);
        let revealScale = 1;
        if (reveal) {
          const nowMs = performance.now();
          if (nowMs >= reveal.revealAt) {
            const rt = clamp((nowMs - reveal.revealAt) / reveal.revealDuration, 0, 1);
            if (!this._reducedMotion) revealScale = 1 + MULTI_PUNCH.scale * Math.sin(Math.PI * rt);
            if (rt >= 1) this.fx.heavyReveals.delete(key);
          }
        }
        const ringR = radius * 1.05 * baseScale * revealScale;
        const coreR = radius * 1.05 * baseScale * revealScale;
        const scatterSizeBoost = symbol === "SCATTER" ? 1.22 : 1;
        // Fill the cell: symbols are drawn nearly edge-to-edge (Pragmatic-style)
        // instead of the old ~0.94-of-cell size that left big gaps.
        const maxIconBase = Math.min(laneW, rowStep) * 1.12;
        const iconBase = Math.min(
          radius * 2.5 * baseScale * scatterSizeBoost * revealScale,
          maxIconBase * baseScale * revealScale
        );
        // A multiplier's emblem has its own box: the cell (MULTI_EMBLEM).
        const isMulti = symbol === "MULTI";
        const iconW = isMulti ? laneW * MULTI_EMBLEM.boxW * baseScale * revealScale * squashX : iconBase * squashX;
        const iconH = isMulti ? rowStep * MULTI_EMBLEM.boxH * baseScale * revealScale * squashY : iconBase * squashY;
        // A squashed symbol stays planted on its floor instead of shrinking
        // toward its centre: the floor of its OWN unsquashed box. (It used to
        // be the square icon box for every symbol; a multiplier's emblem box is
        // shorter, so the emblem sat below the cell centre, jumped down at its
        // strike swap (5.8px at 390, 11.6px at 1366) and drifted with every
        // pulse. At rest every symbol is now centred on its cell.)
        const restH = isMulti ? rowStep * MULTI_EMBLEM.boxH * baseScale * revealScale : iconBase;
        const iconCy = y + Math.max(0, restH - iconH) * 0.5;
        // Win focus (FOCUS): symbols outside the focus set step back.
        const spotDim = focusLevel > 0.001 && !focusSet?.has(key) ? 1 - FOCUS.dim * focusLevel : 1;

        // Spotlight halo: brighten cells on the spotlight set during big
        // events, working with the dim overlay to draw the eye in.
        if (isSpotlit && spotlightAlpha > 0.05) {
          const sp = ctx.createRadialGradient(x, y, 0, x, y, coreR * 2.4);
          sp.addColorStop(0, `rgba(255, 240, 210, ${(0.32 * spotlightAlpha / 0.7).toFixed(3)})`);
          sp.addColorStop(0.55, `rgba(255, 220, 170, ${(0.14 * spotlightAlpha / 0.7).toFixed(3)})`);
          sp.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = sp;
          ctx.beginPath();
          ctx.arc(x, y, coreR * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }

        if (isCharging) {
          // Building glow during the wind-up.
          const cg = ctx.createRadialGradient(x, y, 0, x, y, coreR * 1.9);
          cg.addColorStop(0, `rgba(255, 245, 215, ${(0.55 * chargeGlow).toFixed(3)})`);
          cg.addColorStop(0.5, `rgba(255, 210, 150, ${(0.25 * chargeGlow).toFixed(3)})`);
          cg.addColorStop(1, "rgba(0, 0, 0, 0)");
          ctx.fillStyle = cg;
          ctx.beginPath();
          ctx.arc(x, y, coreR * 1.9, 0, Math.PI * 2);
          ctx.fill();
        }

        // Winner aura colour: the symbol's own (THEME.aura), so a cluster of blue
        // diamonds glows cyan and a cluster of crowns glows gold.
        const auraColor = isWinner ? (THEME.aura[symbol] || THEME.glow.win) : null;
        if (isWinner) {
          // Halo breathes with the celebration pulse so the held cluster reads
          // as actively celebrating, not statically lit. A floor keeps it
          // clearly marked even at the shimmer's low point. Blitted from the
          // cached glow sprite (one per colour) instead of a gradient per frame.
          const haloPulse = 0.55 + 0.45 * pulseGlow;
          const glow = this.getGlowSprite(auraColor);
          const haloR = ringR * 1.55;
          ctx.globalAlpha = 0.85 * blastFade * haloPulse;
          ctx.drawImage(glow.cvs, x - haloR, y - haloR, haloR * 2, haloR * 2);
          ctx.globalAlpha = 1;
        }

        if (isSlamColumn) {
          const slamGlow = ctx.createRadialGradient(x, y - coreR * 0.8, 0, x, y, coreR * 1.7);
          slamGlow.addColorStop(0, this.fx.reelSlam.accent || "rgba(170, 214, 255, 0.36)");
          slamGlow.addColorStop(1, "rgba(170, 214, 255, 0)");
          ctx.globalAlpha = Math.max(0, 0.62 * (1 - reelSlamProgress));
          ctx.fillStyle = slamGlow;
          ctx.beginPath();
          ctx.arc(x, y, coreR * 1.7, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        const multiValueNum = isMulti ? Number(this.board.multiMap.get(key) || 1) : null;
        // A multiplier is its winged-sun emblem, number baked in (one sprite
        // per value and size); every other symbol is its art.
        const emblem = isMulti ? this.multiplierSprite(multiValueNum, laneW * MULTI_EMBLEM.boxW, rowStep * MULTI_EMBLEM.boxH) : null;
        const img = emblem ? null : this.images.get(symbol);
        if (emblem || (img?.complete && img.naturalWidth)) {
          ctx.globalAlpha = blastFade * spotDim;
          if (this._traceAlpha) this._traceAlpha.set(key, ctx.globalAlpha); // probes: the art's opacity
          // SCATTER art is a rectangular (wide) tile, not a square sprite. Draw
          // it at its true aspect ratio contained inside the icon box so it is
          // never stretched; every other symbol still fills the square box.
          let drawW = iconW;
          let drawH = iconH;
          if (symbol === "SCATTER") {
            const ar = img.naturalWidth / img.naturalHeight;
            if (iconW / iconH > ar) drawW = iconH * ar;
            else drawH = iconW / ar;
          }
          // Blit the pre-scaled sprite rather than resampling the source art on
          // every cell, every frame (a multiplier: its baked emblem).
          const sprite = emblem || this.getSymbolSprite(symbol, img, drawW, drawH);
          ctx.drawImage(sprite, x - drawW / 2, iconCy - drawH / 2, drawW, drawH);
          // probes: where each cell's art was drawn this frame (centre and size, CSS px)
          if (this._traceDraw) this._traceDraw.push({ key, symbol, x, y: iconCy, w: drawW, h: drawH, fall: inFlight });
          if (this.fx.waves.length && !isBlast) {
            // Shockwave light (#54): the front lights each symbol it passes.
            const lit = this.waveLight(x, iconCy, performance.now());
            if (lit.a > 0.01) {
              const gr = Math.max(drawW, drawH) * 0.62;
              ctx.save();
              ctx.globalCompositeOperation = "lighter";
              ctx.globalAlpha = lit.a * spotDim;
              ctx.drawImage(lit.wave.glow.cvs, x - gr, iconCy - gr, gr * 2, gr * 2);
              ctx.restore();
            }
          }
          if (isWinner && !isFalling) {
            // Inner glow: the aura added back OVER the art (additive), small and
            // breathing with the pulse, so the winning symbol itself lights up
            // instead of sitting in a box. One cached-sprite blit per winner.
            const inner = this.getGlowSprite(auraColor);
            const innerR = Math.min(drawW, drawH) * 0.42;
            ctx.save();
            ctx.globalCompositeOperation = "lighter";
            ctx.globalAlpha = (0.16 + 0.22 * pulseGlow) * blastFade * spotDim;
            ctx.drawImage(inner.cvs, x - innerR, iconCy - innerR, innerR * 2, innerR * 2);
            ctx.restore();
          }
        } else {
          ctx.fillStyle = THEME.text.label;
          ctx.font = THEME.canvasFont(600, Math.max(10, coreR * 0.22), THEME.font.ui);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(symbol.slice(0, 2), x, y);
        }

        if (symbol === "TOP_CROWN") {
          const crownGlow = ctx.createRadialGradient(x, y - coreR * 0.36, 0, x, y - coreR * 0.36, coreR * 0.75);
          crownGlow.addColorStop(0, THEME.alpha(THEME.glow.winHot, 0.26));
          crownGlow.addColorStop(1, THEME.alpha(THEME.glow.winHot, 0));
          ctx.fillStyle = crownGlow;
          ctx.beginPath();
          ctx.arc(x, y - coreR * 0.22, coreR * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }

        if (symbol === "SCATTER") {
          const orbit = 0.82 + Math.sin(this.time * 0.006 + c + r * 0.5) * 0.12;
          ctx.strokeStyle = `rgba(198, 211, 255, ${0.38 * blastFade})`;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(x, y, ringR * orbit, 0, Math.PI * 2);
          ctx.stroke();
          ctx.strokeStyle = `rgba(224, 235, 255, ${0.22 * blastFade})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(x, y, ringR * (orbit + 0.15), 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
        if (inFlight) ctx.restore(); // reel mask
      }
    }

    // Multiplier strikes: the crackle and the flash, over the symbols.
    if (this.fx.drop?.strikes?.length) this.drawStrikes(ctx, { padX, top, laneW, rowStep });

    // 5a/5c/5d: scatter reticles and the trigger lock-on, over the symbols.
    if (this.fx.reticles.length || this.fx.lockOn) this.drawScatterLocks(ctx, radius);

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

    // Symbol destruction fragments + local light (time-based, pooled).
    this.shards.render(ctx, this.dpr);

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
        // Soft glow via a pre-rendered per-colour sprite (no per-particle
        // gradient allocation). Blit scaled to the particle's glow radius.
        const glowR = p.size * 3.2;
        const sprite = this.getGlowSprite(p.colorA);
        ctx.globalAlpha = alpha * 0.7;
        ctx.drawImage(sprite.cvs, p.x - glowR, p.y - glowR, glowR * 2, glowR * 2);
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
// Exposed for tooling only (tools/layout-check.js instruments the sprite caches
// to assert nothing rebuilds them mid-round). Nothing in the game reads this.
window.__reelRenderer = reelRenderer;

// ─── Canvas context loss boundary ───────────────────────────────────────────
// Under memory pressure (low-end phones, many tabs) the browser may drop the board's
// 2D context ("contextlost"). Without a guard the render loop keeps drawing into a
// dead context and the board stays blank after it comes back. So: on loss, stop the
// loop (preventDefault asks the browser to restore it); on "contextrestored", drop
// every baked sprite / stage cache (their canvases may have been dropped too), draw
// fresh, and, when idle in platform mode, re-read the session from the RGS so the
// balance and free-spin counters are the server's, not whatever was on screen.
// The round itself never depended on the canvas: the result is server-side.
const contextGuard = { lost: 0, restored: 0 };
function installContextLossGuard(renderer) {
  const cvs = renderer.canvas;
  if (!cvs?.addEventListener) return;
  cvs.addEventListener("contextlost", (event) => {
    event.preventDefault();
    contextGuard.lost += 1;
    renderer.pauseRendering();
  });
  cvs.addEventListener("contextrestored", () => {
    contextGuard.restored += 1;
    renderer.glowSprites.clear();
    renderer.symbolSprites.clear();
    renderer.emblemSprites.clear();
    renderer.stageCacheBack = null;
    renderer.stageCacheFront = null;
    renderer.resumeRendering();
    renderer.forceDrawNow();
    resyncAfterContextLoss();
  });
}
installContextLossGuard(reelRenderer);

async function resyncAfterContextLoss() {
  if (!_platform.enabled || !_platform.sessionToken || isRoundInFlight()) return;
  try {
    const res = await fetch("/game/v1/session", { headers: { authorization: `Bearer ${_platform.sessionToken}` } });
    if (!res.ok) return;
    const body = await res.json();
    const balance = Number(body.balance?.amount);
    if (Number.isFinite(balance)) {
      el.balance.textContent = fmt(balance);
      embedBalance(balance);
    }
    el.freeSpins.textContent = String(Number(body.free_spins_left || 0));
  } catch { /* offline: the next round's answer brings the server's numbers */ }
}

// ─── WIN TIERS ──────────────────────────────────────────────────────────────
// The ONE place a win's size becomes presentation. Everything that reacts to
// "how big was that" (big-win overlay label + colour, sound, cluster blast
// strength, win-chip and spin-log styling, ambiance) reads a
// tier from here. Thresholds are × bet; ordered high → low, first match wins.
// Overlay colour lives in CSS: big-win.js sets data-tier and styles.css maps
// it to the matching --tier-* token. `color` mirrors that token for canvas use
// (via THEME, so it is the same value).
// Presentation only: nothing here feeds back into the engine.
//   overlay  — the round-end win opens the full-screen celebration (big-win.js)
//   sfx      — Sound key (step reveal, and the overlay's tier-up)
//   blast    — renderer intensity for the cluster (particles, explode, bloom)
//   flash    — full-board jackpotFlash on the winning step
//   countMs  — overlay only: time for the count to cross this tier's span
//   fx       — overlay only: celebration effect set ("coins" | "sparks" | "motherlode")
const WIN_TIERS = Object.freeze([
  Object.freeze({ key: "epic",  minX: 50, label: "MOTHERLODE",    color: THEME.winTier.epic, overlay: true,  sfx: "win_epic",  blast: "blast-great",  flash: true,  countMs: 2200, fx: "motherlode" }),
  Object.freeze({ key: "mega",  minX: 25, label: "LASER BREACH",  color: THEME.winTier.mega, overlay: true,  sfx: "win_mega",  blast: "blast-great",  flash: false, countMs: 1500, fx: "sparks" }),
  Object.freeze({ key: "big",   minX: 10, label: "VAULT CRACKED", color: THEME.winTier.big,  overlay: true,  sfx: "win_big",   blast: "blast-medium", flash: false, countMs: 1800, fx: "coins" }),
  // "Heartbeat" wins: no overlay (no UI interruption), but the cluster still
  // gets the medium burst so dry spells keep a pulse.
  Object.freeze({ key: "nice",  minX: 5,  label: null,            color: THEME.winTier.nice, overlay: false, sfx: "win_small", blast: "blast-medium", flash: false }),
  Object.freeze({ key: "small", minX: 0,  label: null,            color: THEME.winTier.nice, overlay: false, sfx: "win_small", blast: "blast-small",  flash: false })
]);

// Max win is the engine's cap EVENT, not a threshold, so it sits outside the
// ladder. The overlay counts up through the normal tiers and lands on this.
const WIN_TIER_MAX = Object.freeze({
  key: "max", minX: Infinity, label: "MAX WIN", color: THEME.winTier.max, overlay: true,
  sfx: "max_win", blast: "blast-great", flash: true, countMs: 0, fx: "motherlode"
});

function getWinTier(amount, bet) {
  const x = bet > 0 ? Number(amount || 0) / bet : 0;
  return WIN_TIERS.find((t) => x >= t.minX) || WIN_TIERS[WIN_TIERS.length - 1];
}

// Tier for one tumble step. win_total is the step's raw ways total (the sum
// of its ways_wins), the same figure the old per-step thresholds used.
function stepWinTier(step, bet) {
  return getWinTier(Number(step?.win_total || 0), bet);
}

// ─── Big-win celebration ────────────────────────────────────────────────────
// The full-screen overlay (big-win.js) for round wins on an overlay tier. It
// runs INSIDE the round, so the spin lock stays held until it is dismissed.
const BIG_WIN_TIERS = WIN_TIERS.filter((t) => t.overlay);

const bigWin = new BigWinController({
  root: document.getElementById("bigWinOverlay"),
  format: fmt,
  palette: {
    gold: THEME.color.gold,
    goldBright: THEME.color.goldBright,
    goldDeep: THEME.color.goldDeep,
    diamond: THEME.color.textHud,
    diamondEdge: THEME.color.steelSheen,
    sparks: THEME.particles.breach
  },
  maxDpr: reelRenderer.maxDpr,
  fxScale: TIER_PROFILES[reelRenderer.tier].fxCeil,
  hooks: {
    // The overlay animates its own stage, and the board underneath is dimmed
    // and paused, so only sound is routed out here.
    onTier: (tier) => window.Sound?.play(tier.sfx),
    onTick: (value, total) => window.Sound?.play("win_tick", { progress: total > 0 ? value / total : 1 })
  }
});

/** The win count-up has landed: a stinger sized to the win. A small win is
 *  chips and a coin glint, a nice one (5x+) the orchestral hit; an overlay win
 *  has the big win's own open and tier stings instead. */
function playWinLand(amount, bet) {
  const tier = getWinTier(amount, bet);
  if (tier.overlay || !(amount > 0)) return;
  window.Sound?.play(tier.key === "nice" ? "win_small" : "win_land");
}

/** Celebrate a settled round win. Resolves once the player (or the
 *  auto-dismiss) closes the overlay. */
async function celebrateBigWin(amount, bet, { finalTier = null } = {}) {
  // Follow any FPS-governor downgrade that happened since boot.
  bigWin.field.maxDpr = reelRenderer.maxDpr;
  const inAutoplay = state.autoplayActive || state.bonusAutoplay;
  // Auto-dismiss everywhere: a player who never taps must not leave the round,
  // and the spin lock, held open forever. Autoplay and free spins move on fast.
  const autoDismissMs = inAutoplay ? (state.turbo ? 800 : 1800) : 4000;
  // The overlay covers the board, so stop drawing it: no point spending
  // battery and heat on frames nobody can see. installVisibilityGuards() knows
  // not to wake it while the overlay is up.
  reelRenderer.pauseRendering();
  const tracked = VxNotify.get("bigwin");
  tracked?.open();
  window.Sound?.play("bigwin_open");
  window.Sound?.setMusic("bigWin", { temporary: true });
  try {
    return await bigWin.play({
      amount,
      bet,
      tiers: BIG_WIN_TIERS,
      finalTier,
      speed: state.turbo || state.fastStopRequested ? 0.35 : 1,
      autoDismissMs
    });
  } finally {
    window.Sound?.endTemporaryMusic();
    tracked?.close("done");
    if (!document.hidden) reelRenderer.resumeRendering();
  }
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
// computing spins locally and instead talks to the Vault 20K platform's
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

// ─── Operator free rounds (Campaign Manager) ────────────────────────────────
// Free rounds the CASINO granted (not the scatter feature). The server decides
// everything: it consumes one per spin, soonest-expiring campaign first, at the
// campaign's locked bet. The client only mirrors that state to lock the UI:
//   queue  open grants in the server's consume order (session/init, then each
//          spin's free_round updates the grant it used);
//   won    everything paid while free rounds ran, including a scatter feature a
//          free round triggered (the server pays those against the campaign too);
//   featureLeft  the scatter feature's spins left after the last result: free
//          rounds aren't "complete" until a feature they triggered has finished.
const freeRounds = {
  active: false,
  queue: [],
  won: 0,
  featureLeft: 0,
  get remaining() { return this.queue.reduce((s, g) => s + g.spins_remaining, 0); },
  get bet() { return this.queue.length ? this.queue[0].bet_amount : null; }
};

function freeRoundsLoad(list, featureLeft) {
  freeRounds.queue = (Array.isArray(list) ? list : [])
    .map((g) => ({
      campaign_id: g.campaign_id,
      name: g.name || "",
      bet_amount: Number(g.bet_amount),
      spins_remaining: Number(g.spins_remaining || 0),
      valid_to: g.valid_to || null
    }))
    .filter((g) => g.spins_remaining > 0 && Number.isFinite(g.bet_amount));
  freeRounds.active = freeRounds.queue.length > 0;
  freeRounds.won = 0;
  freeRounds.featureLeft = Number(featureLeft || 0);
}

/** Fold one platform spin result into the mirror (server truth wins). */
function freeRoundsNote(result) {
  const fr = result?.free_round;
  if (fr) {
    let g = freeRounds.queue.find((q) => q.campaign_id === fr.campaign_id);
    if (!g) {
      // Granted after this session loaded: the server already played it as a free
      // round, so start mirroring now.
      g = { campaign_id: fr.campaign_id, name: "", bet_amount: Number(fr.bet_amount), spins_remaining: 0, valid_to: null };
      freeRounds.queue.unshift(g);
    }
    g.spins_remaining = Number(fr.spins_remaining || 0);
    freeRounds.active = true;
  } else if (!result?.is_free_spin) {
    // A cash spin: the server has no usable free round for us (spent, expired or
    // cancelled by the casino).
    freeRounds.queue = [];
  }
  if (freeRounds.active) freeRounds.won = Number((freeRounds.won + Number(result?.total_win || 0)).toFixed(2));
  freeRounds.featureLeft = Number(result?.free_spins_left || 0);
  freeRounds.queue = freeRounds.queue.filter((g) => g.spins_remaining > 0);
}

/** The deck's Bet readout while free rounds run: the count, "FREE ROUNDS 7"
 *  (null = show the normal bet). Count only: "7 × 5.00" overflowed the readout
 *  strip on phones and pushed CREDIT into an ellipsis. The locked bet is on the
 *  ticker line and in the award modal. */
function freeRoundsReadoutText() {
  return freeRounds.active && freeRounds.queue.length ? String(freeRounds.remaining) : null;
}

// ─── Casino embed bridge (client/embed-bridge.js) ───────────────────────────
// Lifecycle signals to the casino that framed /play, and its pause / resume /
// mute commands. Platform mode only; a no-op when the game is not framed or the
// parent is not one of the operator's registered hosts.
function embedEmit(type, data) {
  if (_platform.enabled) window.EmbedBridge?.emit(type, data);
}

function embedSnapshot() {
  return {
    paused: state.embedPaused,
    muted: window.Sound ? window.Sound.isMuted() : false,
    in_round: isRoundInFlight(),
    in_feature: Number(el.freeSpins?.textContent || 0) > 0,
    balance: state.lastBalance ?? null,
    currency: state.currency || null
  };
}

/** Balance as the server last reported it (informational for the casino). */
function embedBalance(balance) {
  const n = Number(balance);
  if (!Number.isFinite(n)) return;
  state.lastBalance = n;
  embedEmit("balanceChanged", { balance: n, currency: state.currency || null });
}

function embedRoundEnded(payload, bet) {
  embedEmit("roundEnded", {
    round_ref: payload?.round_ref || null,
    trace_id: roundTrace.traceId,
    bet,
    win: Number(payload?.total_win || 0),
    balance: Number.isFinite(Number(payload?.balance_after)) ? Number(payload.balance_after) : null,
    free_spin: Boolean(payload?.is_free_spin),
    free_spins_left: Number(payload?.free_spins_left || 0)
  });
  embedBalance(payload?.balance_after);
}

/** "INSUFFICIENT_FUNDS: …" → { code, message }; the casino may react (deposit prompt). */
function embedError(err) {
  const text = String(err?.message || err || "error");
  const m = /^([A-Z][A-Z0-9_]+):\s*(.*)$/.exec(text);
  embedEmit("error", m ? { code: m[1], message: m[2] } : { code: "CLIENT_ERROR", message: text });
}

/** Resolves once the casino has not (or no longer) paused the game. */
async function waitWhileEmbedPaused() {
  while (state.embedPaused) await sleep(150);
}

function embedConnect(meta) {
  const bridge = window.EmbedBridge;
  if (!_platform.enabled || !bridge || !bridge.framed) return;
  bridge.on("pause", () => {
    if (!state.embedPaused) {
      state.embedPaused = true;
      if (state.autoplayActive) stopAutoplay();
      pushGameMessage("Game paused by the casino.", "info");
    }
    bridge.emit("paused", { paused: true });
  });
  bridge.on("resume", () => {
    if (state.embedPaused) {
      state.embedPaused = false;
      pushGameMessage("Game resumed.", "info");
    }
    bridge.emit("paused", { paused: false });
  });
  bridge.on("setMuted", (data) => {
    const before = window.Sound ? window.Sound.isMuted() : false;
    if (window.Sound && typeof data.muted === "boolean") window.Sound.setMuted(data.muted);
    // A change is announced by the onChange listener below; answer a no-op here.
    if ((window.Sound ? window.Sound.isMuted() : false) === before) bridge.emit("muted", { muted: before });
  });
  bridge.on("getState", () => bridge.emit("state", embedSnapshot()));
  bridge.connect(meta?.embed?.allowed_hosts);
  let lastMuted = window.Sound ? window.Sound.isMuted() : false;
  window.Sound?.onChange(({ muted }) => {
    if (muted === lastMuted) return;
    lastMuted = muted;
    bridge.emit("muted", { muted });
  });
}

// ─── W3C Trace Context (platform mode) ────────────────────────────────────────
// One trace per round: the spin / buy request carries `traceparent`, the RGS continues
// it into its ledger and the casino's wallet webhooks, and the casino gets the same
// trace_id on roundStarted / roundEnded, so one player action can be followed end to
// end. crypto.getRandomValues here is the browser's own CSPRNG: ids, never outcomes.
const roundTrace = { traceId: null };
function hexId(bytes) {
  const b = new Uint8Array(bytes);
  window.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function startRoundTrace() {
  roundTrace.traceId = hexId(16);
  return roundTrace.traceId;
}
/** traceparent for a request in the current round's trace (a new span each call). */
function roundTraceparent() {
  return `00-${roundTrace.traceId || startRoundTrace()}-${hexId(8)}-01`;
}

/** An RGS error as an Error carrying its code and machine-readable details. */
function platformError(body, status, fallback) {
  const code = body?.error?.code || `HTTP_${status}`;
  const err = new Error(`${code}: ${body?.error?.message || fallback}`);
  err.code = code;
  err.details = body?.error?.details || null;
  return err;
}

// ─── Jurisdiction rules (platform mode; the session's `regulatory` block) ──────
// The RGS enforces round pacing, the reality check and the feature-buy switch
// itself (SPIN_TOO_FAST / REALITY_CHECK_REQUIRED / FEATURE_BUY_DISABLED). The client
// mirrors them so the player never hits those errors in normal play, and applies the
// switches only it can: autoplay (and its cap) and turbo. Switched-off controls are
// hidden in place (.is-reg-off), so the layout never moves.
const regulatory = {
  rules: null,
  lastRoundStart: -Infinity, // performance.now() of the last round this client started
  due: false,                // the reality check is due (timer fired or the RGS said so)
  timer: null,
  prompt: null               // the open prompt's promise, so concurrent callers share it
};

function regRule(name, fallback) {
  const v = regulatory.rules?.[name];
  return v === undefined || v === null ? fallback : v;
}

function hideForRegulation(node, off) {
  if (!node) return;
  node.classList.toggle("is-reg-off", off);
  if (off) node.setAttribute("aria-hidden", "true");
  else node.removeAttribute("aria-hidden");
}

function applyRegulatory(rules) {
  regulatory.rules = rules || null;
  if (!rules) return;
  const autoplayOff = !regRule("autoplay_enabled", true);
  hideForRegulation(el.autoplayBtn, autoplayOff);
  const cap = regRule("max_autoplay_spins", null);
  el.autoplayPopover?.querySelectorAll("button[data-autoplay]").forEach((btn) => {
    const n = btn.dataset.autoplay === "inf" ? Infinity : Number(btn.dataset.autoplay);
    btn.hidden = cap !== null && n > cap;
  });
  if (!regRule("turbo_enabled", true)) {
    if (state.turbo) setTurbo(false);
    hideForRegulation(el.turboBtn, true);
  }
  hideForRegulation(el.buyFreeBtn, !regRule("buy_feature_enabled", true));
  scheduleRealityCheck(rules.reality_check_due_in_ms);
}

function scheduleRealityCheck(dueInMs) {
  clearTimeout(regulatory.timer);
  if (dueInMs === null || dueInMs === undefined) return;
  regulatory.timer = setTimeout(() => {
    regulatory.due = true;
    // Idle: show it now. Mid-round: the next round start shows it (realityCheckGate).
    if (!isRoundInFlight()) realityCheckGate();
  }, Math.max(0, dueInMs));
}

function fmtDuration(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(m / 60);
  return h ? `${h} h ${m % 60} min` : `${m} min`;
}

/**
 * Show the reality check and wait for the player. Resolves true when they chose to
 * continue (the RGS has acknowledged it), false when they left (the game pauses and
 * the casino is asked to close it). `stats`: from REALITY_CHECK_REQUIRED, else fetched.
 */
function realityCheckPrompt(stats) {
  if (regulatory.prompt) return regulatory.prompt;
  regulatory.prompt = (async () => {
    let figures = stats;
    if (!figures) {
      try {
        const res = await fetch("/game/v1/reality-check", { headers: { authorization: `Bearer ${_platform.sessionToken}` } });
        figures = (await res.json()).stats || {};
      } catch { figures = {}; }
    }
    const set = (id, v) => { const n = document.getElementById(id); if (n) n.textContent = v; };
    set("realityElapsed", fmtDuration(Number(figures.elapsed_ms || 0)));
    set("realityRounds", String(figures.rounds ?? 0));
    set("realityWagered", fmt(Number(figures.wagered || 0)));
    set("realityWon", fmt(Number(figures.won || 0)));
    set("realityNet", fmt(Number(figures.net || 0)));
    if (state.autoplayActive) stopAutoplay();
    embedEmit("realityCheck", { ...figures });
    // A VxNotify modal with no way out but its two buttons.
    const choice = (await VxNotify.open("reality")) === "continue";
    if (!choice) {
      state.embedPaused = true;
      pushGameMessage("Session paused after the reality check.", "info");
      embedEmit("exitRequested", { reason: "reality_check" });
      return false;
    }
    try {
      const res = await fetch("/game/v1/reality-check/ack", { method: "POST", headers: { authorization: `Bearer ${_platform.sessionToken}` } });
      const ack = await res.json();
      regulatory.due = false;
      scheduleRealityCheck(ack.next_due_in_ms);
    } catch { /* the RGS still enforces it: the next round asks again */ }
    return true;
  })().finally(() => { regulatory.prompt = null; });
  return regulatory.prompt;
}

/** Before a round: a due reality check first. False = the player left. */
async function realityCheckGate(stats) {
  if (!_platform.enabled || !regulatory.rules) return true;
  if (!regulatory.due && !stats) return true;
  return realityCheckPrompt(stats);
}

/**
 * Before a new round (not a feature's free spin): keep the jurisdiction's pace. The
 * gap is measured from when the RGS ANSWERED the previous round (roundAnswered), not
 * from when we sent it: the RGS times a round from its arrival, which is always before
 * its answer, so this can never undercut the RGS's gap whatever the network jitter.
 */
async function paceRound() {
  const min = Number(regRule("min_round_ms", 0));
  const wait = min - (performance.now() - regulatory.lastRoundStart);
  if (min > 0 && wait > 0) await sleep(wait);
}
function roundAnswered() {
  regulatory.lastRoundStart = performance.now();
}

// The session token of THIS launch, kept per tab so a page reload resumes the same
// RGS session: the launch token in the URL is a 60s handoff and is usually expired
// by the time a player refreshes. Keyed by the launch token, so a fresh launch from
// the casino starts clean (the RGS still resumes an unfinished feature for it).
const platformTokenKey = () => `vx.platformSession:${_platform.launchToken}`;
function platformSavedToken() {
  try { return sessionStorage.getItem(platformTokenKey()); } catch { return null; }
}
function platformSaveToken(token) {
  try {
    if (token) sessionStorage.setItem(platformTokenKey(), token);
    else sessionStorage.removeItem(platformTokenKey());
  } catch { /* storage unavailable: a reload falls back to the launch token */ }
}

async function platformInitSession() {
  let body = null;
  const saved = platformSavedToken();
  if (saved) {
    // Reload: read the existing session's state; opens nothing new.
    try {
      const res = await fetch("/game/v1/session", { headers: { authorization: `Bearer ${saved}` } });
      if (res.ok) body = { ...(await res.json()), session_token: saved };
      else platformSaveToken(null); // expired or closed: start over from the launch token
    } catch { /* network: fall back to the launch token below */ }
  }
  if (!body) {
    const res = await fetch("/game/v1/session/init", {
      method: "POST",
      headers: { authorization: `Bearer ${_platform.launchToken}` }
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw platformError(body, res.status, "session init failed");
    }
  }
  _platform.sessionToken = body.session_token;
  _platform.sessionMeta = body;
  platformSaveToken(body.session_token);
  freeRoundsLoad(body.free_rounds, body.free_spins_left);
  // Adapt the platform response to the shape the local engine returns so the
  // rest of the client (initSession()) needs no changes. `resume` is the RGS's
  // record of where the player was: the bet + ante to show (the locked terms
  // inside a feature) and any unfinished feature's bank and running win.
  const resume = body.resume || {};
  const feature = resume.feature || null;
  return {
    session_id: body.session_id,
    currency: body.currency,
    game_id: body.game?.code || "bananax",
    slug: body.game?.code || "bananax",
    balance: Number(body.balance?.amount ?? 0),
    allowed_bets: body.allowed_bets || [],
    free_spins_left: Number(body.free_spins_left || 0),
    free_spin_multiplier_current: Number(feature?.multiplier_bank || 0),
    bonus_round_win: Number(feature?.bonus_round_win || 0),
    bet_amount: resume.bet_amount ?? null,
    ante_enabled: Boolean(resume.ante_enabled),
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
      "idempotency-key": idem,
      traceparent: roundTraceparent()
    },
    body: JSON.stringify({
      bet_amount: Number(payload?.bet_amount),
      ante_enabled: Boolean(payload?.ante_enabled)
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw platformError(body, res.status, "spin failed");
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

async function platformBuyFeature(payload) {
  if (!_platform.sessionToken) {
    throw new Error("NO_SESSION: platform session not initialised");
  }
  const idem =
    payload?.spin_id ||
    (window.crypto?.randomUUID ? window.crypto.randomUUID() : `idem_${Date.now()}_${Math.random()}`);
  const res = await fetch("/game/v1/buy-feature", {
    method: "POST",
    headers: {
      authorization: `Bearer ${_platform.sessionToken}`,
      "content-type": "application/json",
      "idempotency-key": idem,
      traceparent: roundTraceparent()
    },
    body: JSON.stringify({ bet_amount: Number(payload?.bet_amount) })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw platformError(body, res.status, "buy feature failed");
  }
  return {
    ...body,
    balance_after: Number(body.balance?.amount ?? body.balance_after ?? 0),
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
    freeRoundsNote(result);
    return result;
  }
  if (_platform.enabled && path === "/api/v1/buy-free-spins") {
    const result = await platformBuyFeature(payload || {});
    showRoundId(result.round_ref);
    return result;
  }
  // /api/v1/simulate stays on the local engine even in platform mode — it's a
  // dev sandbox tool (1M-spin RTP imitation), not a server-authoritative path.
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
  const mult = Number(multiplier) || 0; // the bonus total multiplier; 0 = none caught yet
  const total = Number(bonusTotal || 0);
  const inBonus = spins > 0 || total > 0;
  if (el.bonusTotal) el.bonusTotal.textContent = fmt(total);
  if (el.bonusTotalNode) el.bonusTotalNode.classList.toggle("hidden", !inBonus);
  if (el.freeSpinsNode) el.freeSpinsNode.classList.toggle("hidden", spins <= 0);
  if (el.activeMultiplierNode) el.activeMultiplierNode.classList.toggle("hidden", !inBonus && mult <= 1);
  // Bonus total-multiplier badge over the top of the reels — the signature
  // bonus element (and the multiplier display on mobile, where the HUD column
  // is hidden). Its glow tier scales with the multiplier, and it pops on
  // each increase.
  if (el.bonusMultiBadge) {
    el.bonusMultiBadge.classList.toggle("hidden", !inBonus);
    setBadgeMultiplier(inBonus ? mult : 0);
  }
}

/** The bonus Total Multiplier badge (#46). With no multiplier caught yet it
 *  is EMPTY: invisible (no "1x"), but still laid out, so the first soul has
 *  somewhere to fly to. Each increase shows the new running total at once,
 *  steps its glow tier and pops. */
function setBadgeMultiplier(mult) {
  const badge = el.bonusMultiBadge;
  if (!badge) return;
  const m = Number(mult) || 0;
  badge.classList.toggle("is-empty", m <= 0);
  if (m <= 0) {
    badge.dataset.value = "0";
    if (el.bonusMultiBadgeValue) el.bonusMultiBadgeValue.textContent = "";
    return;
  }
  if (el.bonusMultiBadgeValue) el.bonusMultiBadgeValue.textContent = mfmt(m);
  badge.dataset.tier = m >= 100 ? "mythic"
    : m >= 50 ? "legendary"
    : m >= 20 ? "epic"
    : m >= 10 ? "rare"
    : "common";
  const prev = Number(badge.dataset.value || 0);
  badge.dataset.value = String(m);
  if (m > prev) {
    badge.classList.remove("badge-bump");
    void badge.offsetWidth;
    badge.classList.add("badge-bump");
  }
}

function setControls(disabled) {
  el.spinBtn.disabled = false;
  el.spinBtn.classList.toggle("is-spinning", Boolean(disabled || state.roundAnimating));
  el.spinBtn.setAttribute("aria-label", disabled || state.roundAnimating ? "Stop spin" : "Spin");
  el.simulateBtn.disabled = disabled;
  if (el.simulateBonusBtn) el.simulateBonusBtn.disabled = disabled;
  // Operator free rounds play at the campaign's locked bet with no ante and no
  // buy, so those controls stay locked for as long as free rounds run.
  const frLock = freeRounds.active;
  el.betSelect.disabled = disabled || frLock;
  // Buy-free-spins is server-authoritative in platform mode (/game/v1/buy-feature)
  // and local otherwise. It's only disabled while busy or when Ante is on (the
  // engine forbids buying the feature with an active ante bet).
  el.buyFreeBtn.disabled = disabled || Boolean(el.anteToggle.checked) || frLock;
  el.anteToggle.disabled = disabled || frLock;
  // The bet is fixed for the round from the instant it starts.
  if (el.betDownBtn) el.betDownBtn.disabled = disabled || frLock;
  if (el.betUpBtn) el.betUpBtn.disabled = disabled || frLock;
  setTestButtonsDisabled(disabled || state.bonusAutoplay || state.testBusy);
}

/** True while ANY round occupies the spin lifecycle — base game, base autoplay,
 *  free-spin autoplay, buy-feature or a resumed bonus. This is the single
 *  predicate that answers "may a new round start?" (#28); it ORs four signals
 *  because the paths that drive a round do not all own the lock:
 *    spinLock       — a manual spin or an autoplay run, incl. its network window
 *    roundAnimating — a round being played out by ANY caller
 *    autoplayActive — base autoplay between its spins
 *    bonusAutoplay  — free-spin autoplay between its spins */
function isRoundInFlight() {
  return Boolean(
    state.bonusAutoplay ||
    state.autoplayActive ||
    state.roundAnimating ||
    spinLock.isLocked()
  );
}

// Lifecycle counters. Three integers, incremented at the two decision points in
// spin(); nothing in the game reads them. They exist because #28's acceptance
// criterion ("a press never starts a second round") is otherwise unobservable
// from outside: a leaked manual spin during a bonus looks exactly like a
// legitimate free spin, and free-spin counts move on their own via retriggers.
// Separating manual from autoplay starts makes the invariant exact.
const lifecycleStats = { startedManual: 0, startedAuto: 0, blockedPresses: 0 };

// Read-only lifecycle view for tooling (tools/spin-e2e.js waits on `inFlight` to
// know when a round has genuinely settled — the button's `is-spinning` cue is
// dropped as soon as the result arrives, well before the reels finish).
window.__spinLifecycle = {
  get phase() { return spinLock.phase; },
  get inFlight() { return isRoundInFlight(); },
  get stats() { return { ...lifecycleStats }; }
};

function requestFastStop() {
  // Fire during ANY in-flight phase (starting OR animating), not just once the
  // reels are visibly animating. A press SLAMS ONE BOARD: a board in the air
  // zips into place now (renderer call below); with none in the air the flag
  // latches, collapses the hold/burst it lands in, and the next board is born
  // zipping (it visibly falls in ≤110ms, never pre-placed). Once that board has
  // landed the latch is consumed (endFastStop) and the round goes on at its own
  // pace. The reset in spin() runs before the first await, so a press in the
  // pre-animation window (dropOff + network) survives into animateRound().
  // "In flight" means the lock is held OR a round is visibly animating. Both
  // halves matter: the lock covers the pre-animation window (dropOff + network),
  // while roundAnimating covers any path that animates a round without owning
  // the lock. Gating on the lock alone left fast-stop dead during buy-feature
  // and session-resume bonuses, which never acquired it.
  // During the big-win celebration a press means what a tap on the overlay
  // means: first press skips the count, the next one dismisses it.
  if (bigWin.active) {
    bigWin.advance();
    return true;
  }
  if (!spinLock.isLocked() && !state.roundAnimating) return false; // nothing in flight
  state.fastStopRequested = true;
  el.spinBtn?.classList.add("is-fast-stopping");
  reelRenderer.requestFastStop?.(); // no-op if no drop exists yet (_accelerateDrop guards)
  pushGameMessage("Fast stop requested.", "info");
  return true;
}

/** The slammed board has landed: the Stop is spent. */
function endFastStop() {
  state.fastStopRequested = false;
  el.spinBtn?.classList.remove("is-fast-stopping");
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

/** A win chip landed: the ticker's WIN line takes the hit. */
function pulseWinMeter() {
  ticker.bump();
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
    // The chip flies into the ticker, where the WIN line shows.
    const target = el.psTicker || el.lastWin;
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
  // The running multiplier is kept in #activeMultiplier (state, not shown).
  // The souls fly to what the player can see: the board's Total Multiplier
  // badge during the bonus, otherwise the ticker.
  const target = el.activeMultiplier;
  const badgeOn = el.bonusMultiBadge && !el.bonusMultiBadge.classList.contains("hidden");
  const meterNode = badgeOn ? el.bonusMultiBadge : el.psTicker;
  if (!target || !meterNode) return Promise.resolve();
  const layer = ensureSoulLayer();
  const canvasRect = el.reels.getBoundingClientRect();
  const targetRect = meterNode.getBoundingClientRect();
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

// ── Multiplier magnetism (#52) ─────────────────────────────────────────────
// A caught multiplier detaches from the board and flies to the HUD (the
// bonus Total Multiplier badge, else the ticker) on a cubic Bézier:
//   B(s) = (1−s)³·P0 + 3(1−s)²s·P1 + 3(1−s)s²·P2 + s³·P3
//   P0 = the cell, P3 = the HUD target,
//   P1 = P0 lifted `lift` (the detach: it rises off the board first),
//   P2 = P3 approached from above, `lift`·approach higher, up to `sway` px
//        sideways so several souls do not share one path.
// lift = clamp(liftK·distance, liftMin, liftMax). The curve is sampled once
// into an arc-length table (`samples` points), so position is driven by the
// distance travelled, not by the Bézier parameter (which bunches up at the
// bends). Distance follows d(t) = t² (constant acceleration from rest): it
// eases off the board and is pulled in ever faster, like a magnet.
// The trail is pooled light on one canvas (SoulTrails): particles are laid
// along the path at `perPx` per pixel of travel (independent of frame rate,
// scaled by the quality tier), each drifting a little, shrinking and fading
// over its life, drawn additively. At most `max` alive; `burst` sparks ring
// the HUD where a soul lands.
const SOUL_FLIGHT = {
  liftK: 0.32, liftMin: 110, liftMax: 220, approach: 0.55, sway: 60, samples: 48,
  perPx: 0.32, life: [300, 460], size: [9, 16], drift: 0.02, max: 512, burst: 14
};

/** A cubic Bézier sampled into an arc-length table. at(d, out) writes the
 *  point at fraction d ∈ [0, 1] of the curve's LENGTH into `out`. */
function makeArcPath(p0, p1, p2, p3, samples = SOUL_FLIGHT.samples) {
  const xs = new Float32Array(samples + 1);
  const ys = new Float32Array(samples + 1);
  const len = new Float32Array(samples + 1);
  for (let i = 0; i <= samples; i += 1) {
    const s = i / samples;
    const u = 1 - s;
    const a = u * u * u;
    const b = 3 * u * u * s;
    const c = 3 * u * s * s;
    const d = s * s * s;
    xs[i] = a * p0.x + b * p1.x + c * p2.x + d * p3.x;
    ys[i] = a * p0.y + b * p1.y + c * p2.y + d * p3.y;
    len[i] = i ? len[i - 1] + Math.hypot(xs[i] - xs[i - 1], ys[i] - ys[i - 1]) : 0;
  }
  const total = len[samples];
  return {
    total,
    at(d, out) {
      const want = clamp(d, 0, 1) * total;
      let lo = 0;
      let hi = samples;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (len[mid] < want) lo = mid;
        else hi = mid;
      }
      const seg = len[hi] - len[lo];
      const f = seg > 0 ? (want - len[lo]) / seg : 0;
      out.x = xs[lo] + (xs[hi] - xs[lo]) * f;
      out.y = ys[lo] + (ys[hi] - ys[lo]) * f;
      return out;
    }
  };
}

/** The flight path from (sx, sy) to (tx, ty): see SOUL_FLIGHT. */
function soulPath(sx, sy, tx, ty) {
  const F = SOUL_FLIGHT;
  const lift = clamp(Math.hypot(tx - sx, ty - sy) * F.liftK, F.liftMin, F.liftMax);
  const sway = (Math.random() - 0.5) * 2 * F.sway;
  return makeArcPath(
    { x: sx, y: sy },
    { x: sx + sway * 0.3, y: sy - lift },
    { x: tx + sway, y: ty - lift * F.approach },
    { x: tx, y: ty }
  );
}

/** Pooled, additive glow particles for the multiplier trails, on one fixed
 *  canvas in the soul layer. Runs its own rAF loop only while particles are
 *  alive and integrates on elapsed time. No allocation per particle. */
class SoulTrails {
  constructor(layer, max = SOUL_FLIGHT.max) {
    this.layer = layer;
    this.cap = max;
    this.live = 0;
    const f32 = () => new Float32Array(max);
    this.x = f32(); this.y = f32(); this.vx = f32(); this.vy = f32();
    this.age = f32(); this.life = f32(); this.size = f32();
    this.look = new Array(max);
    this._sprites = new Map();
    this._raf = 0;
    this._last = 0;
    this._p = { x: 0, y: 0 };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "soul-trails";
    this.canvas.setAttribute("aria-hidden", "true");
    layer.appendChild(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this._w = 0;
    this._h = 0;
    this._dpr = 0;
    this._frame = (now) => this._step(now);
  }

  /** Soft glow sprite for `color`, baked once. */
  sprite(color) {
    let c = this._sprites.get(color);
    if (c) return c;
    c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, "rgba(255, 255, 255, 1)");
    grad.addColorStop(0.3, color);
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    this._sprites.set(color, c);
    return c;
  }

  /** Add one particle (px, px/ms, ms). Drops silently when full. */
  add(x, y, vx, vy, size, life, look) {
    if (this.live >= this.cap) return;
    const i = this.live++;
    this.x[i] = x; this.y[i] = y; this.vx[i] = vx; this.vy[i] = vy;
    this.size[i] = size; this.life[i] = life; this.age[i] = 0;
    this.look[i] = look;
    if (!this._raf) {
      this._last = performance.now();
      this._raf = requestAnimationFrame(this._frame);
    }
  }

  /** Lay trail particles along `path` from fraction d0 to d1 of its length. */
  emitAlong(path, d0, d1, look, density = 1) {
    const F = SOUL_FLIGHT;
    const n = Math.floor((d1 - d0) * path.total * F.perPx * density + Math.random());
    const p = this._p;
    for (let k = 0; k < n; k += 1) {
      path.at(d0 + (d1 - d0) * ((k + Math.random()) / n), p);
      const a = Math.random() * Math.PI * 2;
      this.add(p.x, p.y, Math.cos(a) * F.drift, Math.sin(a) * F.drift,
        F.size[0] + Math.random() * (F.size[1] - F.size[0]),
        F.life[0] + Math.random() * (F.life[1] - F.life[0]), look);
    }
  }

  /** A ring of sparks where a soul lands. */
  burst(x, y, look, count) {
    for (let k = 0; k < count; k += 1) {
      const a = (k / count) * Math.PI * 2 + Math.random() * 0.4;
      const v = 0.12 + Math.random() * 0.12;
      this.add(x, y, Math.cos(a) * v, Math.sin(a) * v, 8 + Math.random() * 8, 260 + Math.random() * 160, look);
    }
  }

  _fit() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w === this._w && h === this._h && dpr === this._dpr) return;
    this._w = w;
    this._h = h;
    this._dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
  }

  _step(now) {
    const dt = Math.min(50, now - this._last);
    this._last = now;
    this._fit();
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    const drag = Math.pow(0.96, dt / 16.7);
    let i = 0;
    while (i < this.live) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this._remove(i); continue; }
      this.vx[i] *= drag;
      this.vy[i] *= drag;
      this.x[i] += this.vx[i] * dt;
      this.y[i] += this.vy[i] * dt;
      const t = this.age[i] / this.life[i];
      const s = this.size[i] * (1 - 0.6 * t);
      ctx.globalAlpha = (1 - t) * (1 - t);
      ctx.drawImage(this.look[i], this.x[i] - s / 2, this.y[i] - s / 2, s, s);
      i += 1;
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (this.live > 0) {
      this._raf = requestAnimationFrame(this._frame);
    } else {
      this._raf = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  _remove(i) {
    const j = --this.live;
    if (i !== j) {
      this.x[i] = this.x[j]; this.y[i] = this.y[j]; this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j];
      this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.size[i] = this.size[j];
      this.look[i] = this.look[j];
    }
    this.look[j] = null;
  }
}

let soulTrails = null;
function getSoulTrails(layer) {
  if (!soulTrails || soulTrails.layer !== layer) soulTrails = new SoulTrails(layer);
  return soulTrails;
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

    const path = soulPath(sx, sy, tx, ty);
    const trails = getSoulTrails(layer);
    const look = trails.sprite(tier.accent);
    // Trail density follows the quality tier; reduced motion keeps a faint one.
    const density = prefersReducedMotion() ? 0.25 : reelRenderer.fxScale;
    const p = { x: sx, y: sy };
    const startTime = performance.now() + delay;
    let lastD = 0;
    let launched = false;

    function tick(now) {
      const elapsed = now - startTime;
      if (elapsed < 0) {
        requestAnimationFrame(tick);
        return;
      }
      // The whoosh leaves with the orb, on its first drawn frame.
      if (!launched) { launched = true; window.Sound?.play("soul_launch"); }
      const t = clamp(elapsed / duration, 0, 1);
      const d = t * t; // magnetism: from rest, ever faster into the HUD
      path.at(d, p);
      // Detach: it swells off the board, then shrinks as it is drawn in.
      const scale = t < 0.15
        ? lerp(0.4, 0.9, easeOutCubic(t / 0.15))
        : lerp(0.9, 0.4, easeInOutCubic((t - 0.15) / 0.85));
      const fadeIn = clamp(elapsed / 100, 0, 1);
      const fadeOut = t > 0.9 ? 1 - (t - 0.9) / 0.1 : 1;
      orb.style.opacity = String(fadeIn * fadeOut);
      orb.style.transform = `translate3d(${p.x}px, ${p.y}px, 0) scale(${scale.toFixed(3)})`;
      if (d > lastD) trails.emitAlong(path, lastD, d, look, density);
      lastD = d;

      if (t < 1) {
        requestAnimationFrame(tick);
      } else {
        orb.remove();
        trails.burst(tx, ty, look, Math.max(4, Math.round(SOUL_FLIGHT.burst * density)));
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
  // In the bonus the badge compounds as each multiplier lands (#46): this
  // spin's catches on top of the carried total (the engine adds them to it).
  if (meterNode === el.bonusMultiBadge) setBadgeMultiplier(next);
  window.Sound?.play("multiplier_catch", { value: next });

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

/** Offset (px) from a chip's slot in `overlay` (at `leftFrac` of its width,
 *  vertically centred) to the centre of `node`, so the chip can launch from
 *  where its value lives. Null when either box isn't measurable. */
function combineLaunchOffset(overlay, leftFrac, node) {
  const o = overlay.getBoundingClientRect();
  const r = node?.getBoundingClientRect?.();
  if (!r || !r.width || !o.width) return null;
  return {
    x: r.left + r.width / 2 - (o.left + o.width * leftFrac),
    y: r.top + r.height / 2 - (o.top + o.height / 2)
  };
}

/** Win × Total Multiplier = Total Win, played on every multiplied win. The
 *  Multiplier chip launches from the Total Multiplier badge and the Win chip
 *  from the WIN line, so the player sees both values travel into the sum.
 *  `emptyBadge` (base game): the badge empties as its chip leaves it; in the
 *  bonus it keeps the persistent total. Turbo-scaled (--combine-t). */
// The Total Win chip's pop peaks 20% into its 1.5s combineTotalIn (styles.css).
const COMBINE_TOTAL_PEAK_MS = 300;
function playWinCombineSequence(rawWin, multiplier, totalWin, { emptyBadge = false } = {}) {
  if (!el.reels?.parentElement) return Promise.resolve();
  const stage = el.reels.parentElement;
  // Phase timings (ms), turbo-scaled; the CSS durations read --combine-t.
  const t = turboScale();
  const ENTER = Math.round(480 * t);
  const HOLD  = Math.round(320 * t);
  const SLAM  = Math.round(360 * t);
  const REVEAL = Math.round(1500 * t);
  // A VxNotify celebration: built here, removed when its time is up.
  return VxNotify.celebrate("winCombine", stage, (overlay) => {
    overlay.style.setProperty("--combine-t", String(t));

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

    // Launch: once the overlay is in the page, park each chip (unseen) on the
    // value it carries (the Win chip on the WIN line, the Multiplier chip on
    // the badge), then let it travel into its slot. Unmeasurable → the chip
    // enters from its own side as before.
    requestAnimationFrame(() => {
      [[amount, 0.25, el.psTicker], [multi, 0.75, el.bonusMultiBadge]].forEach(([chip, frac, from]) => {
        const off = from && !from.classList.contains("hidden") ? combineLaunchOffset(overlay, frac, from) : null;
        if (!off) return;
        chip.style.transition = "none";
        chip.style.setProperty("--from-x", `${off.x.toFixed(1)}px`);
        chip.style.setProperty("--from-y", `${off.y.toFixed(1)}px`);
        void chip.offsetWidth; // commit the parked position before the travel
        chip.style.transition = "";
      });
      if (emptyBadge) setBadgeMultiplier(0); // base game: the badge becomes the chip
      amount.classList.add("is-entered");
      multi.classList.add("is-entered");
      // Each phase's sound goes with the class that starts it.
      window.Sound?.play("combine_enter");
    });
    setTimeout(() => {
      // Slam together.
      amount.classList.add("is-slamming");
      multi.classList.add("is-slamming");
    }, ENTER + HOLD);
    setTimeout(() => {
      // Collision flash + total reveal. The punch is the collision itself (the
      // chips meet at the end of their slam)…
      amount.classList.add("is-merged");
      multi.classList.add("is-merged");
      flash.classList.add("is-live");
      total.classList.add("is-live");
      window.Sound?.play("combine_slam");
    }, ENTER + HOLD + SLAM);
    setTimeout(() => {
      // …the bell and the coins land on the total's pop (combineTotalIn peaks at 20%).
      window.Sound?.play("multiplier_combine", { value: multiplier });
      window.Sound?.play("combine_total");
    }, ENTER + HOLD + SLAM + Math.round(COMBINE_TOTAL_PEAK_MS * t));
    setTimeout(() => {
      overlay.classList.add("is-fading");
    }, ENTER + HOLD + SLAM + REVEAL - 320);
  }, { ms: ENTER + HOLD + SLAM + REVEAL, className: "win-combine-overlay" });
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

    VxNotify.open("buyConfirm").then((reason) => resolve(reason === "confirm"));
  });
}

/** Event notices (feature bought, multiplier locked, crazy mode…) go to the
 *  ticker, the game's single message line: shown for `duration`, then the
 *  ticker's current line (tips, spin line or held WIN) comes back. */
function pulseBanner(text, tone = "info", duration = 860) {
  VxNotify.banner(text, tone, duration);
}

function renderExamples() {
  el.lineExamples.innerHTML = "";
  [
    "Grid: 6 reels x 5 rows",
    "Symbols pay anywhere",
    "Minimum 8 matching symbols for a win",
    "Tumble continues while wins keep appearing",
    "Multiplier symbols and Free Spins drive the high-volatility sequences"
  ].forEach((text) => {
    const li = document.createElement("li");
    li.textContent = text;
    el.lineExamples.appendChild(li);
  });
}

// ── Displayed pays = paid pays ──
// The rules file holds raw pays; the engine multiplies every win by the active
// profile's scaler (payout_scaler on paid spins, free_spin_payout_scaler on free
// spins). Everything shown to the player goes through these helpers, which read
// the same profile and scalers the engine does and round the way it rounds
// (symbol: round(round(pay × bet) × scaler); scatter: round(pay × bet × scaler)).
function activeRtpProfile() {
  const rules = state.rules;
  if (!rules) return null;
  return window.SlotEngine.Config.getRtpProfileByGameId(rules, state.gameId);
}

function activePayScalers() {
  const profile = activeRtpProfile();
  if (!profile) return null;
  return window.SlotEngine.CrazyMode.getPayoutScalers({ crazyMode: state.crazyMode, profile });
}

const round2 = (n) => Number(Number(n).toFixed(2));
const scaledSymbolPay = (raw, bet, scaler) => round2(round2(raw * bet) * scaler);
const scaledScatterPay = (raw, bet, scaler) => round2(raw * bet * scaler);

// [{ label, cells: [amount per group] }] for one scaler, built from the rules
// file's symbol_payout_display (the table the engine itself loads).
function paytableRows(bet, scaler) {
  const display = state.rules?.symbol_payout_display;
  if (!display) return { groups: [], rows: [], scatter: [] };
  const groups = (display.groups || []).map((g) => g.label);
  const rows = [];
  let scatter = [];
  (display.symbols || []).forEach((s) => {
    if (s.symbol === "SCATTER") {
      const tiers = Object.keys(s.payouts || {}).map(Number).sort((a, b) => a - b);
      scatter = tiers.map((t, i) => ({
        label: i === tiers.length - 1 ? `${t}+` : String(t),
        amount: scaledScatterPay(s.payouts[String(t)], bet, scaler)
      }));
      return;
    }
    rows.push({ label: s.symbol, cells: groups.map((g) => scaledSymbolPay(Number(s.payouts?.[g] || 0), bet, scaler)) });
  });
  return { groups, rows, scatter };
}

function renderPaytable(bet = Number(el.betSelect.value || 1)) {
  renderPlayerPaytable();
  const scalers = activePayScalers();
  if (!scalers) return; // rules not loaded yet; loadRules() re-renders
  const { groups, rows, scatter } = paytableRows(bet, scalers.basePayoutScaler);
  el.paytableTitle.textContent = `Payout Table (${groups.join(" / ")}) - Bet ${fmt(bet)} - paid spins ×${scalers.basePayoutScaler}`;
  el.paytableBody.innerHTML = "";

  rows.forEach(({ label, cells }) => {
    const tr = document.createElement("tr");
    [label, ...cells.map(fmt)].forEach((text) => {
      const td = document.createElement("td");
      td.textContent = text;
      tr.appendChild(td);
    });
    el.paytableBody.appendChild(tr);
  });

  const scatterTr = document.createElement("tr");
  ["SCATTER", ...scatter.map((t) => `${t.label}: ${fmt(t.amount)}`)].forEach((text) => {
    const td = document.createElement("td");
    td.textContent = text;
    scatterTr.appendChild(td);
  });
  el.paytableBody.appendChild(scatterTr);
}

// Player-facing paytable in the Info modal (the codex-strip table above is
// admin-only). Two tables: paid spins and free spins, at the current bet,
// before multipliers. Re-rendered on bet, profile and rules changes.
function renderPlayerPaytable() {
  const host = el.psInfoModal?.querySelector(".ps-paytable");
  const scalers = activePayScalers();
  if (!host || !scalers) return;
  // RTP is the active profile's declaration, never another profile's.
  const profile = activeRtpProfile();
  const pct = (n) => `${Number(n).toFixed(2)}%`;
  const meta = el.psInfoModal.querySelector(".ps-rules-meta");
  if (meta) meta.textContent = `RTP ${pct(profile.theoretical_percent)} · Volatility ${String(state.rules.volatility || "").toUpperCase()}`;
  const rtpList = el.psInfoModal.querySelector(".ps-rtp");
  if (rtpList) {
    rtpList.textContent = "";
    [
      `The theoretical return to player of this game is ${pct(profile.theoretical_percent)}.`,
      `With Ante Bet active, the theoretical return to player is ${pct(profile.ante_bet_percent)}.`,
      `The theoretical return to player of Buy Free Spins is ${pct(profile.buy_free_spins_percent)}.`
    ].forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      rtpList.appendChild(li);
    });
  }
  const bet = Number(el.betSelect?.value || 1);
  host.textContent = "";
  const table = (caption, scaler) => {
    const { groups, rows, scatter } = paytableRows(bet, scaler);
    const t = document.createElement("table");
    t.className = "ps-paytable__table";
    const cap = document.createElement("caption");
    cap.textContent = caption;
    t.appendChild(cap);
    const addRow = (cells, tag) => {
      const tr = document.createElement("tr");
      cells.forEach((text) => {
        const c = document.createElement(tag);
        c.textContent = text;
        tr.appendChild(c);
      });
      t.appendChild(tr);
    };
    addRow(["Symbol", ...groups], "th");
    rows.forEach(({ label, cells }) => addRow([label, ...cells.map(fmt)], "td"));
    addRow(["Scatter", ...scatter.map((s) => `${s.label}: ${fmt(s.amount)}`)], "td");
    return t;
  };
  const note = document.createElement("p");
  note.className = "ps-paytable__note";
  note.textContent = `Pays shown for a bet of ${fmt(bet)}, before multipliers. Symbol pays are by number of matching symbols anywhere on the grid.`;
  host.append(
    note,
    table("Base game", scalers.basePayoutScaler),
    table("Free Spins", scalers.freeSpinPayoutScaler)
  );
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

/** The scatters to celebrate: every SCATTER on the board the player is looking
 *  at (the renderer's committed board), read when the celebration starts. It
 *  used to be the union over all tumble steps: a scatter that fell during a
 *  tumble left its old cell in that union, and the glow landed on whatever
 *  symbol sits there now. Scatters never win, so they are never cleared: the
 *  final board holds all of them, and its count is the engine's trigger count
 *  (the highest scatter count on a single board). */
function displayedScatterCells() {
  const out = [];
  (reelRenderer.board.matrix || []).forEach((row, r) => {
    (row || []).forEach((sym, c) => { if (sym === "SCATTER") out.push({ row: r, col: c }); });
  });
  return out;
}

// Dev builds (local / admin view) check the scatter celebration against what is
// on screen and against the engine, and say so loudly when they disagree.
const DEV_CHECKS = /^(localhost|127\.|\[::1\])/.test(window.location.hostname)
  || document.body.classList.contains("admin-mode");
function assertScatterCells(cells, payload, label) {
  if (!DEV_CHECKS) return;
  const board = reelRenderer.board.matrix || [];
  const problems = [];
  for (const { row, col } of cells) {
    const sym = board[row]?.[col];
    if (sym !== "SCATTER") problems.push(`cell r${row}c${col} shows ${sym}, not SCATTER`);
  }
  const engineCount = Number(payload?.scatter_count);
  if (Number.isFinite(engineCount) && engineCount !== cells.length) {
    problems.push(`${cells.length} scatters on screen, engine counted ${engineCount}`);
  }
  const final = payload?.tumble_steps?.[payload.tumble_steps.length - 1]?.matrix || payload?.matrix;
  if (Array.isArray(final) && final.some((row, r) => (row || []).some((s, c) => (s === "SCATTER") !== (board[r]?.[c] === "SCATTER")))) {
    problems.push("the board on screen is not the round's final board");
  }
  if (!problems.length) return;
  window.__scatterAssertFailures = (window.__scatterAssertFailures || 0) + problems.length;
  console.error(`[scatter-check] ${label}: ${problems.join("; ")}`);
}

// Scatters needed for this round's feature: the base trigger, or the free-spin
// retrigger. From the rules file, so it cannot drift from the math.
function scatterTargetFor(payload) {
  const fs = state.rules?.features?.free_spins || {};
  return payload?.is_free_spin
    ? Number(fs.retrigger_scatter_count) || 3
    : Number(fs.base_trigger_scatter_count) || 4;
}

async function celebrateScatterCatch(payload, label = "Bonus Catch") {
  const scatters = displayedScatterCells();
  assertScatterCells(scatters, payload, label);
  if (!scatters.length) return;
  // 5c/5d: lock on before the feature reveal. The catch (the gong) lands on
  // the lock-on itself; a retrigger rings the same gong, lighter.
  window.Sound?.play("scatter_catch", { retrigger: Boolean(payload?.is_free_spin) });
  await reelRenderer.lockOn(scatters, 760);
  // Highlight on the same board the cells were read from, so the glow and the
  // symbols under it cannot disagree.
  const matrix = reelRenderer.board.matrix;
  const multipliers = payload?.multipliers || payload?.tumble_steps?.[payload.tumble_steps.length - 1]?.multipliers || [];
  pulseBanner(label, "bonus", 900);
  window.Ambiance?.react("bonus");
  pushGameMessage(`${label}: ${scatters.length} scatters caught.`, "bonus");
  await Promise.all([
    reelRenderer.highlight(matrix, { winning: scatters, multipliers }, 1180),
    reelRenderer.celebrateCluster(scatters, "SCATTER", scatters.length >= 5 ? "blast-great" : "blast-medium", 980)
  ]);
  // Near-win beat: hold on the caught scatters so the player registers the
  // bonus trigger before autoplay/feature continues. (Skipped on fast-stop.)
  await animationSleep(460);
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
  return winChipTierFromStrength(getWinTier(win, bet).blast);
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

// Count the balance from one settled value to another. Durations scale with
// the size of the win (log), compress with turbo, and collapse on fast-stop.
async function animateBalance(from, to) {
  if (!el.balance) return;
  const delta = to - from;
  if (!Number.isFinite(from) || !Number.isFinite(to) || delta < 0.005) {
    el.balance.textContent = fmt(to);
    return;
  }
  const bet = Number(el.betSelect?.value || 1) || 1;
  let ms = clamp(350 + Math.log10(1 + delta / bet) * 450, 350, 1400);
  ms = state.fastStopRequested ? 150 : ms * turboScale();
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = (now) => {
      const t = clamp((now - t0) / ms, 0, 1);
      el.balance.textContent = fmt(lerp(from, to, easeOutCubic(t)));
      if (t < 1) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  el.balance.textContent = fmt(to);
}

async function animateRound(payload, bet, wagerOverride, options = {}) {
  // The settled balance BEFORE this round's win: the engine charges the bet
  // (paid spins only) and adds the win, so balance_after - total_win is the
  // post-bet balance on every kind of round. Shown now; the win is counted
  // into it at the end of the round.
  const balanceAfter = Number(payload.balance_after);
  const balancePreWin = Number((balanceAfter - Number(payload.total_win || 0)).toFixed(2));
  if (Number.isFinite(balancePreWin) && el.balance) el.balance.textContent = fmt(balancePreWin);

  // The result is now committed and the reels are about to play it out: promote
  // the lock to the ANIMATING phase so a tap from here on means "fast-stop".
  spinLock.markAnimating();
  state.roundAnimating = true;
  el.spinBtn?.classList.add("is-spinning");
  el.spinBtn?.setAttribute("aria-label", "Stop spin");
  // If a fast-stop was latched during the starting/network window, spin() cleared
  // the is-fast-stopping cue when the result arrived — re-assert it (and the
  // renderer hint) so this round animates fast and shows the fast-stopping state.
  if (state.fastStopRequested) {
    el.spinBtn?.classList.add("is-fast-stopping");
    reelRenderer.requestFastStop?.();
  }
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
  if (payload.is_free_spin) {
    state.spinMultDisplay = parseFloat(el.activeMultiplier.textContent) || 1;
  } else {
    // Base game: this round's Total Multiplier starts from nothing (the
    // multiplier text still holds the previous spin's). The badge is laid out
    // but empty, so this round's souls fly to it; it fades in on the first
    // catch. Absolute over the board: showing it never moves the layout.
    state.spinMultDisplay = 1;
    if (el.bonusMultiBadge) {
      el.bonusMultiBadge.classList.remove("hidden");
      setBadgeMultiplier(0);
    }
  }
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
  reelRenderer.focusOff();
  reelRenderer.fx.heavyReveals = new Map();
  if (options.preparedTransition) {
    await options.preparedTransition;
  } else {
    await reelRenderer.dropOff();
  }
  // Make the new matrix current WITHOUT drawing it at rest. The old code
  // force-drew the full board in its resting position here, one frame before
  // the intro drop began — so the player saw the generated rows sitting in
  // place and then snap upward to fall (the "I see the rows right before they
  // fall" glitch). intro() below commits the board together with the fall
  // offset on the same synchronous tick, so the very first painted frame
  // already shows the symbols entering from above — no resting flash, no blank.
  reelRenderer.setBoard(steps[0].matrix, { multipliers: steps[0].multipliers || [] });
  try {
    const m = steps[0].matrix || [];
    const tag = `[anim] id=${String(payload?.spin_id || "?").slice(0, 8)} m[0][0]=${m?.[0]?.[0] || "?"}`;
    console.log(tag);
    if (el.resultDump) el.resultDump.dataset.lastSpinTag = tag;
  } catch {}
  pushGameMessage(payload.is_free_spin ? "Free spin started." : `Spin started (bet ${fmt(bet)}).`, "info");
  // A multiplier landing on the first board ALWAYS plays its full reveal
  // (lightning + BANG), even when the opening board isn't itself a win — so the
  // player never sees a multiplier appear silently.
  // Landing thuds are per column now, scheduled by the renderer's drop in
  // sync with the waterfall (ReelCanvasRenderer.scheduleColumnStops).
  // Step 5: scatter feedback + reel anticipation for this round's opening board.
  const scatterTarget = scatterTargetFor(payload);
  const anticipation = findAnticipation(steps[0].matrix, scatterTarget);
  await reelRenderer.intro(steps[0].matrix, steps[0].multipliers || [], {
    animateMultipliers: true,
    scatterTarget,
    anticipation
  });
  // Note: multiplier drop sounds are fired by the renderer at each multiplier's
  // BANG moment (spawnHeavyImpact) so they stay perfectly in sync with the
  // visual landing — see ReelCanvasRenderer.spawnHeavyImpact.
  // Near-win beat: if a multiplier just dropped in, hold briefly so the player
  // registers it before the win/tumble flow continues. animationSleep collapses
  // to ~0 on fast-stop, so impatient players aren't held up.
  if ((steps[0].multipliers || []).length) await animationSleep(120);

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (i > 0) {
      const prev = steps[i - 1];
      const prevWinning = Array.isArray(prev?.winning_positions) ? prev.winning_positions : [];
      const prevWinTotal = Number(prev?.win_total || 0);
      if (prevWinning.length > 0 && prevWinTotal > 0) {
        const prevWinTier = stepWinTier(prev, bet);
        const prevTier = prevWinTier.blast;
        pushGameMessage(`Tumble ${i} triggered.`, "info");
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
        // Deliberate beat (no overlap):
        //   1) the caught cluster was just held + celebrated (the 2.5s mark),
        //   2) it EXPLODES here; explode() resolves once the burst's symbols
        //      are gone (BLAST_GONE), with no lean or shake of the neighbours,
        //   3) the refill drops straight away, under the still-flying shards.
        // The win chip + cluster celebration ride along with the burst. The
        // drop is awaited immediately after the explode resolves (no awaited
        // gap on the slower chip/celebrate promises in between) so the cleared
        // cells can never flash the old symbols back before the refill commits.
        window.Sound?.play("explode", { tier: prevTier });
        await reelRenderer.explode(
          prevWinning,
          ANIMATION_TIMING.explode, // turbo scaling applied inside explode()
          prevTier
        );
        window.Sound?.play("tumble", { step: i });
        // Multiplier drop sounds fire from the renderer at each BANG (synced to
        // the visual landing) — see spawnHeavyImpact.
        await reelRenderer.drop(
          step.matrix,
          step.multipliers || [],
          dropMap,
          ANIMATION_TIMING.tumbleDrop, // turbo + momentum scaling applied inside drop()
          { animateMultipliers: true, scatterTarget, tempo: tumbleTempo(i) }
        );
        await Promise.all([chipPromise, celebratePromise]);
      } else if (prevWinning.length === 0 && Array.isArray(prev?.multipliers) && prev.multipliers.length > 0) {
        // multipliers may persist on a non-winning matrix; nothing to do.
      }
    }
    const stepTier = stepWinTier(step, bet);
    const tier = stepTier.blast;
    const stepWin = Number(step?.win_total || 0);
    // Celebration hold for the caught cluster. Every win here is an 8+ catch
    // (min match = 8), so the headline opening catch is held for the full
    // celebrateHoldFirst (2.5s) and chained tumble catches use the shorter
    // celebrateHoldChain so a long cascade keeps moving. Very large clusters
    // get a little extra read-time, capped, so huge boards stay watchable.
    const markedCount = (step.winning_positions || []).length;
    const isWinStep = markedCount > 0 && stepWin > 0;
    let pulseDuration = 0;
    if (isWinStep) {
      pulseDuration = i === 0
        ? ANIMATION_TIMING.celebrateHoldFirst
        : ANIMATION_TIMING.celebrateHoldChain;
    }
    const stepMaxMultiplier = maxMultiplierInStep(step);
    const mTier = multiplierEventTier(stepMaxMultiplier);
    if ((step.winning_positions || []).length && stepWin > 0) {
      // No per-step popups. Across a tumble chain, showing the amount every
      // step (and stacking banners/callouts) is noisy and repetitive — so steps
      // only update the running meter + play the tier's sound. Exactly ONE win
      // message is shown at the end of the spin (the finale below).
      pushGameMessage(`${stepTier.label || "Win"}: ${fmt(stepWin)} on step ${i + 1}.`, "win");
      if (stepTier.flash) {
        await reelRenderer.jackpotFlash({
          duration: 520,
          colorA: THEME.alpha(THEME.color.laser, 0.30),
          colorB: THEME.alpha(THEME.color.gold, 0.28)
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
        // The drop sound already fired at each multiplier's BANG (renderer's
        // spawnHeavyImpact, synced to the visual landing). Here we only run the
        // catch visuals.
        await Promise.all([
          reelRenderer.multiplierCatch(fresh, freshTier === "epic" || freshTier === "legendary" || freshTier === "mythic" ? 820 : 460),
          flyMultiplierSouls(fresh)
        ]);
        // Big catches keep the flash for impact (no shake: the board stays
        // still), and no text "CATCH" banner/callout/log message.
        if (freshTier === "epic" || freshTier === "legendary" || freshTier === "mythic") {
          await reelRenderer.jackpotFlash({
            duration: freshTier === "mythic" ? 900 : 700,
            colorA: freshTier === "mythic" ? "rgba(255, 165, 224, 0.46)" : "rgba(190, 214, 255, 0.34)",
            colorB: freshTier === "mythic" ? "rgba(255, 232, 184, 0.38)" : "rgba(149, 190, 255, 0.26)"
          });
        }
      }
    }
    // The cluster lights up now (after the multiplier souls, if any): its sound with it.
    if (isWinStep) window.Sound?.play("win_light");
    await reelRenderer.highlight(
      step.matrix,
      { winning: step.winning_positions || [], multipliers: step.multipliers || [] },
      (step.winning_positions || []).length ? pulseDuration : 0
    );
  }

  // ── Single end-of-spin message ───────────────────────────────────────────
  // Exactly ONE message is shown over the reels per spin (no stacked Total Win /
  // Multiplier Applied / Big Win popups). The running meter counts up silently;
  // then either the combine finale OR one win callout OR the max-win message is
  // shown — never more than one.
  const appliedMult = Number(payload.multiplier_applied || 1);
  const totalWinAmt = Number(payload.total_win || 0);
  const totalWinX = bet > 0 ? totalWinAmt / bet : 0;
  // Detect a max-win-cap event (rare) — it owns the single message if present.
  const maxWinEvt = (Array.isArray(payload.events) ? payload.events : [])
    .find((e) => e?.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP" || e?.type === "MAX_WIN_CAP_REACHED");
  // A multiplied win (base or bonus) shows WHY it paid: the meter first holds
  // the win before multiplying, the combine takes it × the Total Multiplier,
  // and only then does the meter count up to the total.
  const isMultipliedWin = !maxWinEvt && appliedMult > 1 && totalWinAmt > 0;
  const rawWin = isMultipliedWin ? Number((totalWinAmt / appliedMult).toFixed(2)) : totalWinAmt;
  if (isMultipliedWin) setBadgeMultiplier(appliedMult); // authoritative (a fast-stop may skip a soul)
  const meterBeforeFinal = Number(el.lastWin.textContent || 0);
  if (Math.abs(rawWin - meterBeforeFinal) > 0.009) {
    await animateWinMeter(meterBeforeFinal, rawWin, 240);
  }

  let messageShown = false;
  if (maxWinEvt) {
    const capX = Number(maxWinEvt.cap_x || 0);
    window.Ambiance?.react("win", { tier: WIN_TIER_MAX.blast, amountX: totalWinX });
    pushGameMessage(`Max win cap (${capX}×) reached.`, "bonus");
    messageShown = true;
    // Counts up through every tier, then lands on MAX WIN.
    await celebrateBigWin(totalWinAmt, bet, {
      finalTier: { ...WIN_TIER_MAX, label: `${WIN_TIER_MAX.label} ${capX.toLocaleString()}×` }
    });
  } else if (isMultipliedWin) {
    // Every multiplied win → the combine reveals Win × Total Multiplier =
    // Total Win (a fast-stop skips it). Then the meter counts to the total; if
    // that total is an overlay tier, the celebration follows.
    if (!state.fastStopRequested) await playWinCombineSequence(rawWin, appliedMult, totalWinAmt, { emptyBadge: !payload.is_free_spin });
    await animateWinMeter(rawWin, totalWinAmt, 360);
    playWinLand(totalWinAmt, bet);
    if (appliedMult >= 50) window.Ambiance?.react("win", { tier: "blast-great", amountX: totalWinX });
    messageShown = true;
    if (getWinTier(totalWinAmt, bet).overlay) await celebrateBigWin(totalWinAmt, bet);
  }

  // A plain win's count-up has landed (its last chip counted in): its stinger.
  if (!maxWinEvt && !isMultipliedWin && totalWinAmt > 0) playWinLand(totalWinAmt, bet);

  // No-win / bonus-trigger only touch the admin log (no over-reel text — the
  // player can see the board).
  if (Number(payload.free_spins_awarded || 0) > 0) {
    pushGameMessage(`Bonus triggered: +${payload.free_spins_awarded} free spins.`, "bonus");
  } else if (totalWinAmt <= 0) {
    pushGameMessage("No win this spin.", "info");
  } else {
    // Plain win (no big-multiplier finale): overlay tiers get the full-screen
    // celebration; anything smaller already had its moment on the board.
    if (!messageShown) {
      const roundTier = getWinTier(totalWinAmt, bet);
      if (roundTier.overlay) {
        if (roundTier.blast === "blast-great") {
          window.Ambiance?.react("win", { tier: roundTier.blast, amountX: totalWinX });
        }
        messageShown = true;
        await celebrateBigWin(totalWinAmt, bet);
      }
    }
    pushGameMessage(`Total spin win: ${fmt(totalWinAmt)}.`, "win");
  }

  // Resolution: count the win into the balance. The UI stays locked until the
  // count lands (spin() unlocks after animateRound returns).
  await animateBalance(balancePreWin, Number.isFinite(balanceAfter) ? balanceAfter : 0);
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
  const manual = !options.autoplay;

  // ── ONE GATE FOR EVERY MANUAL PRESS ──────────────────────────────────────
  // Issue #28 in one rule: while ANY round is in flight — base game, base
  // autoplay, free-spin autoplay, buy-feature, resumed bonus — a press can only
  // ever ACCELERATE the round already on screen. It never starts one, never
  // queues one, and is never silently swallowed.
  //
  // isRoundInFlight() is the single source of truth for "is the lifecycle busy?"
  // The old code returned early on bonusAutoplay/autoplayActive, so during free
  // spins the spin button did nothing at all: the bonus was the one place
  // speed-up was dead.
  if (manual && isRoundInFlight()) {
    // A manual press also cancels BASE autoplay (matches production slots). The
    // free-spin autoplay is not cancellable — those spins are owed to the player
    // — so it only ever speeds up. Either way the current round still finishes:
    // stopping is about what comes next, never about aborting what is running.
    if (state.autoplayActive) stopAutoplay();
    lifecycleStats.blockedPresses += 1;
    requestFastStop();
    return;
  }
  if (manual && performance.now() - state.roundSettledAt < SPIN_SETTLE_GUARD_MS) {
    lifecycleStats.blockedPresses += 1;
    return;
  }
  // The casino paused the game (reality check, deposit modal): no new round.
  if (state.embedPaused) {
    lifecycleStats.blockedPresses += 1;
    return;
  }
  // Acquire BEFORE any await so a rapid double-tap can never slip a second spin
  // through the network window. Autoplay spins are serialized by their driving
  // loop, which holds the lock for the whole run.
  if (manual && !spinLock.tryAcquire()) {
    lifecycleStats.blockedPresses += 1;
    requestFastStop();
    return;
  }
  // Past this point a round IS starting.
  if (manual) lifecycleStats.startedManual += 1;
  else lifecycleStats.startedAuto += 1;
  state.fastStopRequested = false;
  el.spinBtn?.classList.remove("is-fast-stopping");
  setControls(true);
  ticker.roundStart();
  try {
    const bet = Number(el.betSelect.value || 1);
    el.betView.textContent = fmt(bet);
    if (_platform.enabled && regulatory.rules) {
      if (!(await realityCheckGate())) return undefined; // the player left
      if (Number(el.freeSpins.textContent || 0) === 0) await paceRound();
    }
    embedEmit("roundStarted", {
      trace_id: startRoundTrace(),
      bet,
      ante: Boolean(el.anteToggle.checked),
      free_spin: Number(el.freeSpins.textContent || 0) > 0,
      free_round: freeRounds.active
    });
    window.Sound?.play("spin_start");
    window.Ambiance?.react("spin");
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
    rememberFeatureTerms(payload, bet, Boolean(el.anteToggle.checked));
    if (!payload?.is_free_spin) roundAnswered();
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
    embedRoundEnded(payload, bet);
    if (Number(payload.free_spins_awarded || 0) > 0 && !payload.is_free_spin) {
      await celebrateScatterCatch(payload, "Bonus Catch");
      window.Sound?.play("feature_award");
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
      window.Sound?.play("feature_award", { retrigger: true });
      const sf = showFeature(`You won ${payload.free_spins_awarded} more Free Spins`, "Spins resume in a moment...");
      const autoDismiss = setTimeout(() => dismissFeature(), 1800);
      try { await sf; } finally { clearTimeout(autoDismiss); }
    }
    return payload;
  } catch (err) {
    reelRenderer.setBoard(randomMatrix());
    if (err.code === "REALITY_CHECK_REQUIRED") {
      // The RGS's backstop (e.g. the client timer drifted): show it, no error.
      regulatory.due = true;
      await realityCheckPrompt(err.details);
      return undefined;
    }
    if (err.code === "SPIN_TOO_FAST") {
      roundAnswered();
      pushGameMessage("Please wait a moment before the next round.", "info");
      return undefined;
    }
    el.resultDump.textContent = `Error: ${err.message}`;
    pushGameMessage(`Spin error: ${err.message}`, "error");
    embedError(err);
  } finally {
    // Release reliably on every exit path — success, error, or fast-stop
    // cancel. Held across the trailing bonus flow above so manual taps stay
    // blocked until the whole lifecycle (including bonus autoplay) settles.
    if (manual) spinLock.release();
    if (!state.bonusAutoplay) setControls(false);
    ticker.roundEnd();
    freeRoundsUi.settle(); // after roundEnd, so a completion line wins over the tips
    state.roundSettledAt = performance.now();
  }
}

async function autoplayBonus() {
  if (state.bonusAutoplay) return;
  // The whole bonus is ONE atomic lifecycle: no other round may begin until the
  // last free spin has resolved. Reached from a manual spin the lock is already
  // held by that spin (which keeps it until the bonus returns); reached from
  // buy-feature or a resumed session it is held by that caller. Only if nobody
  // holds it do we take it ourselves, and then we are the one who releases it.
  const ownsLock = !spinLock.isLocked() && spinLock.tryAcquire();
  state.bonusAutoplay = true;
  setControls(true);
  let total = 0;
  // The terms this bonus plays at, for a reload mid-bonus (see restoredBetAndAnte).
  // A resumed bonus is already showing its terms, so re-saving them is harmless.
  saveBetPref({ featureBet: Number(el.betSelect.value), featureAnte: Boolean(el.anteToggle.checked) });
  embedEmit("featureState", { active: true, free_spins_left: Number(el.freeSpins.textContent || 0), bonus_win: 0 });
  window.Sound?.setMusic("freeSpins");
  window.Sound?.play("fs_intro");
  try {
    pushGameMessage("Bonus autoplay started.", "bonus");
    while (Number(el.freeSpins.textContent || "0") > 0) {
      // A casino pause holds the bonus between free spins (they stay owed on the server).
      await waitWhileEmbedPaused();
      const payload = await spin({ autoplay: true });
      total += Number(payload?.total_win || 0);
      const capEvent = (payload?.events || []).find((evt) => evt?.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP");
      if (capEvent) {
        total = Number(capEvent.bonus_total_win || total);
        break;
      }
      await animationSleep(120);
    }
    window.Sound?.play("fs_outro");
    await showFeature(`Bonus Win ${fmt(total)}`, "Press anywhere to continue.");
    pushGameMessage(`Bonus autoplay complete. Total bonus win: ${fmt(total)}.`, "bonus");
  } finally {
    window.Sound?.setMusic("base");
    embedEmit("featureState", { active: false, free_spins_left: Number(el.freeSpins.textContent || 0), bonus_win: total });
    state.bonusAutoplay = false;
    // Clear any fast-stop latched on the final free spin so the next base-game
    // spin does not inherit it and play out instantly.
    state.fastStopRequested = false;
    el.spinBtn?.classList.remove("is-fast-stopping");
    if (ownsLock) spinLock.release();
    setControls(false);
  }
}

function setTurbo(on) {
  // A jurisdiction without turbo: it stays off however it is asked for (button, hold).
  state.turbo = Boolean(on) && regRule("turbo_enabled", true);
  window.Sound?.play("turbo_toggle", { on: state.turbo });
  if (el.turboBtn) {
    el.turboBtn.classList.toggle("is-active", state.turbo);
    el.turboBtn.setAttribute("aria-pressed", String(state.turbo));
  }
}

function updateAutoplayUi() {
  if (!el.autoplayBtn) return;
  const active = state.autoplayActive;
  el.autoplayBtn.classList.toggle("is-active", active);
  // The spin button becomes the autoplay stop control while a run is active.
  el.spinBtn?.classList.toggle("is-autoplay", active);
  el.autoplayBtn.setAttribute("aria-label", active ? "Stop autoplay" : "Autoplay");
  const count = el.autoplayBtn.querySelector(".tool-count");
  if (count) {
    count.textContent = active
      ? (state.autoplayLeft === Infinity ? "∞" : String(state.autoplayLeft))
      : "";
  }
}

// Regular (base-game) autoplay: spin a chosen count automatically, stopping on
// request, on a spin error (e.g. insufficient funds -> spin() returns falsy),
// or when the count runs out. A bonus award mid-run is handled inside spin()
// (it runs the bonus autoplay, then returns and we continue).
async function startAutoplay(count) {
  if (state.autoplayActive || state.bonusAutoplay || !state.sessionId || state.embedPaused) return;
  if (!regRule("autoplay_enabled", true)) return;
  const cap = regRule("max_autoplay_spins", null);
  if (cap !== null) count = Math.min(count, cap);
  if (!(count > 0)) return;
  // Dismiss the picker on any outcome, including the refusal below — leaving it
  // open after a choice was made reads as a dead control.
  el.autoplayPopover?.classList.add("hidden");
  // Hold the lock for the WHOLE run, not per spin: the run is a single
  // lifecycle as far as "may another round start?" is concerned, and holding it
  // is also what lets animateRound() promote to the ANIMATING phase (and so
  // makes fast-stop work) on autoplay spins, which do not acquire it themselves.
  // A round already in flight means the run simply does not begin.
  if (!spinLock.tryAcquire()) return;
  state.autoplayActive = true;
  state.autoplayLeft = count;
  state.autoplayInitial = count;
  updateAutoplayUi();
  try {
    while (state.autoplayActive && state.autoplayLeft > 0 && state.sessionId) {
      if (state.autoplayLeft !== Infinity) state.autoplayLeft -= 1;
      updateAutoplayUi();
      const payload = await spin({ autoplay: true });
      if (!payload || !state.autoplayActive) break;
      await sleep(AUTOPLAY_GAP_MS);
    }
  } finally {
    state.autoplayActive = false;
    state.autoplayLeft = 0;
    state.fastStopRequested = false;
    el.spinBtn?.classList.remove("is-fast-stopping");
    spinLock.release();
    updateAutoplayUi();
    setControls(false);
    state.roundSettledAt = performance.now();
  }
}

function stopAutoplay() {
  state.autoplayActive = false;
  updateAutoplayUi();
}

// Mirror the live Balance/Bet readouts into the persistent bottom footer
// (Pragmatic-style CREDIT/BET strip) without touching every update site.
function bindFooterMirror() {
  if (!el.footerBalance && !el.footerBet) return;
  const sync = () => {
    if (el.footerBalance && el.balance) el.footerBalance.textContent = el.balance.textContent;
    if (el.footerBet && el.betView) el.footerBet.textContent = freeRoundsReadoutText() ?? el.betView.textContent;
  };
  sync();
  const obs = new MutationObserver(sync);
  if (el.balance) obs.observe(el.balance, { childList: true, characterData: true, subtree: true });
  if (el.betView) obs.observe(el.betView, { childList: true, characterData: true, subtree: true });
}

async function buyFreeSpins() {
  if (!state.sessionId || state.bonusAutoplay || state.embedPaused) return;
  if (!regRule("buy_feature_enabled", true)) return;
  if (el.anteToggle.checked) return;
  const bet = Number(el.betSelect.value || 1);
  const costMultiplier = Number(state.rules?.features?.buy_free_spins?.cost_multiplier || 100);
  const cost = Number((bet * costMultiplier).toFixed(2));
  const ok = await confirmBuy({ cost, currency: state.currency || "GEL", costMultiplier });
  if (!ok || state.embedPaused) return;
  // A bought feature is a round like any other and must own the lifecycle for
  // its whole duration — the paid base round AND the free spins that follow.
  // Without this the bought round animated with the lock idle, so a tap during
  // it started a real concurrent spin (state.bonusAutoplay is not set yet at
  // that point, so the bonus guard did not cover this window).
  if (!spinLock.tryAcquire()) return;
  setControls(true);
  try {
    pulseBanner("Buying Free Spins...", "bonus", 900);
    if (_platform.enabled && regulatory.rules) {
      if (!(await realityCheckGate())) return;
      await paceRound();
    }
    embedEmit("roundStarted", { trace_id: startRoundTrace(), bet, ante: false, free_spin: false, free_round: false, buy: true });
    const payload = await api("/api/v1/buy-free-spins", { session_id: state.sessionId, bet_amount: bet });
    rememberFeatureTerms(payload, bet, false);
    roundAnswered();
    pushGameMessage(`Bought free spins for ${fmt(payload.buy_cost || 0)}.`, "bonus");
    await animateRound(payload, bet, Number(payload.buy_cost || 0));
    embedRoundEnded(payload, bet);
    if (Number(payload.free_spins_awarded || 0) > 0) {
      await celebrateScatterCatch(payload, "Bonus Catch");
      window.Sound?.play("feature_award");
      await showFeature(`You won ${payload.free_spins_awarded} Free Spins`, "Autoplay starts when you continue.");
      await autoplayBonus();
    }
  } catch (err) {
    el.resultDump.textContent = `Error: ${err.message}`;
    pushGameMessage(`Buy error: ${err.message}`, "error");
    embedError(err);
  } finally {
    spinLock.release();
    state.fastStopRequested = false;
    el.spinBtn?.classList.remove("is-fast-stopping");
    if (!state.bonusAutoplay) setControls(false);
  }
}

/** The feature screen (a VxNotify "feature"): resolves when it is dismissed
 *  (a tap anywhere on it, or dismissFeature()). */
function showFeature(title, copy) {
  return VxNotify.open("feature", { kicker: "Feature", title, body: copy });
}

function dismissFeature() {
  VxNotify.close("feature", "dismissed");
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
    renderPaytable();
    const allowed = rules.features?.multipliers?.allowed_values || [];
    renderMultiplierInfo(allowed);
    ticker.refresh();
  } catch (err) {
    pushGameMessage(`Rules load failed: ${err.message}`, "error");
  }
}

// ─── Bet / ante that survive a reload ───────────────────────────────────────
// The RGS only knows bets that were PLAYED, and the standalone engine knows none,
// so the player's own choice is also kept per device: localStorage, per boot
// mode + game + currency (a 10.00 GEL bet is not a 10.00 EUR bet). Always
// re-validated against the session's allowed bets.
//   bet / ante              the player's last choice in the base game
//   featureBet / featureAnte  the terms a bonus started on: the standalone engine has
//                           no feature lock, so a reload mid-bonus must not replay the
//                           remaining free spins at a different bet
const betPrefKey = () => `vx.betPref:${_platform.enabled ? "rgs" : "local"}:${state.gameId}:${state.currency || "GEL"}`;
function loadBetPref() {
  try {
    const v = JSON.parse(localStorage.getItem(betPrefKey()) || "null");
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}
function saveBetPref(patch) {
  try { localStorage.setItem(betPrefKey(), JSON.stringify({ ...loadBetPref(), ...patch })); } catch { /* storage off: server record only */ }
}
/**
 * A round that awarded a bonus fixes the bonus's terms. Saved the moment the result
 * is in, so a reload during the award screen or the animation already resumes at them.
 */
function rememberFeatureTerms(payload, bet, ante) {
  if (!payload?.is_free_spin && Number(payload?.free_spins_left || 0) > 0) {
    saveBetPref({ featureBet: Number(bet), featureAnte: Boolean(ante) });
  }
}

/** A bet/ante change the player made (not the boot restore, a campaign lock or a feature). */
function isPlayerBetChoice() {
  return !state.restoringBet && !freeRounds.active && Number(el.freeSpins?.textContent || 0) === 0;
}

/**
 * Which bet + ante a (re)booted session starts on. Inside a feature the server's
 * locked terms win (platform), else the terms the feature started on (standalone).
 * In the base game the player's last choice on this device wins (it may be newer
 * than anything played), else the server's last played bet.
 */
function restoredBetAndAnte(payload, allowedBets, inFeature) {
  const pref = loadBetPref();
  const serverBet = payload.bet_amount == null ? null : Number(payload.bet_amount);
  // In a feature with no record of its terms (storage cleared), the player's last
  // chosen bet is the best remaining guess, and still beats 1.00.
  const candidates = inFeature ? [serverBet, pref.featureBet, pref.bet] : [pref.bet, serverBet];
  const bet = candidates.map((b) => (b == null ? NaN : Number(b))).find((b) => allowedBets.includes(b)) ?? null;
  const serverAnte = Boolean(payload.ante_enabled);
  let ante;
  if (inFeature) ante = payload.bet_amount != null ? serverAnte : typeof pref.featureAnte === "boolean" ? pref.featureAnte : serverAnte;
  else ante = typeof pref.ante === "boolean" ? pref.ante : serverAnte;
  return { bet, ante };
}

async function initSession() {
  state.restoringBet = true;
  if (new URLSearchParams(window.location.search).has("reset")) {
    try { window.SlotEngine?.SessionStore?.clearSession?.(); } catch {}
  }
  const payload = await api("/api/v1/session/init", { player_id: `player_${Date.now()}`, currency: "GEL", locale: "en", game_id: state.gameId });
  state.sessionId = payload.session_id;
  state.currency = payload.currency || "GEL";
  state.gameId = payload.game_id || state.gameId;
  el.balance.textContent = fmt(payload.balance);
  // Claim the Round ID row NOW, while the board is still idle. In platform mode
  // it is guaranteed to appear after the first spin, and un-hiding it then would
  // shrink the board mid-animation. Reserving it up front makes that a no-op.
  if (_platform.enabled && el.roundIdBar) el.roundIdBar.classList.remove("hidden");
  el.betSelect.innerHTML = "";
  (payload.allowed_bets || []).forEach((b) => {
    const option = document.createElement("option");
    option.value = String(b);
    option.textContent = fmt(b);
    el.betSelect.appendChild(option);
  });
  // Restore the bet and ante (see restoredBetAndAnte): a feature's locked terms,
  // else the player's own last choice on this device, else the server's record of
  // their last played bet; 1.00 only when there is none of those.
  const allowedBets = (payload.allowed_bets || []).map(Number);
  const pendingFreeSpins = Number(payload.free_spins_left || 0);
  const restored = restoredBetAndAnte(payload, allowedBets, pendingFreeSpins > 0);
  const startBet = restored.bet ?? (allowedBets.includes(1) || !allowedBets.length ? 1 : allowedBets[0]);
  el.betSelect.value = String(startBet);
  el.betView.textContent = fmt(startBet);
  if (el.betDisplay) el.betDisplay.textContent = fmt(startBet);
  renderPaytable(startBet);
  if (pendingFreeSpins > 0) {
    // Mid-feature: the bet and ante are the feature's locked terms. Lock the
    // controls now, before the resume screen, not only once the autoplay starts.
    setControls(true);
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
  // Set ante both ways: a player who switched it off must not get it back on.
  if (el.anteToggle && el.anteToggle.checked !== restored.ante) {
    el.anteToggle.checked = restored.ante;
    el.anteToggle.dispatchEvent(new Event("change"));
  }
  state.restoringBet = false; // from here on, bet / ante changes are the player's
  setCrazyMode(Boolean(payload.crazy_mode), { silent: true });
  pushGameMessage(`Session ${state.sessionId.slice(0, 8)} initialized.`, "info");
  state.lastBalance = Number(payload.balance);
  if (_platform.enabled) {
    applyRegulatory(_platform.sessionMeta?.regulatory);
    embedConnect(_platform.sessionMeta);
    window.EmbedBridge?.ready({
      game_code: state.gameId,
      currency: state.currency,
      balance: state.lastBalance,
      resumed: Boolean(_platform.sessionMeta?.resume?.resumed),
      in_feature: pendingFreeSpins > 0,
      free_spins_left: pendingFreeSpins
    });
  }
  // Operator free rounds waiting: lock bet/ante/buy to the campaign and announce.
  if (freeRounds.active) await freeRoundsUi.begin();
  // If a persisted session left the player mid-bonus, auto-resume the
  // autoplay instead of leaving stale free spins lying around. Otherwise
  // the player would unknowingly burn them by clicking spin manually, and
  // any 4+ scatter catch during base game would be impossible (every spin
  // would be a free spin, so it'd retrigger +5 instead of triggering 15).
  if (pendingFreeSpins > 0) {
    await showFeature(`Resuming Bonus — ${pendingFreeSpins} Free Spins`, "Press anywhere to continue.");
    await autoplayBonus();
    freeRoundsUi.settle(); // a resumed feature may have been the last free round's
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
  renderPaytable(); // crazy mode swaps the pay scalers
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
  if (isPlayerBetChoice()) saveBetPref({ bet: Number(el.betSelect.value) });
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
  window.Sound?.play("bet_change", { up: direction > 0 });
}
if (el.betDownBtn) el.betDownBtn.addEventListener("click", () => stepBet(-1));
if (el.betUpBtn) el.betUpBtn.addEventListener("click", () => stepBet(1));

// Ante disables Buy Free Spins (game rules; the engine refuses it too), so the
// gold button must stop looking clickable the moment Ante is switched on, not
// only when the controls next refresh at spin time.
if (el.anteToggle) {
  el.anteToggle.addEventListener("change", () => {
    window.Sound?.play("toggle", { on: el.anteToggle.checked });
    el.buyFreeBtn.disabled = el.anteToggle.checked || isRoundInFlight() || freeRounds.active;
    if (isPlayerBetChoice()) saveBetPref({ ante: el.anteToggle.checked });
    // The standalone engine keeps its own ante flag (it refuses a buy while it is on)
    // and only updates it on a spin; keep it in step with the toggle, including a
    // restored "off". The RGS takes ante from each request, so platform mode needs nothing.
    if (!_platform.enabled) getEngine().then((engine) => engine.setAnteEnabled(el.anteToggle.checked)).catch(() => {});
  });
}
// The buy dialog clicks as it opens, so no click on top of it here.
el.buyFreeBtn.addEventListener("click", () => buyFreeSpins());
if (el.turboBtn) el.turboBtn.addEventListener("click", () => setTurbo(!state.turbo));

// Sound on/off toggle — reflects + persists via the engine, syncs the glyph.
if (el.soundToggle) {
  const syncSoundToggle = () => {
    const muted = window.Sound ? window.Sound.isMuted() : false;
    el.soundToggle.classList.toggle("is-muted", muted);
    el.soundToggle.setAttribute("aria-pressed", String(!muted));
  };
  el.soundToggle.addEventListener("click", () => {
    if (!window.Sound) return;
    window.Sound.unlock();
    window.Sound.toggleMuted();
    if (!window.Sound.isMuted()) window.Sound.play("toggle", { on: true });
    syncSoundToggle();
  });
  window.Sound?.onChange(syncSoundToggle);
  syncSoundToggle();
}
if (el.autoplayBtn) {
  el.autoplayBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.autoplayActive) { window.Sound?.play("toggle", { on: false }); stopAutoplay(); return; }
    el.autoplayPopover?.classList.toggle("hidden");
    window.Sound?.play("click");
  });
}
if (el.autoplayPopover) {
  el.autoplayPopover.querySelectorAll("button[data-autoplay]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.Sound?.play("toggle", { on: true });
      const raw = btn.dataset.autoplay;
      const count = raw === "inf" ? Infinity : Number(raw);
      startAutoplay(count);
    });
  });
  document.addEventListener("click", (e) => {
    if (el.autoplayPopover.classList.contains("hidden")) return;
    if (el.autoplayPopover.contains(e.target) || e.target === el.autoplayBtn) return;
    el.autoplayPopover.classList.add("hidden");
  });
}
el.simulateBtn.addEventListener("click", () => runSimulation({ bonusOnly: false }));
if (el.simulateBonusBtn) el.simulateBonusBtn.addEventListener("click", () => runSimulation({ bonusOnly: true }));
if (el.testDropBtn) el.testDropBtn.addEventListener("click", () => runVisualTest("drop"));
if (el.testExplodeBtn) el.testExplodeBtn.addEventListener("click", () => runVisualTest("explode"));
if (el.testCelebrateBtn) el.testCelebrateBtn.addEventListener("click", () => runVisualTest("celebrate"));
if (el.testCatchBtn) el.testCatchBtn.addEventListener("click", () => runVisualTest("catch"));
if (el.crazyToggleBtn) el.crazyToggleBtn.addEventListener("click", () => setCrazyMode(!state.crazyMode));
// ═══ PLAYER SHELL INTERACTION ═══════════════════════════════════════════════
// The info/settings modal, the HUD ticker and the spin input (tap vs hold).
// Pure UI: every action goes through the existing spin() / startAutoplay() /
// setTurbo() lifecycle, so the spin lock (#28) still decides what may start.

// ── Info / settings modal ──
// Until the info copy is written, the Game Rules page is generated from the
// rules file (rules_pages + RTP), so RTP, the max win and the malfunction
// clause stay reachable. Authored content wins: generation only runs while the
// section holds nothing but its heading.
function renderInfoRules() {
  const section = el.psInfoModal?.querySelector('[data-ps-section-id="rules"]');
  const rules = state.rules;
  if (!section || !rules || section.dataset.generated === "1") return;
  if ([...section.children].some((n) => n.tagName !== "H3")) return;
  const frag = document.createDocumentFragment();
  const meta = document.createElement("p");
  meta.className = "ps-rules-meta";
  frag.appendChild(meta);
  (rules.rules_pages || []).forEach((page) => {
    const h = document.createElement("h4");
    h.textContent = page?.title || "";
    const ul = document.createElement("ul");
    (page?.points || []).forEach((point) => {
      const li = document.createElement("li");
      li.textContent = point;
      ul.appendChild(li);
    });
    frag.append(h, ul);
  });
  // RTP and paytable depend on the session's profile and bet, so they are
  // filled (and refilled) by renderPlayerPaytable(), not generated once here.
  const rtpHead = document.createElement("h4");
  rtpHead.textContent = "Return to Player";
  const rtpList = document.createElement("ul");
  rtpList.className = "ps-rtp";
  const payHead = document.createElement("h4");
  payHead.textContent = "Paytable";
  const pay = document.createElement("div");
  pay.className = "ps-paytable";
  frag.append(rtpHead, rtpList, payHead, pay);
  section.appendChild(frag);
  section.dataset.generated = "1";
  renderPlayerPaytable();
}

// ── Notifications (#49) ──
// Every popup goes through one skeleton (client/notify.js, VxNotify): the
// same lifecycle, keyboard/focus rules, close reasons, audio hooks and skin
// API for each. docs/notification-skeleton.md.
VxNotify.register("feature", el.featureScreen, {
  kind: "feature",
  visibility: "class",
  dismiss: { anywhere: "tap" },
  fill: (slots, d) => {
    if (slots.kicker) slots.kicker.textContent = d.kicker ?? "Feature";
    if (slots.title) slots.title.textContent = d.title ?? "";
    if (slots.body) slots.body.textContent = d.body ?? "";
  }
});
VxNotify.register("buyConfirm", document.getElementById("buyConfirmModal"), {
  kind: "modal",
  visibility: "class",
  dismiss: { backdrop: "cancel", escape: "cancel", enter: "confirm" },
  audio: { open: "click", close: "click", confirm: "buy_feature" }
});
// The reality check has no way out but its two buttons (continue / leave).
VxNotify.register("reality", document.getElementById("realityCheck"), { kind: "modal", visibility: "attr", audio: { close: "click" } });
VxNotify.register("freeRounds", el.frModal, {
  kind: "modal",
  visibility: "attr",
  dismiss: { backdrop: "play", escape: "play", enter: "play", space: true },
  audio: { open: "click", close: "ui_confirm" }
});
VxNotify.register("bigwin", document.getElementById("bigWinOverlay"), { kind: "bigwin", external: true });
VxNotify.setBanner((text, tone, ms) => ticker.flash(text, tone, ms));

const psModal = (() => {
  const root = el.psInfoModal;
  if (!root) return { open() {}, close() {}, isOpen: () => false };
  const tabs = [...root.querySelectorAll(".ps-modal__tab")];
  const sections = [...root.querySelectorAll(".ps-modal__section")];
  const dots = [...root.querySelectorAll(".ps-dot")];
  const body = root.querySelector(".ps-modal__body");
  const ids = tabs.map((t) => t.dataset.psSection);
  let current = ids[0];

  function show(id) {
    current = ids.includes(id) ? id : ids[0];
    tabs.forEach((t) => {
      if (t.dataset.psSection === current) t.setAttribute("aria-current", "page");
      else t.removeAttribute("aria-current");
    });
    sections.forEach((s) => { s.hidden = s.dataset.psSectionId !== current; });
    dots.forEach((d) => d.classList.toggle("is-active", d.dataset.psDot === current));
    if (body) body.scrollTop = 0;
    if (current === "rules") renderInfoRules();
    revealTab();
  }
  // On phones the tab bar is a horizontal strip wider than the screen: keep the
  // active tab in view. "nearest" moves nothing when it is already visible.
  function revealTab() {
    root.querySelector(".ps-modal__tab[aria-current='page']")
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }
  function step(delta) {
    show(ids[(ids.indexOf(current) + delta + ids.length) % ids.length]);
  }
  // The skeleton owns Esc, Tab (trapped) and the focus; paging is ours.
  const shell = VxNotify.register("info", root, {
    kind: "modal",
    visibility: "attr",
    dismiss: { backdrop: "closed", escape: "closed" },
    audio: { open: "click", close: "click" },
    onKey(e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return false;
      e.preventDefault();
      step(e.key === "ArrowRight" ? 1 : -1);
      root.querySelector(".ps-modal__tab[aria-current='page']")?.focus();
      return true;
    }
  });
  function open(id, trigger) {
    show(id);
    trigger?.focus?.(); // the skeleton returns the focus to what had it on open
    shell.open();
    revealTab(); // show() ran while the modal was hidden, so nothing scrolled then
    // Keyboard users land on the section they asked for.
    setTimeout(() => root.querySelector(".ps-modal__tab[aria-current='page']")?.focus(), 0);
  }
  function close() {
    shell.close("closed");
  }
  root.addEventListener("click", (e) => {
    if (e.target === root || e.target.closest("[data-ps-close]")) return; // the skeleton closes it
    const tab = e.target.closest("[data-ps-section]");
    if (tab) {
      show(tab.dataset.psSection);
      return;
    }
    const dot = e.target.closest("[data-ps-dot]");
    if (dot) show(dot.dataset.psDot);
  });
  return { open, close, isOpen: () => shell.isOpen };
})();

el.psMenuBtn?.addEventListener("click", () => psModal.open("settings", el.psMenuBtn));
el.psInfoBtn?.addEventListener("click", () => psModal.open("rules", el.psInfoBtn));

// ── HUD ticker: the game's single message line ──
// A small state machine on #psTicker. The box is fixed and its one line is
// clipped, so no state can move the board.
//   idle  tips built from the rules file (so they cannot drift from the
//         math), rotating every TICKER.rotateMs;
//   spin  a static line for the round: "Good luck!", autoplay or free spins left;
//   win   the moment the win meter credits a payout, "WIN: amount" cuts in
//         (gold, punch-in) and HOLDS until the next spin starts. It follows the
//         meter as later tumbles add to it.
// flash(text) is a transient notice (multiplier locked, feature bought…):
// shown for its duration, then the current state's line comes back.
const TICKER = { rotateMs: 4500, flashMinMs: 900 };
/** Free spins left once the one starting now is played (#46): n − 1, never below 0. */
const freeSpinsRemainingAfter = (left) => Math.max(0, (Number(left) || 0) - 1);
const ticker = (() => {
  const box = el.psTicker;
  const node = el.psTickerText;
  let mode = "idle";
  let line = "";
  let idleIdx = 0;
  let rotateTimer = 0;
  let flashTimer = 0;
  let flashing = false;
  const calm = () => prefersReducedMotion() || !node?.animate;
  function paint(text, kind) {
    if (node && node.textContent !== text) node.textContent = text;
    if (box && box.dataset.state !== kind) box.dataset.state = kind;
  }
  const show = () => { if (!flashing) paint(line, mode); };
  function tips() {
    // While operator free rounds run they ARE the message; no rotating tips.
    if (freeRounds.active && freeRounds.queue.length) {
      const n = freeRounds.remaining;
      return [`${n} Free Round${n === 1 ? "" : "s"} left · Bet ${fmt(freeRounds.bet)}`];
    }
    const r = state.rules || {};
    const f = r.features || {};
    const out = [`Minimum ${Number(r.layout?.min_match_count) || 8} matches to win`];
    if (f.tumble?.enabled !== false) out.push("Tumbles keep paying until no new win lands");
    if (f.multipliers?.enabled) {
      out.push(`Multipliers up to ${Number(f.multipliers.range_max || 1000).toLocaleString("en-US")}× boost your tumble wins`);
    }
    if (f.free_spins?.base_trigger_scatter_count) {
      out.push(`${f.free_spins.base_trigger_scatter_count} scatters award ${f.free_spins.base_award_spins} free spins`);
    }
    // Ante bet disables the buy (rules: ante_bet), so only offer it when it works.
    if (f.buy_free_spins?.enabled && !el.anteToggle?.checked) out.push("Buy feature available");
    out.push(`Win up to ${(Number(r.max_win_cap_multiplier) || 20000).toLocaleString("en-US")}× bet`);
    if (!window.matchMedia?.("(pointer: coarse)").matches) out.push("Hold space for turbo spin");
    return out;
  }
  function stopRotate() {
    clearInterval(rotateTimer);
    rotateTimer = 0;
  }
  function rotate() {
    const m = tips();
    line = m[idleIdx % m.length];
    idleIdx += 1;
    show();
  }
  function idle() {
    stopRotate();
    mode = "idle";
    rotate();
    rotateTimer = setInterval(rotate, TICKER.rotateMs);
  }
  function spinLine() {
    // el.freeSpins still counts the spin that is starting (the engine consumes
    // it), so the line shows what is left AFTER it: "Remaining: 14" on the
    // first of 15, down to "Remaining: 0" on the last. A retrigger lands in
    // free_spins_left, so the next line includes it.
    if (state.bonusAutoplay) return `Free spins · Remaining: ${freeSpinsRemainingAfter(el.freeSpins?.textContent)}`;
    // This spin uses one free round (the server consumes it), so show what's left after it.
    if (freeRounds.active && freeRounds.queue.length) return `Free round · ${Math.max(0, freeRounds.remaining - 1)} left`;
    if (state.autoplayActive) {
      return state.autoplayLeft === Infinity ? "Autoplay · press spin to stop" : `Autoplay · ${state.autoplayLeft} left`;
    }
    return "Good luck!";
  }
  function roundStart() {
    stopRotate();
    mode = "spin";
    line = spinLine();
    show();
  }
  /** Hit the line: a short punch-in. Scale + light only, on the text inside
   *  the fixed box; skipped under reduced motion. */
  function bump(strong = false) {
    if (calm()) return;
    node.animate(strong
      ? [{ transform: "scale(1.35)", filter: "brightness(2)" }, { transform: "scale(1)", filter: "brightness(1)" }]
      : [{ filter: "brightness(1.8)" }, { filter: "brightness(1)" }],
    { duration: strong ? 380 : 260, easing: "cubic-bezier(0.2, 0.9, 0.2, 1)" });
  }
  function win(amountText) {
    stopRotate();
    const first = mode !== "win";
    mode = "win";
    line = `Win: ${amountText}`;
    show();
    if (first && !flashing) bump(true);
  }
  function roundEnd() {
    // A win holds until the next spin; a round without one goes back to tips.
    if (mode !== "win") idle();
  }
  function flash(text, tone = "info", ms = TICKER.flashMinMs) {
    clearTimeout(flashTimer);
    flashing = true;
    paint(text, `flash-${tone === "win" || tone === "bonus" ? tone : "info"}`);
    flashTimer = setTimeout(() => {
      flashing = false;
      show();
    }, Math.max(TICKER.flashMinMs, ms));
  }
  /** Round-scoped status (scatter count): replaces the spin line, or flashes
   *  if a win already holds the ticker. */
  function say(text) {
    if (mode === "spin") {
      line = text;
      show();
    } else flash(text);
  }
  // The win meter has many writers (step wins, count-ups, round end), so follow
  // the element rather than hooking each one. Only payouts during a round
  // count: the meter resetting to 0.00 at spin start is not a win.
  if (el.lastWin && "MutationObserver" in window) {
    new MutationObserver(() => {
      const v = Number(el.lastWin.textContent || 0);
      if (v > 0 && mode !== "idle") win(el.lastWin.textContent);
    }).observe(el.lastWin, { childList: true, characterData: true, subtree: true });
  }
  // Rules arrive after boot (and ante toggles the buy tip): re-show the current
  // tip with real values.
  function refresh() {
    if (mode !== "idle") return;
    idleIdx = Math.max(0, idleIdx - 1);
    rotate();
  }
  return { idle, roundStart, roundEnd, refresh, say, flash, bump, get mode() { return mode; } };
})();
ticker.idle();

// ── Operator free rounds: UI lockdown, award modal, completion ──
// Data lives in `freeRounds` (mirrored from the server). This only presents it:
// on load an award modal; while they run, bet/ante/buy locked, the bet forced to
// the campaign's and the deck's Bet readout turned into the counter; when the last
// one (and any feature it triggered) is done, a ticker line with the total and the
// player's own bet + ante back. Nothing here moves or resizes the board.
const freeRoundsUi = (() => {
  const modal = el.frModal;
  let locked = false;
  let saved = null; // the player's cash selections, restored afterwards

  function setBet(value) {
    const v = String(value);
    if (el.betSelect.value === v || ![...el.betSelect.options].some((o) => o.value === v)) return;
    el.betSelect.value = v;
    el.betSelect.dispatchEvent(new Event("change"));
  }
  function paintReadout() {
    const text = freeRoundsReadoutText();
    if (el.betReadoutLabel) el.betReadoutLabel.textContent = text ? "Free Rounds" : "Bet";
    if (el.footerBet) el.footerBet.textContent = text ?? el.betView.textContent;
  }
  function apply() {
    if (!locked) {
      locked = true;
      saved = { bet: el.betSelect.value, ante: Boolean(el.anteToggle?.checked) };
      document.body.classList.add("free-rounds-on");
      if (el.anteToggle?.checked) {
        el.anteToggle.checked = false;
        el.anteToggle.dispatchEvent(new Event("change"));
      }
    }
    if (freeRounds.bet != null) setBet(freeRounds.bet); // the next campaign may lock another bet
    if (!isRoundInFlight()) setControls(false);
    paintReadout();
    ticker.refresh();
  }
  function release() {
    if (!locked) return;
    locked = false;
    document.body.classList.remove("free-rounds-on");
    if (saved) {
      setBet(saved.bet);
      if (el.anteToggle && saved.ante !== el.anteToggle.checked) {
        el.anteToggle.checked = saved.ante;
        el.anteToggle.dispatchEvent(new Event("change"));
      }
    }
    saved = null;
    if (!isRoundInFlight()) setControls(false);
    paintReadout();
    ticker.refresh();
  }

  /** "You have X Free Rounds!" on the Step 6 modal shell; resolves when dismissed. */
  function announce() {
    if (!modal) return Promise.resolve();
    const n = freeRounds.remaining;
    const head = freeRounds.queue[0];
    if (el.frCount) el.frCount.textContent = String(n);
    if (el.frNoun) el.frNoun.textContent = n === 1 ? "Free Round" : "Free Rounds";
    if (el.frBet) el.frBet.textContent = fmt(freeRounds.bet);
    if (el.frCurrency) el.frCurrency.textContent = state.currency || "";
    if (el.frMeta) {
      const until = head?.valid_to ? new Date(head.valid_to) : null;
      el.frMeta.textContent = until && !Number.isNaN(until.getTime())
        ? `Bet per round · valid until ${until.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`
        : "Bet per round";
    }
    // A VxNotify modal: Play, Esc, Enter, Space or the backdrop close it.
    return VxNotify.open("freeRounds").then(() => {});
  }

  /** On load: lock the UI, then tell the player. */
  async function begin() {
    if (!freeRounds.active) return;
    apply();
    await announce();
  }

  /** After every round: keep the lock in step with the server, or finish. */
  function settle() {
    if (!freeRounds.active) return;
    if (freeRounds.queue.length) {
      apply();
      return;
    }
    // Last free round played; a scatter feature it triggered still belongs to it.
    if (freeRounds.featureLeft > 0 || state.bonusAutoplay) return;
    const won = freeRounds.won;
    freeRounds.active = false;
    freeRounds.won = 0;
    release();
    ticker.flash(`Free Rounds complete · Total won ${fmt(won)} ${state.currency || ""}`.trim(), "win", 3600);
  }

  return { begin, settle };
})();

// ── Anticipation drone (Step 5b) ──
// A rising tension tone while the anticipated reels wait. Its own small Web

// Step 5 hooks: the renderer reports scatter counts and anticipation; the HUD
// readout (pinned-height ticker line) and the drone react.
reelRenderer.onSlamLanded = endFastStop;
// Multiplier emblems bake their number in the display face: rebake once it
// has loaded, so none keeps a fallback font.
THEME.fontsReady?.then(() => { reelRenderer.emblemSprites.clear(); });
reelRenderer.onScatterCount = (n, need) => ticker.say(`Scatters ${n}/${need}`);
reelRenderer.onSymbolLand = (row, col) => window.Sound?.play("tick", { row, col, rows: reelRenderer.rows });
reelRenderer.onAnticipation = (phase, ms) => {
  if (phase === "start") window.Sound?.drone.start(ms);
  else window.Sound?.drone.stop();
};

// ── Spin input: tap vs hold ──
// Tap (< SPIN_HOLD_MS) = one spin, on release. Hold (≥ SPIN_HOLD_MS) = turbo on
// + endless autoplay, started the moment the hold is recognised. While a round
// or an autoplay run is in flight a press is never a hold: it acts at once
// through spin(), which stops autoplay (the current round still finishes) and
// fast-stops — the #28 rule that a press can only ever accelerate.
// Dragging off the button cancels a press, as with any button.
const SPIN_HOLD_MS = 400;
const spinHold = { timer: 0, active: false, fired: false, source: "", endedAt: 0 };

function spinHoldStart(source) {
  if (spinHold.active || el.spinBtn.disabled) return;
  spinHold.active = true;
  spinHold.source = source;
  spinHold.fired = false;
  if (isRoundInFlight()) {
    spinHold.fired = true;
    spin();
    return;
  }
  spinHold.timer = setTimeout(() => {
    spinHold.fired = true;
    if (isRoundInFlight()) {
      spin();
      return;
    }
    if (!state.turbo) setTurbo(true);
    startAutoplay(Infinity);
  }, SPIN_HOLD_MS);
}

function spinHoldEnd(commit) {
  if (!spinHold.active) return;
  clearTimeout(spinHold.timer);
  spinHold.active = false;
  spinHold.endedAt = performance.now();
  if (commit && !spinHold.fired) spin();
}

el.spinBtn.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  spinHoldStart("pointer");
});
el.spinBtn.addEventListener("pointerup", () => {
  if (spinHold.source === "pointer") spinHoldEnd(true);
});
el.spinBtn.addEventListener("pointerleave", () => {
  if (spinHold.source === "pointer") spinHoldEnd(false);
});
el.spinBtn.addEventListener("pointercancel", () => {
  if (spinHold.source === "pointer") spinHoldEnd(false);
});
// No long-press context menu on touch: a hold here means autoplay.
el.spinBtn.addEventListener("contextmenu", (e) => e.preventDefault());
// Pointer presses are handled above. A click with detail 0 is keyboard
// activation (Enter on the focused button) or a scripted click; the guard
// drops the click a Space release on the focused button may still produce.
el.spinBtn.addEventListener("click", (e) => {
  if (e.detail !== 0) return;
  if (performance.now() - spinHold.endedAt < 80) return;
  spin();
});

window.addEventListener("keydown", (e) => {
  if (e.code !== "Space" || VxNotify.anyModalOpen()) return;
  const t = e.target;
  const typing = t?.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t?.tagName || "");
  if (typing && t !== el.spinBtn) return;
  e.preventDefault();
  if (e.repeat) return;
  spinHoldStart("key");
});
window.addEventListener("keyup", (e) => {
  if (e.code !== "Space" || spinHold.source !== "key") return;
  e.preventDefault();
  spinHoldEnd(true);
});
// Losing focus mid-hold (alt-tab) must not leave a hold armed.
window.addEventListener("blur", () => spinHoldEnd(false));

// Seed the idle board with a varied mix (not a flat wall of one symbol) so the
// first impression looks like a real slot. Engine spins remain authoritative.
reelRenderer.setBoard(createDemoMatrix());
renderExamples();
renderSpinLog();
renderTestPanel();
bindFooterMirror();
el.symbolLegend.textContent = "Top Crown, Hourglass, Ring, Chalice, Red Gem, Purple Triangle, Yellow Hex, Green Triangle, Blue Diamond, Wild Multiplier, Scatter";
el.payoutRuleText.textContent = "High-volatility pays-anywhere model. Wild multipliers and scatter-triggered bonus spins drive peak wins.";
el.multiplierInfo.textContent = "Loading...";
el.activeMultiplier.textContent = "1x";
// Boot loader: gate the reveal on EVERY image the game can ever show, so nothing
// is fetched once the player is in. It used to wait on a hand-picked list of 12
// symbols, which left the free-spins panel, the active-ante plate and the page
// backgrounds to be fetched on first use — they visibly streamed in mid-session.
// The renderer already loaded all of it once in preloadSymbols(), so we WATCH its
// existing load promises rather than re-requesting the URLs; every asset is
// fetched exactly once.
function runBootLoader() {
  const bar = document.getElementById("bootLoaderBar");
  const pctEl = document.getElementById("bootLoaderPct");
  const loader = document.getElementById("bootLoader");
  // Everything in symbolAssets + uiAssets, decoded and ready to paint.
  // Fonts are critical too: canvas text drawn before they load would paint in
  // the fallback face and then visibly swap.
  const waits = [THEME.fontsReady, ...Array.from(reelRenderer.imageLoads?.values() || [])];
  // The on-screen <img> buttons are owned by the document, not the renderer.
  // Their URLs are already in uiAssets (so the bytes are shared), but wait on
  // the elements too so the reveal cannot beat their own decode.
  document.querySelectorAll(".img-btn img, .ante-toggle-img").forEach((img) => {
    waits.push(img.complete
      ? Promise.resolve()
      : new Promise((resolve) => { img.onload = img.onerror = () => resolve(); }));
  });
  const total = waits.length || 1;
  let done = 0;
  let revealed = false;

  const setProgress = (p) => {
    if (bar) bar.style.width = `${p}%`;
    if (pctEl) pctEl.textContent = `${p}%`;
    if (loader) loader.setAttribute("aria-valuenow", String(p));
  };
  const bump = () => {
    done += 1;
    setProgress(Math.round((done / total) * 100));
  };
  const reveal = () => {
    if (revealed) return;
    revealed = true;
    setProgress(100);
    document.body.classList.add("app-ready");
    loadDeferredAssets();
  };

  // Advance the bar as each existing load settles.
  waits.forEach((p) => p.then(bump));
  // Safety valve: a stalled asset must never trap the player behind the splash.
  // Generous now that the bar waits on the FULL manifest — the whole payload is
  // ~500KB of WebP, so anything past this is a genuinely broken connection, not
  // a slow one. Firing early would reveal a half-loaded game, which is the exact
  // bug this gating exists to prevent.
  const safety = setTimeout(reveal, 20000);
  Promise.all(waits).then(() => {
    clearTimeout(safety);
    reveal();
  });
}

// Non-critical, heavy art loaded only after the game is visible: the ~5MB hero
// character (skipped entirely on low-tier devices, where CSS also hides it).
// The hero <img> is currently commented out in index.html, so this is a no-op
// until the art is re-enabled.
function loadDeferredAssets() {
  const hero = document.getElementById("stageCharacter");
  if (hero && hero.dataset.src && !document.body.classList.contains("perf-low")) {
    hero.src = hero.dataset.src;
  }
}

// Stop burning battery while the player is not looking. Nothing in the client
// listened for this before: the render loop ran until unload and the Web Audio
// scheduler kept re-arming, so a game left open in a background tab (or a phone
// with the screen locked) kept the CPU and the audio hardware busy indefinitely.
//
// Browsers usually stop firing rAF on a hidden document, but "usually" is not a
// guarantee — Android WebViews and the casino iframe wrappers the platform
// launches into do not reliably do it — so we cancel the frame explicitly.
// `pagehide` covers the iOS case where the tab is frozen without ever going
// through visibilitychange.
function installVisibilityGuards() {
  const park = () => {
    reelRenderer.pauseRendering();
    window.Sound?.suspendAudio?.();
  };
  const wake = () => {
    // The big-win overlay keeps the board paused while it is up; celebrateBigWin
    // resumes it on dismiss.
    if (!bigWin.active) reelRenderer.resumeRendering();
    window.Sound?.resumeAudio?.();
  };
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) park();
    else wake();
  });
  window.addEventListener("pagehide", park);
  // bfcache restore re-shows the page without a visibilitychange event.
  window.addEventListener("pageshow", () => {
    if (!document.hidden) wake();
  });
}
installVisibilityGuards();

runBootLoader();
initSession().catch((err) => {
  el.resultDump.textContent = `Init failed: ${err.message}`;
  pushGameMessage(`Init failed: ${err.message}`, "error");
  // The bridge is not armed without a session (no allowlist), so nothing reaches
  // the casino here; it sees no "ready" and can time out on that.
  // In platform mode an expired/invalid launch token leaves balance "-" and the
  // controls clickable-but-dead, which looks like a generic break. Make the real
  // cause obvious and lock the controls so nothing silently no-ops.
  const code = String(err?.message || "");
  const isAuthError = _platform.enabled &&
    /TOKEN_EXPIRED|UNAUTHORIZED|HTTP_401|HTTP_403/i.test(code);
  if (isAuthError) {
    if (el.balance) el.balance.textContent = "—";
    setControls(true);
    pulseBanner("Game link expired", "bonus", 6000);
    pushGameMessage(
      'This game link has expired. Open a fresh launch URL — re-run "npm run dev:seed", or use the Admin Portal → Onboarding → Launch a demo player.',
      "error"
    );
  }
});
loadRules();
