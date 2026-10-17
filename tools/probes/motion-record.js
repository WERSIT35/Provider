// Records a real spin (with a tumble chain) in headless Chrome and writes it
// as animated WebP: real speed and 4x slow motion, plus the raw frames.
//
// Usage: node tools/probes/motion-record.js [--ref <git-ref>] [--out <dir>]
//          [--name <label>] [--tumbles <n>] [--turbo] [--size 1280x800]
//   --ref   record an older commit (checked out into a temp worktree)
//   --tumbles  keep re-rolling the spin until it has at least n tumble steps
//   --mult     …and until it is a multiplied win (Total Multiplier + combine)
//   --mult-refill  …whose multiplier lands in a tumble refill (none on the spin board)
//   --scatter-move  instead: a feature trigger where a scatter moved during a
//              tumble (the scatter-celebration case, tools/scatter-celebration-check.js)
//   --seed <prefix>  deterministic re-roll: try <prefix>/0, <prefix>/1, … with
//              the engine session restored between tries, so two builds (or
//              --ref) record the SAME round
//   --ms       how long to record (default 6000)
//   --dpr      device pixel ratio (default 1)
//   --trace-mult  log every multiplier cell's drawn centre and size each frame
//              (renderer probe hook _traceDraw) from landing to rest: writes
//              <name>-mult-trace.md / .json and <name>-mult-<cell>-strip.jpg
//              (every frame around the swap, crosshairs at the resting centre)
// Needs Chrome and sharp (root devDependency).
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execFileSync } = require("child_process");
const sharp = require("sharp");

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : def; };
const flag = (name) => args.includes(`--${name}`);
const REPO = path.join(__dirname, "..", "..");
const REF = opt("ref", "");
const NAME = opt("name", REF || "working-tree");
const OUT = path.resolve(opt("out", fs.mkdtempSync(path.join(os.tmpdir(), "vx-rec-"))));
const TUMBLES = Number(opt("tumbles", 2));
const MULT = flag("mult") || flag("mult-refill");
const MULT_REFILL = flag("mult-refill");
const SCATTER_MOVE = flag("scatter-move");
const SEED = opt("seed", "");
const DPR = Number(opt("dpr", 1));
const TRACE = flag("trace-mult");
const [W, H] = opt("size", "1280x800").split("x").map(Number);
const PORT = 3100 + Math.floor(Math.random() * 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".wav": "audio/wav", ".mp3": "audio/mpeg" };

// Root to serve: the working tree, or a temp worktree of --ref.
let worktree = null;
let ROOT = path.join(REPO, "client");
if (REF) {
  worktree = fs.mkdtempSync(path.join(os.tmpdir(), "vx-rec-wt-"));
  execFileSync("git", ["-C", REPO, "worktree", "add", "--detach", worktree, REF], { stdio: "ignore" });
  ROOT = path.join(worktree, "client");
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vx-rec-prof-"));
function cleanup() {
  if (worktree) { try { execFileSync("git", ["-C", REPO, "worktree", "remove", "--force", worktree], { stdio: "ignore" }); } catch { /* best effort */ } }
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* in use */ }
}
process.on("exit", cleanup);

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
  let id = 1; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method) listeners.forEach((l) => l(m));
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  return {
    ready: new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); }),
    send: (method, params = {}) => { const i = id++; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); },
    on: (fn) => listeners.push(fn),
    close: () => ws.close()
  };
}
async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}

// A controllable page clock, installed before any page script runs. Real
// time until manual() is called; then performance.now, Date.now, setTimeout,
// setInterval and requestAnimationFrame only move when advance(ms) is called
// (timers fire in order, each followed by a real macrotask so promise chains
// settle; rAF callbacks run once per advance, at its end).
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

// --seed: crypto.getRandomValues becomes seedable (__seedRng(text) / __seedRng(null)).
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

/** --trace-mult: per multiplier cell, every frame from its stand-in landing to
 *  the end: drawn centre (cx, cy) and size, and the offset from its resting
 *  centre. After the cell has landed (not falling), a frame "moved" if its
 *  centre differs from rest by ≥ 0.01 CSS px, "scaled" if its size differs. */
