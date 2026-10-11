#!/usr/bin/env node
"use strict";

// Sound ↔ picture sync audit. Plays seeded rounds through the real client under
// a deterministic 60fps clock (the VCLOCK from motion-record.js) and records, on
// the frame it is DRAWN, every visual beat of the game, plus every Sound.play
// (time, sound key, file, and whether it actually played or was debounced). It
// then pairs each beat with the sound that belongs to it and reports the
// offset (sound − picture, ms; negative = the sound is early).
//
// Beats: spin start, every symbol landing (renderer probe hook _traceDraw),
// each reel's stack landing, burst, tumble refill, step win, lightning bolt and
// flash peak, multiplier reveal, multiplier soul landing on the total, win
// combine (enter / slam / collision / total), scatter landing n of need, lock-on,
// scatter celebration, feature screens, FS intro / outro, retrigger, win count-up,
// big-win open and tier-ups, buy confirm open / confirm, UI (bet, turbo, info).
//
//   node tools/probes/sound-sync-probe.js [--out dir] [--label name] [--strict]
// Writes <label>-sound-sync.md / .json. --strict: exit 1 when any beat has no
// sound or is out of sync by more than one frame.

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", fs.mkdtempSync(path.join(os.tmpdir(), "vx-sync-"))));
const LABEL = opt("label", "sync");
const STRICT = args.includes("--strict");
const ROOT = path.join(__dirname, "..", "..", "client");
const PORT = 3600 + Math.floor(Math.random() * 300);
const FRAME = 1000 / 60;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".wav": "audio/wav" };
fs.mkdirSync(OUT, { recursive: true });

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  return {
    ready: new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); }),
    send: (method, params = {}) => { const i = id++; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); },
    close: () => ws.close()
  };
}

// Deterministic clock (as motion-record.js): manual() freezes time; advance(ms)
// fires due timers in order, then one rAF.
const VCLOCK = `(() => {
  const realNow = performance.now.bind(performance), realDate = Date.now;
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window);
  const realSI = window.setInterval.bind(window), realCI = window.clearInterval.bind(window);
  const realRaf = window.requestAnimationFrame.bind(window), realCaf = window.cancelAnimationFrame.bind(window);
  let manual = false, vnow = 0, seq = 1e9, dateAt = 0;
  const timers = new Map(), rafs = new Map();
  const yieldReal = () => new Promise((r) => realST(r, 0));
  performance.now = () => (manual ? vnow : realNow());
  Date.now = () => (manual ? dateAt + vnow : realDate());
  window.setTimeout = (fn, ms, ...a) => { if (!manual) return realST(fn, ms, ...a); const id = ++seq; timers.set(id, { at: vnow + Math.max(0, Number(ms) || 0), fn, a }); return id; };
  window.setInterval = (fn, ms, ...a) => { if (!manual) return realSI(fn, ms, ...a); const id = ++seq; const every = Math.max(1, Number(ms) || 0); timers.set(id, { at: vnow + every, fn, a, every }); return id; };
  window.clearTimeout = (id) => (id > 1e9 ? timers.delete(id) : realCT(id));
  window.clearInterval = (id) => (id > 1e9 ? timers.delete(id) : realCI(id));
  window.requestAnimationFrame = (fn) => { if (!manual) return realRaf(fn); const id = ++seq; rafs.set(id, fn); return id; };
  window.cancelAnimationFrame = (id) => (id > 1e9 ? rafs.delete(id) : realCaf(id));
  window.__vclock = {
    manual() { vnow = realNow(); dateAt = realDate() - vnow; manual = true; },
    async advance(ms) {
      const end = vnow + ms;
      for (let guard = 0; guard < 10000; guard++) {
        let next = null;
        for (const [id, t] of timers) if (t.at <= end && (!next || t.at < next[1].at)) next = [id, t];
        if (!next) break;
        const [id, t] = next;
        vnow = Math.max(vnow, t.at);
        if (t.every) t.at += t.every; else timers.delete(id);
        try { typeof t.fn === "function" ? t.fn(...t.a) : null; } catch (e) { console.error(e); }
        await yieldReal();
      }
      vnow = end;
      const due = [...rafs.entries()]; rafs.clear();
      for (const [, fn] of due) { try { fn(vnow); } catch (e) { console.error(e); } }
      await yieldReal();
      return vnow;
    }
  };
})();`;

