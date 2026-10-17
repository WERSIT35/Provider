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

  const fmt = (n) => (Number.isFinite(n) ? n.toFixed(2) : "—");
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

  // ── symbols: vector art, drawn once per cell size into sprites ──────────────
  const COLORS = { CHERRY: "#e5334b", LEMON: "#f7dc3b", ORANGE: "#f6922e", PLUM: "#8a4fd3", GRAPE: "#6b3bb3", MELON: "#3fb34f", BELL: "#f4c542", BAR: "#e9e4d8", SEVEN: "#ff3b3b", WILD: "#ffd36b", SCATTER: "#4fd8ff" };
  function drawSymbol(g, sym, s) {
    const c = s / 2;
    g.save();
    g.lineJoin = "round";
    g.shadowColor = "rgba(0,0,0,0.45)"; g.shadowBlur = s * 0.06; g.shadowOffsetY = s * 0.03;
    const circle = (x, y, r, fill) => { g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = fill; g.fill(); };
    const shine = (x, y, r) => { g.shadowColor = "transparent"; circle(x, y, r, "rgba(255,255,255,0.45)"); };
    switch (sym) {
      case "CHERRY":
        g.strokeStyle = "#3c8a2e"; g.lineWidth = s * 0.05;
        g.beginPath(); g.moveTo(c * 0.75, c * 1.15); g.quadraticCurveTo(c * 0.9, c * 0.45, c * 1.35, c * 0.35); g.moveTo(c * 1.3, c * 1.2); g.quadraticCurveTo(c * 1.25, c * 0.6, c * 1.35, c * 0.35); g.stroke();
        circle(c * 0.72, c * 1.32, s * 0.2, COLORS.CHERRY); circle(c * 1.3, c * 1.38, s * 0.2, "#c91f38");
        shine(c * 0.62, c * 1.22, s * 0.05); shine(c * 1.2, c * 1.28, s * 0.05); break;
      case "LEMON":
        g.beginPath(); g.ellipse(c, c, s * 0.36, s * 0.26, -0.3, 0, Math.PI * 2); g.fillStyle = COLORS.LEMON; g.fill(); shine(c * 0.82, c * 0.82, s * 0.06); break;
      case "ORANGE":
        circle(c, c * 1.05, s * 0.32, COLORS.ORANGE);
        g.fillStyle = "#3c8a2e"; g.beginPath(); g.ellipse(c * 1.18, c * 0.5, s * 0.12, s * 0.06, -0.5, 0, Math.PI * 2); g.fill(); shine(c * 0.8, c * 0.85, s * 0.07); break;
      case "PLUM":
        g.beginPath(); g.ellipse(c, c * 1.05, s * 0.28, s * 0.34, 0.2, 0, Math.PI * 2); g.fillStyle = COLORS.PLUM; g.fill(); shine(c * 0.82, c * 0.8, s * 0.06); break;
      case "GRAPE":
        for (const [x, y] of [[0.75, 0.7], [1, 0.7], [1.25, 0.7], [0.87, 0.95], [1.13, 0.95], [0.75, 1.2], [1, 1.2], [1.25, 1.2], [1, 1.45]]) circle(c * x, c * y, s * 0.11, COLORS.GRAPE);
        shine(c * 0.72, c * 0.64, s * 0.035); break;
      case "MELON":
        g.beginPath(); g.arc(c, c * 0.8, s * 0.38, 0, Math.PI); g.closePath(); g.fillStyle = "#2e8b3d"; g.fill();
        g.beginPath(); g.arc(c, c * 0.8, s * 0.32, 0, Math.PI); g.closePath(); g.fillStyle = "#ff5d6c"; g.fill();
        g.shadowColor = "transparent"; for (const x of [0.75, 1, 1.25]) circle(c * x, c * 1.05, s * 0.025, "#1d1d1d"); break;
      case "BELL":
        g.fillStyle = COLORS.BELL; g.beginPath(); g.moveTo(c * 0.45, c * 1.35); g.quadraticCurveTo(c * 0.55, c * 0.4, c, c * 0.38); g.quadraticCurveTo(c * 1.45, c * 0.4, c * 1.55, c * 1.35); g.closePath(); g.fill();
        circle(c, c * 1.45, s * 0.07, "#c98f1c"); shine(c * 0.8, c * 0.75, s * 0.05); break;
      case "BAR":
        g.fillStyle = "#1c1c1c"; roundRect(g, s * 0.12, s * 0.33, s * 0.76, s * 0.34, s * 0.06); g.fill();
        g.shadowColor = "transparent"; g.fillStyle = COLORS.BAR; g.font = `900 ${s * 0.24}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("BAR", c, c * 1.02); break;
      case "SEVEN":
        g.fillStyle = COLORS.SEVEN; g.strokeStyle = "#ffe5a0"; g.lineWidth = s * 0.03; g.font = `900 ${s * 0.72}px Georgia, serif`; g.textAlign = "center"; g.textBaseline = "middle";
        g.strokeText("7", c, c * 1.06); g.fillText("7", c, c * 1.06); break;
      case "WILD":
        star(g, c, c * 0.95, s * 0.42, s * 0.2, 5); g.fillStyle = COLORS.WILD; g.fill();
        g.shadowColor = "transparent"; g.fillStyle = "#3a1d00"; g.font = `900 ${s * 0.17}px system-ui, sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("WILD", c, c * 1.0); break;
      case "SCATTER":
        g.fillStyle = COLORS.SCATTER; g.beginPath(); g.moveTo(c, c * 0.3); g.lineTo(c * 1.62, c * 0.85); g.lineTo(c, c * 1.72); g.lineTo(c * 0.38, c * 0.85); g.closePath(); g.fill();
        g.shadowColor = "transparent"; g.fillStyle = "rgba(255,255,255,0.5)"; g.beginPath(); g.moveTo(c, c * 0.3); g.lineTo(c * 1.25, c * 0.85); g.lineTo(c, c * 1.72); g.closePath(); g.fill();
        g.fillStyle = "#06263a"; g.font = `900 ${s * 0.12}px system-ui, sans-serif`; g.textAlign = "center"; g.fillText("SCATTER", c, c * 1.92); break;
    }
    g.restore();
  }
  function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function star(g, x, y, R, r, n) { g.beginPath(); for (let i = 0; i < n * 2; i++) { const a = (Math.PI * i) / n - Math.PI / 2; const d = i % 2 ? r : R; g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } g.closePath(); }

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
  function draw(now) {
    const g = R.ctx, cell = R.cell, ox = (R.w - cell * 5) / 2, oy = (R.h - cell * 3) / 2;
    g.fillStyle = "#0d0816"; g.fillRect(0, 0, R.w, R.h);
    for (let col = 0; col < 5; col++) {
      const strip = S.rules.reels[col], L = strip.length, reel = R.reels[col];
      const x = ox + col * cell;
      g.fillStyle = col % 2 ? "#150d22" : "#130b1f"; g.fillRect(x, oy, cell, cell * 3);
      g.save(); g.beginPath(); g.rect(x, oy, cell, cell * 3); g.clip();
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      for (let k = -1; k <= 3; k++) {
        const sym = strip[(((base + k) % L) + L) % L];
        const y = oy + (k - frac) * cell;
        const sp = sprite(sym), pad = (cell - sp.width) / 2;
        const lit = !R.highlight || R.highlight.cells.has(`${k},${col}`) || reel.anim || reel.spinning;
        g.globalAlpha = lit ? 1 : 0.32;
        if (reel.spinning && !reduceMotion?.matches) { g.globalAlpha = 0.85; g.drawImage(sp, x + pad, y + pad, sp.width, sp.height * 1.0); }
        else g.drawImage(sp, x + pad, y + pad);
      }
      g.restore(); g.globalAlpha = 1;
    }
    // Win line (one at a time), over the board.
    if (R.highlight?.line) {
      g.save(); g.lineWidth = Math.max(2, cell * 0.06); g.strokeStyle = "rgba(255, 224, 138, 0.95)"; g.shadowColor = "rgba(255, 190, 80, 0.9)"; g.shadowBlur = cell * 0.15;
      g.beginPath(); R.highlight.line.forEach(([row, col], i) => { const px = ox + (col + 0.5) * cell, py = oy + (row + 0.5) * cell; i ? g.lineTo(px, py) : g.moveTo(px, py); }); g.stroke(); g.restore();
    }
    // Frame between reels.
    g.strokeStyle = "rgba(255, 214, 140, 0.18)"; g.lineWidth = 1 * R.dpr;
    for (let col = 1; col < 5; col++) { g.beginPath(); g.moveTo(ox + col * cell, oy); g.lineTo(ox + col * cell, oy + cell * 3); g.stroke(); }
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
    const x = total / bet;
    const tier = x >= 50 ? ["EPIC WIN", "win_epic"] : x >= 25 ? ["MEGA WIN", "win_mega"] : x >= 10 ? ["BIG WIN", "win_big"] : null;
    countUp(total, tier ? 300 : 500 * speed());
    if (total > 0) say(`WIN ${fmt(total)}${r.multiplier_applied > 1 ? ` (×${r.multiplier_applied})` : ""}`, true);
    sfx(x >= 5 ? "win_land" : total > 0 ? "win_small" : "click");
    if (tier) await celebrate(tier[0], total, tier[1]);
    // Walk the winning lines once (skipped by quick stop / turbo / autoplay pace).
    if (!S.quickStop && !S.turbo && (r.line_wins || []).length > 1) {
      for (const w of r.line_wins.slice(0, 6)) { if (S.quickStop) break; R.highlight = { cells: new Set(w.positions.map((p) => `${p.row},${p.col}`)), line: S.rules.lines.patterns[w.line - 1].map((row, col) => [row, col]) }; kick(); await sleep(420); }
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
    const tick = (now) => { const t = Math.min(1, (now - t0) / ms); el.win.textContent = fmt(to * (1 - Math.pow(1 - t, 3))); if (t < 1 && !S.quickStop) countTimer = requestAnimationFrame(tick); else el.win.textContent = fmt(to); };
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
  const showBet = () => { el.bet.textContent = fmt(S.bets[S.betIndex]); el.betDown.disabled = S.betIndex === 0 || S.inFlight; el.betUp.disabled = S.betIndex === S.bets.length - 1 || S.inFlight; if (el.info.open) renderRules(); };
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
