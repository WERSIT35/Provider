/*
 * Glasshouse: the player client (board + round lifecycle) on the multi-game platform.
 * games/glasshouse/DESIGN.md is the specification (section numbers below refer to it).
 *
 * - Server-authoritative: every outcome comes from the RGS (/game/v1/*). The reels land on
 *   the server's own `stops` on the real strips (rules.json, the file the engine pays from),
 *   and the Sunbeam is drawn exactly along the path the engine sent (`beams[].path`): the
 *   client never computes a path, a wild or a pay. Visuals never feed back into play.
 * - The Lumina Shell (/play/shell/shell.js) owns every control, readout and dialog, the same
 *   as in every Lumina game; this file owns the board (BoardView, §11.6) and tells the shell
 *   what is happening. Market rules (autoplay, speed, slam stop, buy, pacing, no win effects
 *   at or below the stake) come from the session's regulatory profile through the shell.
 * - Every duration comes from the shared motion table (/play/shell/motion.js): the grammar
 *   rows for the beam (beamIgnite, beamCell, beamBend, paneLight, beamHold, stickyCarry) and
 *   this game's block (its own constants).
 * - Light by design: panes are drawn once per size into sprites; the canvas loop runs only
 *   while something moves (a resting board draws nothing); no layout ever moves the board.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = { canvas: $("panes"), board: $("board") };
  const Sound = window.Sound;
  const M = window.LuminaMotion;
  const T = window.LuminaMotion.game("glasshouse");
  // Glasshouse's own events on top of the shared engine's (its sounds: audio/manifest.json).
  if (Sound?.defineEvents) {
    const { semis } = Sound.util;
    // The beam builds a chord: each lit pane adds the next note of a rising scale (§13).
    const SCALE = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    Sound.defineEvents({
      gh_beam_cell: { minGap: 25, voice: (o) => ({ key: "gh_chime", rate: semis(SCALE[Math.min(SCALE.length - 1, Number(o.i) || 0)]), jitter: false, db: -6 }) },
      gh_lens: { voice: () => ({ key: "gh_lens", db: -4 }) },
      gh_mirror: { minGap: 40, voice: () => ({ key: "gh_mirror", db: -5 }) },
      gh_carry: { voice: () => ({ key: "gh_carry", db: -8 }) }
    });
  }
  const sfx = (name, opts) => { Haptics.onEvent(name); try { Sound?.play(name, opts); } catch { /* sound is never load-bearing */ } };
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");

  // ── state ────────────────────────────────────────────────────────────────
  const S = {
    token: null, rules: null, variant: null, currency: "", bets: [], betIndex: 0, balance: null,
    inFlight: false, featureRun: false, quickStop: false, resultShown: false, paused: false, lastAnswerAt: 0, minRoundMs: 0,
    autoplay: null, // { left, limits, startBalance }
    freeSpinsLeft: 0, featureWin: 0, featureStake: 0, featureState: null, stats: { startedManual: 0, startedAuto: 0 }
  };
  window.__spinLifecycle = { get inFlight() { return S.inFlight || S.featureRun; }, get autoplayActive() { return Boolean(S.autoplay); }, stats: S.stats };

  const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "—");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const speed = () => ({ normal: 1, quick: T.quick, turbo: T.turbo })[shell?.speed?.() || "normal"] || 1;
  const calm = () => Boolean(shell?.reducedMotion?.() ?? reduceMotion?.matches);
  /** A grammar duration at the player's speed; a Stop shortens a "shorten" row to its turbo value. */
  const ms = (event) => {
    const sp = shell.motionSpeed();
    const row = M.GRAMMAR[event];
    return S.quickStop && sp !== "reduced" && row.skip === "shorten" ? Math.min(row.turbo, M.ms(event, sp)) : M.ms(event, sp);
  };

  // ── haptics (touch devices only, off with reduced motion, player can switch it off) ──
  const Haptics = (() => {
    const supported = typeof navigator.vibrate === "function" && window.matchMedia?.("(pointer: coarse)").matches === true;
    let on = true;
    try { on = localStorage.getItem("vx.haptics") !== "0"; } catch { /* default on */ }
    const P = { spin_start: 8, reel_stop: 4, scatter_land: 16, gh_lens: 10, feature_award: [30, 50, 30, 50, 60], win_big: [40, 60, 40], win_mega: [50, 60, 50, 60, 70], win_epic: [60, 50, 60, 50, 120] };
    return {
      supported,
      get on() { return on; },
      set(v) { on = Boolean(v); try { localStorage.setItem("vx.haptics", on ? "1" : "0"); } catch { /* not remembered */ } },
      onEvent(name) { const p = P[name]; if (p !== undefined && supported && on && !reduceMotion?.matches && !document.hidden) { try { navigator.vibrate(p); } catch { /* blocked */ } } }
    };
  })();

  let shell = null;
  function say(text, win = false, celebrate = true) { if (!shell) return; win ? shell.ticker.win(text, celebrate) : shell.ticker.say(text); }

  // ── panes: leaded glass, drawn in code (DESIGN §3.1, §12) ───────────────────
  // Every symbol reads by silhouette alone in grayscale at 48 px (symbol-sheet probe); colour
  // is the second cue: the low gems' tint marks their pay tier, their cut tells them apart.
  const NAMES = {
    TRILLION: "Trillion", CUSHION: "Cushion", BAGUETTE: "Baguette", MARQUISE: "Marquise", PEAR: "Pear", HEART: "Heart",
    SUNDIAL: "Sundial", WATERING_CAN: "Watering Can", ORCHID: "Glass Orchid", HUMMINGBIRD: "Hummingbird",
    LENS: "Sun Lens", MIRROR_RISE: "Mirror", MIRROR_FALL: "Mirror", ROSE: "Glass Rose", CLEAR: "Clear Pane"
  };
  const LEAD = "#1e2124";
  const GLASS = {
    ruby: ["#ef6b7c", "#b3263a", "#6e1322"], emerald: ["#5fd39c", "#1f8a5b", "#0f4f33"],
    sapphire: ["#7aa4ec", "#2457a6", "#12305f"], amber: ["#f5c56e", "#c98a2b", "#7a5214"],
    brass: ["#f1d9a4", "#b08d57", "#6f5631"], silver: ["#ffffff", "#c9d1d8", "#7e8a95"]
  };
  const TINT = { HEART: "ruby", PEAR: "ruby", MARQUISE: "sapphire", BAGUETTE: "sapphire", CUSHION: "emerald", TRILLION: "emerald" };
  window.__luminaSymbols = { get ids() { return Object.keys(NAMES).filter((k) => k !== "MIRROR_FALL"); }, render(id, px) { const c = document.createElement("canvas"); c.width = c.height = px; drawPane(c.getContext("2d"), id, px); return c; } };

  function drawPane(g, sym, s) {
    g.save();
    g.lineJoin = "round"; g.lineCap = "round";
    const lw = Math.max(1.5, s * 0.05);
    const X = (v) => v * s;
    const grad = (x0, y0, x1, y1, [a, b, c]) => { const gr = g.createLinearGradient(X(x0), X(y0), X(x1), X(y1)); gr.addColorStop(0, a); gr.addColorStop(0.55, b); gr.addColorStop(1, c); return gr; };
    const radial = (x, y, r, stops) => { const gr = g.createRadialGradient(X(x), X(y), 0, X(x), X(y), X(r)); stops.forEach(([o, col]) => gr.addColorStop(o, col)); return gr; };
    // A piece of glass: fill, then its lead came (the dark outline every leaded window has).
    const piece = (path, fill, w = 1) => { g.beginPath(); path(); g.fillStyle = fill; g.fill(); g.lineWidth = lw * w; g.strokeStyle = LEAD; g.stroke(); };
    const facet = (pts, col = "rgba(255,255,255,0.55)", w = 0.35) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), X(y)) : g.moveTo(X(x), X(y)))); g.lineWidth = lw * w; g.strokeStyle = col; g.stroke(); };
    const poly = (pts) => () => { pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), X(y)) : g.moveTo(X(x), X(y)))); g.closePath(); };
    const circ = (x, y, r) => () => g.arc(X(x), X(y), X(r), 0, Math.PI * 2);
    const ell = (x, y, rx, ry, rot = 0) => () => g.ellipse(X(x), X(y), X(rx), X(ry), rot, 0, Math.PI * 2);
    const rrect = (x, y, w, h, r) => () => { g.roundRect ? g.roundRect(X(x), X(y), X(w), X(h), X(r)) : g.rect(X(x), X(y), X(w), X(h)); };

    // The pane behind the motif: frosted dawn glass, a few mottles, a soft streak of reflection.
    const bg = sym === "ROSE" ? ["#3c5f9e", "#1d3a6e", "#10244a"] : sym === "LENS" ? ["#fff1d0", "#e9c690", "#b88d55"] : sym === "CLEAR" ? ["#fbf6ee", "#efe4d6", "#dccbb8"]
      : sym.startsWith("MIRROR") ? ["#fbefe9", "#ecd6cd", "#d2b6aa"] : ["SUNDIAL", "WATERING_CAN", "ORCHID", "HUMMINGBIRD"].includes(sym) ? ["#f6e4c8", "#e3c9a3", "#c4a47a"] : ["#f1e3d8", "#dcc5b6", "#bfa392"];
    g.fillStyle = grad(0, 0, 1, 1, bg); g.fillRect(0, 0, s, s);
    g.save(); g.globalAlpha = 0.22; g.fillStyle = "#ffffff";
    g.beginPath(); g.moveTo(X(0.08), X(0.02)); g.lineTo(X(0.3), X(0.02)); g.lineTo(X(0.02), X(0.3)); g.lineTo(X(0.02), X(0.12)); g.closePath(); g.fill();
    g.restore();

    switch (sym) {
      case "TRILLION": { // triangular cut, point up
        const c = GLASS[TINT[sym]];
        piece(poly([[0.5, 0.15], [0.86, 0.8], [0.14, 0.8]]), grad(0.3, 0.15, 0.7, 0.8, c), 1.1);
        facet([[0.5, 0.15], [0.5, 0.58], [0.86, 0.8]]); facet([[0.5, 0.58], [0.14, 0.8]]);
        break;
      }
      case "CUSHION": { // square cut, rounded corners
        const c = GLASS[TINT[sym]];
        piece(rrect(0.2, 0.2, 0.6, 0.6, 0.14), grad(0.2, 0.2, 0.8, 0.8, c), 1.1);
        piece(rrect(0.36, 0.36, 0.28, 0.28, 0.05), grad(0.36, 0.36, 0.64, 0.64, [c[0], c[0], c[1]]), 0.6);
        facet([[0.24, 0.24], [0.36, 0.36]]); facet([[0.76, 0.24], [0.64, 0.36]]); facet([[0.24, 0.76], [0.36, 0.64]]); facet([[0.76, 0.76], [0.64, 0.64]]);
        break;
      }
      case "BAGUETTE": { // long thin step cut, upright
        const c = GLASS[TINT[sym]];
        piece(rrect(0.36, 0.1, 0.28, 0.8, 0.02), grad(0.36, 0.1, 0.64, 0.9, c), 1.1);
        piece(rrect(0.44, 0.2, 0.12, 0.6, 0.01), grad(0.44, 0.2, 0.56, 0.8, [c[0], c[0], c[1]]), 0.5);
        break;
      }
      case "MARQUISE": { // tall pointed oval
        const c = GLASS[TINT[sym]];
        piece(() => { g.moveTo(X(0.5), X(0.1)); g.quadraticCurveTo(X(0.82), X(0.5), X(0.5), X(0.9)); g.quadraticCurveTo(X(0.18), X(0.5), X(0.5), X(0.1)); g.closePath(); }, grad(0.3, 0.1, 0.7, 0.9, c), 1.1);
        facet([[0.5, 0.1], [0.5, 0.9]]); facet([[0.34, 0.5], [0.66, 0.5]], "rgba(255,255,255,0.4)");
        break;
      }
      case "PEAR": { // teardrop, point up
        const c = GLASS[TINT[sym]];
        piece(() => { g.moveTo(X(0.5), X(0.1)); g.bezierCurveTo(X(0.62), X(0.3), X(0.8), X(0.46), X(0.78), X(0.64)); g.arc(X(0.5), X(0.64), X(0.28), 0, Math.PI, false); g.bezierCurveTo(X(0.2), X(0.46), X(0.38), X(0.3), X(0.5), X(0.1)); g.closePath(); }, grad(0.3, 0.1, 0.7, 0.92, c), 1.1);
        facet([[0.5, 0.1], [0.5, 0.64], [0.32, 0.82]]); facet([[0.5, 0.64], [0.68, 0.82]]);
        break;
      }
      case "HEART": { // heart cut
        const c = GLASS[TINT[sym]];
        piece(() => { g.moveTo(X(0.5), X(0.86)); g.bezierCurveTo(X(0.16), X(0.6), X(0.08), X(0.34), X(0.28), X(0.22)); g.bezierCurveTo(X(0.4), X(0.16), X(0.48), X(0.24), X(0.5), X(0.32)); g.bezierCurveTo(X(0.52), X(0.24), X(0.6), X(0.16), X(0.72), X(0.22)); g.bezierCurveTo(X(0.92), X(0.34), X(0.84), X(0.6), X(0.5), X(0.86)); g.closePath(); }, grad(0.2, 0.2, 0.8, 0.86, c), 1.1);
        facet([[0.5, 0.32], [0.5, 0.86]]); facet([[0.28, 0.4], [0.5, 0.52], [0.72, 0.4]], "rgba(255,255,255,0.4)");
        break;
      }
      case "SUNDIAL": { // brass dial plate with its gnomon standing up
        const b = GLASS.brass;
        piece(ell(0.5, 0.62, 0.38, 0.22), grad(0.12, 0.4, 0.88, 0.84, b), 1);
        for (let i = 0; i < 9; i++) { const a = Math.PI + (i / 8) * Math.PI; facet([[0.5 + Math.cos(a) * 0.3, 0.62 + Math.sin(a) * 0.17], [0.5 + Math.cos(a) * 0.36, 0.62 + Math.sin(a) * 0.205]], LEAD, 0.4); }
        piece(poly([[0.36, 0.64], [0.66, 0.64], [0.36, 0.16]]), grad(0.36, 0.16, 0.66, 0.64, ["#fff3cf", "#e3c58e", "#9c7a44"]), 1);
        break;
      }
      case "WATERING_CAN": { // brass can, long spout to the right
        const b = GLASS.brass;
        g.beginPath(); g.moveTo(X(0.26), X(0.4)); g.quadraticCurveTo(X(0.4), X(0.08), X(0.56), X(0.4)); g.lineWidth = X(0.06); g.strokeStyle = LEAD; g.stroke(); g.lineWidth = X(0.03); g.strokeStyle = b[1]; g.stroke();
        piece(poly([[0.6, 0.62], [0.86, 0.3], [0.9, 0.34], [0.66, 0.7]]), grad(0.6, 0.3, 0.9, 0.7, b), 0.9);
        piece(ell(0.88, 0.3, 0.06, 0.09, 0.7), grad(0.82, 0.22, 0.94, 0.38, b), 0.8);
        piece(poly([[0.2, 0.42], [0.64, 0.42], [0.68, 0.86], [0.16, 0.86]]), grad(0.16, 0.42, 0.68, 0.86, b), 1.1);
        facet([[0.2, 0.56], [0.65, 0.56]], LEAD, 0.5);
        break;
      }
      case "ORCHID": { // orchid bloom in leaded glass on a stem
        g.beginPath(); g.moveTo(X(0.5), X(0.62)); g.quadraticCurveTo(X(0.46), X(0.8), X(0.52), X(0.96)); g.lineWidth = X(0.05); g.strokeStyle = LEAD; g.stroke(); g.lineWidth = X(0.025); g.strokeStyle = "#1f8a5b"; g.stroke();
        const petal = ["#ffffff", "#f2b8d6", "#b9567f"];
        for (const [x, y, rx, ry, rot] of [[0.5, 0.2, 0.1, 0.17, 0], [0.26, 0.38, 0.17, 0.09, -0.35], [0.74, 0.38, 0.17, 0.09, 0.35], [0.33, 0.6, 0.13, 0.08, 0.6], [0.67, 0.6, 0.13, 0.08, -0.6]]) piece(ell(x, y, rx, ry, rot), grad(x - rx, y - ry, x + rx, y + ry, petal), 0.9);
        piece(() => { g.moveTo(X(0.4), X(0.44)); g.quadraticCurveTo(X(0.5), X(0.74), X(0.6), X(0.44)); g.quadraticCurveTo(X(0.5), X(0.36), X(0.4), X(0.44)); g.closePath(); }, grad(0.4, 0.36, 0.6, 0.7, GLASS.ruby), 0.9);
        break;
      }
      case "HUMMINGBIRD": { // in profile: long beak, wings up, forked tail
        const e = GLASS.emerald;
        piece(poly([[0.44, 0.52], [0.3, 0.06], [0.58, 0.44]]), grad(0.3, 0.06, 0.58, 0.52, ["#c9f5df", "#5fd39c", "#1f8a5b"]), 0.9);
        piece(poly([[0.36, 0.66], [0.14, 0.9], [0.22, 0.7], [0.08, 0.76], [0.3, 0.6]]), grad(0.08, 0.6, 0.36, 0.9, e), 0.9);
        piece(ell(0.46, 0.58, 0.2, 0.11, -0.5), grad(0.3, 0.46, 0.66, 0.7, e), 1);
        piece(circ(0.64, 0.38, 0.1), grad(0.54, 0.28, 0.74, 0.48, e), 1);
        piece(ell(0.58, 0.48, 0.07, 0.05, -0.5), grad(0.52, 0.44, 0.64, 0.54, GLASS.ruby), 0.6);
        g.beginPath(); g.moveTo(X(0.72), X(0.35)); g.lineTo(X(0.96), X(0.24)); g.lineWidth = X(0.045); g.strokeStyle = LEAD; g.stroke();
        g.beginPath(); circ(0.665, 0.355, 0.02)(); g.fillStyle = LEAD; g.fill();
        break;
      }
      case "LENS": { // brass-ringed burning lens, handle stub to the left, light gathered at its centre
        piece(rrect(0.04, 0.44, 0.22, 0.12, 0.03), grad(0.04, 0.44, 0.26, 0.56, GLASS.brass), 0.9);
        piece(circ(0.58, 0.5, 0.34), grad(0.24, 0.16, 0.92, 0.84, GLASS.brass), 1.1);
        g.beginPath(); circ(0.58, 0.5, 0.25)(); g.fillStyle = radial(0.58, 0.5, 0.25, [[0, "#ffffff"], [0.3, "#fff3cf"], [0.7, "#ffe38a"], [1, "#d9a24a"]]); g.fill();
        g.lineWidth = lw * 0.9; g.strokeStyle = LEAD; g.stroke();
        facet([[0.44, 0.36], [0.52, 0.32]], "rgba(255,255,255,0.9)", 0.6);
        break;
      }
      case "MIRROR_RISE":
      case "MIRROR_FALL": { // silvered glass at 45°: the direction of the glass is the whole meaning
        g.save();
        if (sym === "MIRROR_FALL") { g.translate(s, 0); g.scale(-1, 1); }
        g.translate(X(0.5), X(0.5)); g.rotate(-Math.PI / 4);
        const L = 0.6, W = 0.17;
        // The silver: bright along its top edge, the dawn caught in its lower half.
        const sv = g.createLinearGradient(0, X(-W / 2), 0, X(W / 2));
        sv.addColorStop(0, "#ffffff"); sv.addColorStop(0.35, "#e6ebf0"); sv.addColorStop(0.62, "#f2cfc4"); sv.addColorStop(1, "#9aa6b1");
        g.beginPath(); g.rect(X(-L), X(-W / 2), X(2 * L), X(W)); g.fillStyle = sv; g.fill();
        g.lineWidth = lw * 0.9; g.strokeStyle = LEAD; g.stroke();
        g.beginPath(); g.moveTo(X(-L * 0.86), X(-W * 0.22)); g.lineTo(X(L * 0.86), X(-W * 0.22)); g.lineWidth = lw * 0.35; g.strokeStyle = "rgba(255,255,255,0.95)"; g.stroke();
        // Brass caps hold the glass at both ends.
        for (const x of [-L, L - 0.08]) { g.beginPath(); g.rect(X(x), X(-W / 2 - 0.02), X(0.08), X(W + 0.04)); g.fillStyle = grad(0, -0.1, 0, 0.1, GLASS.brass); g.fill(); g.lineWidth = lw * 0.7; g.strokeStyle = LEAD; g.stroke(); }
        g.restore();
        break;
      }
      case "ROSE": { // a rose in leaded glass in a round brass frame (scatter)
        piece(circ(0.5, 0.5, 0.42), grad(0.08, 0.08, 0.92, 0.92, GLASS.brass), 1.1);
        g.beginPath(); circ(0.5, 0.5, 0.33)(); g.fillStyle = grad(0.17, 0.17, 0.83, 0.83, GLASS.sapphire); g.fill(); g.lineWidth = lw * 0.8; g.strokeStyle = LEAD; g.stroke();
        for (const [x, y, rot] of [[0.3, 0.68, -0.8], [0.7, 0.68, 0.8]]) piece(ell(x, y, 0.1, 0.05, rot), grad(x - 0.1, y - 0.05, x + 0.1, y + 0.05, GLASS.emerald), 0.7);
        for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; piece(ell(0.5 + Math.cos(a) * 0.1, 0.47 + Math.sin(a) * 0.1, 0.12, 0.09, a), grad(0.3, 0.3, 0.7, 0.7, GLASS.ruby), 0.6); }
        piece(circ(0.5, 0.47, 0.08), radial(0.5, 0.47, 0.08, [[0, "#ffb3bd"], [1, "#b3263a"]]), 0.6);
        g.beginPath(); g.arc(X(0.5), X(0.47), X(0.04), 0, Math.PI * 1.5); g.lineWidth = lw * 0.4; g.strokeStyle = LEAD; g.stroke();
        break;
      }
      case "CLEAR": // plain glass: nothing but the light on it
        g.save(); g.globalAlpha = 0.35; g.fillStyle = "#ffffff";
        g.beginPath(); g.moveTo(X(0.52), X(0.12)); g.lineTo(X(0.62), X(0.12)); g.lineTo(X(0.28), X(0.88)); g.lineTo(X(0.18), X(0.88)); g.closePath(); g.fill();
        g.restore();
        break;
    }
    // The pane's own lead came, with a bevel highlight on its inner edge.
    g.lineWidth = lw * 1.6; g.strokeStyle = LEAD; g.strokeRect(lw * 0.8, lw * 0.8, s - lw * 1.6, s - lw * 1.6);
    g.lineWidth = Math.max(1, lw * 0.3); g.strokeStyle = "rgba(255,255,255,0.28)"; g.strokeRect(lw * 1.8, lw * 1.8, s - lw * 3.6, s - lw * 3.6);
    g.restore();
  }

  // ── renderer (BoardView, DESIGN §11.6) ───────────────────────────────────
  const R = {
    ctx: el.canvas.getContext("2d"), w: 0, h: 0, dpr: 1, cell: 0, ox: 0, oy: 0, sprites: new Map(),
    reels: [],        // { strip, pos (cells, fractional), anim, spinning, speed }
    beams: null,      // { list: [{ pts, cells: [{ r, c, at, bend }] , exitPt }], t0, perCell, ignite, done }
    lit: new Map(),   // "r,c" → time the pane lit (this spin)
    sticky: new Map(),// "r,c" → ttl (lit panes carried from earlier free spins)
    carryAt: 0,       // when the stickyCarry glow started
    highlight: null,  // { cells: Set, neutral, labels: [{ r, c, text }] }
    anticipate: -1,
    raf: 0
  };
  const key = (r, c) => `${r},${c}`;
  // Probes (tools/probes/glasshouse-client.mjs): what the board is showing, read-only.
  window.__ghBoard = { get beaming() { return Boolean(R.beams && !R.beams.done); }, get highlighted() { return Boolean(R.highlight); }, get lit() { return R.lit.size + R.sticky.size; } };
  function resize() {
    const box = el.board.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (w === R.w && h === R.h && dpr === R.dpr) return;
    R.w = el.canvas.width = w; R.h = el.canvas.height = h; R.dpr = dpr;
    R.cell = Math.min(w / 6, h / 4);
    R.ox = (w - R.cell * 6) / 2; R.oy = (h - R.cell * 4) / 2;
    R.sprites.clear();
    kick();
  }
  function sprite(sym) {
    let sp = R.sprites.get(sym);
    if (!sp) {
      const s = Math.max(8, Math.ceil(R.cell));
      sp = document.createElement("canvas"); sp.width = sp.height = s;
      drawPane(sp.getContext("2d"), sym, s);
      R.sprites.set(sym, sp);
    }
    return sp;
  }
  const centre = (r, c) => [R.ox + (c + 0.5) * R.cell, R.oy + (r + 0.5) * R.cell];
  const cellAt = (reel, k) => { const st = reel.strip, L = st.length, base = Math.floor(reel.pos); return st[(((base + k) % L) + L) % L]; };

  /** A lit pane: the glass floods with white-gold light; the lead stays; what was there shows faintly. */
  function drawLight(g, x, y, cell, a, { carried = false, fading = false } = {}) {
    if (a <= 0) return;
    g.save();
    g.globalAlpha = a * (fading ? 0.62 : carried ? 0.9 : 0.86);
    const gr = g.createRadialGradient(x + cell * 0.5, y + cell * 0.5, cell * 0.04, x + cell * 0.5, y + cell * 0.5, cell * 0.72);
    gr.addColorStop(0, "#ffffff"); gr.addColorStop(0.35, "#fff3cf"); gr.addColorStop(0.8, "#ffe38a"); gr.addColorStop(1, "#e2b35a");
    g.fillStyle = gr; g.fillRect(x, y, cell, cell);
    g.globalAlpha = a;
    const lw = Math.max(1.5, cell * 0.05);
    g.lineWidth = lw * 1.6; g.strokeStyle = LEAD; g.strokeRect(x + lw * 0.8, y + lw * 0.8, cell - lw * 1.6, cell - lw * 1.6);
    // A small sun mark: the pane is wild because the light is in it.
    { g.strokeStyle = "rgba(201,138,43,0.85)"; g.lineWidth = Math.max(1, cell * 0.022); const cx = x + cell * 0.5, cy = y + cell * 0.5, r0 = cell * 0.1, r1 = cell * 0.17; g.beginPath(); for (let i = 0; i < 8; i++) { const an = (i / 8) * Math.PI * 2; g.moveTo(cx + Math.cos(an) * r0, cy + Math.sin(an) * r0); g.lineTo(cx + Math.cos(an) * r1, cy + Math.sin(an) * r1); } g.stroke(); g.beginPath(); g.arc(cx, cy, cell * 0.07, 0, Math.PI * 2); g.fillStyle = "rgba(201,138,43,0.85)"; g.fill(); }
    g.restore();
  }

  function draw(now) {
    const g = R.ctx, cell = R.cell, ox = R.ox, oy = R.oy;
    g.clearRect(0, 0, R.w, R.h);
    g.fillStyle = LEAD; g.fillRect(ox, oy, cell * 6, cell * 4);
    const hl = R.highlight;
    const pl = M.ms("paneLight", shell?.motionSpeed?.() || "normal") || 1;
    for (let col = 0; col < 6; col++) {
      const reel = R.reels[col]; if (!reel) continue;
      const moving = reel.anim || reel.spinning;
      const x = ox + col * cell;
      g.save(); g.beginPath(); g.rect(x, oy, cell, cell * 4); g.clip();
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      for (let k = -1; k <= 4; k++) {
        const sym = cellAt(reel, k);
        const y = oy + (k - frac) * cell;
        const sp = sprite(sym);
        const row = k, here = !moving && row >= 0 && row < 4 ? key(row, col) : null;
        const win = hl && here && hl.cells.has(here);
        const tease = R.anticipate >= 0 && !moving && col < R.anticipate && sym !== "ROSE";
        g.globalAlpha = !hl || moving || win ? (tease ? 0.72 : 1) : hl.neutral ? 0.75 : 0.38;
        if (reel.spinning && !calm()) { g.globalAlpha = 0.55; g.drawImage(sp, x, y - cell * 0.08, cell, cell * 1.16); }
        else g.drawImage(sp, x, y, cell, cell);
        g.globalAlpha = 1;
      }
      g.restore();
    }
    // Lit panes carried from earlier free spins: fixed in the glass while the reels turn under them.
    for (const [k, ttl] of R.sticky) {
      const [r, c] = k.split(",").map(Number);
      const glow = R.carryAt && !calm() ? Math.max(0, 1 - (now - R.carryAt) / (M.ms("stickyCarry", shell.motionSpeed()) || 1)) : 0;
      drawLight(R.ctx, ox + c * cell, oy + r * cell, cell, 1, { carried: true, fading: ttl <= 1 });
      if (glow > 0) { g.save(); g.globalAlpha = glow * 0.6; g.fillStyle = "#ffffff"; g.fillRect(ox + c * cell, oy + r * cell, cell, cell); g.restore(); }
    }
    // Panes lit by this spin's beams, each as the light enters it (paneLight fade).
    for (const [k, t] of R.lit) {
      const [r, c] = k.split(",").map(Number);
      const a = now >= t ? Math.min(1, (now - t) / pl) : 0;
      drawLight(g, ox + c * cell, oy + r * cell, cell, a);
    }
    // Winning panes: a warm outline (celebrated) or a plain ink outline (no-celebrate markets).
    if (hl) for (const k of hl.cells) {
      const [r, c] = k.split(",").map(Number), x = ox + c * cell, y = oy + r * cell;
      g.save(); g.lineWidth = Math.max(2, cell * 0.045);
      g.strokeStyle = hl.neutral ? "rgba(30,33,36,0.85)" : "#ffe38a";
      if (!hl.neutral) { g.shadowColor = "rgba(255,227,138,0.95)"; g.shadowBlur = cell * 0.12; }
      g.strokeRect(x + cell * 0.07, y + cell * 0.07, cell * 0.86, cell * 0.86);
      g.restore();
    }
    // The beams: a soft glow and a bright core, drawn along the engine's path up to `progress`.
    if (R.beams) for (const b of R.beams.list) {
      const prog = R.beams.perCell > 0 ? (now - b.t0) / R.beams.perCell : Infinity;
      if (prog < 0) {
        // Ignite: the lens gathers the light before the beam leaves it.
        const [lx, ly] = centre(b.cells[0].r, 0), k = calm() ? 1 : Math.max(0, 1 + prog * R.beams.perCell / Math.max(1, R.beams.ignite));
        g.save(); const gr = g.createRadialGradient(lx, ly, 0, lx, ly, cell * 0.6); gr.addColorStop(0, `rgba(255,255,255,${0.9 * k})`); gr.addColorStop(1, "rgba(255,243,207,0)"); g.fillStyle = gr; g.fillRect(lx - cell, ly - cell, cell * 2, cell * 2); g.restore();
        continue;
      }
      const pts = b.pts, n = pts.length - 1, upTo = Math.min(n, prog);
      g.save();
      g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i <= Math.floor(upTo); i++) g.lineTo(pts[i][0], pts[i][1]);
      if (upTo < n) { const i = Math.floor(upTo), f = upTo - i; g.lineTo(pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f); }
      const done = upTo >= n;
      g.lineCap = "round"; g.lineJoin = "round";
      g.strokeStyle = `rgba(255,227,138,${done ? 0.4 : 0.55})`; g.lineWidth = cell * 0.16; if (!calm()) { g.shadowColor = "rgba(255,243,207,0.95)"; g.shadowBlur = cell * 0.25; } g.stroke();
      g.shadowBlur = 0; g.strokeStyle = "rgba(255,255,255,0.95)"; g.lineWidth = Math.max(1.5, cell * 0.035); g.stroke();
      // A mirror flashes as it turns the light.
      const bm = M.ms("beamBend", shell.motionSpeed()) || 0;
      for (const cc of b.cells) if (cc.bend && bm > 0) {
        const t = now - cc.at; if (t < 0 || t > bm) continue;
        const [cx, cy] = centre(cc.r, cc.c); const a = 1 - t / bm;
        const gr = g.createRadialGradient(cx, cy, 0, cx, cy, cell * 0.55); gr.addColorStop(0, `rgba(255,255,255,${a})`); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(cx - cell, cy - cell, cell * 2, cell * 2);
      }
      g.restore();
    }
    // Amounts: a small brass tag on each winning symbol's last pane.
    for (const l of hl?.labels || []) {
      const [cx, cy] = centre(l.r, l.c);
      tag(g, cx, cy + cell * 0.3, l.text, cell * 0.16, hl.neutral);
    }
  }
  function tag(g, cx, cy, text, size, neutral) {
    g.save();
    g.font = `600 ${Math.round(size)}px "GH Num", "Arial Narrow", sans-serif`;
    const w = g.measureText(text).width + size * 0.9, h = size * 1.45;
    g.beginPath(); g.roundRect ? g.roundRect(cx - w / 2, cy - h / 2, w, h, size * 0.2) : g.rect(cx - w / 2, cy - h / 2, w, h);
    g.fillStyle = neutral ? "#fff6e2" : "#ffe38a"; g.fill(); g.lineWidth = Math.max(1, size * 0.14); g.strokeStyle = LEAD; g.stroke();
    g.fillStyle = LEAD; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, cx, cy + size * 0.04);
    g.restore();
  }

  function busy(now) {
    if (R.reels.some((r) => r.anim || r.spinning) || R.anticipate >= 0) return true;
    const pl = M.ms("paneLight", shell.motionSpeed()) || 0;
    for (const t of R.lit.values()) if (now < t + pl) return true;
    if (R.beams && !R.beams.done) return true;
    if (R.carryAt && now < R.carryAt + (M.ms("stickyCarry", shell.motionSpeed()) || 0)) return true;
    return false;
  }
  function step(now) {
    R.raf = 0;
    for (const reel of R.reels) {
      if (reel.spinning) { reel.pos -= (reel.speed * (now - (reel.last || now))) / 1000; reel.last = now; }
      if (reel.anim) {
        const a = reel.anim, t = Math.min(1, (now - a.t0) / a.dur);
        const e = t < 1 ? 1 - Math.pow(1 - t, 3) : 1; // a pane settles into its lead: ease-out, no bounce
        reel.pos = a.from + (a.to - a.from) * e;
        if (t >= 1) { reel.pos = a.to; reel.anim = null; a.done(); }
      }
    }
    if (R.beams && !R.beams.done && R.beams.list.every((b) => R.beams.perCell === 0 || now >= b.t0 + (b.pts.length - 1) * R.beams.perCell)) R.beams.done = true;
    if (!S.rules || !R.reels.length) return;
    draw(now);
    if (busy(performance.now())) kick();
  }
  function kick() { if (!R.raf) R.raf = requestAnimationFrame(step); }

  function setStrips(free) {
    const set = S.rules.strip_sets[S.variant.strips];
    const strips = free ? set.free : set.base;
    R.reels.forEach((reel, col) => { if (reel.strip !== strips[col]) { reel.strip = strips[col]; reel.pos = ((Math.round(reel.pos) % reel.strip.length) + reel.strip.length) % reel.strip.length; } });
  }
  function startReels() {
    R.highlight = null; R.beams = null; R.lit.clear();
    const now = performance.now();
    for (const reel of R.reels) { reel.spinning = true; reel.speed = (20 + Math.random() * 2) / speed(); reel.last = now; reel.anim = null; }
    kick();
  }
  function landReel(col, stop, dur) {
    const reel = R.reels[col], L = reel.strip.length;
    reel.spinning = false;
    let to = stop; const from = reel.pos;
    while (to > from - 2) to -= L;
    return new Promise((resolve) => { reel.anim = { from, to, t0: performance.now(), dur, done: () => { reel.pos = ((stop % L) + L) % L; resolve(); } }; kick(); });
  }

  /** Replay the engine's beams (DESIGN §11.2 step 3): top to bottom, cell by cell. */
  async function playBeams(r) {
    if (!r.beams?.length) return;
    const ignite = ms("beamIgnite"), perCell = ms("beamCell"), hold = ms("beamHold");
    const stickyIn = new Set((r.sticky_in || []).map(([a, b]) => key(a, b)));
    let t = performance.now();
    const list = [];
    for (const b of r.beams) {
      const t0 = t + ignite;
      const cells = b.path.map(([pr, pc], i) => ({ r: pr, c: pc, at: t0 + i * perCell, bend: b.bends.some(([br, bc]) => br === pr && bc === pc) }));
      const pts = b.path.map(([pr, pc]) => centre(pr, pc));
      const [lr, lc, ld] = b.path[b.path.length - 1];
      const [ex, ey] = centre(lr, lc), D = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }[ld];
      pts.push([ex + D[0] * R.cell * 0.62, ey + D[1] * R.cell * 0.62]); // out through the frame
      list.push({ t0, pts, cells });
      t = t0 + b.path.length * perCell;
    }
    R.beams = { list, perCell, ignite, done: false };
    // Each pane lights as the beam enters it; the lens itself stays a light source (§4.5).
    const litSet = new Set((r.lit || []).map(([a, b]) => key(a, b)));
    for (const b of list) for (const cc of b.cells) { const k = key(cc.r, cc.c); if (litSet.has(k) && !stickyIn.has(k) && !R.lit.has(k)) R.lit.set(k, cc.at); }
    kick();
    sfx("gh_lens");
    // Voice the chord and the mirrors in step with the light (timers: visuals stay on the clock above).
    let note = 0;
    for (const b of list) for (const cc of b.cells.slice(1)) {
      const at = cc.at - performance.now(), i = note++;
      setTimeout(() => { if (cc.bend) sfx("gh_mirror"); sfx("gh_beam_cell", { i }); }, Math.max(0, at));
    }
    await sleep(Math.max(0, t - performance.now()) + hold);
    R.beams.done = true; kick();
  }

  // ── network ──────────────────────────────────────────────────────────────
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
  async function api(method, url, body, idemKey) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(url, { method, headers: { authorization: `Bearer ${S.token}`, ...(body ? { "content-type": "application/json" } : {}), ...(idemKey ? { "idempotency-key": idemKey } : {}) }, body: body ? JSON.stringify(body) : undefined });
      } catch (err) {
        if (attempt < 3) { await sleep(400 * 2 ** attempt); continue; } // same key: the server never plays a round twice
        throw new Error("NETWORK: connection lost");
      }
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json.result ? Object.assign({}, json.result, json) : json;
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
  Bridge?.on?.("resume", () => { S.paused = false; say("Morning light."); });
  Bridge?.on?.("setMuted", (d) => Sound?.setMuted?.(Boolean(d.muted)));
  Bridge?.on?.("getState", () => emit("state", { paused: S.paused, in_round: S.inFlight, in_feature: S.freeSpinsLeft > 0, balance: S.balance, currency: S.currency }));

  // ── one round ────────────────────────────────────────────────────────────
  function setBalance(b) { if (Number.isFinite(b)) { S.balance = b; shell.setBalance(b); emit("balanceChanged", { balance: b, currency: S.currency }); } }
  function setControls() {
    const feature = S.freeSpinsLeft > 0 || S.featureRun;
    const phase = S.autoplay ? "autoplay" : S.inFlight ? (S.resultShown ? "result" : "flight") : feature ? "feature" : "ready";
    shell.setPhase(phase);
    const canSkip = S.inFlight && (S.resultShown || shell.slamAllowed());
    shell.setSpinMode(S.autoplay ? "stop" : canSkip ? "skip" : "spin");
    shell.setAutoplay(S.autoplay ? S.autoplay.left : 0);
  }
  async function paceRound() {
    const wait = S.minRoundMs - (performance.now() - S.lastAnswerAt);
    if (S.minRoundMs > 0 && wait > 0) await sleep(wait);
  }
  function showSticky(state) {
    R.sticky.clear();
    if (state?.sticky) state.sticky.forEach(([r, c], i) => R.sticky.set(key(r, c), Number(state.ttl?.[i] ?? 2)));
  }

  async function playRound({ auto = false, buy = false } = {}) {
    if (S.inFlight || S.paused || (S.featureRun && !auto)) return null;
    const free = S.freeSpinsLeft > 0;
    const bet = S.bets[S.betIndex];
    const cost = buy ? Math.round(bet * S.rules.buy.cost_x * 100) / 100 : bet;
    if (!free && Number.isFinite(S.balance) && S.balance + 1e-9 < cost) { await notEnoughCredit(cost); return null; }
    S.inFlight = true; S.quickStop = false; S.resultShown = false;
    auto ? S.stats.startedAuto++ : S.stats.startedManual++;
    setControls();
    if (!free) await paceRound();
    setStrips(free);
    // A free spin starts from the panes still lit (they glow once to show they kept their light).
    if (free) { showSticky(S.featureState); if (R.sticky.size) { R.carryAt = performance.now(); sfx("gh_carry"); } } else R.sticky.clear();
    sfx("spin_start");
    emit("roundStarted", { bet, ante: false, free_spin: free, free_round: false, buy });
    stopCount();
    if (!free) { shell.setWin(0); if (Number.isFinite(S.balance)) shell.setBalance(S.balance - cost); }
    shell.ticker.spin(free ? `Midday · ${S.freeSpinsLeft} left` : buy ? "The sun climbs…" : "The light moves…");
    startReels();
    const minSpin = sleep(T.minSpin * speed());
    shell.waiting(true);
    let r;
    try {
      [r] = await Promise.all([api("POST", buy ? "/game/v1/buy-feature" : "/game/v1/spin", { bet_amount: bet }, uuid()), minSpin]);
    } catch (err) {
      shell.waiting(false);
      S.lastAnswerAt = performance.now();
      await Promise.all(R.reels.map((reel, col) => landReel(col, Math.round(reel.pos), T.errorLand)));
      S.inFlight = false; setControls();
      if (err.code === "REALITY_CHECK_REQUIRED") { await realityCheck(err.details); return null; }
      if (Number.isFinite(S.balance)) shell.setBalance(S.balance);
      if (err.code === "INSUFFICIENT_FUNDS") await notEnoughCredit(cost);
      else say(`Round not played (${err.code || err.message})`);
      emit("error", { code: err.code || "CLIENT_ERROR", message: err.message });
      return null;
    } finally {
      shell.waiting(false);
    }
    S.lastAnswerAt = performance.now();
    const stake = buy ? cost : bet;
    await view.presentRound(r, { bet, stake });
    setBalance(Number(r.balance?.amount ?? r.balance ?? r.balance_after));
    S.freeSpinsLeft = Number(r.free_spins_left || 0);
    S.featureState = r.feature_state || null;
    if (!r.is_free_spin && r.free_spins_awarded > 0) { S.featureStake = stake; S.featureWin = Number(r.bonus_round_win ?? r.total_win); }
    else if (r.is_free_spin) S.featureWin = Number(r.bonus_round_win ?? S.featureWin + r.total_win);
    if (S.featureRun || S.freeSpinsLeft > 0) shell.featureHud({ left: S.freeSpinsLeft, win: S.featureWin, label: "Spins", winLabel: "Midday win" });
    emit("roundEnded", { round_ref: r.round_ref, bet, win: r.total_win, free_spin: r.is_free_spin, free_spins_left: S.freeSpinsLeft });
    S.inFlight = false; S.resultShown = false; setControls();
    Sound?.warmMusic?.();
    if (!S.musicOn) { S.musicOn = true; Sound?.startMusic?.(); }
    return r;
  }

  /** The board's half of a round (BoardView.presentRound): land the reels on the server's
   *  stops, replay the beams, then explain the win. A pure function of the payload. */
  async function presentRound(r, { bet, stake }) {
    // Land reels left to right. Anticipation only while the landed reels can still complete a
    // trigger and have not already (a pure function of what has landed; DESIGN §10).
    const need = S.rules.free_spins.scatters, slam = () => S.quickStop && shell.slamAllowed();
    const stickyKeys = new Set((r.sticky_in || []).map(([a, b]) => key(a, b)));
    let roses = 0;
    for (let col = 0; col < 6; col++) {
      const reelsLeft = 6 - col; // a reel shows at most one rose
      const could = roses >= need - 1 && roses < need && roses + reelsLeft >= need;
      // UKGC / ON: anticipation is shown in full even after a slam press (LuminaMotion grammar).
      if (could && !shell.anticipationSkippable()) S.quickStop = false;
      const anticipate = could && !slam();
      const dur = (slam() ? T.reelLandQuick : (anticipate ? T.reelLandAnticipate : T.reelLand) * speed()) + (slam() ? 0 : col * T.reelLandColExtra);
      if (!slam() && col > 0) await sleep((anticipate ? T.reelGapAnticipate : T.reelGap) * speed());
      R.anticipate = anticipate ? col : -1; kick();
      if (anticipate) shell.ticker.say("One more rose…");
      await landReel(col, r.stops[col], dur);
      sfx("reel_stop", { index: col });
      const here = [0, 1, 2, 3].filter((row) => r.matrix[row][col] === "ROSE" && !stickyKeys.has(key(row, col))).length;
      if (here) { roses += here; sfx("scatter_land", { n: roses, need }); }
    }
    if (R.anticipate >= 0) { R.anticipate = -1; kick(); }
    // The result is on the board; the beam is part of it (never skipped before it is shown).
    await playBeams(r);
    // The first beam of a visit gets one line of explanation over the board (no tap needed).
    if (r.beams?.length && !S.beamExplained) { S.beamExplained = true; shell.callout("The light turns every pane it crosses wild."); }
    S.resultShown = true; setControls();
    await presentWin(r, stake, bet);
  }

  // The shared ladder (LuminaMotion.BIG_WIN, × the stake), named in the glasshouse's voice (§11.4).
  const TIER_NAMES = { big: "Sunlit", mega: "Radiant", epic: "Solstice", legendary: "Zenith" };
  const TIER_SOUND = { big: "win_big", mega: "win_mega", epic: "win_epic", legendary: "win_epic", max: "max_win" };

  /** Ways and roses (DESIGN §11.2 steps 4-6): what paid, how much, then the count. */
  async function presentWin(r, stake, bet) {
    const total = Number(r.total_win || 0);
    // Win effects only when the round returns MORE than its stake where the market says so
    // (RTS 14F / AGCO 2.20). In free spins the feature's running total is the round.
    const roundWin = r.is_free_spin ? Math.max(total, Number(r.bonus_round_win || 0)) : total;
    const celebrate = shell.celebrates(roundWin, r.is_free_spin ? S.featureStake || bet : stake);
    if (!(total > 0) && !(r.free_spins_awarded > 0)) { say(S.freeSpinsLeft > 0 || r.is_free_spin ? `Midday · ${r.free_spins_left} left` : "The glass is warm."); return; }
    const cells = new Set();
    for (const w of r.way_wins || []) for (const [a, b] of w.positions) cells.add(key(a, b));
    if (r.scatter?.count >= S.rules.free_spins.scatters || r.scatter?.amount > 0) for (const [a, b] of r.scatter.positions) cells.add(key(a, b));
    // One tag per winning symbol, on its last reel (moved down a row if two would overlap).
    const used = new Set();
    const labels = (r.way_wins || []).map((w) => {
      const last = w.positions.filter(([, c]) => c === w.reels - 1).sort((a, b) => a[0] - b[0]);
      let [lr, lc] = last[0] || w.positions[w.positions.length - 1];
      for (const [a] of last) if (!used.has(key(a, lc))) { lr = a; break; }
      used.add(key(lr, lc));
      return { r: lr, c: lc, text: fmt(w.amount) };
    });
    if (r.scatter?.amount > 0) { const [a, b] = r.scatter.positions[0]; labels.push({ r: a, c: b, text: fmt(r.scatter.amount) }); }
    R.highlight = { cells, neutral: !celebrate, labels }; kick();
    const tier = celebrate ? M.tierFor(total / (r.is_free_spin ? bet : stake)) : null;
    const capped = (r.events || []).some((e) => /MAX_WIN_CAP/.test(e.type));
    if (celebrate && !S.quickStop) await sleep(ms("winHighlight"));
    const counted = countUp(total, !celebrate ? M.ms("neutralCredit") : tier ? T.countUpTier : M.countUpMs(total / bet, shell.motionSpeed()), celebrate);
    if (total > 0) say(celebrate ? `Sunlit: ${fmt(total)}` : `Credit: ${fmt(total)}`, true, celebrate);
    sfx(!celebrate ? "click" : total / bet >= 5 ? "win_land" : "win_small");
    // Big win and Full Bloom (the max win): the shared Lumina overlay (layers.md, Layer 2) in
    // the glasshouse's words and skin.
    if (celebrate && (tier || capped)) await shell.bigWin({ amount: total, bet: r.is_free_spin ? bet : stake, tiers: shell.ladder(TIER_NAMES),
      autoDismissMs: S.autoplay || S.freeSpinsLeft > 0 ? 1800 : 4000,
      finalTier: capped ? { key: "max", minX: Infinity, label: "Full Bloom", countMs: 0, fx: "motherlode", overlay: true } : null,
      hooks: { onTier: (t) => sfx(TIER_SOUND[t.key] || "win_big"), onTick: (v, of) => sfx("win_tick", { progress: of > 0 ? v / of : 1 }) } });
    await counted;
    if (r.free_spins_awarded > 0) {
      sfx("feature_award", { retrigger: r.is_free_spin });
      // A retrigger: "+N" flies into the spins readout, which then shows the new count.
      if (r.is_free_spin) { say(`More sun: +${r.free_spins_awarded} spins`, true, true); await shell.flyPlus(`+${r.free_spins_awarded}`); shell.featureHud({ left: Number(r.free_spins_left || 0), win: S.featureWin, label: "Spins", winLabel: "Midday win" }); }
      else { say(`The sun climbs: ${r.free_spins_awarded} free spins`, true, true); await sleep(T.featureAward * speed()); }
    }
  }
  let countTimer = 0, countDone = null;
  function countUp(to, dur, ticks = true) {
    stopCount();
    return new Promise((resolve) => {
      const t0 = performance.now();
      countDone = () => { countDone = null; shell.setWin(to); resolve(); };
      const tick = (now) => { const t = Math.min(1, (now - t0) / dur); shell.setWin(to * (1 - Math.pow(1 - t, 3))); if (t < 1 && ticks) sfx("win_tick", { progress: t }); if (t < 1 && !S.quickStop) countTimer = requestAnimationFrame(tick); else countDone?.(); };
      countTimer = requestAnimationFrame(tick);
    });
  }
  function stopCount() { cancelAnimationFrame(countTimer); countDone?.(); }
  // ── free spins: "Midday" (DESIGN §5, §11.3) ──────────────────────────────
  async function runFreeSpins() {
    if (S.freeSpinsLeft <= 0 || S.featureRun) return 0;
    S.featureRun = true;
    try { return await playFeature(); } finally { S.featureRun = false; shell.featureHud(null); showBet(); R.sticky.clear(); kick(); setControls(); }
  }
  async function playFeature() {
    shell.featureHud({ left: S.freeSpinsLeft, win: S.featureWin, label: "Spins", winLabel: "Midday win" });
    view.setTheme("feature");
    emit("featureState", { active: true, free_spins_left: S.freeSpinsLeft, bonus_win: S.featureWin });
    Sound?.setMusic?.("freeSpins");
    sfx("fs_intro");
    // The intro says what the feature is (A6): the spins and the one special rule. A tap or
    // Spin starts it; in autoplay it starts by itself.
    const resumed = S.resuming; S.resuming = false;
    const ttl = S.rules.free_spins.sticky_spins;
    await shell.panel({ kicker: resumed ? "Resuming" : "Midday", title: `${S.freeSpinsLeft} free spins`, line: `Lit panes stay lit for ${ttl === 2 ? "two" : ttl} more spins. More Glass Roses add spins.`, stats: [["Bet", fmt(S.bets[S.betIndex])], ["Lit panes", `${ttl} spins`]], auto: Boolean(S.autoplay) });
    let played = 0;
    while (S.freeSpinsLeft > 0 && !S.paused) {
      const r = await playRound({ auto: true });
      if (!r) break;
      played++;
      await sleep(T.betweenFreeSpins * speed());
    }
    view.setTheme("base");
    Sound?.setMusic?.("base");
    const total = S.featureWin, stake = S.featureStake || S.bets[S.betIndex];
    const celebrate = shell.celebrates(total, stake);
    if (celebrate) sfx("fs_outro");
    // The outro says what the feature paid, counted (plainly where the market forbids win
    // effects at or below the stake).
    if (!S.paused) await shell.panel({ kicker: "Evening", title: "Free spins complete", stats: [["Spins", String(played)], ["Bet", fmt(S.bets[S.betIndex])]], total, totalLabel: "Midday win", countX: total / S.bets[S.betIndex], count: celebrate, auto: Boolean(S.autoplay) });
    say(total > 0 ? (celebrate ? `Midday gave ${fmt(total)}` : `Credit: ${fmt(total)}`) : "Morning light.", total > 0, celebrate);
    emit("featureState", { active: false, free_spins_left: S.freeSpinsLeft, bonus_win: total });
    S.featureWin = 0; S.featureStake = 0;
    return total;
  }
  function stopAutoplay(why) {
    if (!S.autoplay) return;
    S.autoplay = null; setControls();
    if (why) say(`Autoplay stopped · ${why}`);
  }
  async function startAutoplay(n, limits) {
    if (S.autoplay || S.inFlight || S.paused || !shell.rule("autoplay_enabled", true)) return;
    const bet = S.bets[S.betIndex];
    const cap = shell.autoplayCap();
    const count = cap === null ? n : Math.min(n, cap);
    if (!(count > 0)) return;
    S.autoplay = { left: count, startBalance: S.balance, limits: { loss: Number(limits?.lossX || 0) * bet, win: Number(limits?.winX || 0) * bet, feature: Boolean(limits?.feature) } };
    setControls();
    while (S.autoplay && S.autoplay.left > 0) {
      if (S.autoplay.left !== Infinity) S.autoplay.left--;
      setControls();
      const r = await playRound({ auto: true });
      if (!r) { stopAutoplay(); break; }
      const featureTriggered = r.free_spins_awarded > 0;
      let roundWin = Number(r.total_win || 0);
      if (S.freeSpinsLeft > 0) roundWin = Math.max(roundWin, await runFreeSpins());
      const a = S.autoplay; if (!a) break;
      if (a.limits.loss > 0 && a.startBalance - S.balance >= a.limits.loss - 1e-9) { stopAutoplay("loss limit reached"); break; }
      if (a.limits.win > 0 && roundWin >= a.limits.win - 1e-9) { stopAutoplay(`win of ${fmt(roundWin)}`); break; }
      if (a.limits.feature && featureTriggered) { stopAutoplay("Free Spins won"); break; }
      await sleep(shell.speed() === "turbo" ? T.autoplayGapTurbo : T.autoplayGap);
    }
    stopAutoplay();
  }
  async function notEnoughCredit(cost) {
    shell.setPhase("broke");
    await shell.notice("Not enough credit", `<p>Your balance is ${fmt(S.balance)} and this costs ${fmt(cost)}. Lower the bet with − or the Bet readout, or add funds at the casino.</p>`);
    setControls();
  }

  // ── controls (the shell calls these) ─────────────────────────────────────
  async function onSpinPress() {
    Sound?.unlock?.();
    const slamNow = () => shell.slamAllowed() && (R.anticipate < 0 || shell.anticipationSkippable());
    if (S.autoplay) { stopAutoplay("stopped"); if (S.resultShown || slamNow()) S.quickStop = true; return; }
    if (S.inFlight || S.featureRun) {
      // Never a new round mid-round or mid-feature. A press shows the result sooner only where
      // slam stop is allowed; elsewhere it may only skip presentation AFTER the result is shown.
      // Reels in anticipation are never cut short where the market says so (UKGC, ON).
      if (S.inFlight && (S.resultShown || slamNow())) S.quickStop = true;
      return;
    }
    // A feature left unfinished (a reload mid-feature) resumes from its intro panel.
    if (S.freeSpinsLeft > 0) { S.resuming = true; await runFreeSpins(); return; }
    const r = await playRound();
    if (r && S.freeSpinsLeft > 0) await runFreeSpins();
  }
  async function onBuy() {
    Sound?.unlock?.();
    if (S.inFlight || S.featureRun || S.autoplay || S.paused || S.freeSpinsLeft > 0 || !shell.rule("buy_feature_enabled", true)) return;
    const bet = S.bets[S.betIndex], price = Math.round(bet * S.rules.buy.cost_x * 100) / 100;
    const cap = Number(shell.rule("max_stake", 0)) || 0;
    if (cap > 0 && price > cap + 1e-9) { shell.ticker.flash(`The maximum stake here is ${fmt(cap)}`, "info", 1800); return; }
    const choice = await shell.ask("Buy free spins", `<p><b>${S.rules.free_spins.award} free spins</b> for <b>${fmt(price)}${S.currency ? ` ${S.currency}` : ""}</b>: ${S.rules.buy.cost_x}× your bet of ${fmt(bet)}.</p><p>Return to player of the buy: ${Number(S.variant.buy_free_spins_percent).toFixed(2)}%.</p>`,
      [{ reason: "cancel", label: "Cancel" }, { reason: "buy", label: `Buy for ${fmt(price)}`, primary: true }]);
    if (choice !== "buy") return;
    sfx("ui_confirm");
    const r = await playRound({ buy: true });
    if (r && S.freeSpinsLeft > 0) await runFreeSpins();
  }
  function showBet() { shell.setBets(S.bets, S.betIndex); shell.setBet(S.bets[S.betIndex]); syncBuy(); }
  /** The buy is a stake (UKGC guidance): hidden in place where the market's cap is below its price at this bet. */
  function syncBuy() {
    const b = shell.el.buy; if (!b || !S.rules) return;
    const cap = Number(shell.rule("max_stake", 0)) || 0, price = S.bets[S.betIndex] * S.rules.buy.cost_x;
    const off = !shell.rule("buy_feature_enabled", true) || (cap > 0 && price > cap + 1e-9);
    b.classList.toggle("is-off", off); b.toggleAttribute("aria-hidden", off); b.tabIndex = off ? -1 : 0;
  }
  function setBetIndex(i) {
    if (S.inFlight || S.featureRun || S.autoplay || i === S.betIndex || i < 0 || i >= S.bets.length) return;
    const cap = Number(shell.rule("max_stake", 0)) || 0;
    if (cap > 0 && S.bets[i] > cap + 1e-9) { shell.ticker.flash(`The maximum stake here is ${fmt(cap)}`, "info", 1800); return; }
    S.betIndex = i; sfx("bet_change"); showBet();
  }

  /** Paytable and rules from rules.json (the file the engine pays from): displayed pays = paid pays. */
  const icons = new Map();
  function icon(sym) {
    if (!icons.has(sym)) { const cv = document.createElement("canvas"); cv.width = cv.height = 52; drawPane(cv.getContext("2d"), sym, 52); icons.set(sym, cv.toDataURL()); }
    return icons.get(sym);
  }
  const ico = (sym) => `<img src="${icon(sym)}" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px">`;
  const money = (x) => fmt(Math.round(x * 100) / 100); // the engine rounds each symbol's win to cents
  function rulesHtml() {
    if (!S.rules) return "";
    const r = S.rules, bet = S.bets[S.betIndex], v = S.variant;
    const rows = r.paying.map((sym) => `<tr><td>${ico(sym)}${NAMES[sym]}</td>${r.paytable[sym].map((x) => `<td>${money(x * bet)}</td>`).join("")}</tr>`).join("");
    return `
      <p>6 reels, 4 rows, 4,096 ways. Total bet ${fmt(bet)}. A symbol pays when it lands on 3 or more adjacent reels from the left, in any row. Pays below are per way at this bet; the number of ways is the product of how many of that symbol (or wild panes) each reel shows. Every symbol's win is paid and they add up.</p>
      <table><thead><tr><th>Symbol</th><th>3 reels</th><th>4 reels</th><th>5 reels</th><th>6 reels</th></tr></thead><tbody>${rows}</tbody></table>
      <p>${ico("LENS")}<b>The Sun Lens</b> lands on reel 1 only and sends a beam of light to the right along its row. ${ico("MIRROR_RISE")}<b>Mirrors</b> turn the beam up or down, in the direction their glass slants. The beam ends where it leaves the board.</p>
      <p><b>Every pane the beam crosses turns wild</b> for that spin and stands in for every symbol, except the Sun Lens itself and the Glass Rose. A way made only of wild panes pays as the Hummingbird. ${ico("CLEAR")}<b>Clear Panes</b> pay nothing, but turn wild when lit.</p>
      <p>${ico("ROSE")}<b>The Glass Rose</b> pays anywhere: 3 = ${money(r.scatter.pays[0] * bet)}, 4 = ${money(r.scatter.pays[1] * bet)}, 5 = ${money(r.scatter.pays[2] * bet)}, 6 = ${money(r.scatter.pays[3] * bet)}. 3 or more award ${r.free_spins.award} free spins at the same bet; 3 or more during free spins add ${r.free_spins.retrigger}.</p>
      <p><b>Free spins.</b> A pane lit during free spins stays lit, and wild, for the next ${r.free_spins.sticky_spins} free spins, then fades; a beam crossing it again renews it. Whatever lands under a lit pane is ignored, and a beam passes straight through it. Free spins use their own reels.</p>
      <p><b>Buy free spins</b> (where available): ${r.free_spins.award} free spins for ${r.buy.cost_x}× the bet. Return to player of the buy: ${Number(v.buy_free_spins_percent).toFixed(2)}%.</p>
      <p>Maximum win: ${r.max_win_x.toLocaleString()}× the total bet for a spin (or a buy) and the free spins it awards; the feature ends when it is reached.</p>
      <p>Return to player: ${Number(v.theoretical_percent).toFixed(2)}%, measured by simulation of 100 million rounds. Over a short session results vary widely.</p>
      <p>Autoplay stops when you press Stop, when the spins run out, when a round can't be played, or when a stop condition you chose is met.</p>`;
  }

  async function realityCheck(details) {
    stopAutoplay();
    emit("realityCheck", details || {});
    const text = details ? `You have played for ${Math.round((details.elapsed_ms || 0) / 60000)} minutes. Wagered ${fmt(details.wagered ?? details.total_bet ?? 0)}, won ${fmt(details.won ?? details.total_win ?? 0)}.` : "Time for a break?";
    const choice = await shell.ask("Session reminder", `<p>${text}</p>`, [{ reason: "exit", label: "Exit game" }, { reason: "continue", label: "Keep playing", primary: true }]);
    if (choice !== "continue") { S.paused = true; emit("exitRequested", { reason: "reality_check" }); say("Session ended"); return; }
    await api("POST", "/game/v1/reality-check/ack", {}, uuid()).catch(() => {});
    say("Morning light.");
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  shell = window.LuminaShell.mount({
    game: "glasshouse", stage: $("ghStage"), haptics: Haptics,
    features: { buy: true, ante: false, autoplay: true, turbo: true, stop: true },
    fmt,
    build: { title: "Glasshouse" },
    particles: { gold: "#ffe38a", goldBright: "#fffaf0", goldDeep: "#c98a2b", diamond: "#fff3cf", diamondEdge: "#1e2124", sparks: ["#fffaf0", "#ffe38a", "#f3c9bc"] },
    // The game's skin for the themed slots (layers.md, Layer 2): brass fittings, cream glass,
    // charcoal lead. The system chrome itself is the shell's and is never restyled here.
    skin: {
      "--skin-title-font": "var(--display)", "--skin-title-weight": "400", "--skin-amount-font": "var(--num)", "--skin-accent": "#ffe38a",
      "--skin-slot-bg": "linear-gradient(180deg, #fffaf0, #f4e8d2)", "--skin-slot-ink": "#1e2124", "--skin-slot-edge": "inset 0 0 0 2px #1e2124, 0 2px 0 rgba(0, 0, 0, 0.45)",
      "--skin-panel-bg": "linear-gradient(180deg, #fffaf0, #f4e8d2)", "--skin-panel-ink": "#1e2124", "--skin-panel-muted": "#5b5146",
      "--skin-panel-title": "#1e2124", "--skin-panel-total": "#8a1f30", "--skin-panel-radius": "6px",
      "--skin-panel-frame": "0 0 0 2px #1e2124, 0 0 0 6px #b08d57, 0 0 0 8px #1e2124, 0 18px 48px rgba(0, 0, 0, 0.55)",
      "--skin-tier-big": "#ffe38a", "--skin-tier-mega": "#f0b856", "--skin-tier-epic": "#fff3cf", "--skin-tier-legendary": "#f3c9bc", "--skin-tier-max": "#ffffff",
      "--skin-win-hi": "#fffaf0", "--skin-win": "#ffe38a", "--skin-win-deep": "#c98a2b",
      "--skin-bigwin-scrim": "rgba(30, 33, 36, 0.84)"
    },
    on: {
      spin: () => onSpinPress(),
      buy: () => onBuy(),
      betStep: (d) => setBetIndex(S.betIndex + d),
      betIndex: (i) => setBetIndex(i),
      autoplay: (n, limits) => startAutoplay(n, limits),
      autoplayStop: () => stopAutoplay("stopped"),
      // DE panic button (the shell asked first): stop now; the casino locks play 24 h.
      panic: () => { stopAutoplay(); S.paused = true; emit("exitRequested", { reason: "panic" }); say("Play paused for 24 hours"); },
      info: () => rulesHtml(),
      pref: () => { R.sprites.clear(); kick(); }
    }
  });

  // The board behind the shared BoardView seam (client/shell/board-view.js): the round flow
  // above talks to the board only through these five calls.
  let boardRO = null;
  const view = window.LuminaBoardView.define("glasshouse", {
    mount() { resize(); boardRO = new ResizeObserver(() => view.resize()); boardRO.observe(el.board); },
    resize() { resize(); },
    presentRound: (payload, t = {}) => presentRound(payload, { bet: t.bet ?? S.bets[S.betIndex], stake: t.stake ?? t.bet ?? S.bets[S.betIndex] }),
    // The feature scene: dawn turns to full midday sun, the panes glow brighter.
    setTheme(name) { document.body.classList.toggle("midday", name === "feature"); },
    destroy() { boardRO?.disconnect(); boardRO = null; stopCount(); cancelAnimationFrame(R.raf); R.raf = -1; }
  });

  async function boot() {
    view.mount(el.board);
    const params = new URLSearchParams(location.search);
    const lt = params.get("lt");
    const KEY = "glasshouse.session";
    const rulesP = fetch("rules.json", { credentials: "same-origin", mode: "cors" }).then((r) => r.json()); // matches the HTML preload
    let session;
    if (lt) {
      S.token = lt;
      try {
        const early = window.__glasshouseEarlySession ? await window.__glasshouseEarlySession.catch(() => null) : null;
        window.__glasshouseEarlySession = null;
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
    await Promise.race([document.fonts?.load?.('400 32px "GH Display"') ?? Promise.resolve(), sleep(1500)]).catch(() => {});
    S.variant = S.rules.rtp_profiles.find((p) => p.game_id === session.game?.code) || S.rules.rtp_profiles[0];
    S.currency = session.currency;
    shell.setCurrency(S.currency);
    shell.applyMarket(session.regulatory || {});
    shell.setRtp(S.variant.theoretical_percent);
    S.minRoundMs = Number(shell.rule("min_round_ms", 0)) || 0;
    S.bets = session.allowed_bets.slice().sort((a, b) => a - b);
    const resumeBet = session.resume?.bet_amount;
    S.betIndex = Math.max(0, S.bets.indexOf(resumeBet ?? S.bets[Math.min(2, S.bets.length - 1)]));
    S.freeSpinsLeft = Number(session.free_spins_left || 0);
    S.featureWin = Number(session.resume?.feature?.bonus_round_win || 0);
    S.featureState = session.resume?.feature?.feature_state || null;
    S.featureStake = S.bets[S.betIndex];
    setBalance(Number(session.balance?.amount ?? session.balance));
    showBet(); shell.setWin(0);
    const set = S.rules.strip_sets[S.variant.strips], strips = S.freeSpinsLeft > 0 ? set.free : set.base;
    R.reels = strips.map((strip) => ({ strip, pos: Math.floor(Math.random() * strip.length), anim: null, spinning: false, speed: 0 }));
    if (S.freeSpinsLeft > 0) showSticky(S.featureState);
    await new Promise((res) => requestAnimationFrame(() => { draw(performance.now()); res(); }));
    if (Bridge?.connect?.(session.embed?.allowed_hosts)) Bridge.ready({ game: "glasshouse", currency: S.currency, balance: S.balance });
    document.body.classList.add("app-ready");
    performance.mark("app-ready");
    const startAudio = () => { removeEventListener("pointerdown", startAudio, true); removeEventListener("keydown", startAudio, true); Sound?.preload?.(); Sound?.unlock?.(); };
    addEventListener("pointerdown", startAudio, true);
    addEventListener("keydown", startAudio, true);
    if (S.freeSpinsLeft > 0) { shell.featureHud({ left: S.freeSpinsLeft, win: S.featureWin, label: "Spins", winLabel: "Midday win" }); view.setTheme("feature"); say(`Midday · ${S.freeSpinsLeft} left · tap Spin`); }
    else shell.ticker.idle(["Morning light.", "The glass is warm.", "Dew on the panes."]);
    setControls();
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