const SEEDABLE_RNG = `(() => {
  const real = crypto.getRandomValues.bind(crypto);
  let gen = null;
  function xmur3(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; }; }
  function sfc32(a, b, c, d) { return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return t >>> 0; }; }
  crypto.getRandomValues = (arr) => {
    if (!gen) return real(arr);
    if (arr instanceof Uint32Array) { for (let i = 0; i < arr.length; i++) arr[i] = gen(); return arr; }
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = gen() & 255;
    return arr;
  };
  window.__seedRng = (text) => { if (text == null) { gen = null; return; } const s = xmur3(String(text)); gen = sfc32(s(), s(), s(), s()); };
})();`;

// In-page recorder: sounds (wrapped Sound.play) and visual beats (sampled on the
// frame they are drawn, from the renderer's state and the DOM).
function RECORDER() {
  const R = window.__sync = { sounds: [], beats: [], scenario: "", plan: null, picks: [] };
  const now = () => performance.now();
  const beat = (type, extra = {}) => R.beats.push({ t: R.frameT, scenario: R.scenario, type, ...extra });
  // Sounds.
  const realPlay = Sound.play.bind(Sound);
  Sound.play = (name, o = {}) => {
    // recent() is a capped list (64): compare the last entry, not the length.
    const before = Sound.debug.recent(); const prevLast = before[before.length - 1];
    realPlay(name, o);
    const rec = Sound.debug.recent();
    const tail = rec[rec.length - 1];
    const last = tail && tail !== prevLast ? tail : null;
    R.sounds.push({ t: now(), scenario: R.scenario, name, opts: o, key: last?.key || null, file: last?.file || null, played: Boolean(last && last.name === name) });
  };
  const realDrone = Sound.drone.start.bind(Sound.drone);
  Sound.drone.start = (ms) => { R.sounds.push({ t: now(), scenario: R.scenario, name: "drone", key: "riser", file: "sfx/riser_1", played: true }); return realDrone(ms); };
  const realMusic = Sound.setMusic.bind(Sound);
  Sound.setMusic = (mood, o) => { R.sounds.push({ t: now(), scenario: R.scenario, name: `music:${mood}`, key: null, file: null, played: true }); return realMusic(mood, o); };

  // Seeded outcomes (session restored between tries).
  const realApi = window.__realApi || api;
  window.__realApi = realApi;
  api = async (p, payload) => {
    const plan = R.plan && R.plan[p];
    if (!plan) return realApi(p, payload);
    const eng = await getEngine();
    const snap = Object.fromEntries(Object.entries(eng.session).filter(([, v]) => v === null || typeof v !== "object"));
    let last = null;
    for (let i = 0; i < plan.tries; i++) {
      Object.assign(eng.session, snap);
      window.__seedRng(plan.prefix + "/" + i);
      try { last = await realApi(p, { ...payload, ...(plan.extra || {}), spin_id: crypto.randomUUID() }); } finally { window.__seedRng(null); }
      if (plan.want(last)) {
        R.picks.push({ p, seed: plan.prefix + "/" + i });
        if (plan.keepSpins != null && Number(last.free_spins_left) > plan.keepSpins) { eng.session.freeSpinsLeft = plan.keepSpins; last.free_spins_left = plan.keepSpins; }
        if (plan.then) R.plan[p] = plan.then; else delete R.plan[p];
        return last;
      }
    }
    R.picks.push({ p, seed: null });
    delete R.plan[p];
    return last;
  };

  // DOM beats: noted on mutation, stamped with the next drawn frame.
  const pendingDom = [];
  const domBeat = (type, extra) => pendingDom.push({ type, extra });
  new MutationObserver((recs) => {
    for (const m of recs) {
      const n = m.target;
      if (m.type === "attributes" && m.attributeName === "class") {
        const before = new Set((m.oldValue || "").split(/\s+/)); const add = (c) => n.classList.contains(c) && !before.has(c);
        if (add("soul-hit")) domBeat("soul lands on the total", { on: n.id || n.className.split(" ")[0] });
        if (n.classList.contains("combine-amount") && add("is-entered")) domBeat("combine: chips enter");
        if (n.classList.contains("combine-amount") && add("is-slamming")) domBeat("combine: chips slam");
        if (n.classList.contains("combine-flash") && add("is-live")) domBeat("combine: collision flash");
        // The Total Win chip pops to full size 20% into its animation (COMBINE_TOTAL_PEAK_MS).
        if (n.classList.contains("combine-total") && add("is-live")) domBeat("combine: total pops", { shift: COMBINE_TOTAL_PEAK_MS * turboScale() });
        if (n.id === "bigWinOverlay" && add("is-open")) domBeat("big win: overlay opens");
        if (n.id === "featureScreen" && before.has("hidden") && !n.classList.contains("hidden")) domBeat("feature screen opens", { title: document.getElementById("featureScreenTitle")?.textContent });
        if (n.id === "buyConfirmModal" && before.has("hidden") && !n.classList.contains("hidden")) domBeat("buy confirm opens");
      }
      if (m.type === "attributes" && m.attributeName === "data-tier" && n.id === "bigWinOverlay" && n.dataset.tier) domBeat("big win: tier", { tier: n.dataset.tier });
      if (m.type === "attributes" && m.attributeName === "hidden" && n.id === "psInfoModal" && !n.hidden) domBeat("info modal opens");
    }
  }).observe(document.body, { subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ["class", "data-tier", "hidden"] });
  // Win count-up: the WIN meter changing while counting up.
  let lastWin = 0, counting = false;
  new MutationObserver(() => {
    const v = Number(el.lastWin.textContent.replace(/,/g, "")) || 0;
    if (v > lastWin && !counting) { counting = true; domBeat("win count-up starts", { value: v }); }
    if (v <= lastWin) counting = false;
    lastWin = v;
  }).observe(el.lastWin, { childList: true, characterData: true, subtree: true });

  // Wrapped calls (their effect is drawn on the next frame).
  const wrap = (obj, name, type) => { const orig = obj[name].bind(obj); obj[name] = (...a) => { domBeat(type, {}); return orig(...a); }; };
  const origSouls = flyMultiplierSouls;
  flyMultiplierSouls = (m) => { if ((m || []).length) domBeat("souls launch to the total"); return origSouls(m); };
  // The count-up lands: the frame its last value is written.
  const origMeter = animateWinMeter;
  animateWinMeter = async (from, to, ms) => { const r = await origMeter(from, to, ms); domBeat("win count-up lands", { to, overlay: Boolean(getWinTier(to, Number(el.betSelect.value)).overlay) }); return r; };
  const origCelebrate = celebrateScatterCatch;
  // Its glow is the scatters' (voiced by the gong on the lock-on), not a cluster win.
  celebrateScatterCatch = async (p, label) => { domBeat(`scatter celebration: ${label}`); R.inScatterCelebration = true; try { return await origCelebrate(p, label); } finally { R.inScatterCelebration = false; } };
  wrap(reelRenderer, "lockOn", "scatter lock-on");
  const origStepBurst = reelRenderer.explode.bind(reelRenderer);
  reelRenderer.explode = (...a) => origStepBurst(...a);

  // Frame sampler: renderer state, first frame each thing is drawn.
  let prev = { exit: null, blast: null, drop: null, lockOn: null, pulse: null };
  const cellState = new Map(); // drop|cell → { fell, impacted }
  const colState = new Map();  // drop → Map(col → symbols landed)
  const colDone = new Set();
  const colLandT = new Map(); // drop|col → its last symbol's impact time
  let prevBonus = false;
  let dropSeq = 0;
  reelRenderer._traceDraw = [];
  function sample(t) {
    R.frameT = performance.now();
    for (const d of pendingDom.splice(0)) {
      if (d.extra?.shift) R.beats.push({ t: R.frameT + d.extra.shift, scenario: R.scenario, type: d.type, ...d.extra });
      else beat(d.type, d.extra);
    }
    const fx = reelRenderer.fx;
    if (fx.exit && fx.exit !== prev.exit) beat("spin starts (board spins out)");
    if (fx.blast && fx.blast !== prev.blast) beat("cluster burst", { cells: fx.blast.set?.size });
    if (fx.drop && fx.drop !== prev.drop) { dropSeq += 1; fx.drop.__seq = dropSeq; beat(fx.drop.spin ? "spin board starts falling" : "tumble refill starts falling"); }
    if (fx.lockOn && fx.lockOn !== prev.lockOn) beat("lock-on drawn");
    if (fx.pulse && fx.pulse !== prev.pulse) beat(R.inScatterCelebration ? "scatter celebration glow" : "winning cluster lights (step win)");
    for (const st of fx.drop?.strikes || []) {
      if (st.bolted && !st.__seenBolt) { st.__seenBolt = true; beat("lightning bolt drawn", { cell: st.key, value: st.value }); }
      if (st.swapped && !st.__seenSwap) { st.__seenSwap = true; beat("strike flash peak = multiplier revealed", { cell: st.key, value: st.value }); }
    }
    // Landings, from what was drawn: IMPACT = the first frame a falling symbol
    // reaches its slot (before any bounce). A reel's stack lands with the last
    // of its symbols in this drop.
    const drawn = reelRenderer._traceDraw.splice(0);
    const L = reelRenderer.getLayout();
    const seq = fx.drop?.__seq || 0;
    for (const e of drawn) {
      const k = seq + "|" + e.key;
      let st = cellState.get(k);
      if (!st) { st = { fell: false, impacted: false, y: -Infinity, t: 0 }; cellState.set(k, st); }
      if (e.fall) st.fell = true;
      // Track its fall offset from its slot (cellOffset: the renderer's own fall,
      // without the reel-slam dip or the squash that follow the impact).
      const [r0, c0] = e.key.split("-").map(Number);
      const yb = reelRenderer.cellOffset(r0, c0, L.rowStep, R.frameT);
      if (!st.fell || st.impacted) { st.y = yb; st.t = R.frameT; continue; }
      const [r, c] = e.key.split("-").map(Number);
      const slotY = reelRenderer.cellCenter(r, c).y;
      // Impact = the frame of its lowest drawn position: it reached the slot,
      // or it has started to rebound (contact fell between two frames).
      const atSlot = yb >= -0.5 && st.y < -0.5;
      const rebounding = st.y > -Infinity && yb < st.y - 0.01;
      if (atSlot || rebounding || !e.fall) {
        st.impacted = true;
        const at = atSlot ? R.frameT : st.t;
        R.beats.push({ t: at, scenario: R.scenario, type: "symbol lands", cell: e.key, symbol: e.symbol, drop: seq });
        if (e.symbol === "SCATTER") R.beats.push({ t: at, scenario: R.scenario, type: "scatter lands", cell: e.key, drop: seq });
        st.landT = at;
        if (!colState.has(seq)) colState.set(seq, new Map());
        colState.get(seq).set(c, (colState.get(seq).get(c) || 0) + 1);
        const lt = colLandT.get(seq + "|" + c) || 0; colLandT.set(seq + "|" + c, Math.max(lt, at));
      }
      st.y = yb; st.t = R.frameT;
    }
    if (fx.drop) {
      const m = fx.drop.map || {};
      const perCol = new Map();
      for (const [key, v] of Object.entries(m)) if (Number(v) > 0) { const c = Number(key.split("-")[1]); perCol.set(c, (perCol.get(c) || 0) + 1); }
      for (const [c, n] of perCol) {
        const tag = seq + "|col" + c;
        if (!colDone.has(tag) && (colState.get(seq)?.get(c) || 0) >= n) { colDone.add(tag); {
          const keys = Object.keys(m).filter((k) => Number(m[k]) > 0 && Number(k.split("-")[1]) === c);
          const sched = Math.max(...keys.map((k) => { const [rr, cc] = k.split("-").map(Number); return reelRenderer.cellLandMs(rr, cc, Number(m[k])); }));
          R.beats.push({ t: colLandT.get(seq + "|" + c) || R.frameT, scenario: R.scenario, type: "reel stack lands", col: c, drop: seq, spin: Boolean(fx.drop.spin), scheduledAt: fx.drop.start + sched, dropStart: fx.drop.start, duration: fx.drop.duration, antic: fx.drop.antic ? { fromCol: fx.drop.antic.fromCol, holdMs: fx.drop.antic.holdMs, slow: fx.drop.antic.slow } : null, tempo: fx.drop.tempo });
        } }
      }
    }
    if (state.bonusAutoplay && !prevBonus) beat("free spins begin");
    if (!state.bonusAutoplay && prevBonus) beat("free spins end");
    prevBonus = state.bonusAutoplay;
    prev = { exit: fx.exit, blast: fx.blast, drop: fx.drop, lockOn: fx.lockOn, pulse: fx.pulse };
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);

  // Auto-dismiss feature screens and big wins (as a player tapping on).
  setInterval(() => {
    if (VxNotify.isOpen("feature")) { R.beats.push({ t: performance.now(), scenario: R.scenario, type: "(tap: feature screen dismissed)" }); dismissFeature(); }
    const bw = document.getElementById("bigWinOverlay");
    if (bw?.classList.contains("is-done")) bw.click();
  }, 1500);
  return true;
}

