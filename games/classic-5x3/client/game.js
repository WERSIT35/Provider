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

  // ── symbols: fruit-machine art for ivory reels, drawn once per cell size into sprites ──
  // Sticker style: rich gradient fills, a dark ink outline and one specular highlight, so
  // every symbol reads at 40 px on a phone. Text symbols use the marquee face (Bungee).
  const INK = "#2a1408";
  const MARQUEE = '"C5 Marquee", "Arial Black", Impact, sans-serif';
  function drawSymbol(g, sym, s) {
    const c = s / 2, lw = Math.max(1.5, s * 0.035);
    g.save();
    g.lineJoin = "round"; g.lineCap = "round";
    const rg = (x, y, r, stops) => { const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r * 1.05); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
    const lg = (x0, y0, x1, y1, stops) => { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
    const ink = (w = lw) => { g.lineWidth = w; g.strokeStyle = INK; g.stroke(); };
    const ball = (x, y, r, stops) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = rg(x, y, r, stops); g.fill(); ink(); };
    const glint = (x, y, rx, ry, rot = -0.6, a = 0.75) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fillStyle = `rgba(255,255,255,${a})`; g.fill(); };
    const leaf = (x, y, len, rot) => {
      g.save(); g.translate(x, y); g.rotate(rot);
      g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(len * 0.5, -len * 0.42, len, 0); g.quadraticCurveTo(len * 0.5, len * 0.42, 0, 0);
      g.fillStyle = lg(0, -len * 0.3, 0, len * 0.3, [[0, "#8fe06a"], [1, "#2f8a2a"]]); g.fill(); ink(lw * 0.8);
      g.beginPath(); g.moveTo(len * 0.1, 0); g.lineTo(len * 0.85, 0); g.lineWidth = lw * 0.5; g.strokeStyle = "rgba(20,60,10,0.6)"; g.stroke();
      g.restore();
    };
    const label = (text, y, size, fill, stroke) => {
      g.font = `400 ${size}px ${MARQUEE}`; g.textAlign = "center"; g.textBaseline = "middle";
      g.lineWidth = size * 0.22; g.strokeStyle = stroke; g.strokeText(text, c, y); g.fillStyle = fill; g.fillText(text, c, y);
    };
    // A soft contact shadow under every symbol: it sits on the reel, not floating.
    g.beginPath(); g.ellipse(c, s * 0.9, s * 0.3, s * 0.05, 0, 0, Math.PI * 2); g.fillStyle = "rgba(60,30,10,0.16)"; g.fill();
    switch (sym) {
      case "CHERRY": {
        g.beginPath(); g.moveTo(s * 0.33, s * 0.62); g.quadraticCurveTo(s * 0.4, s * 0.3, s * 0.62, s * 0.16); g.moveTo(s * 0.68, s * 0.66); g.quadraticCurveTo(s * 0.64, s * 0.36, s * 0.62, s * 0.16);
        g.lineWidth = s * 0.07; g.strokeStyle = INK; g.stroke(); g.lineWidth = s * 0.038; g.strokeStyle = "#5c8f2a"; g.stroke();
        leaf(s * 0.62, s * 0.17, s * 0.26, -0.35);
        const red = [[0, "#ff9aa2"], [0.35, "#e8243c"], [1, "#7a0716"]];
        ball(s * 0.32, s * 0.68, s * 0.2, red); ball(s * 0.68, s * 0.71, s * 0.2, red);
        glint(s * 0.26, s * 0.6, s * 0.05, s * 0.03); glint(s * 0.62, s * 0.63, s * 0.05, s * 0.03); break;
      }
      case "LEMON": {
        g.beginPath(); g.moveTo(s * 0.12, s * 0.52); g.bezierCurveTo(s * 0.16, s * 0.2, s * 0.84, s * 0.2, s * 0.88, s * 0.48); g.bezierCurveTo(s * 0.84, s * 0.8, s * 0.16, s * 0.82, s * 0.12, s * 0.52); g.closePath();
        g.fillStyle = rg(c, c, s * 0.42, [[0, "#fff9b0"], [0.45, "#ffe03a"], [1, "#c99a00"]]); g.fill(); ink();
        g.fillStyle = "rgba(160,110,0,0.35)"; for (const [x, y] of [[0.55, 0.6], [0.66, 0.5], [0.45, 0.66], [0.72, 0.62], [0.36, 0.58]]) { g.beginPath(); g.arc(s * x, s * y, s * 0.012, 0, Math.PI * 2); g.fill(); }
        glint(s * 0.34, s * 0.4, s * 0.1, s * 0.04, -0.3); break;
      }
      case "ORANGE": {
        ball(c, s * 0.56, s * 0.32, [[0, "#ffd29a"], [0.4, "#ff8c1a"], [1, "#a8460a"]]);
        g.fillStyle = "rgba(140,60,0,0.3)"; for (let i = 0; i < 14; i++) { const a = i * 2.4, r = s * (0.08 + (i % 5) * 0.045); g.beginPath(); g.arc(c + Math.cos(a) * r, s * 0.58 + Math.sin(a) * r, s * 0.011, 0, Math.PI * 2); g.fill(); }
        g.beginPath(); g.arc(c, s * 0.25, s * 0.04, 0, Math.PI * 2); g.fillStyle = "#6b4a1a"; g.fill(); ink(lw * 0.7);
        leaf(c + s * 0.02, s * 0.24, s * 0.24, -0.5); glint(s * 0.38, s * 0.44, s * 0.08, s * 0.05); break;
      }
      case "PLUM": {
        g.beginPath(); g.ellipse(c, s * 0.57, s * 0.29, s * 0.33, 0.25, 0, Math.PI * 2);
        g.fillStyle = rg(c, s * 0.57, s * 0.33, [[0, "#e2b8ff"], [0.35, "#9a52e0"], [1, "#3e1470"]]); g.fill(); ink();
        g.beginPath(); g.moveTo(s * 0.5, s * 0.27); g.quadraticCurveTo(s * 0.62, s * 0.55, s * 0.56, s * 0.88); g.lineWidth = lw * 0.7; g.strokeStyle = "rgba(40,10,70,0.5)"; g.stroke();
        g.beginPath(); g.moveTo(c, s * 0.26); g.lineTo(s * 0.56, s * 0.12); g.lineWidth = s * 0.05; g.strokeStyle = INK; g.stroke(); g.lineWidth = s * 0.025; g.strokeStyle = "#6b4a1a"; g.stroke();
        leaf(s * 0.55, s * 0.15, s * 0.2, -0.2); glint(s * 0.4, s * 0.44, s * 0.06, s * 0.1, 0.3, 0.6); break;
      }
      case "GRAPE": {
        g.beginPath(); g.moveTo(c, s * 0.24); g.lineTo(s * 0.54, s * 0.1); g.lineWidth = s * 0.05; g.strokeStyle = INK; g.stroke(); g.lineWidth = s * 0.025; g.strokeStyle = "#6b4a1a"; g.stroke();
        leaf(s * 0.52, s * 0.18, s * 0.28, -0.15);
        const pur = [[0, "#c9a4ff"], [0.4, "#7b3fd0"], [1, "#2c0d5c"]];
        for (const [x, y] of [[0.33, 0.36], [0.5, 0.34], [0.67, 0.36], [0.41, 0.52], [0.59, 0.52], [0.33, 0.67], [0.5, 0.68], [0.67, 0.67], [0.42, 0.82], [0.58, 0.82]].reverse()) ball(s * x, s * y, s * 0.095, pur);
        glint(s * 0.3, s * 0.33, s * 0.03, s * 0.02); glint(s * 0.47, s * 0.31, s * 0.03, s * 0.02); break;
      }
      case "MELON": {
        g.beginPath(); g.moveTo(s * 0.1, s * 0.4); g.quadraticCurveTo(c, s * 1.06, s * 0.9, s * 0.4); g.closePath();
        g.fillStyle = lg(0, s * 0.4, 0, s * 0.85, [[0, "#3fbf4f"], [1, "#1c6b26"]]); g.fill(); ink();
        g.beginPath(); g.moveTo(s * 0.15, s * 0.4); g.quadraticCurveTo(c, s * 0.97, s * 0.85, s * 0.4); g.closePath(); g.fillStyle = "#f6f2d4"; g.fill();
        g.beginPath(); g.moveTo(s * 0.19, s * 0.4); g.quadraticCurveTo(c, s * 0.9, s * 0.81, s * 0.4); g.closePath();
        g.fillStyle = lg(0, s * 0.4, 0, s * 0.8, [[0, "#ff7a86"], [1, "#e0263c"]]); g.fill();
        g.beginPath(); g.moveTo(s * 0.1, s * 0.4); g.lineTo(s * 0.9, s * 0.4); ink();
        g.fillStyle = INK; for (const [x, y] of [[0.35, 0.5], [0.5, 0.56], [0.65, 0.5], [0.43, 0.64], [0.57, 0.64]]) { g.beginPath(); g.ellipse(s * x, s * y, s * 0.017, s * 0.03, 0, 0, Math.PI * 2); g.fill(); }
        break;
      }
      case "BELL": {
        g.beginPath(); g.moveTo(s * 0.16, s * 0.74); g.quadraticCurveTo(s * 0.24, s * 0.66, s * 0.26, s * 0.48); g.bezierCurveTo(s * 0.28, s * 0.2, s * 0.72, s * 0.2, s * 0.74, s * 0.48); g.quadraticCurveTo(s * 0.76, s * 0.66, s * 0.84, s * 0.74); g.closePath();
        g.fillStyle = lg(s * 0.2, 0, s * 0.8, 0, [[0, "#9a6a08"], [0.3, "#ffe27a"], [0.55, "#f7b91c"], [1, "#8a5a05"]]); g.fill(); ink();
        g.beginPath(); g.roundRect ? g.roundRect(s * 0.14, s * 0.72, s * 0.72, s * 0.08, s * 0.04) : g.rect(s * 0.14, s * 0.72, s * 0.72, s * 0.08);
        g.fillStyle = lg(0, s * 0.72, 0, s * 0.8, [[0, "#ffe9a0"], [1, "#a8720a"]]); g.fill(); ink(lw * 0.8);
        ball(c, s * 0.86, s * 0.065, [[0, "#fff2c0"], [1, "#a8720a"]]);
        g.beginPath(); g.arc(c, s * 0.2, s * 0.05, Math.PI, 0); ink(lw * 1.1);
        glint(s * 0.37, s * 0.42, s * 0.04, s * 0.11, 0.15, 0.6); break;
      }
      case "BAR": {
        g.beginPath(); g.roundRect ? g.roundRect(s * 0.08, s * 0.3, s * 0.84, s * 0.4, s * 0.08) : g.rect(s * 0.08, s * 0.3, s * 0.84, s * 0.4);
        g.fillStyle = lg(0, s * 0.3, 0, s * 0.7, [[0, "#3a3a3a"], [0.5, "#111"], [1, "#000"]]); g.fill(); ink(lw * 1.2);
        g.beginPath(); g.roundRect ? g.roundRect(s * 0.13, s * 0.35, s * 0.74, s * 0.3, s * 0.05) : g.rect(s * 0.13, s * 0.35, s * 0.74, s * 0.3);
        g.lineWidth = lw * 0.8; g.strokeStyle = "#f2c14e"; g.stroke();
        label("BAR", s * 0.505, s * 0.25, "#fff4d6", "#000"); break;
      }
      case "SEVEN": {
        g.font = `400 ${s * 0.86}px ${MARQUEE}`; g.textAlign = "center"; g.textBaseline = "middle";
        g.lineWidth = s * 0.12; g.strokeStyle = INK; g.strokeText("7", c, s * 0.53);
        g.lineWidth = s * 0.06; g.strokeStyle = "#ffd75a"; g.strokeText("7", c, s * 0.53);
        g.fillStyle = lg(0, s * 0.15, 0, s * 0.9, [[0, "#ff8a7a"], [0.45, "#ff2a1f"], [1, "#9a0610"]]); g.fillText("7", c, s * 0.53);
        break;
      }
      case "WILD": {
        star(g, c, s * 0.47, s * 0.43, s * 0.2, 5);
        g.fillStyle = rg(c, s * 0.47, s * 0.43, [[0, "#fff6c4"], [0.45, "#ffc93a"], [1, "#b8730a"]]); g.fill(); ink(lw * 1.1);
        g.beginPath(); g.roundRect ? g.roundRect(s * 0.1, s * 0.52, s * 0.8, s * 0.2, s * 0.05) : g.rect(s * 0.1, s * 0.52, s * 0.8, s * 0.2);
        g.fillStyle = lg(0, s * 0.52, 0, s * 0.72, [[0, "#ff5a4a"], [1, "#a30d16"]]); g.fill(); ink();
        label("WILD", s * 0.625, s * 0.15, "#fff6dc", "#5c0409"); break;
      }
      case "SCATTER": {
        const pts = [[c, s * 0.1], [s * 0.86, s * 0.38], [c, s * 0.86], [s * 0.14, s * 0.38]];
        g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
        g.fillStyle = lg(s * 0.14, s * 0.1, s * 0.86, s * 0.86, [[0, "#c8f4ff"], [0.4, "#2fb8f0"], [1, "#0a3e8a"]]); g.fill(); ink(lw * 1.1);
        // Facets.
        g.beginPath(); g.moveTo(s * 0.14, s * 0.38); g.lineTo(s * 0.86, s * 0.38); g.moveTo(c, s * 0.1); g.lineTo(s * 0.35, s * 0.38); g.lineTo(c, s * 0.86); g.lineTo(s * 0.65, s * 0.38); g.lineTo(c, s * 0.1);
        g.lineWidth = lw * 0.6; g.strokeStyle = "rgba(255,255,255,0.55)"; g.stroke();
        g.beginPath(); g.moveTo(c, s * 0.1); g.lineTo(s * 0.35, s * 0.38); g.lineTo(s * 0.14, s * 0.38); g.closePath(); g.fillStyle = "rgba(255,255,255,0.45)"; g.fill();
        label("SCATTER", s * 0.9, s * 0.12, "#e8fbff", "#062a4a"); break;
      }
    }
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function star(g, x, y, R, r, n) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2; const d = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } g.closePath(); }
  // Win-line colours: each line its own lamp colour, as on a real cabinet's line lamps.
  const LINE_COLORS = ["#ff3b30", "#ffcc00", "#34c759", "#0a84ff", "#bf5af2", "#ff9f0a", "#64d2ff", "#ff375f", "#30d158", "#5e5ce6"];

  // ── renderer ─────────────────────────────────────────────────────────────
  const R = {
    ctx: el.canvas.getContext("2d", { alpha: false }), w: 0, h: 0, dpr: 1, cell: 0, sprites: new Map(),
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
    R.sprites.clear();
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
  function reelShade(g, x, y, w, h) {
    // Ivory drum: darker at the top and bottom edges, so the reel reads as a cylinder.
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, "rgba(90,55,25,0.55)"); gr.addColorStop(0.1, "rgba(90,55,25,0.12)"); gr.addColorStop(0.22, "rgba(90,55,25,0)");
    gr.addColorStop(0.78, "rgba(90,55,25,0)"); gr.addColorStop(0.9, "rgba(90,55,25,0.12)"); gr.addColorStop(1, "rgba(90,55,25,0.55)");
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  }
  function draw(now) {
    const g = R.ctx, cell = R.cell, ox = (R.w - cell * 5) / 2, oy = (R.h - cell * 3) / 2;
    g.fillStyle = "#1a0507"; g.fillRect(0, 0, R.w, R.h);
    const hl = R.highlight;
    for (let col = 0; col < 5; col++) {
      const strip = S.rules.reels[col], L = strip.length, reel = R.reels[col];
      const x = ox + col * cell;
      g.fillStyle = col % 2 ? "#f4ecda" : "#f8f2e4"; g.fillRect(x, oy, cell, cell * 3);
      g.save(); g.beginPath(); g.rect(x, oy, cell, cell * 3); g.clip();
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      const moving = reel.anim || reel.spinning;
      for (let k = -1; k <= 3; k++) {
        const sym = strip[(((base + k) % L) + L) % L];
        const y = oy + (k - frac) * cell;
        const sp = sprite(sym), pad = (cell - sp.width) / 2;
        const win = hl && !moving && hl.cells.has(`${k},${col}`);
        if (win) {
          // A lit lamp-glass behind a winning symbol.
          const gr = g.createRadialGradient(x + cell / 2, y + cell / 2, cell * 0.05, x + cell / 2, y + cell / 2, cell * 0.62);
          gr.addColorStop(0, "rgba(255,236,150,0.95)"); gr.addColorStop(1, "rgba(255,170,40,0)");
          g.fillStyle = gr; g.fillRect(x, y, cell, cell);
        }
        g.globalAlpha = !hl || moving || win ? 1 : 0.28;
        if (reel.spinning && !reduceMotion?.matches) {
          // Motion blur: the sprite stretched and smeared down the drum.
          g.globalAlpha = 0.55; g.drawImage(sp, x + pad, y + pad - cell * 0.12, sp.width, sp.height * 1.24);
          g.globalAlpha = 0.35; g.drawImage(sp, x + pad, y + pad + cell * 0.1, sp.width, sp.height);
        } else g.drawImage(sp, x + pad, y + pad);
        g.globalAlpha = 1;
        if (win) { g.lineWidth = Math.max(2, cell * 0.04); g.strokeStyle = "#ffb000"; roundRect(g, x + cell * 0.05, y + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.12); g.stroke(); }
      }
      g.restore();
      reelShade(g, x, oy, cell, cell * 3);
    }
    // Win line (one at a time), over the board, in that line's lamp colour.
    if (hl?.line) {
      const col = LINE_COLORS[((hl.lineNo || 1) - 1) % LINE_COLORS.length];
      g.save(); g.lineJoin = "round"; g.lineCap = "round";
      const path = () => { g.beginPath(); hl.line.forEach(([row, c], i) => { const px = ox + (c + 0.5) * cell, py = oy + (row + 0.5) * cell; i ? g.lineTo(px, py) : g.moveTo(px, py); }); };
      path(); g.lineWidth = Math.max(5, cell * 0.12); g.strokeStyle = "rgba(42,20,8,0.75)"; g.stroke();
      path(); g.lineWidth = Math.max(3, cell * 0.07); g.strokeStyle = col; g.shadowColor = col; g.shadowBlur = cell * 0.25; g.stroke();
      g.restore();
    }
    // Chrome dividers between the drums.
    for (let col = 1; col < 5; col++) {
      const x = ox + col * cell, w = Math.max(3, cell * 0.045);
      const gr = g.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
      gr.addColorStop(0, "#4a4f57"); gr.addColorStop(0.5, "#f4f6f8"); gr.addColorStop(1, "#4a4f57");
      g.fillStyle = gr; g.fillRect(x - w / 2, oy, w, cell * 3);
    }
  }
  function step(now) {
    R.raf = 0;
    let moving = false;
    for (const reel of R.reels) {
      if (reel.spinning) { reel.pos -= (reel.speed * (now - (reel.last || now))) / 1000; reel.last = now; moving = true; }
      if (reel.anim) {
        const a = reel.anim, t = Math.min(1, (now - a.t0) / a.dur);
        // Ease out with one small settle past the line (no wind-up, no shake).
        const e = t < 1 ? 1 - Math.pow(1 - t, 3) * (1 - 1.6 * t * (1 - t)) : 1;
        reel.pos = a.from + (a.to - a.from) * e;
        if (t >= 1) { reel.pos = a.to; reel.anim = null; a.done(); } else moving = true;
      }
    }
    if (!S.rules) return; // a resize before the rules arrived: boot draws the first frame
    draw(now);
    if (moving) kick();
  }
  /** The marquee's bulbs chase while a win is on show (CSS only; off with reduced motion). */
  function lights(on) { document.body.classList.toggle("lights", Boolean(on)); }
  function kick() { if (!R.raf) R.raf = requestAnimationFrame(step); }

  /** Spin all reels (strip scrolls downward: pos decreases). */
  function startReels() {
    R.highlight = null; lights(false);
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
  Bridge?.on?.("resume", () => { S.paused = false; say("Ready"); });
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
    say(free ? `Free spin · ${S.freeSpinsLeft} left` : "Good luck!");
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
    return r;
  }

  /** Lines one at a time (tap skips), the meter counts up, big wins get their screen. */
  async function presentWin(r, bet) {
    const total = Number(r.total_win || 0);
    if (!(total > 0) && !(r.free_spins_awarded > 0)) { say(S.freeSpinsLeft > 0 ? `Free spin · ${r.free_spins_left} left` : "Spin again"); return; }
    const cells = new Set();
    for (const w of r.line_wins || []) for (const p of w.positions) cells.add(`${p.row},${p.col}`);
    for (const p of r.scatter?.positions || []) if (r.scatter.count >= 3) cells.add(`${p.row},${p.col}`);
    R.highlight = { cells, line: null }; kick();
    lights(true);
    const x = total / bet;
    const tier = x >= 50 ? ["EPIC WIN", "win_epic"] : x >= 25 ? ["MEGA WIN", "win_mega"] : x >= 10 ? ["BIG WIN", "win_big"] : null;
    countUp(total, tier ? 300 : 500 * speed());
    if (total > 0) say(`WIN ${fmt(total)}${r.multiplier_applied > 1 ? ` (×${r.multiplier_applied})` : ""}`, true);
    sfx(x >= 5 ? "win_land" : total > 0 ? "win_small" : "click");
    if (tier) await celebrate(tier[0], total, tier[1]);
    // Walk the winning lines once (skipped by quick stop / turbo / autoplay pace).
    if (!S.quickStop && !S.turbo && (r.line_wins || []).length > 1) {
      for (const [li, w] of r.line_wins.slice(0, 6).entries()) { if (S.quickStop) break; sfx("line_show", { i: li }); R.highlight = { cells: new Set(w.positions.map((p) => `${p.row},${p.col}`)), line: S.rules.lines.patterns[w.line - 1].map((row, col) => [row, col]), lineNo: w.line }; kick(); await sleep(420); }
      R.highlight = { cells, line: null }; kick();
    }
    if (r.free_spins_awarded > 0) {
      sfx("feature_award", { retrigger: r.is_free_spin });
      say(r.is_free_spin ? `+${r.free_spins_awarded} free spins!` : `${r.free_spins_awarded} FREE SPINS · every win ×${S.rules.free_spins.multiplier}`, true);
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
  function celebrate(title, amount, sound) {
    return new Promise((resolve) => {
      el.celTitle.textContent = title; el.celAmount.textContent = "0.00"; el.cel.hidden = false; sfx(sound);
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
    emit("featureState", { active: true, free_spins_left: S.freeSpinsLeft, bonus_win: S.featureWin });
    Sound?.setMusic?.("freeSpins");
    sfx("fs_intro");
    while (S.freeSpinsLeft > 0 && !S.paused) {
      el.fsBadge.textContent = `FREE SPINS ${S.freeSpinsLeft} · ×${S.rules.free_spins.multiplier}`;
      const r = await playRound({ auto: true });
      if (!r) break;
      await sleep(260 * speed());
    }
    el.fsBadge.hidden = true;
    Sound?.setMusic?.("base");
    sfx("fs_outro");
    const total = S.featureWin;
    say(`Free spins won ${fmt(total)}`, total > 0);
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
      const cv = document.createElement("canvas"); cv.width = cv.height = Math.round(38 * dpr); drawSymbol(cv.getContext("2d"), sym, cv.width);
      const big = document.createElement("b"); big.textContent = fmt(p[2] * lb);
      const small = document.createElement("span"); small.textContent = `4: ${fmt(p[1] * lb)} · 3: ${fmt(p[0] * lb)}`;
      tile.append(cv, big, small); box.append(tile);
    }
    const note = document.createElement("p");
    note.textContent = `5 in a line, ${S.lines} lines. 3+ scatters anywhere: ${S.rules.free_spins.awards[0]}+ free spins, every win ×${S.rules.free_spins.multiplier}.`;
    box.append(note);
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
  function renderRules() {
    if (!S.rules) return;
    const r = S.rules, lb = lineBet();
    const rows = Object.entries(r.paytable).map(([sym, p]) => `<tr><td>${sym}</td>${p.map((x) => `<td>${fmt(x * lb)}</td>`).join("")}</tr>`).join("");
    el.rules.innerHTML = `
      <p>${S.lines} fixed lines. Total bet ${fmt(S.bets[S.betIndex])} (line bet ${fmt(lb)}). Line wins pay left to right from the first reel, 3 or more in a row; the highest win per line is paid and wins on different lines add up.</p>
      <table><thead><tr><th>Symbol</th><th>×3</th><th>×4</th><th>×5</th></tr></thead><tbody>${rows}</tbody></table>
      <p><b>WILD</b> appears on reels 2, 3 and 4 and substitutes for every symbol except SCATTER.</p>
      <p><b>SCATTER</b> pays anywhere: 3 = ${fmt(r.scatter.pays[0] * S.bets[S.betIndex])}, 4 = ${fmt(r.scatter.pays[1] * S.bets[S.betIndex])}, 5 = ${fmt(r.scatter.pays[2] * S.bets[S.betIndex])}.
      3, 4 or 5 scatters award ${r.free_spins.awards.join(", ")} free spins, played at the same bet. Every free-spin win is multiplied by ${r.free_spins.multiplier}. Free spins can be won again during free spins.</p>
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
    say("Ready");
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
    // The marquee face draws BAR, 7, WILD and SCATTER: wait for it (capped) so no sprite is cached in a fallback.
    await Promise.race([document.fonts?.load?.('400 32px "C5 Marquee"') ?? Promise.resolve(), sleep(1500)]).catch(() => {});
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
    say(S.freeSpinsLeft > 0 ? `Free spins left: ${S.freeSpinsLeft} · tap Spin to continue` : `${S.lines} lines · good luck!`);
    setControls();
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
