/*
 * Clockwork Menagerie: the player client (board + round lifecycle) on the multi-game platform.
 * games/clockwork/DESIGN.md is the specification (section numbers below refer to it).
 *
 * - Server-authoritative: every outcome comes from the RGS (/game/v1/*). A round is a list of
 *   boards (`boards[]`: the spin, then the Wound Wild respins, §4); each board's reels land on
 *   the server's own `stops` on the real strips (rules.json, the file the engine pays from); a
 *   wound reel has stop null and shows the wild. The client never computes a win, a wild or a
 *   multiplier: it replays `wound`, `line_wins` and `scatter` per board. Visuals never feed back.
 * - The Lumina Shell (/play/shell/shell.js) owns every control, readout and dialog; this file
 *   owns the board (BoardView) and tells the shell what is happening. Market rules come from
 *   the session's regulatory profile through the shell.
 * - Every duration comes from the shared motion table (/play/shell/motion.js): the grammar rows
 *   (linesAll, linePerLine, neutralCredit) and this game's block.
 * - Art: generated images by the game's owner (assets/ART.md), drawn once per size into
 *   sprites; the canvas loop runs only while something moves; no layout ever moves the board.
 */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const el = { canvas: $("reels"), board: $("board") };
  const Sound = window.Sound;
  const M = window.LuminaMotion;
  const T = window.LuminaMotion.game("clockwork");
  // Clockwork's own events on top of the shared engine's (its sounds: audio/manifest.json).
  Sound?.defineEvents?.({
    cw_wind: { minGap: 120, voice: () => ({ key: "cw_wind", bus: "sfx", db: -2 }) },
    cw_tick: { minGap: 40, voice: (o) => ({ key: "cw_tick", bus: "sfx", rate: Sound.util.semis(Math.min(8, ((Number(o.mult) || 2) - 2) * 2)), jitter: false }) },
    cw_unwind: { minGap: 120, voice: () => ({ key: "cw_unwind", bus: "sfx", db: -4 }) }
  });
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
  /** A game duration at the player's speed; a Stop cuts it to its quick-stop share. */
  const gms = (name) => (S.quickStop ? T[name] * T.turbo * 0.5 : T[name] * speed());

  // ── haptics (touch devices only, off with reduced motion, player can switch it off) ──
  const Haptics = (() => {
    const supported = typeof navigator.vibrate === "function" && window.matchMedia?.("(pointer: coarse)").matches === true;
    let on = true;
    try { on = localStorage.getItem("vx.haptics") !== "0"; } catch { /* default on */ }
    const P = { spin_start: 8, reel_stop: 4, scatter_land: 16, cw_wind: [12, 30, 12], feature_award: [30, 50, 30, 50, 60], win_big: [40, 60, 40], win_mega: [50, 60, 50, 60, 70], win_epic: [60, 50, 60, 50, 120] };
    return {
      supported,
      get on() { return on; },
      set(v) { on = Boolean(v); try { localStorage.setItem("vx.haptics", on ? "1" : "0"); } catch { /* not remembered */ } },
      onEvent(name) { const p = P[name]; if (p !== undefined && supported && on && !reduceMotion?.matches && !document.hidden) { try { navigator.vibrate(p); } catch { /* blocked */ } } }
    };
  })();

  let shell = null;
  function say(text, win = false, celebrate = true) { if (!shell) return; win ? shell.ticker.win(text, celebrate) : shell.ticker.say(text); }

  // ── art (DESIGN §2): one image per symbol, the music box opens when it counts ──
  const NAMES = { OWL: "Brass Owl", FOX: "Clockwork Fox", HARE: "Tin Hare", TORTOISE: "Jewelled Tortoise", GEAR: "Gear", SPRING: "Spring", NUT: "Nut", SCREW: "Screw", WRENCH: "Wrench", KEY: "Wind-up Key", BOX: "Music Box" };
  const FILES = { OWL: "owl", FOX: "fox", HARE: "hare", TORTOISE: "tortoise", GEAR: "gear", SPRING: "spring", NUT: "nut", SCREW: "screw", WRENCH: "wrench", KEY: "key", BOX: "box", BOX_OPEN: "box_open", WILD: "wild_reel" };
  const IMG = {};
  const loadArt = () => Promise.all(Object.entries(FILES).map(([k, f]) => new Promise((res) => {
    const im = new Image(); im.decoding = "async"; im.onload = im.onerror = () => res(); im.src = `assets/art/${f}.webp`; IMG[k] = im;
  })));
  const TEAL = "92,230,210", GOLD = "#ffd98a", INK = "#1a120c";
  /** One symbol in a square of `s` px, with its shadow on the glass. */
  function drawSymbol(g, sym, s) {
    const im = IMG[sym];
    if (!im || !im.naturalWidth) return;
    const k = sym === "BOX" || sym === "BOX_OPEN" ? 0.9 : 0.84;
    const f = Math.min((s * k) / im.naturalWidth, (s * k) / im.naturalHeight), w = im.naturalWidth * f, h = im.naturalHeight * f;
    g.save(); g.shadowColor = "rgba(0,0,0,0.6)"; g.shadowBlur = s * 0.06; g.shadowOffsetY = s * 0.03;
    g.drawImage(im, (s - w) / 2, (s - h) / 2, w, h); g.restore();
  }
  window.__luminaSymbols = { get ids() { return Object.keys(NAMES); }, render(id, px) { const c = document.createElement("canvas"); c.width = c.height = px; drawSymbol(c.getContext("2d"), id, px); return c; } };

  // ── renderer (BoardView) ─────────────────────────────────────────────────
  const R = {
    ctx: el.canvas.getContext("2d"), w: 0, h: 0, dpr: 1, cell: 0, gap: 0, step: 0, ox: 0, oy: 0, sprites: new Map(),
    reels: [],          // { strip, pos (cells, fractional), anim, spinning, speed }
    wound: new Map(),   // reel → { n, mode: "turns"|"mult", at (wind start), tickAt, outAt }
    highlight: null,    // { cells: Set, neutral, lines: [[[r, c]…]], labels: [{ r, c, text }] }
    anticipate: -1,
    raf: 0
  };
  const key = (r, c) => `${r},${c}`;
  // Probes (tools/probes/clockwork-client.mjs): what the board is showing, read-only.
  window.__cwBoard = { get wound() { return [...R.wound].map(([c, w]) => [c, w.n, w.mode]); }, get highlighted() { return Boolean(R.highlight); }, get moving() { return R.reels.some((r) => r.anim || r.spinning); } };
  function resize() {
    const box = el.board.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(box.width * dpr)), h = Math.max(1, Math.round(box.height * dpr));
    if (w === R.w && h === R.h && dpr === R.dpr) return;
    R.w = el.canvas.width = w; R.h = el.canvas.height = h; R.dpr = dpr;
    const unit = Math.min(w / 5, h / 3), pad = unit * 0.05;
    R.gap = unit * 0.04;
    R.cell = Math.min((w - 2 * pad - 4 * R.gap) / 5, (h - 2 * pad - 2 * R.gap) / 3);
    R.step = R.cell + R.gap;
    R.ox = (w - 5 * R.cell - 4 * R.gap) / 2; R.oy = (h - 3 * R.cell - 2 * R.gap) / 2;
    R.sprites.clear();
    kick();
  }
  function sprite(sym) {
    let sp = R.sprites.get(sym);
    if (!sp) { const s = Math.max(8, Math.ceil(R.cell)); sp = document.createElement("canvas"); sp.width = sp.height = s; drawSymbol(sp.getContext("2d"), sym, s); R.sprites.set(sym, sp); }
    return sp;
  }
  const colX = (c) => R.ox + c * R.step;
  const rowY = (r) => R.oy + r * R.step;
  const centre = (r, c) => [colX(c) + R.cell / 2, rowY(r) + R.cell / 2];
  const cellAt = (reel, k) => { const st = reel.strip, L = st.length, base = Math.floor(reel.pos); return st[(((base + k) % L) + L) % L]; };
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const rr = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h); };

  /** A wound reel: the wild column behind a teal glow, its gauge (base: respins left) or ×N (free spins). */
  function drawWound(g, c, w, now) {
    const x = colX(c), y = R.oy, h = 3 * R.cell + 2 * R.gap, cell = R.cell;
    const a = calm() ? 1 : clamp01((now - w.at) / Math.max(1, T.wind));
    const out = w.outAt ? clamp01((now - w.outAt) / Math.max(1, calm() ? 1 : T.unwind)) : 0;
    const vis = a * (1 - out);
    if (vis <= 0) return;
    g.save(); g.globalAlpha = vis;
    rr(g, x, y, cell, h, cell * 0.12); g.fillStyle = `rgba(${TEAL},0.12)`; g.fill();
    g.lineWidth = Math.max(2, cell * 0.03); g.strokeStyle = `rgba(${TEAL},0.9)`;
    if (!calm()) { g.shadowColor = `rgba(${TEAL},0.8)`; g.shadowBlur = cell * 0.18; }
    g.stroke(); g.shadowBlur = 0;
    const im = IMG.WILD;
    if (im?.naturalWidth) {
      const sc = 0.94 + 0.06 * (1 - Math.pow(1 - a, 3));
      const f = Math.min((cell * 0.98) / im.naturalWidth, (h * 0.97) / im.naturalHeight) * sc, iw = im.naturalWidth * f, ih = im.naturalHeight * f;
      g.drawImage(im, x + (cell - iw) / 2, y + (h - ih) / 2, iw, ih);
    }
    // The wind: a flash of light on the column as the key turns.
    if (a < 1) { const gr = g.createRadialGradient(x + cell / 2, y + h / 2, 0, x + cell / 2, y + h / 2, h * 0.6); gr.addColorStop(0, `rgba(255,255,255,${0.85 * (1 - a)})`); gr.addColorStop(1, `rgba(${TEAL},0)`); g.fillStyle = gr; g.fillRect(x - cell * 0.2, y, cell * 1.4, h); }
    // The badge: a brass disc at the foot of the column.
    const tick = w.tickAt && !calm() ? clamp01((now - w.tickAt) / Math.max(1, T.multTick)) : 1;
    const bs = 1 + 0.2 * (1 - tick), cx = x + cell / 2, cy = y + h - cell * 0.2, br = cell * 0.17 * bs;
    g.beginPath(); g.arc(cx, cy, br, 0, Math.PI * 2); g.fillStyle = "rgba(26,18,12,0.94)"; g.fill();
    g.lineWidth = Math.max(1.5, cell * 0.025); g.strokeStyle = GOLD; g.stroke();
    if (w.mode === "mult") {
      g.fillStyle = "#ffe7b0"; g.font = `600 ${Math.round(cell * 0.17 * bs)}px "CW Num", "Arial Narrow", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(`×${w.n}`, cx, cy + cell * 0.01);
    } else {
      const turns = Number(S.rules?.wild?.respins || 2);
      for (let i = 0; i < turns; i++) { const px = cx + (i - (turns - 1) / 2) * br * 0.9; g.beginPath(); g.arc(px, cy, br * 0.26, 0, Math.PI * 2); g.fillStyle = i < w.n ? `rgb(${TEAL})` : "rgba(255,231,176,0.25)"; g.fill(); }
    }
    g.restore();
  }

  function draw(now) {
    const g = R.ctx, cell = R.cell;
    g.clearRect(0, 0, R.w, R.h);
    const hl = R.highlight;
    // The wells: darker glass under each symbol, a thin brass line.
    for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) { rr(g, colX(c), rowY(r), cell, cell, cell * 0.1); g.fillStyle = "rgba(38,28,20,0.55)"; g.fill(); g.lineWidth = Math.max(1, cell * 0.012); g.strokeStyle = "rgba(201,154,75,0.28)"; g.stroke(); }
    for (let col = 0; col < 5; col++) {
      const reel = R.reels[col]; if (!reel) continue;
      const w = R.wound.get(col);
      if (w && !w.outAt && (calm() || now >= w.at + T.wind)) continue; // fully wound: the wild covers the reel
      const moving = reel.anim || reel.spinning;
      const x = colX(col);
      g.save(); g.beginPath(); g.rect(x - R.gap / 2, R.oy - R.gap / 2, cell + R.gap, 3 * R.step); g.clip();
      const base = Math.floor(reel.pos), frac = reel.pos - base;
      for (let k = -1; k <= 3; k++) {
        let sym = cellAt(reel, k);
        const y = R.oy + (k - frac) * R.step;
        const here = !moving && k >= 0 && k < 3 ? key(k, col) : null;
        const win = hl && here && hl.cells.has(here);
        if (sym === "BOX" && win) sym = "BOX_OPEN";
        const tease = R.anticipate >= 0 && !moving && col < R.anticipate && sym !== "BOX";
        g.globalAlpha = !hl || moving || win ? (tease ? 0.6 : 1) : hl.neutral ? 0.7 : 0.35;
        if (reel.spinning && !calm()) { g.globalAlpha = 0.6; g.drawImage(sprite(sym), x, y - cell * 0.08, cell, cell * 1.16); }
        else g.drawImage(sprite(sym), x, y, cell, cell);
      }
      g.restore();
    }
    for (const [c, w] of R.wound) drawWound(g, c, w, now);
    // Anticipation: the reel still to land glows warm.
    if (R.anticipate >= 0) { const x = colX(R.anticipate); g.save(); rr(g, x - 2, R.oy - 2, cell + 4, 3 * cell + 2 * R.gap + 4, cell * 0.12); g.lineWidth = Math.max(2, cell * 0.035); g.strokeStyle = GOLD; if (!calm()) { g.shadowColor = "rgba(255,200,110,0.9)"; g.shadowBlur = cell * 0.2; } g.stroke(); g.restore(); }
    if (!hl) return;
    // Winning lines: through the centres of the run, warm light (or plain ink where the market forbids win effects).
    for (const pts of hl.lines || []) {
      g.save(); g.lineCap = "round"; g.lineJoin = "round"; g.beginPath();
      pts.forEach(([r, c], i) => { const [x, y] = centre(r, c); i ? g.lineTo(x, y) : g.moveTo(x, y); });
      if (hl.neutral) { g.strokeStyle = "rgba(251,238,214,0.8)"; g.lineWidth = Math.max(2, cell * 0.04); g.stroke(); }
      else {
        g.strokeStyle = "rgba(255,190,90,0.5)"; g.lineWidth = cell * 0.12; if (!calm()) { g.shadowColor = "rgba(255,210,120,0.9)"; g.shadowBlur = cell * 0.2; } g.stroke();
        g.shadowBlur = 0; g.strokeStyle = "#fff4d6"; g.lineWidth = Math.max(2, cell * 0.035); g.stroke();
      }
      g.restore();
    }
    for (const k of hl.cells) { const [r, c] = k.split(",").map(Number); g.save(); rr(g, colX(c) + 1, rowY(r) + 1, cell - 2, cell - 2, cell * 0.1); g.lineWidth = Math.max(2, cell * 0.035); g.strokeStyle = hl.neutral ? "rgba(251,238,214,0.7)" : GOLD; g.stroke(); g.restore(); }
    for (const l of hl.labels || []) { const [cx, cy] = centre(l.r, l.c); tag(g, cx, cy + cell * 0.32, l.text, cell * 0.15, hl.neutral); }
  }
  function tag(g, cx, cy, text, size, neutral) {
    g.save();
    g.font = `600 ${Math.round(size)}px "CW Num", "Arial Narrow", sans-serif`;
    const w = g.measureText(text).width + size * 0.9, h = size * 1.45;
    rr(g, cx - w / 2, cy - h / 2, w, h, size * 0.3);
    g.fillStyle = neutral ? "#fbeed6" : GOLD; g.fill(); g.lineWidth = Math.max(1, size * 0.12); g.strokeStyle = INK; g.stroke();
    g.fillStyle = INK; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, cx, cy + size * 0.04);
    g.restore();
  }

  function busy(now) {
    if (R.reels.some((r) => r.anim || r.spinning) || R.anticipate >= 0) return true;
    for (const w of R.wound.values()) {
      if (!calm() && now < w.at + T.wind) return true;
      if (w.tickAt && now < w.tickAt + T.multTick) return true;
      if (w.outAt && now < w.outAt + T.unwind) return true;
    }
    return false;
  }
  function step(now) {
    R.raf = 0;
    for (const reel of R.reels) {
      if (reel.spinning) { reel.pos -= (reel.speed * (now - (reel.last || now))) / 1000; reel.last = now; }
      if (reel.anim) {
        const a = reel.anim, t = Math.min(1, (now - a.t0) / a.dur);
        reel.pos = a.from + (a.to - a.from) * (t < 1 ? 1 - Math.pow(1 - t, 3) : 1); // a reel settles: ease-out, no bounce
        if (t >= 1) { reel.pos = a.to; reel.anim = null; a.done(); }
      }
    }
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
  /** Spin every reel that is not wound. */
  function startReels() {
    R.highlight = null;
    const now = performance.now();
    R.reels.forEach((reel, c) => { if (R.wound.has(c)) return; reel.spinning = true; reel.speed = (18 + Math.random() * 2) / speed(); reel.last = now; reel.anim = null; });
    kick();
  }
  function landReel(col, stop, dur) {
    const reel = R.reels[col], L = reel.strip.length;
    reel.spinning = false;
    let to = stop; const from = reel.pos;
    while (to > from - 2) to -= L;
    return new Promise((resolve) => { reel.anim = { from, to, t0: performance.now(), dur, done: () => { reel.pos = ((stop % L) + L) % L; resolve(); } }; kick(); });
  }
  /** Show the wound reels a session or a free spin starts from. */
  function showWound(list, mode) {
    R.wound.clear();
    for (const [c, n] of list || []) R.wound.set(c, { n, mode, at: -1e9, tickAt: 0, outAt: 0 });
    kick();
  }
  async function unwindAll() {
    if (!R.wound.size) return;
    const now = performance.now();
    for (const w of R.wound.values()) w.outAt = now;
    sfx("cw_unwind");
    kick();
    await sleep(calm() ? 0 : T.unwind);
    R.wound.clear(); kick();
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
  Bridge?.on?.("resume", () => { S.paused = false; say("The workshop is open."); });
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
  const featureHud = (left) => shell.featureHud({ left, win: S.featureWin, label: "Spins", winLabel: "Night win" });

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
    // A free spin starts from the reels still wound (§5.2); a paid round from none.
    if (free) showWound(S.featureState?.wound, "mult"); else R.wound.clear();
    sfx("spin_start");
    emit("roundStarted", { bet, ante: false, free_spin: free, free_round: false, buy });
    stopCount();
    if (!free) { shell.setWin(0); if (Number.isFinite(S.balance)) shell.setBalance(S.balance - cost); }
    shell.ticker.spin(free ? `Night shift · ${S.freeSpinsLeft} left` : buy ? "Opening the music box…" : "Winding…");
    startReels();
    const minSpin = sleep(T.minSpin * speed());
    shell.waiting(true);
    let r;
    try {
      [r] = await Promise.all([api("POST", buy ? "/game/v1/buy-feature" : "/game/v1/spin", { bet_amount: bet }, uuid()), minSpin]);
    } catch (err) {
      shell.waiting(false);
      S.lastAnswerAt = performance.now();
      await Promise.all(R.reels.map((reel, col) => (reel.spinning ? landReel(col, Math.round(reel.pos), T.errorLand) : null)));
      S.inFlight = false; setControls();
      if (err.code === "REALITY_CHECK_REQUIRED") { await realityCheck(err.details); return null; }
      if (Number.isFinite(S.balance)) shell.setBalance(S.balance);
      if (err.code === "INSUFFICIENT_FUNDS") await notEnoughCredit(cost);
      else say(LuminaShell.roundNotPlayed(err));
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
    if (S.featureRun || S.freeSpinsLeft > 0) featureHud(S.freeSpinsLeft);
    emit("roundEnded", { round_ref: r.round_ref, bet, win: r.total_win, free_spin: r.is_free_spin, free_spins_left: S.freeSpinsLeft });
    S.inFlight = false; S.resultShown = false; setControls();
    Sound?.warmMusic?.();
    if (!S.musicOn) { S.musicOn = true; Sound?.startMusic?.(); }
    return r;
  }

  /** Land one board's reels left to right on its stops (a wound reel, stop null, stays put). */
  async function landBoard(b) {
    const need = S.rules.free_spins.scatters, slam = () => S.quickStop && shell.slamAllowed();
    const cols = b.stops.map((s, c) => (s === null ? -1 : c)).filter((c) => c >= 0);
    let boxes = 0;
    for (const [i, col] of cols.entries()) {
      const reelsLeft = cols.length - i; // a reel shows at most one box
      const could = boxes >= need - 1 && boxes < need && boxes + reelsLeft >= need;
      // UKGC / ON: anticipation is shown in full even after a slam press (LuminaMotion grammar).
      if (could && !shell.anticipationSkippable()) S.quickStop = false;
      const anticipate = could && !slam();
      const dur = slam() ? T.reelLandQuick : (anticipate ? T.reelLandAnticipate : T.reelLand) * speed() + col * T.reelLandColExtra;
      if (!slam() && i > 0) await sleep((anticipate ? T.reelGapAnticipate : T.reelGap) * speed());
      R.anticipate = anticipate ? col : -1; kick();
      if (anticipate) shell.ticker.say("One more music box…");
      await landReel(col, b.stops[col], dur);
      sfx("reel_stop", { index: col });
      if ([0, 1, 2].some((row) => b.matrix[row][col] === S.rules.scatter.symbol)) { boxes++; sfx("scatter_land", { n: boxes, need }); }
    }
    if (R.anticipate >= 0) { R.anticipate = -1; kick(); }
  }

  /** The board's half of a round (BoardView.presentRound): every board in turn (§4), then the win. */
  async function presentRound(r, { bet, stake }) {
    const boards = r.boards?.length ? r.boards : [{ stops: r.stops, matrix: r.matrix, wound: [], line_wins: r.line_wins || [], scatter: r.scatter || {}, win: Number(r.total_win || 0) }];
    const free = Boolean(r.is_free_spin), mode = free ? "mult" : "turns";
    const roundWin = free ? Math.max(Number(r.total_win || 0), Number(r.bonus_round_win || 0)) : Number(r.total_win || 0);
    const celebrate = shell.celebrates(roundWin, free ? S.featureStake || bet : stake);
    let running = 0;
    for (let i = 0; i < boards.length; i++) {
      const b = boards[i];
      if (i > 0) {
        await sleep(gms("respinGap"));
        S.resultShown = false; setControls();
        shell.ticker.spin(`Respin ${i} of ${boards.length - 1}`);
        startReels(); sfx("spin_start");
        await sleep(T.minSpin * speed());
      }
      await landBoard(b);
      // Keys wind their reels; wound reels update their gauge or multiplier (§4.2, §5.2).
      const now = performance.now();
      let wound = 0, ticked = 0;
      for (const [c, n] of b.wound || []) {
        const w = R.wound.get(c);
        if (!w) { R.wound.set(c, { n, mode, at: now, tickAt: 0, outAt: 0 }); wound++; }
        else if (w.n !== n) { w.n = n; if (mode === "mult") { w.tickAt = now; ticked++; } }
      }
      kick();
      if (wound) {
        sfx("cw_wind");
        shell.ticker.say(free ? "A key winds its reel: wild, ×1" : `A key winds its reel: wild for ${S.rules.wild.respins} respins`);
        if (!S.windExplained && !free) { S.windExplained = true; shell.callout("A wind-up key turns its whole reel wild and respins the others."); }
        await sleep(gms("wind") + gms("windHold"));
      } else if (ticked) { sfx("cw_tick", { mult: Math.max(...(b.wound || []).map(([, n]) => n)) }); await sleep(gms("multTick")); }
      S.resultShown = true; setControls();
      running = await presentBoardWin(b, running, celebrate, bet, i < boards.length - 1);
    }
    await presentWin(r, stake, bet, celebrate);
    if (!free) await unwindAll();
  }

  /** One board's wins: lines (all, then one by one), the music boxes, the meter counting on. */
  async function presentBoardWin(b, running, celebrate, bet, more) {
    const lines = b.line_wins || [];
    const sc = b.scatter || {};
    const cells = new Set();
    for (const w of lines) for (const [r, c] of w.positions) cells.add(key(r, c));
    if (sc.count >= S.rules.free_spins.scatters) for (const [r, c] of sc.positions) cells.add(key(r, c));
    if (!cells.size) { R.highlight = null; kick(); if (more) await sleep(gms("boardHold") * 0.4); return running; }
    const end = (w) => (w.dir === "rtl" ? w.positions[0] : w.positions[w.positions.length - 1]);
    const used = new Set();
    const label = (w) => { let [r, c] = end(w); while (used.has(key(r, c)) && r < 2) r++; used.add(key(r, c)); return { r, c, text: w.mult > 1 ? `×${w.mult} ${fmt(w.amount)}` : fmt(w.amount) }; };
    const labels = lines.map(label);
    if (sc.amount > 0) { const [r, c] = sc.positions[0]; labels.push({ r, c, text: fmt(sc.amount) }); }
    R.highlight = { cells, neutral: !celebrate, lines: lines.map((w) => w.positions), labels }; kick();
    const win = Number(b.win || 0);
    const counted = win > 0 ? countUp(running, running + win, !celebrate ? M.ms("neutralCredit") : M.countUpMs(win / bet, shell.motionSpeed()), celebrate) : null;
    if (win > 0) sfx(!celebrate ? "click" : win / bet >= 5 ? "win_land" : "win_small");
    if (celebrate && lines.length && !S.quickStop) {
      const sp = shell.motionSpeed();
      await sleep(M.ms("linesAll", sp));
      if (lines.length > 1 && shell.speed() !== "turbo") {
        for (const w of lines.slice(0, 6)) {
          if (S.quickStop) break;
          R.highlight = { cells: new Set(w.positions.map(([r, c]) => key(r, c))), lines: [w.positions], labels: [label(w)] }; used.clear(); kick();
          await sleep(M.ms("linePerLine", sp));
        }
        R.highlight = { cells, neutral: false, lines: lines.map((w) => w.positions), labels }; kick();
      }
    }
    await counted;
    if (more) await sleep(gms("boardHold"));
    return running + win;
  }

  // The shared ladder (LuminaMotion.BIG_WIN, × the stake), named in the workshop's voice.
  const TIER_NAMES = { big: "Wound Up", mega: "Full Tilt", epic: "Grand Menagerie", legendary: "Masterwork" };
  const TIER_SOUND = { big: "win_big", mega: "win_mega", epic: "win_epic", legendary: "win_epic", max: "max_win" };

  /** The round's total: the readout lands on it, big wins get their screen, then the feature award. */
  async function presentWin(r, stake, bet, celebrate) {
    const total = Number(r.total_win || 0);
    stopCount(); shell.setWin(total); // the engine's total (after the max-win cap)
    if (!(total > 0) && !(r.free_spins_awarded > 0)) { say(S.freeSpinsLeft > 0 || r.is_free_spin ? `Night shift · ${r.free_spins_left} left` : "Tick… tock."); return; }
    const tier = celebrate ? M.tierFor(total / (r.is_free_spin ? bet : stake)) : null;
    const capped = (r.events || []).some((e) => /MAX_WIN_CAP/.test(e.type));
    if (total > 0) say(celebrate ? `Wound up: ${fmt(total)}` : `Credit: ${fmt(total)}`, true, celebrate);
    if (celebrate && (tier || capped)) await shell.bigWin({ amount: total, bet: r.is_free_spin ? bet : stake, tiers: shell.ladder(TIER_NAMES),
      autoDismissMs: S.autoplay || S.freeSpinsLeft > 0 ? 1800 : 4000,
      finalTier: capped ? { key: "max", minX: Infinity, label: "Mainspring", countMs: 0, fx: "motherlode", overlay: true } : null,
      hooks: { onTier: (t) => sfx(TIER_SOUND[t.key] || "win_big"), onTick: (v, of) => sfx("win_tick", { progress: of > 0 ? v / of : 1 }) } });
    if (r.free_spins_awarded > 0) {
      sfx("feature_award", { retrigger: r.is_free_spin });
      // A retrigger: "+N" flies into the spins readout, which then shows the new count.
      if (r.is_free_spin) { say(`More music boxes: +${r.free_spins_awarded} spins`, true, true); await shell.flyPlus(`+${r.free_spins_awarded}`); featureHud(Number(r.free_spins_left || 0)); }
      else { say(`The music box opens: ${r.free_spins_awarded} free spins`, true, true); await sleep(T.featureAward * speed()); }
    }
  }
  let countTimer = 0, countDone = null;
  function countUp(from, to, dur, ticks = true) {
    stopCount();
    return new Promise((resolve) => {
      const t0 = performance.now();
      countDone = () => { countDone = null; shell.setWin(to); resolve(); };
      const tick = (now) => { const t = Math.min(1, (now - t0) / Math.max(1, dur)); shell.setWin(from + (to - from) * (1 - Math.pow(1 - t, 3))); if (t < 1 && ticks) sfx("win_tick", { progress: t }); if (t < 1 && !S.quickStop) countTimer = requestAnimationFrame(tick); else countDone?.(); };
      countTimer = requestAnimationFrame(tick);
    });
  }
  function stopCount() { cancelAnimationFrame(countTimer); countDone?.(); }

  // ── free spins: "Night shift" (DESIGN §5) ────────────────────────────────
  async function runFreeSpins() {
    if (S.freeSpinsLeft <= 0 || S.featureRun) return 0;
    S.featureRun = true;
    try { return await playFeature(); } finally { S.featureRun = false; shell.featureHud(null); showBet(); R.wound.clear(); kick(); setControls(); }
  }
  async function playFeature() {
    featureHud(S.freeSpinsLeft);
    view.setTheme("feature");
    emit("featureState", { active: true, free_spins_left: S.freeSpinsLeft, bonus_win: S.featureWin });
    Sound?.setMusic?.("freeSpins");
    sfx("fs_intro");
    const resumed = S.resuming; S.resuming = false;
    const fs = S.rules.free_spins;
    await shell.panel({ kicker: resumed ? "Resuming" : "Night shift", title: `${S.freeSpinsLeft} free spins`, line: `A key winds its reel wild for the rest of the feature, and every spin adds +1 to its multiplier, up to ×${fs.max_mult}.`, stats: [["Bet", fmt(S.bets[S.betIndex])], ["Wound reels", `×1 to ×${fs.max_mult}`]], auto: Boolean(S.autoplay) });
    let played = 0;
    while (S.freeSpinsLeft > 0 && !S.paused) {
      const r = await playRound({ auto: true });
      if (!r) break;
      played++;
      await sleep(T.betweenFreeSpins * speed());
    }
    await unwindAll();
    view.setTheme("base");
    Sound?.setMusic?.("base");
    const total = S.featureWin, stake = S.featureStake || S.bets[S.betIndex];
    const celebrate = shell.celebrates(total, stake);
    if (celebrate) sfx("fs_outro");
    if (!S.paused) await shell.panel({ kicker: "Morning", title: "Free spins complete", stats: [["Spins", String(played)], ["Bet", fmt(S.bets[S.betIndex])]], total, totalLabel: "Night win", countX: total / S.bets[S.betIndex], count: celebrate, auto: Boolean(S.autoplay) });
    say(total > 0 ? (celebrate ? `The night shift made ${fmt(total)}` : `Credit: ${fmt(total)}`) : "The workshop is open.", total > 0, celebrate);
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
    const fs = S.rules.free_spins;
    const choice = await shell.ask("Buy free spins", `<p><b>${S.rules.buy.scatters} music boxes and ${fs.awards[0]} free spins</b> for <b>${fmt(price)}${S.currency ? ` ${S.currency}` : ""}</b>: ${S.rules.buy.cost_x}× your bet of ${fmt(bet)}.</p><p>Return to player of the buy: ${Number(S.variant.buy_free_spins_percent).toFixed(2)}%.</p>`,
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
  function icon(sym) { if (!icons.has(sym)) icons.set(sym, window.__luminaSymbols.render(sym, 56).toDataURL()); return icons.get(sym); }
  const ico = (sym) => `<img src="${icon(sym)}" alt="" width="28" height="28" style="vertical-align:middle;margin-right:8px">`;
  const money = (x) => fmt(Math.round(x * 100) / 100); // the engine rounds each line win to cents
  function rulesHtml() {
    if (!S.rules) return "";
    const r = S.rules, bet = S.bets[S.betIndex], v = S.variant, lineBet = bet / r.lines.count, fs = r.free_spins;
    const rows = r.paying.map((sym) => `<tr><td>${ico(sym)}${NAMES[sym]}</td>${r.paytable[sym].map((x) => `<td>${money(x * lineBet)}</td>`).join("")}</tr>`).join("");
    return `
      <p>5 reels, 3 rows, ${r.lines.count} fixed lines that pay both ways. Total bet ${fmt(bet)}, so ${money(lineBet)} per line. A line pays when 3 or more of a symbol land on adjacent reels from the leftmost reel, or from the rightmost reel; five of a kind pays once. Every line win is paid and they add up. Pays below are per line at this bet.</p>
      <table><thead><tr><th>Symbol</th><th>3</th><th>4</th><th>5</th></tr></thead><tbody>${rows}</tbody></table>
      <p>${ico("KEY")}<b>The Wind-up Key</b> lands on reels 2, 3 and 4 only. It winds its whole reel: the reel turns wild and stands in for every symbol except the Music Box, and the other reels respin ${r.wild.respins} times while it stays. A key landing on a respin winds its reel for ${r.wild.respins} more respins. The respins are part of the same paid round.</p>
      <p>${ico("BOX")}<b>The Music Box</b> pays anywhere on one board: 3 = ${money(r.scatter.pays[0] * bet)}, 4 = ${money(r.scatter.pays[1] * bet)}, 5 = ${money(r.scatter.pays[2] * bet)}. 3, 4 or 5 on one board award ${fs.awards.join(", ").replace(/, (\d+)$/, " or $1")} free spins at the same bet; 3 or more during free spins add ${fs.retrigger}. A wound reel's column does not count.</p>
      <p><b>Free spins.</b> A key that lands winds its reel wild for the rest of the feature at ×1, and each later spin adds +1, up to ×${fs.max_mult}. A line win is multiplied by the sum of the multipliers of the wound reels in its winning run. Free spins use their own reels.</p>
      <p><b>Buy free spins</b> (where available): a board with ${r.buy.scatters} music boxes and ${fs.awards[0]} free spins for ${r.buy.cost_x}× the bet. Return to player of the buy: ${Number(v.buy_free_spins_percent).toFixed(2)}%.</p>
      <p>Maximum win: ${r.max_win_x.toLocaleString()}× the total bet for a paid round (or a buy) and the free spins it awards; the feature ends when it is reached.</p>
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
    say("The workshop is open.");
  }

  // ── boot ─────────────────────────────────────────────────────────────────
  shell = window.LuminaShell.mount({
    game: "clockwork", stage: $("cwStage"), haptics: Haptics,
    features: { buy: true, ante: false, autoplay: true, turbo: true, stop: true },
    fmt,
    build: { title: "Clockwork Menagerie" },
    particles: { gold: "#ffd98a", goldBright: "#fff4d6", goldDeep: "#b9802f", diamond: "#9ff3e6", diamondEdge: "#1a120c", sparks: ["#fff4d6", "#ffd98a", "#5ce6d2"] },
    // The game's skin for the themed slots (layers.md, Layer 2): smoked glass, brass, teal key-light.
    skin: {
      "--skin-title-font": "var(--display)", "--skin-title-weight": "600", "--skin-amount-font": "var(--num)", "--skin-accent": "#ffd98a",
      "--skin-slot-bg": "linear-gradient(180deg, #2c2016, #1a120c)", "--skin-slot-ink": "#fbeed6", "--skin-slot-edge": "inset 0 0 0 2px #c99a4b, 0 2px 0 rgba(0, 0, 0, 0.45)",
      "--skin-panel-bg": "linear-gradient(180deg, #2c2016, #160f0a)", "--skin-panel-ink": "#fbeed6", "--skin-panel-muted": "#d6c3a4",
      "--skin-panel-title": "#ffd98a", "--skin-panel-total": "#9ff3e6", "--skin-panel-radius": "14px",
      "--skin-panel-frame": "0 0 0 2px #2a1709, 0 0 0 6px #c99a4b, 0 0 0 8px #2a1709, 0 18px 48px rgba(0, 0, 0, 0.6)",
      "--skin-tier-big": "#ffd98a", "--skin-tier-mega": "#f2b25c", "--skin-tier-epic": "#9ff3e6", "--skin-tier-legendary": "#fff4d6", "--skin-tier-max": "#ffffff",
      "--skin-win-hi": "#fff4d6", "--skin-win": "#ffd98a", "--skin-win-deep": "#b9802f",
      "--skin-bigwin-scrim": "rgba(16, 11, 8, 0.86)"
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

  // The board behind the shared BoardView seam (client/shell/board-view.js).
  let boardRO = null;
  const view = window.LuminaBoardView.define("clockwork", {
    mount() { resize(); boardRO = new ResizeObserver(() => view.resize()); boardRO.observe(el.board); },
    resize() { resize(); },
    presentRound: (payload, t = {}) => presentRound(payload, { bet: t.bet ?? S.bets[S.betIndex], stake: t.stake ?? t.bet ?? S.bets[S.betIndex] }),
    // The feature scene: the same workshop at night, the lamps gone teal.
    setTheme(name) { document.body.classList.toggle("night", name === "feature"); },
    destroy() { boardRO?.disconnect(); boardRO = null; stopCount(); cancelAnimationFrame(R.raf); R.raf = -1; }
  });

  async function boot() {
    view.mount(el.board);
    const params = new URLSearchParams(location.search);
    const lt = params.get("lt");
    const KEY = "clockwork.session";
    const rulesP = fetch("rules.json", { credentials: "same-origin", mode: "cors" }).then((r) => r.json()); // matches the HTML preload
    const artP = loadArt();
    let session;
    if (lt) {
      S.token = lt;
      try {
        const early = window.__clockworkEarlySession ? await window.__clockworkEarlySession.catch(() => null) : null;
        window.__clockworkEarlySession = null;
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
    await Promise.race([Promise.all([artP, document.fonts?.load?.('600 32px "CW Num"') ?? Promise.resolve()]), sleep(4000)]).catch(() => {});
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
    if (S.freeSpinsLeft > 0) showWound(S.featureState?.wound, "mult");
    await new Promise((res) => requestAnimationFrame(() => { draw(performance.now()); res(); }));
    if (Bridge?.connect?.(session.embed?.allowed_hosts)) Bridge.ready({ game: "clockwork", currency: S.currency, balance: S.balance });
    document.body.classList.add("app-ready");
    performance.mark("app-ready");
    // The intro splash (shared Lumina slot): facts from rules.json; volatility from DESIGN.md ("high").
    const fs = S.rules.free_spins;
    shell.splash({
      logo: "Clockwork Menagerie",
      cards: [
        { art: window.__luminaSymbols.render("KEY", 160), line: `A wind-up key turns its whole reel wild and respins the other reels ${S.rules.wild.respins} times.` },
        { art: window.__luminaSymbols.render("BOX_OPEN", 160), line: `3, 4 or 5 music boxes award ${fs.awards.join(", ").replace(/, (\d+)$/, " or $1")} free spins. Wound reels stay and climb to ×${fs.max_mult}.` }
      ],
      maxX: S.rules.max_win_x,
      volatility: "high"
    });
    const startAudio = () => { removeEventListener("pointerdown", startAudio, true); removeEventListener("keydown", startAudio, true); Sound?.preload?.(); Sound?.unlock?.(); };
    addEventListener("pointerdown", startAudio, true);
    addEventListener("keydown", startAudio, true);
    if (S.freeSpinsLeft > 0) { featureHud(S.freeSpinsLeft); view.setTheme("feature"); say(`Night shift · ${S.freeSpinsLeft} left · tap Spin`); }
    else shell.ticker.idle(["The workshop is open.", "Tick… tock.", "Wind them up."]);
    setControls();
  }
  boot().catch((err) => { say(`Could not start the game (${err.code || err.message})`); document.body.classList.add("app-ready"); });
})();