async function writeMultTrace(trace, frames, geo) {
  const r2 = (v) => Math.round(v * 100) / 100;
  const byKey = new Map();
  for (const f of trace) for (const e of f.cells) {
    if (!byKey.has(e.key)) byKey.set(e.key, []);
    byKey.get(e.key).push({ t: f.t, ...e });
  }
  const turbo = flag("turbo");
  const out = { name: NAME, size: `${W}x${H}`, dpr: DPR, turbo, cells: [] };
  const md = [`# ${NAME}: multiplier cells (${W}x${H}, DPR ${DPR}, turbo ${turbo ? "on" : "off"})`, ""];
  for (const [key, rows] of byKey) {
    const swapIdx = rows.findIndex((x) => x.symbol === "MULTI");
    if (swapIdx < 0) continue;
    // This multiplier's run at this cell: from its first MULTI frame to its
    // last; rest = its last frame that is not falling.
    let endIdx = rows.length - 1;
    while (endIdx > swapIdx && rows[endIdx].symbol !== "MULTI") endIdx -= 1;
    const restRow = [...rows.slice(swapIdx, endIdx + 1)].reverse().find((x) => !x.fall) || rows[endIdx];
    // Landing: the first frame of the not-falling run that leads into the swap.
    let landIdx = swapIdx;
    for (let i = swapIdx; i >= 0 && !rows[i].fall; i -= 1) landIdx = i;
    const span = rows.slice(landIdx, endIdx + 1);
    const flagged = [];
    // The swap: the art's centre on the stand-in's last frame vs the multiplier's first.
    const pre = rows[swapIdx - 1];
    const jump = pre && !pre.fall ? { dx: r2(rows[swapIdx].x - pre.x), dy: r2(rows[swapIdx].y - pre.y) } : null;
    const jumpPx = jump ? Math.max(Math.abs(jump.dx), Math.abs(jump.dy)) : 0;
    md.push(`## cell ${key}`, "",
      `landed ${Math.round(rows[landIdx].t)}ms (as ${rows[landIdx].symbol}), swapped to MULTI ${Math.round(rows[swapIdx].t)}ms; rest centre (${r2(restRow.x)}, ${r2(restRow.y)}) size ${r2(restRow.w)}×${r2(restRow.h)}`, "",
      `swap jump (stand-in centre → multiplier centre): ${jump ? `Δx ${jump.dx}, Δy ${jump.dy}` : "n/a (still falling)"}`, "",
      "| ms | symbol | falling | cx | cy | w | h | Δx | Δy | scale | note |", "|---|---|---|---|---|---|---|---|---|---|---|");
    for (const x of span) {
      const dx = r2(x.x - restRow.x), dy = r2(x.y - restRow.y);
      const scale = Math.round((x.w / restRow.w) * 1000) / 1000;
      const isMulti = x.symbol === "MULTI";
      const moved = isMulti && !x.fall && (Math.abs(dx) >= 0.01 || Math.abs(dy) >= 0.01);
      const scaled = isMulti && Math.abs(x.w - restRow.w) >= 0.01;
      if (moved || scaled) flagged.push({ t: x.t, dx, dy, scale, moved, scaled });
      md.push(`| ${Math.round(x.t)} | ${x.symbol} | ${x.fall ? "yes" : ""} | ${r2(x.x)} | ${r2(x.y)} | ${r2(x.w)} | ${r2(x.h)} | ${dx} | ${dy} | ${scale} | ${moved ? "**MOVED**" : ""}${scaled ? " scaled" : ""} |`);
    }
    const maxD = flagged.filter((f) => f.moved).reduce((m, f) => Math.max(m, Math.abs(f.dx), Math.abs(f.dy)), 0);
    const maxS = flagged.reduce((m, f) => Math.max(m, Math.abs(f.scale - 1)), 0);
    md.push("", `swap jump ${jumpPx}px; after landing: ${flagged.filter((f) => f.moved).length} frames moved (max ${maxD}px CSS = ${r2(maxD * DPR)} device px), ${flagged.filter((f) => f.scaled).length} frames scaled (max ${Math.round(maxS * 1000) / 10}%)`, "");
    out.cells.push({ key, landedMs: rows[landIdx].t, swapMs: rows[swapIdx].t, rest: restRow, swapJump: jump, flagged, maxMovePx: Math.max(maxD, jumpPx), maxScale: maxS });
    // Strip: every frame from 4 before the swap to 24 after, around the cell,
    // crosshairs at the resting centre (device px).
    if (geo) {
      const half = Math.round(geo.rowStep * 0.8 * DPR);
      const cx = Math.round((geo.left + restRow.x) * DPR), cy = Math.round((geo.top + restRow.y) * DPR);
      const crop = { left: Math.max(0, cx - half), top: Math.max(0, cy - half), width: half * 2, height: half * 2 };
      const t0 = rows[swapIdx].t - 4 * (1000 / 60), t1 = rows[swapIdx].t + 24 * (1000 / 60);
      const pick = frames.filter((f) => f.t >= t0 - 1 && f.t <= t1 + 1);
      const tw = Math.min(crop.width, 160), k = tw / crop.width;
      const tiles = await Promise.all(pick.map(async (f) => {
        const img = await sharp(f.buf).extract(crop).resize({ width: tw }).toBuffer();
        const gx = Math.round((cx - crop.left) * k), gy = Math.round((cy - crop.top) * k);
        const over = Buffer.from(`<svg width="${tw}" height="${tw}"><line x1="${gx}" y1="0" x2="${gx}" y2="${tw}" stroke="#0f0" stroke-width="1" opacity="0.7"/><line x1="0" y1="${gy}" x2="${tw}" y2="${gy}" stroke="#0f0" stroke-width="1" opacity="0.7"/><rect width="${tw}" height="16" fill="black" opacity="0.7"/><text x="3" y="12" fill="white" font-size="11" font-family="monospace">${Math.round(f.t - rows[swapIdx].t)}ms</text></svg>`);
        return sharp(img).composite([{ input: over, top: 0, left: 0 }]).toBuffer();
      }));
      if (tiles.length) {
        const cols = Math.min(tiles.length, 14);
        await sharp({ create: { width: cols * tw, height: Math.ceil(tiles.length / cols) * tw, channels: 3, background: "#000" } })
          .composite(tiles.map((input, i) => ({ input, left: (i % cols) * tw, top: Math.floor(i / cols) * tw })))
          .jpeg({ quality: 88 }).toFile(path.join(OUT, `${NAME}-mult-${key}-strip.jpg`));
      }
    }
  }
  if (!out.cells.length) md.push("(no new multiplier landed in this round)");
  fs.writeFileSync(path.join(OUT, `${NAME}-mult-trace.md`), md.join("\n"));
  fs.writeFileSync(path.join(OUT, `${NAME}-mult-trace.json`), JSON.stringify(out, null, 1));
  const moved = out.cells.reduce((n, c) => n + c.flagged.filter((f) => f.moved).length, 0);
  const scaled = out.cells.reduce((n, c) => n + c.flagged.filter((f) => f.scaled).length, 0);
  const worst = out.cells.reduce((m, c) => Math.max(m, c.maxMovePx), 0);
  const jumps = out.cells.map((c) => (c.swapJump ? Math.max(Math.abs(c.swapJump.dx), Math.abs(c.swapJump.dy)) : 0));
  console.log(`${NAME}: ${out.cells.length} multiplier cell(s); swap jump ${Math.max(0, ...jumps)}px; after landing: ${moved} frames moved (max ${worst}px CSS), ${scaled} frames scaled`);
}

