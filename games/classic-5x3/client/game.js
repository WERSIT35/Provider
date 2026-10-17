/*
 * Classic 5x3: the player client (renderer + game shell) on the multi-game platform.
 *
 * - Server-authoritative: every outcome comes from the RGS (/game/v1/*). The reels land on
 *   the server's own `stops` on the real strips (rules.json, the file the engine pays from),
 *   so what the player sees is exactly what was paid. Visuals never feed back into play.
 * - Shared shell: the casino bridge (/play/embed-bridge.js), the sound engine
 *   (/play/audio/audio.js), haptics, autoplay with stop conditions, turbo, quick stop.
 * - Light by design: symbols are drawn once per size into sprites; the canvas loop runs only
 *   while something moves (a resting board costs nothing); no layout ever moves the board.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = {
    canvas: $("reels"), board: $("board"), msg: $("msg"), balance: $("balance"), bet: $("bet"), win: $("win"),
    spin: $("spinBtn"), betUp: $("betUp"), betDown: $("betDown"), auto: $("autoBtn"), autoPop: $("autoPop"), turbo: $("turboBtn"),
    sound: $("soundBtn"), info: $("info"), infoBtn: $("infoBtn"), rules: $("rulesBody"), fsBadge: $("fsBadge"),
    cel: $("celebration"), celTitle: $("celTitle"), celAmount: $("celAmount"), reality: $("reality"), realityText: $("realityText")
  };
  const Sound = window.Sound;
  // Classic 5x3's own events on top of the shared engine's (its sounds: audio/manifest.json).
  if (Sound?.defineEvents) {
    const { semis } = Sound.util;
    // Each winning line its own note, walking up a major scale as the lines are shown.
    const SCALE = [0, 2, 4, 5, 7, 9, 11, 12];
    Sound.defineEvents({ line_show: { minGap: 60, voice: (o) => ({ key: "line", rate: semis(SCALE[(Number(o.i) || 0) % SCALE.length]), jitter: false, db: -2 }) } });
  }
  const sfx = (name, opts) => { Haptics.onEvent(name); try { Sound?.play(name, opts); } catch { /* sound is never load-bearing */ } };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  // ── state ────────────────────────────────────────────────────────────────
  const S = {
    token: null, rules: null, currency: "", bets: [], betIndex: 0, balance: null, lines: 20,
    inFlight: false, featureRun: false, quickStop: false, turbo: false, paused: false,
    autoplay: null, // { left, limits, startBalance }
    freeSpinsLeft: 0, featureWin: 0, stats: { startedManual: 0, startedAuto: 0 }
  };
  // A free-spins run is ONE lifecycle (as in Vault 20K): no other round may start between its spins.
  window.__spinLifecycle = { get inFlight() { return S.inFlight || S.featureRun; }, get autoplayActive() { return Boolean(S.autoplay); }, stats: S.stats };

  const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const speed = () => (S.turbo ? 0.5 : 1) * (reduceMotion?.matches ? 0.6 : 1);

  // ── haptics (touch devices only, off with reduced motion, player can switch it off) ──
  const Haptics = (() => {
    const supported = typeof navigator.vibrate === "function" && window.matchMedia?.("(pointer: coarse)").matches === true;
    let on = true;
    try { on = localStorage.getItem("vx.haptics") !== "0"; } catch { /* default on */ }
    const P = { spin_start: 8, reel_stop: 4, scatter_land: 16, feature_award: [30, 50, 30, 50, 60], win_big: [40, 60, 40], win_mega: [50, 60, 50, 60, 70], win_epic: [60, 50, 60, 50, 120] };
    return {
      supported,
      get on() { return on; },
      set(v) { on = Boolean(v); try { localStorage.setItem("vx.haptics", on ? "1" : "0"); } catch { /* not remembered */ } },
      onEvent(name) { const p = P[name]; if (p !== undefined && supported && on && !reduceMotion?.matches && !document.hidden) { try { navigator.vibrate(p); } catch { /* blocked */ } } }
    };
  })();

  // ── messages ─────────────────────────────────────────────────────────────
  function say(text, win = false) { el.msg.textContent = text; el.msg.classList.toggle("win", win); }
  const lineBet = () => S.bets[S.betIndex] / S.lines;

  // ── symbols: Moth & Lantern, cut paper (docs/brand/classic-5x3.md) ─────────
  // Each symbol is built from flat paper layers with a hair of shadow between them. The low
  // symbols are two-tone plants; the high ones get layered depth and a thin gold-leaf edge.
  // Ids are the engine's (CHERRY … SCATTER); only the drawing is themed.
  const NAMES = { CHERRY: "Fern", LEMON: "Clover", ORANGE: "Poppy", PLUM: "Iris", GRAPE: "Firefly jar", MELON: "Paper crane", BELL: "Barn owl", BAR: "Luna moth", SEVEN: "Moth Queen", WILD: "Lantern", SCATTER: "Full moon" };
  const INK = "#0b1026", GOLD_LEAF = "#d9a441";
  function drawSymbol(g, sym, s) {
    const c = s / 2;
    g.save();
    g.lineJoin = "round"; g.lineCap = "round";
    const P = (x, y) => [x * s, y * s];
    // One paper layer: fill, a soft contact shadow, an optional gold-leaf edge.
    const layer = (build, fill, { edge = false, depth = 1 } = {}) => {
      g.save();
      g.shadowColor = "rgba(11,16,38,0.38)"; g.shadowBlur = s * 0.022 * depth; g.shadowOffsetY = s * 0.014 * depth;
      g.beginPath(); build(); g.fillStyle = fill; g.fill();
      g.restore();
      if (edge) { g.beginPath(); build(); g.lineWidth = Math.max(1, s * 0.016); g.strokeStyle = GOLD_LEAF; g.stroke(); }
    };
    const ell = (x, y, rx, ry, rot = 0) => () => g.ellipse(x * s, y * s, rx * s, ry * s, rot, 0, Math.PI * 2);
    const circ = (x, y, r) => () => g.arc(x * s, y * s, r * s, 0, Math.PI * 2);
    const poly = (pts) => () => { pts.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s))); g.closePath(); };
    const stem = (pts, w, col) => { g.beginPath(); g.moveTo(...P(pts[0][0], pts[0][1])); g.quadraticCurveTo(...P(pts[1][0], pts[1][1]), ...P(pts[2][0], pts[2][1])); g.lineWidth = w * s; g.strokeStyle = col; g.stroke(); };
    const glow = (x, y, r, col, a) => { const gr = g.createRadialGradient(x * s, y * s, 0, x * s, y * s, r * s); gr.addColorStop(0, col.replace("A", a)); gr.addColorStop(1, col.replace("A", 0)); g.fillStyle = gr; g.fillRect(0, 0, s, s); };
    const lg = (y0, y1, stops) => { const gr = g.createLinearGradient(0, y0 * s, 0, y1 * s); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
    switch (sym) {
      case "CHERRY": { // fern frond
        stem([[0.46, 0.94], [0.44, 0.5], [0.6, 0.08]], 0.03, "#3f6b45");
        for (let i = 0; i < 7; i++) {
          const t = 0.12 + i * 0.12, x = 0.46 + (0.6 - 0.46) * t * t - 0.02 * Math.sin(t * 3), y = 0.94 - t * 0.84, len = 0.2 - i * 0.02;
          for (const side of [-1, 1]) {
            const rot = side * 0.95 - 0.25;
            layer(ell(x + side * len * 0.55, y - 0.02, len * 0.55, 0.045, rot), "#5e8c61");
            g.beginPath(); ell(x + side * len * 0.5, y - 0.03, len * 0.42, 0.02, rot)(); g.fillStyle = "#86b77f"; g.fill();
          }
        }
        break;
      }
      case "LEMON": { // clover
        stem([[0.5, 0.94], [0.56, 0.74], [0.5, 0.56]], 0.035, "#2f6b5c");
        for (let i = 0; i < 4; i++) {
          g.save(); g.translate(c, s * 0.42); g.rotate((i * Math.PI) / 2 + Math.PI / 4);
          const heart = () => { g.moveTo(0, 0); g.bezierCurveTo(-s * 0.2, -s * 0.06, -s * 0.18, -s * 0.3, -s * 0.02, -s * 0.24); g.bezierCurveTo(s * 0.0, -s * 0.23, s * 0.0, -s * 0.23, s * 0.02, -s * 0.24); g.bezierCurveTo(s * 0.18, -s * 0.3, s * 0.2, -s * 0.06, 0, 0); g.closePath(); };
          layer(heart, "#3d8b7a");
          g.scale(0.62, 0.62); g.beginPath(); heart(); g.fillStyle = "#6fbfa6"; g.fill();
          g.restore();
        }
        break;
      }
      case "ORANGE": { // poppy
        stem([[0.5, 0.95], [0.46, 0.74], [0.5, 0.56]], 0.03, "#3f6b45");
        layer(ell(0.38, 0.8, 0.09, 0.035, -0.6), "#5e8c61");
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; layer(circ(0.5 + Math.cos(a) * 0.15, 0.42 + Math.sin(a) * 0.15, 0.16), i % 2 ? "#d9452f" : "#e8583c"); }
        g.beginPath(); circ(0.5, 0.42, 0.2)(); g.fillStyle = "#f07a52"; g.globalAlpha = 0.5; g.fill(); g.globalAlpha = 1;
        layer(circ(0.5, 0.42, 0.075), "#24182c");
        g.fillStyle = "#f3e6c8"; for (let i = 0; i < 6; i++) { const a = i * 1.05; g.beginPath(); circ(0.5 + Math.cos(a) * 0.045, 0.42 + Math.sin(a) * 0.045, 0.01)(); g.fill(); }
        break;
      }
      case "PLUM": { // iris
        stem([[0.5, 0.95], [0.52, 0.78], [0.5, 0.6]], 0.03, "#3f6b45");
        layer(poly([[0.36, 0.96], [0.42, 0.62], [0.47, 0.96]]), "#5e8c61");
        for (const [x, rot] of [[0.3, -0.7], [0.7, 0.7], [0.5, 0]]) layer(ell(x, 0.58, 0.1, 0.17, rot), "#4f3fb0");
        for (const [x, rot] of [[0.38, -0.35], [0.62, 0.35], [0.5, 0]]) layer(ell(x, 0.3, 0.08, 0.16, rot), "#7d6be0");
        g.lineWidth = s * 0.03; g.strokeStyle = "#ffcc4d"; for (const [x0, x1] of [[0.32, 0.27], [0.68, 0.73], [0.5, 0.5]]) { g.beginPath(); g.moveTo(x0 * s, 0.5 * s); g.lineTo(x1 * s, 0.62 * s); g.stroke(); }
        break;
      }
      case "GRAPE": { // firefly in a jar
        layer(() => { g.roundRect ? g.roundRect(s * 0.24, s * 0.22, s * 0.52, s * 0.7, s * 0.14) : g.rect(s * 0.24, s * 0.22, s * 0.52, s * 0.7); }, "#efe2c2", { depth: 1.4 });
        g.beginPath(); g.roundRect ? g.roundRect(s * 0.3, s * 0.3, s * 0.4, s * 0.56, s * 0.1) : g.rect(s * 0.3, s * 0.3, s * 0.4, s * 0.56); g.fillStyle = "#1b2350"; g.fill();
        g.save(); g.beginPath(); g.roundRect ? g.roundRect(s * 0.3, s * 0.3, s * 0.4, s * 0.56, s * 0.1) : g.rect(s * 0.3, s * 0.3, s * 0.4, s * 0.56); g.clip();
        for (const [x, y, r] of [[0.42, 0.5, 0.05], [0.58, 0.64, 0.045], [0.46, 0.76, 0.035]]) { glow(x, y, r * 4, "rgba(255,181,71,A)", 0.55); g.beginPath(); circ(x, y, r)(); g.fillStyle = "#fff1c8"; g.fill(); }
        g.restore();
        layer(() => { g.roundRect ? g.roundRect(s * 0.28, s * 0.12, s * 0.44, s * 0.12, s * 0.04) : g.rect(s * 0.28, s * 0.12, s * 0.44, s * 0.12); }, "#8a6b45");
        break;
      }
      case "MELON": { // paper crane
        const d = { depth: 1.4 };
        layer(poly([[0.1, 0.56], [0.5, 0.48], [0.62, 0.7], [0.3, 0.72]]), "#c9677f", d);
        layer(poly([[0.5, 0.48], [0.92, 0.6], [0.62, 0.7]]), "#d67990", d);
        layer(poly([[0.3, 0.5], [0.46, 0.12], [0.58, 0.52]]), "#e98aa0", d);
        layer(poly([[0.5, 0.5], [0.8, 0.18], [0.66, 0.56]]), "#f4a9ba", d);
        layer(poly([[0.1, 0.56], [0.04, 0.34], [0.16, 0.52]]), "#e98aa0", d);
        g.beginPath(); g.moveTo(...P(0.5, 0.48)); g.lineTo(...P(0.62, 0.7)); g.lineWidth = s * 0.008; g.strokeStyle = "rgba(11,16,38,0.35)"; g.stroke();
        break;
      }
      case "BELL": { // barn owl
        const e = { edge: true, depth: 1.5 };
        layer(ell(0.5, 0.58, 0.3, 0.36), "#c78d4b", e);
        layer(ell(0.26, 0.64, 0.1, 0.24, 0.25), "#9d6a33"); layer(ell(0.74, 0.64, 0.1, 0.24, -0.25), "#9d6a33");
        layer(() => { g.moveTo(c, s * 0.62); g.bezierCurveTo(s * 0.24, s * 0.56, s * 0.22, s * 0.22, s * 0.38, s * 0.24); g.quadraticCurveTo(c, s * 0.3, s * 0.62, s * 0.24); g.bezierCurveTo(s * 0.78, s * 0.22, s * 0.76, s * 0.56, c, s * 0.62); g.closePath(); }, "#f6ead0");
        for (const x of [0.4, 0.6]) { layer(circ(x, 0.4, 0.07), INK); g.beginPath(); circ(x - 0.02, 0.38, 0.02)(); g.fillStyle = "#ffb547"; g.fill(); }
        layer(poly([[0.47, 0.47], [0.53, 0.47], [0.5, 0.56]]), "#e0a24a");
        break;
      }
      case "BAR": { // luna moth
        const e = { edge: true, depth: 1.5 };
        for (const sd of [-1, 1]) {
          layer(() => { g.moveTo(c, s * 0.5); g.bezierCurveTo(c + sd * s * 0.1, s * 0.66, c + sd * s * 0.22, s * 0.92, c + sd * s * 0.12, s * 0.96); g.bezierCurveTo(c + sd * s * 0.3, s * 0.8, c + sd * s * 0.34, s * 0.6, c, s * 0.5); g.closePath(); }, "#8fd09b", e);
          layer(() => { g.moveTo(c, s * 0.46); g.bezierCurveTo(c + sd * s * 0.12, s * 0.1, c + sd * s * 0.46, s * 0.14, c + sd * s * 0.44, s * 0.36); g.bezierCurveTo(c + sd * s * 0.42, s * 0.5, c + sd * s * 0.2, s * 0.54, c, s * 0.46); g.closePath(); }, "#b6e4b0", e);
          g.beginPath(); circ(0.5 + sd * 0.25, 0.34, 0.05)(); g.fillStyle = "#ffb547"; g.fill(); g.beginPath(); circ(0.5 + sd * 0.25, 0.34, 0.022)(); g.fillStyle = INK; g.fill();
        }
        layer(ell(0.5, 0.48, 0.04, 0.16), "#f3e6c8");
        g.beginPath(); g.moveTo(...P(0.48, 0.32)); g.quadraticCurveTo(...P(0.42, 0.18), ...P(0.38, 0.16)); g.moveTo(...P(0.52, 0.32)); g.quadraticCurveTo(...P(0.58, 0.18), ...P(0.62, 0.16)); g.lineWidth = s * 0.012; g.strokeStyle = "#6d6150"; g.stroke();
        break;
      }
      case "SEVEN": { // the golden Moth Queen
        glow(0.5, 0.48, 0.5, "rgba(255,181,71,A)", 0.45);
        const wing = lg(0.08, 0.9, [[0, "#fff1c8"], [0.45, "#ffb547"], [1, "#c8781a"]]);
        const e = { edge: true, depth: 1.8 };
        for (const sd of [-1, 1]) {
          layer(() => { g.moveTo(c, s * 0.52); g.bezierCurveTo(c + sd * s * 0.08, s * 0.08, c + sd * s * 0.5, s * 0.06, c + sd * s * 0.47, s * 0.34); g.bezierCurveTo(c + sd * s * 0.45, s * 0.52, c + sd * s * 0.2, s * 0.58, c, s * 0.52); g.closePath(); }, wing, e);
          layer(() => { g.moveTo(c, s * 0.54); g.bezierCurveTo(c + sd * s * 0.36, s * 0.56, c + sd * s * 0.4, s * 0.86, c + sd * s * 0.16, s * 0.86); g.bezierCurveTo(c + sd * s * 0.06, s * 0.84, c + sd * s * 0.02, s * 0.7, c, s * 0.54); g.closePath(); }, wing, e);
          g.lineWidth = s * 0.012; g.strokeStyle = "rgba(11,16,38,0.55)";
          g.beginPath(); g.moveTo(c + sd * s * 0.05, s * 0.48); g.quadraticCurveTo(c + sd * s * 0.2, s * 0.26, c + sd * s * 0.4, s * 0.26); g.moveTo(c + sd * s * 0.05, s * 0.56); g.quadraticCurveTo(c + sd * s * 0.22, s * 0.68, c + sd * s * 0.18, s * 0.8); g.stroke();
          g.beginPath(); circ(0.5 + sd * 0.27, 0.32, 0.04)(); g.fillStyle = "#ff7a3d"; g.fill();
        }
        layer(ell(0.5, 0.52, 0.05, 0.2), "#ff7a3d");
        for (const x of [0.44, 0.5, 0.56]) { g.beginPath(); circ(x, x === 0.5 ? 0.22 : 0.25, 0.022)(); g.fillStyle = "#fff1c8"; g.fill(); }
        break;
      }
      case "WILD": { // the lit lantern
        glow(0.5, 0.52, 0.56, "rgba(255,181,71,A)", 0.65);
        const e = { edge: true, depth: 1.6 };
        g.beginPath(); g.moveTo(...P(0.5, 0.02)); g.lineTo(...P(0.5, 0.16)); g.lineWidth = s * 0.012; g.strokeStyle = "#6d6150"; g.stroke();
        layer(() => { g.roundRect ? g.roundRect(s * 0.36, s * 0.14, s * 0.28, s * 0.08, s * 0.03) : g.rect(s * 0.36, s * 0.14, s * 0.28, s * 0.08); }, "#2c2440");
        const body = g.createRadialGradient(c, s * 0.52, s * 0.02, c, s * 0.52, s * 0.34); body.addColorStop(0, "#fff6dc"); body.addColorStop(0.45, "#ffb547"); body.addColorStop(1, "#e8642e");
        layer(ell(0.5, 0.52, 0.3, 0.32), body, e);
        g.save(); g.beginPath(); ell(0.5, 0.52, 0.3, 0.32)(); g.clip(); g.lineWidth = s * 0.012; g.strokeStyle = "rgba(140,50,10,0.45)";
        for (const k of [-0.6, -0.3, 0, 0.3, 0.6]) { g.beginPath(); g.ellipse(c, s * 0.52, Math.abs(k) * s * 0.3 + 0.001, s * 0.32, 0, 0, Math.PI * 2); g.stroke(); }
        g.restore();
        layer(() => { g.roundRect ? g.roundRect(s * 0.38, s * 0.82, s * 0.24, s * 0.07, s * 0.03) : g.rect(s * 0.38, s * 0.82, s * 0.24, s * 0.07); }, "#2c2440");
        g.beginPath(); g.moveTo(...P(0.5, 0.89)); g.lineTo(...P(0.5, 0.98)); g.lineWidth = s * 0.02; g.strokeStyle = "#ff7a3d"; g.stroke();
        break;
      }
      case "SCATTER": { // full moon with a cloud strip
        glow(0.5, 0.44, 0.52, "rgba(207,227,255,A)", 0.55);
        const moon = g.createRadialGradient(s * 0.42, s * 0.36, s * 0.04, c, s * 0.44, s * 0.36); moon.addColorStop(0, "#ffffff"); moon.addColorStop(0.6, "#cfe3ff"); moon.addColorStop(1, "#8fa6d8");
        layer(circ(0.5, 0.44, 0.34), moon, { depth: 1.6 });
        g.fillStyle = "rgba(110,135,190,0.35)"; for (const [x, y, r] of [[0.4, 0.36, 0.06], [0.6, 0.5, 0.05], [0.56, 0.3, 0.03], [0.38, 0.56, 0.035]]) { g.beginPath(); circ(x, y, r)(); g.fill(); }
        layer(() => { g.moveTo(s * 0.06, s * 0.78); g.bezierCurveTo(s * 0.08, s * 0.64, s * 0.24, s * 0.62, s * 0.3, s * 0.68); g.bezierCurveTo(s * 0.36, s * 0.56, s * 0.56, s * 0.56, s * 0.6, s * 0.66); g.bezierCurveTo(s * 0.7, s * 0.6, s * 0.92, s * 0.64, s * 0.94, s * 0.78); g.closePath(); }, "#f3e6c8", { depth: 1.4 });
        break;
      }
    }
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  // Paper grain for the strips: one small noise tile, made once (Math.random is visual only).
  const GRAIN = (() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 96; const gg = cv.getContext("2d"), img = gg.createImageData(96, 96);
    for (let i = 0; i < img.data.length; i += 4) { const v = 200 + Math.random() * 55; img.data[i] = v; img.data[i + 1] = v * 0.94; img.data[i + 2] = v * 0.82; img.data[i + 3] = 22; }
    gg.putImageData(img, 0, 0); return cv;
  })();

  // ── renderer ─────────────────────────────────────────────────────────────
  const R = {
    ctx: el.canvas.getContext("2d"), w: 0, h: 0, dpr: 1, cell: 0, sprites: new Map(),
    reels: [], // { pos (cells, fractional), anim: { from, to, t0, dur } | null, spinning, speed }
    highlight: null, // { cells:Set("r,c"), line: [[row,col]...] | null }
    raf: 0, dirty: true
  };
  function resize() {
    const box = el.board.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (w === R.w && h === R.h && dpr === R.dpr) return;
    R.w = el.canvas.width = w; R.h = el.canvas.height = h; R.dpr = dpr;
    R.cell = Math.min(w / 5, h / 3);
    R.sprites.clear(); R.edges = null;
    R.dirty = true; kick();
  }
  function sprite(sym) {
    let sp = R.sprites.get(sym);
    if (!sp) {
      const s = Math.max(8, Math.floor(R.cell * 0.86));
      sp = document.createElement("canvas"); sp.width = sp.height = s;
      drawSymbol(sp.getContext("2d"), sym, s);
      R.sprites.set(sym, sp);
    }
    return sp;
  }
  // Torn paper edges, one jagged profile per strip side, made per size (visual only).
  function tornEdges() {
    R.edges = [];
    const n = 28;
    for (let col = 0; col < 5; col++) R.edges.push([0, 1].map(() => Array.from({ length: n + 1 }, () => Math.random())));
  }
  function stripPath(g, col, x, y, w, h) {
    const amp = R.cell * 0.022, e = R.edges[col], n = e[0].length - 1;
    g.beginPath();
    for (let i = 0; i <= n; i++) g.lineTo(x + e[0][i] * amp, y + (h * i) / n);
    for (let i = n; i >= 0; i--) g.lineTo(x + w - e[1][i] * amp, y + (h * i) / n);
    g.closePath();
  }
  function draw(now) {
    const g = R.ctx, cell = R.cell, ox = (R.w - cell * 5) / 2, oy = (R.h - cell * 3) / 2;
    if (!R.edges) tornEdges();
    g.clearRect(0, 0, R.w, R.h);
    const hl = R.highlight, gap = cell * 0.07;
    const resting = R.reels.every((r) => !r.anim && !r.spinning);
    // Lanterns at rest light the paper around them.
    const lamps = [];
    if (resting) for (let col = 0; col < 5; col++) { const strip = S.rules.reels[col], L = strip.length, base = Math.round(R.reels[col].pos); for (let k = 0; k < 3; k++) if (strip[(((base + k) % L) + L) % L] === "WILD") lamps.push([col, k]); }
    for (let col = 0; col < 5; col++) {
      const strip = S.rules.reels[col], L = strip.length, reel = R.reels[col];
      const sway = reel.spinning && !reduceMotion?.matches ? Math.sin(now / 85 + col * 1.7) * cell * 0.016 : 0;
      const x = ox + col * cell + gap / 2 + sway, w = cell - gap;
      g.save();
      g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = cell * 0.06; g.shadowOffsetY = cell * 0.02;
      stripPath(g, col, x, oy - cell * 0.02, w, cell * 3 + cell * 0.04); g.fillStyle = "#f3e6c8"; g.fill();
      g.restore();
      g.save(); stripPath(g, col, x, oy - cell * 0.02, w, cell * 3 + cell * 0.04); g.clip();
      g.fillStyle = g.createPattern(GRAIN, "repeat"); g.fillRect(x, oy, w, cell * 3);
      for (const [lc, lk] of lamps) {
        const cx = ox + (lc + 0.5) * cell, cy = oy + (lk + 0.5) * cell, gr = g.createRadialGradient(cx, cy, cell * 0.1, cx, cy, cell * 1.35);
        gr.addColorStop(0, "rgba(255,181,71,0.42)"); gr.addColorStop(1, "rgba(255,181,71,0)"); g.fillStyle = gr; g.fillRect(x, oy, w, cell * 3);
      }
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      const moving = reel.anim || reel.spinning;
      for (let k = -1; k <= 3; k++) {
        const sym = strip[(((base + k) % L) + L) % L];
        const y = oy + (k - frac) * cell;
        const sp = sprite(sym), pad = (cell - sp.width) / 2;
        const win = hl && !moving && hl.cells.has(`${k},${col}`);
        if (win) {
          const gr = g.createRadialGradient(x + w / 2, y + cell / 2, cell * 0.05, x + w / 2, y + cell / 2, cell * 0.6);
          gr.addColorStop(0, "rgba(255,181,71,0.7)"); gr.addColorStop(1, "rgba(255,181,71,0)");
          g.fillStyle = gr; g.fillRect(x, y, w, cell);
        }
        g.globalAlpha = !hl || moving || win ? 1 : 0.3;
        const sx = ox + col * cell + pad + sway;
        if (reel.spinning && !reduceMotion?.matches) {
          g.globalAlpha = 0.5; g.drawImage(sp, sx, y + pad - cell * 0.1, sp.width, sp.height * 1.2);
          g.globalAlpha = 0.3; g.drawImage(sp, sx, y + pad + cell * 0.1, sp.width, sp.height);
        } else g.drawImage(sp, sx, y + pad);
        g.globalAlpha = 1;
      }
      // The strip curls slightly away at the top and bottom of the window.
      const sh = g.createLinearGradient(0, oy, 0, oy + cell * 3);
      sh.addColorStop(0, "rgba(11,16,38,0.4)"); sh.addColorStop(0.1, "rgba(11,16,38,0)"); sh.addColorStop(0.9, "rgba(11,16,38,0)"); sh.addColorStop(1, "rgba(11,16,38,0.4)");
      g.fillStyle = sh; g.fillRect(x, oy - cell * 0.02, w, cell * 3 + cell * 0.04);
      g.restore();
    }
    // Win line: a dotted firefly trail.
    if (hl?.line) {
      const pts = hl.line.map(([row, c]) => [ox + (c + 0.5) * cell, oy + (row + 0.5) * cell]);
      g.save();
      g.beginPath(); pts.forEach(([px, py], i) => (i ? g.lineTo(px, py) : g.moveTo(px, py)));
      g.lineWidth = Math.max(2, cell * 0.025); g.strokeStyle = "rgba(255,181,71,0.35)"; g.stroke();
      g.shadowColor = "rgba(255,190,90,0.95)"; g.shadowBlur = cell * 0.18; g.fillStyle = "#fff1c8";
      const step = cell * 0.16;
      for (let i = 0; i < pts.length - 1; i++) {
        const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / step));
        for (let j = 0; j < n; j++) { const t = j / n; g.beginPath(); g.arc(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, cell * (j % 3 === 0 ? 0.034 : 0.022), 0, Math.PI * 2); g.fill(); }
      }
      g.restore();
    }
  }
  function step(now) {
    R.raf = 0;
    let moving = false;
    for (const reel of R.reels) {
      if (reel.spinning) { reel.pos -= (reel.speed * (now - (reel.last || now))) / 1000; reel.last = now; moving = true; }
      if (reel.anim) {
        const a = reel.anim, t = Math.min(1, (now - a.t0) / a.dur);
        // A soft paper settle: ease-out, never past the line (no bounce, no shake).
        const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1;
        reel.pos = a.from + (a.to - a.from) * e;
        if (t >= 1) { reel.pos = a.to; reel.anim = null; a.done(); } else moving = true;
      }
    }
    if (!S.rules) return; // a resize before the rules arrived: boot draws the first frame
    draw(now);
    if (moving) kick();
  }
  function kick() { if (!R.raf) R.raf = requestAnimationFrame(step); }

  /** Spin all reels (strip scrolls downward: pos decreases). */
  function startReels() {
    R.highlight = null;
    const now = performance.now();
    for (const reel of R.reels) { reel.spinning = true; reel.speed = (22 + Math.random() * 2) / speed(); reel.last = now; reel.anim = null; }
    kick();
  }
  /** Land reel `col` so its top visible row is strip index `stop`; resolves when settled. */
  function landReel(col, stop, dur) {
    const reel = R.reels[col], L = S.rules.reels[col].length;
    reel.spinning = false;
    // Travel at least 2 cells further down the strip (decreasing pos) to the target stop.
    let to = stop; const from = reel.pos;
    while (to > from - 2) to -= L;
    return new Promise((resolve) => { reel.anim = { from, to, t0: performance.now(), dur, done: () => { reel.pos = ((stop % L) + L) % L; resolve(); } }; kick(); });
  }

  // ── network ──────────────────────────────────────────────────────────────
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  async function api(method, url, body, key) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { method, headers: { authorization: `Bearer ${S.token}`, ...(body ? { "content-type": "application/json" } : {}), ...(key ? { "idempotency-key": key } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch (err) {
        if (attempt < 3) { await sleep(400 * 2 ** attempt); continue; } // same key: the server never plays a round twice
        throw new Error("NETWORK: connection lost");
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json;
      const code = json?.error?.code || `HTTP_${res.status}`;
      const retryAfter = Number(res.headers.get("retry-after") || 0);
      if ((code === "SPIN_TOO_FAST" || code === "PERSISTENCE_UNAVAILABLE" || res.status === 503) && attempt < 5) { await sleep(Math.max(250, retryAfter * 1000)); continue; }
      const e = new Error(code); e.code = code; e.details = json?.error?.details; throw e;
    }
  }

  // ── casino bridge ────────────────────────────────────────────────────────
  const Bridge = window.EmbedBridge;
  const emit = (type, data) => { try { Bridge?.emit(type, data); } catch { /* never breaks play */ } };
  Bridge?.on?.("pause", () => { S.paused = true; stopAutoplay("Paused by the casino"); });
  Bridge?.on?.("resume", () => { S.paused = false; say("Lanterns lit."); });
  Bridge?.on?.("setMuted", (d) => Sound?.setMuted?.(Boolean(d.muted)));
  Bridge?.on?.("getState", () => emit("state", { paused: S.paused, in_round: S.inFlight, in_feature: S.freeSpinsLeft > 0, balance: S.balance, currency: S.currency }));

  // ── one round ────────────────────────────────────────────────────────────
  function setBalance(b) { if (Number.isFinite(b)) { S.balance = b; el.balance.textContent = fmt(b); emit("balanceChanged", { balance: b, currency: S.currency }); } }
  function setControls() {
    const busy = S.inFlight || S.freeSpinsLeft > 0;
    el.betUp.disabled = el.betDown.disabled = busy || Boolean(S.autoplay);
    el.spin.classList.toggle("busy", S.inFlight || Boolean(S.autoplay));
    el.spin.textContent = S.autoplay ? "STOP" : S.inFlight ? "STOP" : "SPIN";
    el.auto.setAttribute("aria-pressed", String(Boolean(S.autoplay)));
  }

  async function playRound({ auto = false } = {}) {
    if (S.inFlight || S.paused || (S.featureRun && !auto)) return null;
    S.inFlight = true; S.quickStop = false;
    auto ? S.stats.startedAuto++ : S.stats.startedManual++;
    setControls();
    const free = S.freeSpinsLeft > 0;
    const bet = S.bets[S.betIndex];
    sfx("spin_start");
    emit("roundStarted", { bet, ante: false, free_spin: free, free_round: false, buy: false });
    if (!free) { el.win.textContent = "0.00"; if (Number.isFinite(S.balance)) el.balance.textContent = fmt(S.balance - bet); }
    say(free ? `Night · ${S.freeSpinsLeft} left` : "The moths take flight…");
    startReels();
    const minSpin = sleep(260 * speed());
    let r;
    try {
      [r] = await Promise.all([api("POST", "/game/v1/spin", { bet_amount: bet }, uuid()), minSpin]);
    } catch (err) {
      await Promise.all(R.reels.map((reel, col) => landReel(col, Math.round(reel.pos), 120)));
      S.inFlight = false; setControls();
      if (err.code === "REALITY_CHECK_REQUIRED") { await realityCheck(err.details); return null; }
      say(err.code === "INSUFFICIENT_FUNDS" ? "Not enough credit for this bet" : `Round not played (${err.code || err.message})`);
      if (Number.isFinite(S.balance)) el.balance.textContent = fmt(S.balance);
      emit("error", { code: err.code || "CLIENT_ERROR", message: err.message });
      return null;
    }
    // Land reels left to right; scatter anticipation slows the rest once two scatters show.
    let scattersSoFar = 0;
    for (let col = 0; col < 5; col++) {
      const anticipate = scattersSoFar >= 2 && !S.quickStop;
      const dur = (S.quickStop ? 130 : (anticipate ? 900 : 360) * speed()) + (S.quickStop ? 0 : col * 25);
      if (!S.quickStop && col > 0) await sleep((anticipate ? 380 : 110) * speed());
      if (anticipate) say("…");
      await landReel(col, r.stops[col], dur);
      sfx("reel_stop", { index: col });
      const here = [0, 1, 2].filter((row) => r.matrix[row][col] === "SCATTER").length;
      if (here) { scattersSoFar += here; sfx("scatter_land", { n: scattersSoFar, need: 3 }); }
    }
    await presentWin(r, bet);
    setBalance(Number(r.balance?.amount ?? r.balance ?? r.balance_after));
    S.freeSpinsLeft = Number(r.free_spins_left || 0);
    if (r.is_free_spin || r.free_spins_awarded > 0) S.featureWin = Number(r.bonus_round_win ?? S.featureWin + r.total_win);
    emit("roundEnded", { round_ref: r.round_ref, bet, win: r.total_win, free_spin: r.is_free_spin, free_spins_left: S.freeSpinsLeft });
    S.inFlight = false; setControls();
    Sound?.warmMusic?.();
    // The night bed starts once the first round has been shown (never during load).
    if (!S.musicOn) { S.musicOn = true; Sound?.startMusic?.(); }
    return r;
  }

  /** Lines one at a time (tap skips), the meter counts up, big wins get their screen. */
  async function presentWin(r, bet) {
    const total = Number(r.total_win || 0);
    if (!(total > 0) && !(r.free_spins_awarded > 0)) { say(S.freeSpinsLeft > 0 ? `Night · ${r.free_spins_left} left` : "The garden is quiet."); return; }
    const cells = new Set();
    for (const w of r.line_wins || []) for (const p of w.positions) cells.add(`${p.row},${p.col}`);
    for (const p of r.scatter?.positions || []) if (r.scatter.count >= 3) cells.add(`${p.row},${p.col}`);
    R.highlight = { cells, line: null }; kick();
    const x = total / bet;
    const tier = x >= 50 ? ["The Queen's gift", "win_epic"] : x >= 25 ? ["Moonlit", "win_mega"] : x >= 10 ? ["Lanterns rise", "win_big"] : null;
    countUp(total, tier ? 300 : 500 * speed());
    if (total > 0) say(`Moonlight win: ${fmt(total)}`, true);
    sfx(x >= 5 ? "win_land" : total > 0 ? "win_small" : "click");
    if (tier) await celebrate(tier[0], total, tier[1]);
    // Walk the winning lines once (skipped by quick stop / turbo / autoplay pace).
    if (!S.quickStop && !S.turbo && (r.line_wins || []).length > 1) {
      for (const [li, w] of r.line_wins.slice(0, 6).entries()) { if (S.quickStop) break; sfx("line_show", { i: li }); R.highlight = { cells: new Set(w.positions.map((p) => `${p.row},${p.col}`)), line: S.rules.lines.patterns[w.line - 1].map((row, col) => [row, col]), lineNo: w.line }; kick(); await sleep(420); }
      R.highlight = { cells, line: null }; kick();
    }
    if (r.free_spins_awarded > 0) {
      sfx("feature_award", { retrigger: r.is_free_spin });
      say(r.is_free_spin ? `More moths — +${r.free_spins_awarded} free spins` : `The moths gather — ${r.free_spins_awarded} free spins.`, true);
      await sleep(900 * speed());
    }
  }
  let countTimer = 0;
  function countUp(to, ms) {
    cancelAnimationFrame(countTimer);
    const t0 = performance.now();
    const tick = (now) => { const t = Math.min(1, (now - t0) / ms); el.win.textContent = fmt(to * (1 - Math.pow(1 - t, 3))); if (t < 1) sfx("win_tick", { progress: t }); if (t < 1 && !S.quickStop) countTimer = requestAnimationFrame(tick); else el.win.textContent = fmt(to); };
    countTimer = requestAnimationFrame(tick);
  }
  /** Big win: paper moths spiral up out of the board toward the lanterns (not with reduced motion). */
  const MOTH_SVG = '<svg viewBox="-26 -14 52 32" aria-hidden="true"><path d="M0 0 C-10 -12 -26 -10 -24 2 C-22 10 -10 8 0 2Z M0 0 C10 -12 26 -10 24 2 C22 10 10 8 0 2Z" fill="#ffd27a" stroke="#0b1026" stroke-width="1.5"/><path d="M0 2 C-6 6 -14 12 -10 16 C-6 18 -2 10 0 4Z M0 2 C6 6 14 12 10 16 C6 18 2 10 0 4Z" fill="#f3e6c8" stroke="#0b1026" stroke-width="1.2"/><ellipse cx="0" cy="4" rx="2" ry="7" fill="#0b1026"/></svg>';
  function releaseMoths() {
    if (reduceMotion?.matches || !el.cel.animate) return;
    for (let i = 0; i < 14; i++) {
      const m = document.createElement("div"); m.className = "moth"; m.innerHTML = MOTH_SVG; el.cel.appendChild(m);
      const turns = 1.2 + Math.random() * 0.8, r0 = 20 + Math.random() * 60, dir = Math.random() < 0.5 ? -1 : 1, frames = [];
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, a = dir * (t * turns * Math.PI * 2 + i), r = r0 * (1 - t * 0.4);
        frames.push({ transform: `translate(${Math.cos(a) * r - 13}px, ${-t * 320 + Math.sin(a) * r * 0.4}px) rotate(${Math.cos(a) * 25}deg) scale(${0.6 + t * 0.6})`, opacity: t < 0.1 ? t * 10 : t > 0.85 ? (1 - t) / 0.15 : 1 });
      }
      m.animate(frames, { duration: 2200 + Math.random() * 900, delay: i * 70, easing: "ease-in-out", fill: "forwards" }).finished.then(() => m.remove(), () => m.remove());
    }
  }
  function celebrate(title, amount, sound) {
    return new Promise((resolve) => {
      el.celTitle.textContent = title; el.celAmount.textContent = "0.00"; el.cel.hidden = false; sfx(sound);
      releaseMoths();
      const t0 = performance.now(), ms = S.turbo ? 900 : 2200;
      let done = false;
      const finish = () => { if (done) return; done = true; el.cel.hidden = true; el.cel.removeEventListener("pointerdown", finish); resolve(); };
      const tick = (now) => { if (done) return; const t = Math.min(1, (now - t0) / ms); el.celAmount.textContent = fmt(amount * (1 - Math.pow(1 - t, 3))); if (t < 1) requestAnimationFrame(tick); else setTimeout(finish, S.autoplay || S.freeSpinsLeft > 0 ? 900 : 2500); };
      requestAnimationFrame(tick);
      el.cel.addEventListener("pointerdown", finish);
    });
  }

  // ── free spins and autoplay ──────────────────────────────────────────────
  async function runFreeSpins() {
    if (S.freeSpinsLeft <= 0 || S.featureRun) return 0;
    S.featureRun = true;
    try { return await playFeature(); } finally { S.featureRun = false; setControls(); }
  }
  async function playFeature() {
    S.featureWin = S.featureWin || 0;
    el.fsBadge.hidden = false;
    document.body.classList.add("night"); // dusk turns to deep night; the lanterns light one by one
    emit("featureState", { active: true, free_spins_left: S.freeSpinsLeft, bonus_win: S.featureWin });
    Sound?.setMusic?.("freeSpins");
    sfx("fs_intro");
    while (S.freeSpinsLeft > 0 && !S.paused) {
      el.fsBadge.textContent = `Night · ${S.freeSpinsLeft} left`;
      const r = await playRound({ auto: true });
      if (!r) break;
      await sleep(260 * speed());
    }
    el.fsBadge.hidden = true;
    document.body.classList.remove("night");
    Sound?.setMusic?.("base");
    sfx("fs_outro");
    const total = S.featureWin;
    say(total > 0 ? `The night gave ${fmt(total)}` : "Dawn returns.", total > 0);
    emit("featureState", { active: false, free_spins_left: S.freeSpinsLeft, bonus_win: total });
    S.featureWin = 0;
    return total;
  }
  function stopAutoplay(why) {
    if (!S.autoplay) return;
    S.autoplay = null; setControls();
    if (why) say(`Autoplay stopped · ${why}`);
  }
  async function startAutoplay(n) {
    if (S.autoplay || S.inFlight || S.paused) return;
    el.autoPop.hidden = true;
    const bet = S.bets[S.betIndex];
    S.autoplay = { left: n, startBalance: S.balance, limits: { loss: Number($("apLoss").value) * bet, win: Number($("apWin").value) * bet, feature: $("apFeature").checked } };
    setControls();
    while (S.autoplay && S.autoplay.left > 0) {
      if (S.autoplay.left !== Infinity) S.autoplay.left--;
      const r = await playRound({ auto: true });
      if (!r) { stopAutoplay(); break; }
      const featureTriggered = r.free_spins_awarded > 0;
      let roundWin = Number(r.total_win || 0);
      // The feature's total includes the trigger spin's win (bonus_round_win starts there).
      if (S.freeSpinsLeft > 0) roundWin = Math.max(roundWin, await runFreeSpins());
      const a = S.autoplay; if (!a) break;
      if (a.limits.loss > 0 && a.startBalance - S.balance >= a.limits.loss - 1e-9) { stopAutoplay("loss limit reached"); break; }
      if (a.limits.win > 0 && roundWin >= a.limits.win - 1e-9) { stopAutoplay(`win of ${fmt(roundWin)}`); break; }
      if (a.limits.feature && featureTriggered) { stopAutoplay("Free Spins won"); break; }
      await sleep(S.turbo ? 150 : 400);
    }
    stopAutoplay();
  }

  // ── controls ─────────────────────────────────────────────────────────────
  async function onSpinPress() {
    Sound?.unlock?.();
    if (S.autoplay) { stopAutoplay("stopped"); S.quickStop = true; return; }
    if (S.inFlight || S.featureRun) { S.quickStop = true; return; } // quick stop: land everything now (never a new round mid-feature)
    const r = await playRound();
    if (r && S.freeSpinsLeft > 0) await runFreeSpins();
  }
  el.spin.addEventListener("pointerdown", (e) => { if (e.button === 0) { e.preventDefault(); onSpinPress(); } });
  el.spin.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSpinPress(); } });
  document.addEventListener("keydown", (e) => { if (e.code === "Space" && e.target === document.body) { e.preventDefault(); onSpinPress(); } });
  // The rules text is built when the dialog opens (it shows pays at the current bet), not on every bet change.
  /** The pay glass: the four top symbols' pays at the current bet (from rules.json, as paid). */
  const PAY_GLASS = ["SEVEN", "BAR", "BELL", "MELON"];
  function renderPays() {
    const box = $("pays"); if (!box || !S.rules) return;
    const lb = lineBet(), dpr = Math.min(window.devicePixelRatio || 1, 2);
    box.replaceChildren();
    for (const sym of PAY_GLASS) {
      const p = S.rules.paytable[sym]; if (!p) continue;
      const tile = document.createElement("div"); tile.className = "pay";
      const cv = document.createElement("canvas"); cv.width = cv.height = Math.round(40 * dpr); cv.title = NAMES[sym]; drawSymbol(cv.getContext("2d"), sym, cv.width);
      const big = document.createElement("b"); big.textContent = fmt(p[2] * lb);
      const small = document.createElement("span"); small.textContent = `${fmt(p[1] * lb)} · ${fmt(p[0] * lb)}`;
      tile.append(cv, big, small); box.append(tile);
    }
  }
  const showBet = () => { renderPays(); el.bet.textContent = fmt(S.bets[S.betIndex]); el.betDown.disabled = S.betIndex === 0 || S.inFlight; el.betUp.disabled = S.betIndex === S.bets.length - 1 || S.inFlight; if (el.info.open) renderRules(); };
  el.betUp.addEventListener("click", () => { if (S.betIndex < S.bets.length - 1) { S.betIndex++; sfx("bet_change"); showBet(); } });
  el.betDown.addEventListener("click", () => { if (S.betIndex > 0) { S.betIndex--; sfx("bet_change"); showBet(); } });
  el.turbo.addEventListener("click", () => { S.turbo = !S.turbo; el.turbo.setAttribute("aria-pressed", String(S.turbo)); sfx("turbo_toggle", { on: S.turbo }); });
  el.auto.addEventListener("click", (e) => { e.stopPropagation(); if (S.autoplay) return stopAutoplay("stopped"); el.autoPop.hidden = !el.autoPop.hidden; });
  el.autoPop.addEventListener("click", (e) => { const b = e.target.closest("button[data-n]"); if (b) startAutoplay(b.dataset.n === "inf" ? Infinity : Number(b.dataset.n)); });
  document.addEventListener("click", (e) => { if (!el.autoPop.hidden && !el.autoPop.contains(e.target) && e.target !== el.auto) el.autoPop.hidden = true; });
  const syncSound = () => { const m = Sound?.isMuted?.() ?? false; el.sound.classList.toggle("muted", m); el.sound.setAttribute("aria-pressed", String(!m)); };
  el.sound.addEventListener("click", () => { Sound?.unlock?.(); Sound?.toggleMuted?.(); syncSound(); });
  el.infoBtn.addEventListener("click", () => { renderRules(); el.info.showModal(); });
  el.info.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target === el.info) el.info.close(); });
  if (document.fullscreenEnabled) {
    const fs = $("fsBtn"); fs.hidden = false;
    fs.addEventListener("click", () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen({ navigationUI: "hide" })).catch(() => {}));
    document.addEventListener("fullscreenchange", () => { fs.setAttribute("aria-pressed", String(Boolean(document.fullscreenElement))); fs.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen"; });
  }
  if (Haptics.supported) { $("hapticsRow").hidden = false; $("haptics").checked = Haptics.on; $("haptics").addEventListener("change", (e) => Haptics.set(e.target.checked)); }

  /** Paytable and rules from rules.json (the file the engine pays from): displayed pays = paid pays. */
  const icons = new Map();
  function icon(sym) {
    if (!icons.has(sym)) { const cv = document.createElement("canvas"); cv.width = cv.height = 52; drawSymbol(cv.getContext("2d"), sym, 52); icons.set(sym, cv.toDataURL()); }
    return icons.get(sym);
  }
  function renderRules() {
    if (!S.rules) return;
    const r = S.rules, lb = lineBet();
    const rows = Object.entries(r.paytable).reverse().map(([sym, p]) => `<tr><td><img src="${icon(sym)}" alt="" width="26" height="26" style="vertical-align:middle;margin-right:8px">${NAMES[sym] || sym}</td>${p.map((x) => `<td>${fmt(x * lb)}</td>`).join("")}</tr>`).join("");
    el.rules.innerHTML = `
      <p>${S.lines} fixed lines. Total bet ${fmt(S.bets[S.betIndex])} (line bet ${fmt(lb)}). Line wins pay left to right from the first reel, 3 or more in a row; the highest win per line is paid and wins on different lines add up.</p>
      <table><thead><tr><th>Symbol</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>${rows}</tbody></table>
      <p><img src="${icon("WILD")}" alt="" width="26" height="26" style="vertical-align:middle"> <b>The Lantern</b> is wild. It appears on reels 2, 3 and 4 and stands in for every symbol except the Full Moon.</p>
      <p><img src="${icon("SCATTER")}" alt="" width="26" height="26" style="vertical-align:middle"> <b>The Full Moon</b> pays anywhere: 3 = ${fmt(r.scatter.pays[0] * S.bets[S.betIndex])}, 4 = ${fmt(r.scatter.pays[1] * S.bets[S.betIndex])}, 5 = ${fmt(r.scatter.pays[2] * S.bets[S.betIndex])}.
      3, 4 or 5 Full Moons award ${r.free_spins.awards.join(", ")} free spins, played at the same bet. Every free-spin win is multiplied by ${r.free_spins.multiplier}. Free spins can be won again during free spins.</p>
      <p>Maximum win: ${r.max_win_x.toLocaleString()}× the total bet for a spin and the free spins it awards; the feature ends when it is reached.</p>
      <p>Theoretical return to player: ${Number(r.theoretical_rtp).toFixed(2)}%. Over a short session results vary widely.</p>
      <p>Autoplay stops when you press Stop, when the spins run out, when a round can't be played, or when a stop condition you chose is met. Turbo and quick stop change only how fast a round is shown, never its result. A malfunction voids all pays and plays.</p>`;
  }

  async function realityCheck(details) {
    stopAutoplay();
    el.realityText.textContent = details ? `You have played for ${Math.round((details.elapsed_ms || 0) / 60000)} minutes. Wagered ${fmt(details.total_bet ?? 0)}, won ${fmt(details.total_win ?? 0)}.` : "Time for a break?";
    emit("realityCheck", details || {});
    el.reality.showModal();
    const choice = await new Promise((res) => { $("realityContinue").onclick = () => res("continue"); $("realityExit").onclick = () => res("exit"); });
    el.reality.close();
    if (choice === "exit") { emit("exitRequested", { reason: "reality_check" }); say("Session ended"); return; }
    await api("POST", "/game/v1/reality-check/ack", {}, uuid()).catch(() => {});
    say("Lanterns lit.");
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  async function boot() {
    resize();
    new ResizeObserver(() => resize()).observe(el.board);
    const params = new URLSearchParams(location.search);
    const lt = params.get("lt");
    const KEY = "classic5x3.session";
    const rulesP = fetch("rules.json", { credentials: "same-origin", mode: "cors" }).then((r) => r.json()); // matches the HTML preload
    let session;
    if (lt) {
      S.token = lt;
      try {
        // The handshake the HTML already started (same request, made once); else start it now.
        const early = window.__classicEarlySession ? await window.__classicEarlySession.catch(() => null) : null;
        window.__classicEarlySession = null;
        if (early && early.ok) session = early.body;
        else if (early && !early.ok) { const e = new Error(early.body?.error?.code || `HTTP_${early.status}`); e.code = e.message; throw e; }
        else session = await api("POST", "/game/v1/session/init", null);
        S.token = session.session_token;
        try { sessionStorage.setItem(KEY, S.token); } catch { /* reload will need a new launch */ }
      } catch (err) {
        const stored = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
        if (!stored) throw err;
        S.token = stored; session = await api("GET", "/game/v1/session");
      }
    } else {
      S.token = (() => { try { return sessionStorage.getItem(KEY); } catch { return null; } })();
      if (!S.token) { say("Open the game from the casino"); document.body.classList.add("app-ready"); return; }
      session = await api("GET", "/game/v1/session");
    }
    S.rules = await rulesP;
    // The logo and win amounts use the display face: wait for it (capped) before the first frame.
    await Promise.race([document.fonts?.load?.('600 32px "ML Display"') ?? Promise.resolve(), sleep(1500)]).catch(() => {});
    R.sprites.clear();
    const variant = S.rules.rtp_profiles.find((p) => p.game_id === session.game?.code) || S.rules.rtp_profiles[0];
    S.lines = variant.lines;
    S.currency = session.currency;
    S.bets = session.allowed_bets.slice().sort((a, b) => a - b);
    const resumeBet = session.resume?.bet_amount;
    S.betIndex = Math.max(0, S.bets.indexOf(resumeBet ?? S.bets[Math.min(2, S.bets.length - 1)]));
    S.freeSpinsLeft = Number(session.free_spins_left || 0);
    S.featureWin = Number(session.resume?.feature?.bonus_round_win || 0);
    setBalance(Number(session.balance?.amount ?? session.balance));
    showBet(); syncSound(); Sound?.onChange?.(syncSound);
    R.reels = S.rules.reels.map((strip) => ({ pos: Math.floor(Math.random() * strip.length), anim: null, spinning: false, speed: 0 }));
    // First frame, then playable.
    await new Promise((res) => requestAnimationFrame(() => { draw(performance.now()); res(); }));
    if (Bridge?.connect?.(session.embed?.allowed_hosts)) Bridge.ready({ game: "classic-5x3", currency: S.currency, balance: S.balance });
    document.body.classList.add("app-ready");
    performance.mark("app-ready");
    // Sounds load on the player's first touch or key (VX_AUDIO_PRELOAD = "manual"): the audio
    // context may only start on a gesture anyway, and creating it and decoding right after
    // the reveal held a slow phone's main thread for ~3 s (bench: Slow 4G + 4x CPU), so the
    // first tap waited. The first spin's sounds arrive while its reels fall.
    const startAudio = () => { removeEventListener("pointerdown", startAudio, true); removeEventListener("keydown", startAudio, true); Sound?.preload?.(); Sound?.unlock?.(); };
    addEventListener("pointerdown", startAudio, true);
    addEventListener("keydown", startAudio, true);
    say(S.freeSpinsLeft > 0 ? `Night · ${S.freeSpinsLeft} left · tap Spin` : "Lanterns lit.");
    setControls();
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