// Which sound belongs to which beat (the identity the audit expects), and the
// window to look for it in. A sound fired up to `before` ms early or `after` ms
// late is paired; the offset is then judged against one frame.
const PAIRS = [
  { beat: "spin starts (board spins out)", sound: ["spin_start", "buy_feature"], before: 200, after: 200 },
  { beat: "reel stack lands", sound: ["reel_stop"], where: (b) => b.spin, before: 120, after: 120 },
  { beat: "symbol lands", sound: ["tick"], before: 60, after: 60, sampleOnly: true },
  { beat: "tumble refill starts falling", sound: ["tumble"], before: 200, after: 200 },
  { beat: "cluster burst", sound: ["explode"], before: 200, after: 200 },
  { beat: "winning cluster lights (step win)", sound: ["win_light"], before: 200, after: 200 },
  // The bolt itself is silent by design: the crack lands on the flash peak.
  { beat: "strike flash peak = multiplier revealed", sound: ["multiplier_strike"], before: 200, after: 200, label: "strike sound vs FLASH PEAK" },
  { beat: "strike flash peak = multiplier revealed", sound: ["multiplier_drop"], before: 200, after: 200, label: "reveal sound vs reveal" },
  { beat: "souls launch to the total", sound: ["soul_launch"], before: 200, after: 200 },
  { beat: "soul lands on the total", sound: ["multiplier_catch"], before: 200, after: 200 },
  { beat: "combine: chips enter", sound: ["combine_enter"], before: 200, after: 200 },
  { beat: "combine: collision flash", sound: ["combine_slam"], before: 200, after: 200 },
  { beat: "combine: total pops", sound: ["multiplier_combine"], before: 200, after: 200, label: "combine: total pops (bell)" },
  { beat: "combine: total pops", sound: ["combine_total"], before: 200, after: 200, label: "combine: total pops (coins)" },
  { beat: "scatter lands", sound: ["scatter_land"], before: 120, after: 120 },
  { beat: "scatter lock-on", sound: ["scatter_catch"], before: 200, after: 200 },
  { beat: "feature screen opens", sound: ["feature_award", "fs_outro"], before: 200, after: 200 },
  { beat: "free spins begin", sound: ["fs_intro"], before: 300, after: 300 },
  { beat: "win count-up starts", sound: ["win_tick"], before: 100, after: 100 },
  // Only the round's final count-up (the running meter updates per step before it).
  { beat: "win count-up lands", sound: ["win_land", "win_small"], where: (b) => b.final && !b.overlay && b.to > 0, before: 120, after: 120 },
  { beat: "big win: overlay opens", sound: ["bigwin_open"], before: 200, after: 200 },
  { beat: "big win: tier", sound: ["win_big", "win_mega", "max_win"], before: 120, after: 120 },
  { beat: "buy confirm opens", sound: ["click"], before: 120, after: 120 },
  { beat: "info modal opens", sound: ["click"], before: 120, after: 120 }
];