/** Evenly spaced frames → animated WebP at `speed` (1 = real time). Every
 *  `step`-th frame is kept so each frame shows for ≥ 20ms (browsers stretch
 *  shorter ones), with one constant delay, so playback time is exact. */
async function writeWebp(frames, file, speed, width) {
  const dt = frames.length > 1 ? (frames[frames.length - 1].t - frames[0].t) / (frames.length - 1) : 1000 / 60;
  const step = Math.max(1, Math.ceil((20 * speed) / dt));
  const kept = frames.filter((_, i) => i % step === 0);
  const scaled = await Promise.all(kept.map((f) => sharp(f.buf).resize({ width }).png().toBuffer()));
  const delay = Math.round((dt * step) / speed);
  await sharp(scaled, { join: { animated: true } })
    .webp({ quality: 70, loop: 0, delay: kept.map(() => delay), effort: 2, minSize: false, mixed: false })
    .toFile(file);
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    "--no-first-run", "--hide-scrollbars", `--force-device-scale-factor=${DPR}`, "--mute-audio", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => {
    let buf = "";
    chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
  });
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: VCLOCK });
  if (SEED) await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEEDABLE_RNG });
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: DPR, mobile: W < 900 });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
  for (let i = 0; i < 150; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && typeof state !== "undefined" && !!state.sessionId`)) break; }
  await sleep(1200);
  if (flag("turbo")) await evaluate(cdp, `(() => { if (!state.turbo) document.getElementById("turboBtn")?.click(); state.turbo = true; return true; })()`);
  // Re-roll the round until it has a tumble chain (standalone engine, no money involved).
  await evaluate(cdp, `(() => { const real = window.__realApi || api; window.__realApi = real; api = async (p, payload) => { if (p !== "/api/v1/spin") return real(p, payload);
    const eng = await getEngine(); const snap = Object.fromEntries(Object.entries(eng.session).filter(([, v]) => v === null || typeof v !== "object"));
    const scat = (m) => { const o = []; (m || []).forEach((row, r) => (row || []).forEach((x, c) => { if (x === "SCATTER") o.push(r + "-" + c); })); return o; };
    const moved = (r) => { const fin = new Set(scat((r.tumble_steps || []).slice(-1)[0]?.matrix)); return (r.tumble_steps || []).some((st) => scat(st.matrix).some((k) => !fin.has(k))); };
    for (let i = 0; i < ${MULT || SCATTER_MOVE ? 20000 : 400}; i++) {
      ${SEED ? `Object.assign(eng.session, snap); window.__seedRng(${JSON.stringify(SEED)} + "/" + i);` : ""}
      let r; try { r = await real(p, { ...payload, spin_id: crypto.randomUUID() }); } finally { ${SEED ? "window.__seedRng(null);" : ""} }
      if (${SCATTER_MOVE}) { if (Number(r.free_spins_awarded) > 0 && moved(r) && !(r.events || []).length) { console.log("[motion-record] seed index " + i); return r; } continue; }
      if ((r.tumble_steps || []).length >= ${TUMBLES} && !r.free_spins_awarded
      && (!${MULT} || (Number(r.multiplier_applied) > 1 && Number(r.total_win) > 0 && !(r.events || []).length))
      && (!${MULT_REFILL} || (!(r.tumble_steps[0].multipliers || []).length && r.tumble_steps.some((st) => (st.multipliers || []).length)))) return r; }
    return real(p, payload); }; return true; })()`);
  // Keep the round that was played (the trace watches its multiplier cells).
  await evaluate(cdp, `(() => { const inner = api; api = async (p, payload) => { const r = await inner(p, payload); if (p === "/api/v1/spin" && !window.__picked) window.__picked = r; return r; }; return true; })()`);

  // Deterministic capture: the page's clock (performance.now, timers, rAF;
  // VCLOCK below) is switched to manual and advanced exactly one 60fps frame
  // at a time, each frame screenshotted, so every frame is there and evenly
  // spaced however slow the capture itself is. The spin is pressed 300ms in.
  const frames = [];
  const trace = [];
  const FRAME = 1000 / 60;
  const advance = (ms) => evaluate(cdp, `__vclock.advance(${ms})`);
  const maxMs = Number(opt("ms", 6000));
  await evaluate(cdp, `(__vclock.manual(), true)`);
  let pressed = false;
  let idleSince = null;
  for (let t = 0; t <= maxMs; t += FRAME) {
    if (!pressed && t >= 300) {
      if (TRACE) await evaluate(cdp, `(reelRenderer._traceDraw = [], true)`);
      await evaluate(cdp, `(document.getElementById("spinBtn") || el.spinBtn).click(), true`);
      pressed = true;
    }
    await advance(FRAME);
    const shot = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 85 });
    frames.push({ t, buf: Buffer.from(shot.data, "base64") });
    if (TRACE && pressed) {
      trace.push({ t, ...(await evaluate(cdp, `(() => {
        const all = reelRenderer._traceDraw || []; reelRenderer._traceDraw = [];
        const p = window.__picked;
        const watch = new Set((p?.tumble_steps || []).flatMap((s) => (s.multipliers || []).map((m) => m.row + "-" + m.col)));
        return { drew: all.length > 0, cells: all.filter((e) => watch.has(e.key)) };
      })()`)) });
    }
    if (pressed && t > 800 && Math.round(t / FRAME) % 6 === 0) {
      const busy = await evaluate(cdp, `isRoundInFlight()`);
      if (!busy && idleSince === null) idleSince = t;
      if (busy) idleSince = null;
      if (idleSince !== null && t - idleSince > 600) break;
    }
  }
  const geo = TRACE ? await evaluate(cdp, `(() => { const r = el.reels.getBoundingClientRect(); const L = reelRenderer.getLayout(); return { left: r.left, top: r.top, rowStep: L.rowStep, laneW: L.laneW }; })()`) : null;
  cdp.close(); chrome.kill(); server.close();

  fs.mkdirSync(OUT, { recursive: true });
  if (TRACE) await writeMultTrace(trace, frames, geo);
  const span = frames.length ? frames[frames.length - 1].t : 0;
  const fps = frames.length / Math.max(0.001, span / 1000);
  const width = Math.min(W, 960);
  // --strip <col>:<fromMs>-<toMs>: one reel (column `col`), every frame, side
  // by side at full size: to judge a landing frame by frame.
  const strip = opt("strip", "");
  if (strip) {
    const [, col, a, b] = /^(\d+):(\d+)-(\d+)$/.exec(strip).map(Number);
    const laneW = (710 - 2 * 15) / 6;
    const crop = { left: Math.round(290 + 15 + laneW * col - 8), top: 8, width: Math.round(laneW + 16), height: 600 };
    const picked = frames.filter((f) => f.t >= a && f.t <= b);
    const tiles = await Promise.all(picked.map(async (f) => {
      const img = await sharp(f.buf).extract(crop).toBuffer();
      const label = Buffer.from(`<svg width="${crop.width}" height="20"><rect width="${crop.width}" height="20" fill="black"/><text x="4" y="15" fill="white" font-size="13" font-family="monospace">${Math.round(f.t)}</text></svg>`);
      return sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer();
    }));
    await sharp({ create: { width: crop.width * tiles.length, height: crop.height, channels: 3, background: "#000" } })
      .composite(tiles.map((input, i) => ({ input, left: i * crop.width, top: 0 })))
      .jpeg({ quality: 85 }).toFile(path.join(OUT, `${NAME}-strip.jpg`));
  }
  // --sheet <fromMs>-<toMs>/<stepMs>: a contact sheet of the board, one tile per step.
  const sheet = opt("sheet", "");
  if (sheet) {
    const [, a, b, step] = /^(\d+)-(\d+)\/(\d+)$/.exec(sheet).map(Number);
    const crop = { left: 290, top: 8, width: 710, height: 600 }; // the board at 1280x800
    const tiles = [];
    for (let t = a; t <= b; t += step) {
      const f = frames.reduce((best, x) => (Math.abs(x.t - t) < Math.abs(best.t - t) ? x : best), frames[0]);
      const img = await sharp(f.buf).extract(crop).resize({ width: 284 }).toBuffer();
      const label = Buffer.from(`<svg width="284" height="22"><rect width="284" height="22" fill="black"/><text x="6" y="16" fill="white" font-size="14" font-family="monospace">${Math.round(f.t)}ms</text></svg>`);
      tiles.push(await sharp(img).composite([{ input: label, top: 0, left: 0 }]).toBuffer());
    }
    const meta = await sharp(tiles[0]).metadata();
    const cols = 6;
    const rows = Math.ceil(tiles.length / cols);
    await sharp({ create: { width: cols * meta.width, height: rows * meta.height, channels: 3, background: "#000" } })
      .composite(tiles.map((input, i) => ({ input, left: (i % cols) * meta.width, top: Math.floor(i / cols) * meta.height })))
      .jpeg({ quality: 80 }).toFile(path.join(OUT, `${NAME}-sheet.jpg`));
  }
  // One SHA-256 per captured frame: two builds recording the same seeded round show the
  // same motion exactly when the lists match (diff the two files).
  fs.writeFileSync(path.join(OUT, `${NAME}-frames.sha256`), frames.map((f) => require("crypto").createHash("sha256").update(f.buf).digest("hex")).join("\n") + "\n");
  await writeWebp(frames, path.join(OUT, `${NAME}.webp`), 1, width);
  await writeWebp(frames, path.join(OUT, `${NAME}-slow4x.webp`), 0.25, width);
  console.log(`${NAME}: ${frames.length} frames over ${(span / 1000).toFixed(1)}s (${fps.toFixed(0)} fps) -> ${OUT}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