async function main() {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vx-sync-prof-"));
  const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars",
    "--autoplay-policy=no-user-gesture-required", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); });
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: VCLOCK });
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEEDABLE_RNG });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const ev = async (e) => { const r = await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed"); return r.result.value; };
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?reset` });
  for (let i = 0; i < 200; i++) { await sleep(100); try { if (await ev(`document.body.classList.contains("app-ready") && typeof state !== "undefined" && !!state.sessionId && !!state.rules`)) break; } catch {} }
  // Every file decoded, audio unlocked, then the recorder and the clock.
  await ev(`(async () => { await Sound.debug.ready(); const m = Sound.debug.manifest(); const all = Object.values(m.sounds).flat().concat(Object.values(m.music));
    const t0 = performance.now(); while (Sound.debug.loaded().length < all.length && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
    Sound.setMuted(false); Sound.unlock(); return true; })()`);
  await sleep(800);
  await ev(`(${RECORDER.toString()})()`);
  await ev(`(__vclock.manual(), true)`);
  const advance = (ms) => ev(`__vclock.advance(${ms})`);
  const run = async (scenario, setup, startJs, { maxMs = 30000, untilIdle = true } = {}) => {
    await ev(`(__sync.scenario = ${JSON.stringify(scenario)}, true)`);
    if (setup) await ev(setup);
    if (startJs) await ev(startJs);
    let idleFor = 0;
    for (let t = 0; t < maxMs; t += FRAME) {
      await advance(FRAME);
      if (untilIdle && t > 600) {
        const busy = await ev(`isRoundInFlight() || state.bonusAutoplay || VxNotify.openNames().length > 0`);
        idleFor = busy ? 0 : idleFor + FRAME;
        if (idleFor > 700) break;
      }
    }
  };
  const noEv = `!(r.events || []).length`;
  // 1. A multiplied win: strike + reveal + tumble + burst + souls + combine + count-up.
  await run("multiplied win", `(__sync.plan = { "/api/v1/spin": { prefix: "sync-mult", tries: 20000,
    want: (r) => !r.free_spins_awarded && ${noEv} && Number(r.multiplier_applied) > 1 && r.total_win > 0 && (r.tumble_steps || []).length >= 3 && r.total_win / Number(el.betSelect.value) < 10 } }, true)`,
    `(el.spinBtn.click(), true)`);
  // 2. A big win (overlay tiers).
  await run("big win", `(__sync.plan = { "/api/v1/spin": { prefix: "sync-big", tries: 20000, extra: { force_multiplier_value: 25 },
    want: (r) => !r.free_spins_awarded && ${noEv} && r.total_win / Number(el.betSelect.value) >= 25 && r.total_win / Number(el.betSelect.value) < 50 } }, true)`,
    `(el.spinBtn.click(), true)`, { maxMs: 40000 });
  // 3. Scatter trigger → free spins (cut short) with a retrigger on the first free spin.
  await run("scatter trigger + free spins + retrigger", `(__sync.plan = { "/api/v1/spin": { prefix: "sync-scatter", tries: 20000, keepSpins: 1,
    want: (r) => !r.is_free_spin && Number(r.free_spins_awarded) > 0 && ${noEv},
    then: { prefix: "sync-retrigger", tries: 20000, keepSpins: 1, want: (r) => r.is_free_spin && Number(r.free_spins_awarded) > 0 && ${noEv} } } }, true)`,
    `(el.spinBtn.click(), true)`, { maxMs: 90000 });
  // 4. Buy feature: confirm dialog, then the bought feature (cut to one spin).
  await run("buy feature", `(__sync.plan = { "/api/v1/buy-free-spins": { prefix: "sync-buy", tries: 2000, keepSpins: 1, want: (r) => Number(r.free_spins_awarded) > 0 && ${noEv} } }, true)`,
    `(document.getElementById("buyFreeBtn").click(), true)`, { maxMs: 1500, untilIdle: false });
  await ev(`(document.getElementById("buyConfirmBtn").click(), true)`);
  await run("buy feature", null, null, { maxMs: 60000 });
  // 5. UI: bet up / down, turbo on / off, info open / close.
  await run("ui", null, `(document.getElementById("betUpBtn").click(), true)`, { maxMs: 400, untilIdle: false });
  await run("ui", null, `(document.getElementById("betDownBtn").click(), true)`, { maxMs: 400, untilIdle: false });
  await run("ui", null, `(document.getElementById("turboBtn").click(), true)`, { maxMs: 400, untilIdle: false });
  await run("ui", null, `(document.getElementById("turboBtn").click(), true)`, { maxMs: 400, untilIdle: false });
  await run("ui", null, `(document.getElementById("psInfoBtn").click(), true)`, { maxMs: 600, untilIdle: false });
  await run("ui", null, `(VxNotify.close("info", "closed"), true)`, { maxMs: 400, untilIdle: false });

  const data = await ev(`({ sounds: __sync.sounds, beats: __sync.beats, picks: __sync.picks })`);
  cdp.close(); chrome.kill(); server.close();
  fs.writeFileSync(path.join(OUT, `${LABEL}-sound-sync.json`), JSON.stringify(data, null, 1));

  // ── Pairing and report ──
  // A count-up is the round's final one when no other lands before the next spin.
  const ordered = data.beats.filter((b) => b.type === "win count-up lands" || b.type === "spin starts (board spins out)").sort((a, c) => a.t - c.t);
  ordered.forEach((b, i) => { if (b.type === "win count-up lands") { const nx = ordered[i + 1]; b.final = !nx || nx.type !== "win count-up lands"; } });
  const r1 = (v) => Math.round(v * 10) / 10;
  const used = new Set();
  const rows = [];
  let bad = 0;
  for (const pr of PAIRS) {
    const beats = data.beats.filter((b) => b.type === pr.beat && (!pr.where || pr.where(b)));
    if (!beats.length) continue;
    const offs = [], missing = [], files = new Set(), names = new Set(), debounced = [];
    for (const b of beats) {
      const cands = data.sounds.filter((s) => s.scenario === b.scenario && pr.sound.includes(s.name) && s.t >= b.t - pr.before && s.t <= b.t + pr.after);
      cands.sort((a, c) => Math.abs(a.t - b.t) - Math.abs(c.t - b.t));
      const s = cands[0];
      if (!s) { missing.push(b); continue; }
      used.add(s);
      names.add(s.name);
      if (!s.played) { debounced.push(s); continue; }
      if (s.file) files.add(s.file);
      offs.push(s.t - b.t);
    }
    const sorted = offs.slice().sort((a, c) => a - c);
    const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
    const worst = sorted.length ? sorted.reduce((m, v) => (Math.abs(v) > Math.abs(m) ? v : m), 0) : null;
    const flags = [];
    if (!pr.sound.length) flags.push("**no sound designed**");
    else if (missing.length === beats.length) flags.push("**no sound**");
    else if (missing.length) flags.push(`${missing.length}/${beats.length} beats without a sound`);
    if (debounced.length) flags.push(`${debounced.length} debounced`);
    if (worst != null && Math.abs(worst) > FRAME + 0.5 && !pr.sampleOnly) flags.push(`**out of sync** (${r1(worst)}ms)`);
    if (flags.some((f) => f.startsWith("**"))) bad += 1;
    rows.push(`| ${pr.label || pr.beat} | ${beats.length} | ${[...names].join(", ") || "—"} | ${[...files].join(", ") || "—"} | ${med == null ? "—" : r1(med)} | ${worst == null ? "—" : r1(worst)} | ${flags.join("; ") || "ok"} |`);
  }
  // Sounds no beat claimed.
  const orphans = new Map();
  for (const s of data.sounds) if (!used.has(s) && s.played) orphans.set(s.name, (orphans.get(s.name) || 0) + 1);
  const md = [
    `# Sound ↔ picture sync: ${LABEL}`, "",
    `Seeded rounds: ${data.picks.map((p) => `${p.p.split("/").pop()} ${p.seed}`).join(", ")}. Offset = sound − first frame the beat is drawn (ms, 60fps clock; one frame = 16.7ms; negative = early).`, "",
    "| visual beat | beats | Sound.play event(s) | files played | median offset | worst offset | flags |", "|---|---|---|---|---|---|---|",
    ...rows, "",
    "Sounds not tied to a measured beat: " + ([...orphans].map(([n, c]) => `${n} ×${c}`).join(", ") || "none")
  ];
  fs.writeFileSync(path.join(OUT, `${LABEL}-sound-sync.md`), md.join("\n"));
  console.log(md.join("\n"));
  console.log(`\n${OUT}`);
  setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} process.exit(STRICT && bad ? 1 : 0); }, 300);
}
main().catch((e) => { console.error(e); process.exit(1); });
