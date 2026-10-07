// One-off verification for Step 1: tokens resolve, fonts load, no console
// errors/warnings, plus phone + desktop screenshots. Borrows layout-check's
// zero-dependency CDP approach.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// Temp Chrome profiles: removed on exit so probe runs do not pile up in the OS temp dir.
const _tempProfiles = [];
function tempProfile(prefix) {
  // A profile Chrome still held at our exit (Windows keeps child processes alive a
  // few seconds after kill) is swept by the next run, once it is over an hour old.
  if (!_tempProfiles.length) {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(prefix) || name.startsWith(`${prefix}out-`)) continue; // keep screenshot output dirs
      const full = path.join(os.tmpdir(), name);
      try { if (Date.now() - fs.statSync(full).mtimeMs > 3600e3) fs.rmSync(full, { recursive: true, force: true }); } catch { /* in use */ }
    }
  }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tempProfiles.push(d);
  return d;
}
process.on("exit", () => {
  // Chrome may still be releasing its files just after kill(): retry briefly.
  for (const d of _tempProfiles) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ } }
});

// Usage: node tools/probes/<name>.js [repoRoot] [outDir]  (defaults: this repo, a temp dir)
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."), "client");
const OUT = process.argv[3] || fs.mkdtempSync(path.join(os.tmpdir(), "vx-probe-out-"));
const PORT = 3127;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".wav": "audio/wav" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${tempProfile("vx-probe-")}`,
    "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => {
    let buf = "";
    chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
  });
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  const logs = [];
  cdp.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(m.params.type))
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
    if (m.method === "Network.loadingFailed") logs.push(`netfail: ${m.params.errorText}`);
    if (m.method === "Network.responseReceived" && m.params.response.status >= 400) logs.push(`http ${m.params.response.status}: ${m.params.response.url}`);
  });
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable"); await cdp.send("Network.enable");

  let failed = false;
  const check = (name, ok, detail = "") => {
    console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? "  (" + detail + ")" : ""}`);
    if (!ok) failed = true;
  };
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && !!state.sessionId`)) break; }
  await sleep(800);
  // Sound log: every Sound.play with its time.
  await evaluate(cdp, `(() => { const real = window.Sound.play; window.__snd = []; window.Sound.play = (n, o) => { __snd.push({ n, i: o?.index, t: performance.now() }); return real(n, o); }; return true; })()`);
  const waitIdle = async () => { for (let i = 0; i < 400; i++) { if (!(await evaluate(cdp, "isRoundInFlight()"))) break; await sleep(50); } await sleep(400); };

  // Warm the audio graph: the first Sound.play builds the AudioContext
  // synchronously (~30ms headless), which would skew the next timestamps.
  await evaluate(cdp, `(window.Sound.play("click"), true)`); await sleep(100);
  console.log("\nspin-out: the old board falls out as reel stacks, no wind-up (#47)");
  const out = await evaluate(cdp, `(async () => {
    const R = __reelRenderer;
    R.dropOff(); const ex = R.fx.exit; const samples = []; let minAll = 0, hidden = R.board.hidden;
    while (R.fx.exit === ex) {
      const now = performance.now(); const o = [];
      for (let c = 0; c < R.cols; c++) { const y = R.exitOffsetRows(ex, c, now); minAll = Math.min(minAll, y); o.push(y); }
      samples.push({ t: now - ex.start, o });
      await new Promise((r) => requestAnimationFrame(r));
    }
    const first = (c) => (samples.find((s) => s.o[c] > 0) || { t: Infinity }).t;
    const done = samples.length ? samples[samples.length - 1].t : 0;
    R.setBoard(R.board.matrix || [], {}); // show the board again for the next checks
    return { minAll, hidden, frames: samples.length, first0: first(0), first5: first(5), colMs: ex.colMs, dur: ex.duration, done };
  })()`);
  check("no reel ever moves up during the spin-out", out.minAll >= 0, `${out.frames} frames`);
  check("gravity takes over at once: reel 1 is falling on the first frames", out.first0 < 40, `${out.first0.toFixed(0)}ms`);
  check("reels leave left to right, spinColMs apart", out.first5 > out.first0 && Math.abs(out.first5 - out.first0 - 5 * out.colMs) < 40,
    `reel 6 starts ${(out.first5 - out.first0).toFixed(0)}ms after reel 1 (${out.colMs}ms × 5)`);
  check("the old board is its own layer and is gone once it has fallen out", out.hidden && out.done < out.dur * 1.2 + 5 * out.colMs + 80,
    `cleared at ${out.done.toFixed(0)}ms`);

  console.log("\ngravity + one real bounce (#47)");
  const grav = await evaluate(cdp, `(() => {
    const R = __reelRenderer, rs = R.getLayout().rowStep, saved = R.fx.drop, out = {};
    const p = R.reelProfile(0);
    for (const n of [1, 2, 5]) {
      const row = 5 - n, key = row + "-0";
      const mk = (t) => ({ start: performance.now() - t, duration: 360, map: { [key]: n }, heavy: new Map() });
      R.fx.drop = mk(0); const total = R.cellFallMs(0, n), impact = total * p.contact;
      const ys = []; for (let t = 0; t <= Math.ceil(total) + 2; t += 1) { R.fx.drop = mk(t); ys.push(R.cellOffset(row, 0, rs) / rs); }
      const start = ys[0];
      const hit = ys.findIndex((y, i) => i > 0 && ys[i - 1] < y && ys[i + 1] !== undefined && ys[i + 1] < y); // the turn-around
      const firstZero = Math.round(impact);
      const after = ys.slice(firstZero);
      const peak = -Math.min(...after);           // bounce height above the slot, rows
      const fallen = (t) => (ys[t] - start);        // rows covered at t
      out[n] = { total, impact, firstZero, hit, start, peak, end: ys[ys.length - 1],
        quarter: fallen(Math.round(impact / 4)), half: fallen(Math.round(impact / 2)) };
    }
    R.fx.drop = saved; return { out, contact: p.contact, e: GRAVITY.restitution };
  })()`);
  const G = grav.out;
  check("one gravity: fall time grows with √distance (2 rows vs 1: ×√2)", Math.abs(G[2].impact / G[1].impact - Math.SQRT2) < 0.01 && Math.abs(G[5].impact / G[1].impact - Math.sqrt(5)) < 0.01,
    `impact at ${G[1].impact.toFixed(0)} / ${G[2].impact.toFixed(0)} / ${G[5].impact.toFixed(0)}ms for 1 / 2 / 5 rows`);
  check("falls from rest under constant acceleration (s ∝ t²: a quarter of the time, a sixteenth of the way)",
    [1, 2, 5].every((n) => Math.abs(G[n].half / G[n].quarter - 4) < 0.35), [1, 2, 5].map((n) => (G[n].half / G[n].quarter).toFixed(2)).join(" / "));
  check("hits its slot exactly on its predicted impact (and turns round there)", [1, 2, 5].every((n) => Math.abs(G[n].hit - G[n].impact) <= 1.5),
    [1, 2, 5].map((n) => `${G[n].hit}/${G[n].impact.toFixed(1)}ms`).join(", "));
  check("one real bounce: rebound height = e² of the fall, then it rests exactly in its slot",
    [1, 2, 5].every((n) => Math.abs(G[n].peak - grav.e * grav.e * -G[n].start) < 0.004 && G[n].end === 0),
    [1, 2, 5].map((n) => `${n} row${n > 1 ? "s" : ""}: ${(G[n].peak * 100).toFixed(1)}% of a row`).join(", "));

  console.log("\nimpact squash follows impact speed (#47)");
  const deform = await evaluate(cdp, `(() => {
    const R = __reelRenderer, saved = R.fx.drop, out = {};
    for (const n of [1, 5]) {
      const row = 5 - n, key = row + "-0";
      const mk = (t) => ({ start: performance.now() - t, duration: 360, map: { [key]: n }, heavy: new Map() });
      R.fx.drop = mk(0); const total = R.cellFallMs(0, n), impact = total * R.reelProfile(0).contact;
      let minSy = 1, inFlight = 1, after = 1;
      for (let t = 0; t <= total + 2; t += 1) {
        R.fx.drop = mk(t); const d = R.dropDeform(row, 0);
        if (t < impact - 1) inFlight = Math.min(inFlight, d.sy, 2 - d.sx);
        minSy = Math.min(minSy, d.sy); if (t > total) after = d.sy;
      }
      out[n] = { minSy, inFlight, after };
    }
    R.fx.drop = saved; return { out, squash: GRAVITY.squash };
  })()`);
  const D = deform.out;
  check("rigid in flight, flattened on impact, back to shape before it rests", [1, 5].every((n) => D[n].inFlight === 1 && D[n].minSy < 1 && D[n].after === 1));
  check("a full-reel fall squashes by GRAVITY.squash; a one-row refill much less", Math.abs(1 - D[5].minSy - deform.squash) < 0.002 && (1 - D[1].minSy) < (1 - D[5].minSy) * 0.6,
    `5 rows ${((1 - D[5].minSy) * 100).toFixed(1)}%, 1 row ${((1 - D[1].minSy) * 100).toFixed(1)}%`);

  console.log("\ncluster blast: pop, shockwave light, dust (#54)");
  await waitIdle();
  const blast = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const m = R.board.matrix.map((r) => r.slice());
    const cells = []; for (let r = 1; r < 5; r++) for (let c = 1; c < 3; c++) { m[r][c] = "BLUE_DIAMOND"; cells.push({ row: r, col: c }); }
    R.setBoard(m, { multipliers: [] });
    const els = [".vault-window", ".reels-stage"].map((s) => document.querySelector(s)); const base = els.map((e) => e.getBoundingClientRect());
    let moved = 0, maxDust = 0, litFar = 0, litNear = 0, firstNear = 0, firstFar = 0;
    const near = R.cellCenter(2, 3), far = R.cellCenter(2, 5); const t0 = performance.now();
    const p = R.explode(cells, 380, "blast-medium");
    const waves = () => R.fx.waves.length;
    let hadWave = 0;
    while (performance.now() - t0 < 900) {
      hadWave = Math.max(hadWave, waves()); maxDust = Math.max(maxDust, R.shards.dust);
      const now = performance.now(), a = R.waveLight(near.x, near.y, now).a, b = R.waveLight(far.x, far.y, now).a;
      if (a > litNear) { litNear = a; firstNear = now - t0; } if (b > litFar) { litFar = b; firstFar = now - t0; }
      els.forEach((e, k) => { const r = e.getBoundingClientRect(); moved = Math.max(moved, Math.abs(r.x - base[k].x), Math.abs(r.y - base[k].y)); });
      await new Promise((r) => requestAnimationFrame(r));
    }
    await p;
    return { hadWave, maxDust, litNear, litFar, firstNear, firstFar, moved, dustLeft: R.shards.dust, small: (() => {
      R.fx.waves = []; R.spawnClusterBlast(cells.slice(0, 7), "medium"); const n = R.fx.waves.length; R.fx.waves = []; return n; })() };
  })()`);
  check("an 8-symbol cluster sends one shockwave; 7 symbols send none", blast.hadWave === 1 && blast.small === 0);
  check("the front lights the symbols it passes, nearer ones first", blast.litNear > 0.2 && blast.litFar > 0 && blast.firstNear < blast.firstFar,
    `near ${blast.litNear.toFixed(2)} @${blast.firstNear.toFixed(0)}ms, far ${blast.litFar.toFixed(2)} @${blast.firstFar.toFixed(0)}ms`);
  check("dust radiates from the cluster, pooled under its cap", blast.maxDust > 0 && blast.maxDust <= 256, `${blast.maxDust} puffs`);
  check("no shake: the board never moved during the blast", blast.moved === 0);

  console.log("\nexplosion handoff: exploded symbols never come back (#50)");
  await waitIdle();
  const handoff = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const results = [];
    const others = ["RED_RUBY", "PURPLE_GEM", "GREEN_GEM", "GOLD_RING", "HOURGLASS"];
    for (const size of [8, 15, 25]) {
      const m = []; const cells = [];
      for (let r = 0; r < R.rows; r++) { m.push([]); for (let c = 0; c < R.cols; c++) m[r].push(others[(r * 7 + c * 3) % others.length]); }
      for (let k = 0; k < size; k++) { const r = R.rows - 1 - (k % R.rows), c = Math.floor(k / R.rows); m[r][c] = "BLUE_DIAMOND"; cells.push({ row: r, col: c }); }
      const next = m.map((row) => row.map((s) => (s === "BLUE_DIAMOND" ? "GOLD_RING" : s)));
      R.setBoard(m, {});
      const realDraw = R.draw.bind(R); let phase = "hold"; const leaks = []; let blastFrames = 0, afterFrames = 0, burstPeakDrawn = 0;
      const clearedKeys = new Set(cells.map((p) => p.row + "-" + p.col));
      R.draw = (...x) => {
        R._traceCells = new Set(); const out = realDraw(...x);
        if (phase === "after") {
          afterFrames++;
          for (const k of clearedKeys) if (R._traceCells.has(k) && !(Number(R.fx.drop?.map?.[k] || 0) > 0)) leaks.push(k);
        }
        if (phase === "burst" && R.fx.blast) blastFrames++;
        R._traceCells = null; return out; };
      await R.highlight(m, { winning: cells }, 200);
      phase = "burst";
      await R.explode(cells, 380, "blast-medium");
      phase = "after";
      await R.vacuum(cells);
      await new Promise((r) => setTimeout(r, 40)); // the await gap the round loop has before the refill
      const dropMap = buildDropMap(m, cells);
      await R.drop(next, [], dropMap, 360, { tempo: 1 });
      R.draw = realDraw;
      results.push({ size, leaks: leaks.length, afterFrames, blastFrames, clearedOnNew: R.board.cleared.size });
    }
    return results;
  })()`);
  for (const h of handoff) {
    check(`${h.size}-symbol cluster: gone after its burst, never redrawn before the refill`, h.leaks === 0 && h.afterFrames > 3 && h.blastFrames > 3 && h.clearedOnNew === 0,
      `${h.afterFrames} frames between the burst and the settled refill, ${h.leaks} leaked`);
  }
  check("a burst's own symbol is gone by BLAST_GONE of it (no see-through ghost)", await evaluate(cdp, `BLAST_GONE <= 0.5`));

  console.log("\npacing: short win hold, refill under the shards, readable turbo (#48)");
  await waitIdle();
  const pace = await evaluate(cdp, `(async () => {
    const real = window.__realApi || api; window.__realApi = real;
    api = async (p, payload) => { if (p !== "/api/v1/spin") return real(p, payload);
      for (;;) { const r = await real(p, { ...payload, spin_id: crypto.randomUUID() }); if ((r.tumble_steps || []).length >= 3 && !r.free_spins_awarded && Number(r.total_win) / Number(payload.bet_amount || 1) < 10) return r; } };
    const R = __reelRenderer; const runs = {};
    for (const turbo of [false, true]) {
      state.turbo = turbo;
      await new Promise((r) => setTimeout(r, 400)); // past SPIN_SETTLE_GUARD_MS, or the press is a late skip
      const ev = []; const wrap = (n) => { const f = R[n].bind(R); R[n] = (...a) => { ev.push({ n, t: performance.now(), d: a[2] && typeof a[2] === "number" ? a[2] : null }); return f(...a); }; return f; };
      const orig = { highlight: wrap("highlight"), explode: wrap("explode"), drop: wrap("drop") };
      // A drop() that ends a burst: note when its symbols' art is gone (charge + BLAST_GONE).
      el.spinBtn.click();
      await new Promise((r) => setTimeout(r, 200));
      while (isRoundInFlight()) await new Promise((r) => setTimeout(r, 30));
      Object.assign(R, orig);
      const holds = []; const gaps = [];
      for (let k = 0; k < ev.length; k++) {
        if (ev[k].n === "explode") {
          const h = [...ev.slice(0, k)].reverse().find((e) => e.n === "highlight");
          const d = ev.slice(k).find((e) => e.n === "drop");
          if (h) holds.push(ev[k].t - h.t);
          if (d) gaps.push(d.t - ev[k].t);
        }
      }
      runs[turbo ? "turbo" : "normal"] = { holds, gaps };
    }
    state.turbo = false; api = real;
    return { runs, first: ANIMATION_TIMING.celebrateHoldFirst, chain: ANIMATION_TIMING.celebrateHoldChain,
      charge: PACING.charge, explode: ANIMATION_TIMING.explode, gone: BLAST_GONE, turbo: TURBO_SCALE };
  })()`);
  const N = pace.runs.normal, T = pace.runs.turbo;
  check("the caught cluster is held 200-300ms, then it bursts (first catch longest, chains snappier)",
    N.holds.length >= 2 && N.holds[0] >= 200 && N.holds[0] <= 340 && N.holds.slice(1).every((h) => h >= 190 && h <= 270),
    N.holds.map((h) => h.toFixed(0) + "ms").join(" → "));
  const maxGap = Math.max(...pace.charge ? Object.values(pace.charge) : [0]) + pace.explode * pace.gone + 30 + 60;
  check("the refill starts falling as soon as the burst's symbols are gone (no empty-board wait)",
    N.gaps.length >= 2 && N.gaps.every((g) => g <= maxGap), N.gaps.map((g) => g.toFixed(0) + "ms").join(", ") + ` (≤ ${maxGap.toFixed(0)})`);
  const ratio = (T.holds[0] || 0) / (N.holds[0] || 1);
  check("turbo is 2.0-2.5x the pace (holds scale by TURBO_SCALE, once)",
    pace.turbo >= 0.4 && pace.turbo <= 0.5 && Math.abs(ratio - pace.turbo) < 0.1, `turbo hold ${T.holds.map((h) => h.toFixed(0)).join("/")}ms = ×${ratio.toFixed(2)}`);

  console.log("\nwin focus + idle breathing (#55)");
  await waitIdle();
  const focus = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const m = R.board.matrix.map((r) => r.slice());
    const cells = []; for (let r = 1; r < 5; r++) for (let c = 1; c < 3; c++) { m[r][c] = "BLUE_DIAMOND"; cells.push({ row: r, col: c }); }
    const lvl = () => envelopeLevel(R.focus, performance.now());
    const t0 = performance.now(); const h = R.highlight(m, { winning: cells }, 600); const s = [];
    while (performance.now() - t0 < 600) { s.push({ t: performance.now() - t0, l: lvl() }); await new Promise((r) => requestAnimationFrame(r)); }
    await h; const afterHold = lvl();
    await R.explode(cells, 380, "blast-small"); const afterBlast = lvl();
    const inSet = R.focus.set.has("1-1"), outSet = R.focus.set.has("0-0");
    const d0 = performance.now(); const dp = R.drop(m, [], { "1-1": 1 }, 380, { tempo: 1 }); const out = [];
    while (performance.now() - d0 < 400) { out.push({ t: performance.now() - d0, l: lvl() }); await new Promise((r) => requestAnimationFrame(r)); }
    await dp;
    const at = (arr, ms) => (arr.find((x) => x.t >= ms) || arr[arr.length - 1]).l;
    return { early: at(s, 60), mid: at(s, 125), full: at(s, 300), afterHold, afterBlast, inSet, outSet,
      outMid: at(out, 120), outEnd: at(out, 320), dim: FOCUS.dim };
  })()`);
  check("the rest of the board fades back over ~250ms when a cluster is caught", focus.early > 0 && focus.early < focus.mid && focus.mid < 1 && focus.full === 1 && focus.inSet && !focus.outSet,
    `level ${focus.early.toFixed(2)} @60ms, ${focus.mid.toFixed(2)} @125ms, ${focus.full} @300ms`);
  check(`non-winners at ${(1 - focus.dim) * 100}% opacity, held through the hold and the blast`, focus.dim === 0.4 && focus.afterHold === 1 && focus.afterBlast === 1);
  check("the refill brings the board back up smoothly (~260ms)", focus.outMid > 0 && focus.outMid < 1 && focus.outEnd === 0,
    `level ${focus.outMid.toFixed(2)} @120ms, ${focus.outEnd} @320ms`);

  await waitIdle(); await sleep(900);
  const breath = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const idle = R.isIdle(); const per = [];
    const t0 = performance.now(); let maxB = 0, minB = 1e9;
    for (let k = 0; k < 6; k++) per.push([]);
    while (performance.now() - t0 < 3100) {
      const now = performance.now();
      for (let c = 0; c < 6; c++) { const b = R.breathOffset(2, c, now); per[c].push(b); maxB = Math.max(maxB, b); minB = Math.min(minB, b); }
      await new Promise((r) => setTimeout(r, 25));
    }
    const peakAt = per.map((a) => a.indexOf(Math.max(...a)));
    // A spin starts: the float settles DOWN to the slot, quickly, never up.
    const before = R.breathOffset(2, 0, performance.now()); el.spinBtn.click(); const s = [];
    const c0 = performance.now();
    while (performance.now() - c0 < 160) { s.push(R.breathOffset(2, 0, performance.now())); await new Promise((r) => requestAnimationFrame(r)); }
    let rose = 0; for (let i = 1; i < s.length; i++) if (s[i] > s[i - 1] + 1e-6) rose++;
    while (isRoundInFlight()) await new Promise((r) => setTimeout(r, 50));
    return { idle, maxB, minB, peaks: new Set(peakAt).size, before, settled: s[s.length - 1], rose, idleAfterSpinStart: s.length };
  })()`);
  check("idle symbols breathe 0-1.5px above their slot over a 3s sine", breath.idle && breath.maxB > 1.3 && breath.maxB <= 1.5 + 1e-9 && breath.minB < 0.2 && breath.minB >= 0,
    `range ${breath.minB.toFixed(2)}-${breath.maxB.toFixed(2)}px`);
  check("each symbol breathes on its own phase (staggered)", breath.peaks >= 4, `${breath.peaks}/6 distinct peak times`);
  check("a spin stops the breath at once, settling down (never lifting)", breath.settled === 0 && breath.rose === 0,
    `${breath.before.toFixed(2)}px → 0 in under 160ms`);

  console.log("\nreels land as stacks, no dead air between spins (#47)");
  await waitIdle();
  const sync = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; __snd.length = 0; const lands = []; const realS = R.symbolsLanded.bind(R);
    R.symbolsLanded = (rows, c) => { lands.push({ rows: rows.slice(), c, t: performance.now(), n: R.shards.live }); realS(rows, c); lands[lands.length - 1].added = R.shards.live - lands[lands.length - 1].n; };
    let ticks = 0; const realTick = R.onSymbolLand; R.onSymbolLand = (r, c) => { ticks++; realTick?.(r, c); };
    const realDrop = R.drop.bind(R); let pred = null, start = 0;
    const realAntic = R.makeAnticipation; R.makeAnticipation = () => null; // judge the plain landing beat
    const press = performance.now(); let firstMove = 0, emptyFrames = 0, watching = true;
    const watch = () => { if (!watching) return;
      // A frame with neither the old board (fx.exit) nor the new one showing is dead air.
      if (!R.fx.exit && (R.board.hidden || !R.fx.drop) && performance.now() - press < 600 && !firstMove) emptyFrames++;
      if (!firstMove && R.fx.exit && R.exitOffsetRows(R.fx.exit, 0, performance.now()) > 0) firstMove = performance.now() - press;
      requestAnimationFrame(watch); };
    R.drop = async (...a) => { const p = realDrop(...a); if (!pred && R.fx.drop) { start = R.fx.drop.start; pred = {};
      for (const k of Object.keys(R.fx.drop.map)) { const [r, c] = k.split("-").map(Number); const n = R.fx.drop.map[k];
        pred[k] = R.dropDelay(r, c, n) + R.cellFallMs(c, n) * R.reelProfile(c).contact; } } return p; };
    el.spinBtn.click(); requestAnimationFrame(watch);
    for (let i = 0; i < 200 && !pred; i++) await new Promise((r) => setTimeout(r, 5));
    const resultAt = start - press;
    await new Promise((r) => setTimeout(r, 1300));
    watching = false; R.drop = realDrop; R.symbolsLanded = realS; R.onSymbolLand = realTick; R.makeAnticipation = realAntic;
    // Each reel's landing thud (a multiplier's BANG plays its own reel_stop too).
    const seen = new Set();
    const thuds = __snd.filter((s) => s.n === "reel_stop" && s.i >= 0 && s.t >= start && !seen.has(s.i) && seen.add(s.i)).map((s) => ({ c: s.i, t: s.t - start }));
    return { pred, ticks, thuds, resultAt, firstMove, emptyFrames, colMs: WATERFALL.spinColMs,
      lands: lands.filter((l) => l.t >= start).map((l) => ({ rows: l.rows, c: l.c, t: l.t - start, added: l.added })) };
  })()`);
  const L = sync.lands.slice(0, 6);
  check("the new board starts falling in as soon as the result is in, behind the old one (no dead air)", sync.resultAt < 60 && sync.emptyFrames === 0 && sync.firstMove < 40,
    `result at ${sync.resultAt.toFixed(0)}ms, old board moving at ${sync.firstMove.toFixed(0)}ms`);
  check("each reel lands as one stack: all 5 symbols at once, one tick", L.length === 6 && L.every((l) => l.rows.length === 5) && sync.ticks === 6,
    L.map((l) => `r${l.c + 1}:${l.rows.length}`).join(" ") + `; ${sync.ticks} ticks`);
  const err = L.map((l) => Math.abs(l.t - sync.pred[`0-${l.c}`]));
  check("…on its predicted moment, reels left to right spinColMs apart", Math.max(...err) < 20 && L.every((l, k) => k === 0 || Math.abs(l.t - L[k - 1].t - sync.colMs) < 20),
    L.map((l) => `r${l.c + 1}@${l.t.toFixed(0)}`).join(" "));
  check("each stack landing gets its floor glints (2 per symbol)", L.every((l) => l.added === 10));
  check("each reel thuds as it lands", sync.thuds.length === 6 && sync.thuds.every((th) => Math.abs(th.t - L[th.c].t) < 8),
    sync.thuds.map((th) => `r${th.c + 1}@${th.t.toFixed(0)}`).join(" "));

  console.log("\ntumble refill: stacks fall together, the lower ones land first (#47)");
  const own = await evaluate(cdp, `(() => {
    const R = __reelRenderer, saved = R.fx.drop;
    R.fx.drop = { start: performance.now(), duration: 360, map: { "4-4": 1, "3-4": 1, "2-4": 2, "1-4": 2, "0-4": 2, "4-1": 1 }, heavy: new Map() };
    R.fx.drop.order = R._dropOrder(R.fx.drop.map);
    const land = (r, c, n) => R.dropDelay(r, c, n) + R.cellFallMs(c, n) * R.reelProfile(c).contact;
    const out = { low: land(4, 4, 1), low2: land(3, 4, 1), high: land(2, 4, 2), high2: land(0, 4, 2),
      rel4a: R.dropDelay(4, 4, 1), rel4b: R.dropDelay(0, 4, 2), rel1: R.dropDelay(4, 1, 1), rel4: R.dropDelay(4, 4, 1) };
    R.fx.drop = saved; return out;
  })()`);
  check("a whole reel is released at once (it falls as a stack)", own.rel4a === own.rel4b);
  check("symbols that fall as far land together; the shorter falls land first",
    own.low === own.low2 && own.high === own.high2 && own.low < own.high, `1-row ${own.low.toFixed(0)}ms, 2-row ${own.high.toFixed(0)}ms`);
  check("a refill releases reels left to right, tumbleColMs apart (no wait for reels that stay put)", own.rel1 === 0 && own.rel4 > own.rel1 && own.rel4 < 60,
    `reel 2 at ${own.rel1}ms, reel 5 at ${own.rel4}ms`);

  console.log("\ntumble vacuum");
  await waitIdle();
  const vac = await evaluate(cdp, `(async () => {
    const R = __reelRenderer, { rowStep: rs, laneW } = R.getLayout();
    const winning = [{ row: 4, col: 2 }, { row: 3, col: 2 }];
    const p = R.vacuum(winning); const s = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 26) { s.push({ dip: R.cellOffset(1, 2, rs) / rs, below: R.cellOffset(4, 1, rs) / rs, left: R.cellLeanX("4-1", laneW) / laneW, right: R.cellLeanX("4-3", laneW) / laneW, far: R.cellLeanX("0-0", laneW) }); await new Promise((r) => setTimeout(r, 4)); }
    await p;
    const atEnd = R.cellOffset(1, 2, rs) / rs;
    // the refill: cell (1,2) falls 2 → lands at (3,2)
    const m = R.board.matrix.map((r) => r.slice());
    const dp = R.drop(m, [], { "0-2": 2, "1-2": 2, "2-2": 2, "3-2": 2, "4-2": 2 }, 380, { tempo: 1 });
    const firstDrop = R.cellOffset(3, 2, rs) / rs + 2; // relative to its old slot (count 2)
    const side0 = R.cellLeanX("4-3", laneW) / laneW;
    await new Promise((r) => setTimeout(r, 160));
    const sideLater = R.cellLeanX("4-3", laneW);
    await dp;
    return { s, atEnd, firstDrop, side0, sideLater, vac: R.fx.vacuum, pull: VACUUM.pull, side: VACUUM.side };
  })()`);
  const last = vac.s[vac.s.length - 1];
  check("symbols above the void dip into it; the floor beside it does not", last.dip > 0 && last.below === 0, `dip ${last.dip.toFixed(3)} rows`);
  check("same-row neighbours lean sideways toward the void", last.left > 0 && last.right < 0 && last.far === 0, `left +${last.left.toFixed(3)}, right ${last.right.toFixed(3)} lanes`);
  check("the dip is carried into the fall (no jump at release)", Math.abs(vac.atEnd - vac.pull) < 1e-6 && Math.abs(vac.firstDrop - vac.pull) < 0.01,
    `vacuum end ${vac.atEnd.toFixed(3)} → fall start ${vac.firstDrop.toFixed(3)} rows`);
  check("side lean relaxes without overshoot and clears", vac.side0 < 0 && vac.sideLater === 0 && vac.vac === null);

  console.log("\ncascade momentum (real round)");
  await waitIdle();
  await evaluate(cdp, `(() => { const real = window.__realApi || api; window.__realApi = real; api = async (p, payload) => { if (p !== "/api/v1/spin") return real(p, payload);
    for (;;) { const r = await real(p, { ...payload, spin_id: crypto.randomUUID() }); if ((r.tumble_steps || []).length >= 4 && !r.free_spins_awarded && Number(r.total_win) / Number(payload.bet_amount || 1) < 10) return r; } }; return true; })()`);
  const mom = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const durs = []; const realDrop = R.drop.bind(R);
    R.drop = (...a) => { const p = realDrop(...a); if (R.fx.drop && !R.fx.drop.spin && Object.keys(a[2] || {}).length) durs.push({ d: R.fx.drop.duration, tempo: R.fx.drop.tempo }); return p; };
    window.__moves = { max: 0, n: 0 }; const els = [".vault-window", ".reels-stage", ".ps-center"].map((s) => document.querySelector(s)); const base = els.map((e) => e.getBoundingClientRect());
    let watch = true; const tick = () => { els.forEach((e, k) => { const b = e.getBoundingClientRect(); __moves.max = Math.max(__moves.max, Math.abs(b.x - base[k].x), Math.abs(b.y - base[k].y)); }); __moves.n++; if (watch) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    el.spinBtn.click();
    await new Promise((r) => setTimeout(r, 300));
    while (isRoundInFlight()) await new Promise((r) => setTimeout(r, 50));
    watch = false; R.drop = realDrop; return { durs, moves: __moves };
  })()`);
  const want = mom.durs.map((_, k) => Math.max(0.5, 0.85 ** k));
  check("each tumble in the chain falls (and staggers) 15% faster, floored at 50%", mom.durs.length >= 3 && mom.durs.every((x, k) => Math.abs(x.tempo - want[k]) < 1e-9),
    mom.durs.map((x) => `${x.d}ms ×${x.tempo.toFixed(3)}`).join(" → "));
  check("board never moved through a full cascade round", mom.moves.max === 0, `${mom.moves.n} frames`);
  await waitIdle();

  console.log("\nfast-stop zip (press mid-drop)");
  await evaluate(cdp, `(() => { api = window.__realApi; return true; })()`);
  const zip = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const rs = R.getLayout().rowStep;
    el.spinBtn.click();
    // wait until the opening board is in the air, ~150ms in
    for (let i = 0; i < 400; i++) { if (R.fx.drop && performance.now() - R.fx.drop.start > 150) break; await new Promise((r) => setTimeout(r, 5)); }
    __snd.length = 0;
    const t0 = performance.now(); el.spinBtn.click();
    const z = R.fx.drop?.zip; const frames = []; let maxBlur = 0; const prev = new Map(); let backwards = 0;
    while (R.fx.drop && R.fx.drop.zip && performance.now() - t0 < 400) {
      const now = performance.now() - t0; const offs = {};
      for (const k of Object.keys(R.fx.drop.map)) { const [r, c] = k.split("-").map(Number); const y = R.cellOffset(r, c, rs); if (prev.has(k) && y < prev.get(k) - 1e-6) backwards++; prev.set(k, y); maxBlur = Math.max(maxBlur, R.cellVelocity(r, c, rs)); offs[k] = y; }
      frames.push({ now, maxAbs: Math.max(0, ...Object.values(offs).map(Math.abs)) });
      await new Promise((r) => requestAnimationFrame(r));
    }
    const done = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 200));
    return { had: Boolean(z), ends: z ? z.ends : null, frames, maxBlur, backwards, done,
      snd: __snd.map((s) => ({ n: s.n, i: s.i, t: s.t - t0 })) };
  })()`);
  // Only the zip's own sounds: later tumbles in the same round thud too.
  // Each reel's lock thud (a multiplier's BANG plays its own reel_stop too).
  const zipSeen = new Set();
  const zipThuds = zip.snd.filter((s) => s.n === "reel_stop" && s.i >= 0 && s.t < 200 && !zipSeen.has(s.i) && zipSeen.add(s.i));
  const zipClicks = zip.snd.filter((s) => s.n === "click" && s.t < 250);
  const lockedBy = zip.done; // the drop is released only once every reel has locked
  check("the press zips the reels instead of teleporting them", zip.had && zip.frames.length > 2, `${zip.frames.length} zip frames`);
  check("reels lock left to right, all within 120ms", zipThuds.length >= 1 && zipThuds.every((t, k) => k === 0 || (t.i > zipThuds[k - 1].i && t.t > zipThuds[k - 1].t)) && Math.max(...zip.ends) <= 110 && Math.max(...zipThuds.map((t) => t.t)) < 130 && lockedBy < 140,
    `scheduled ${zip.ends.join("/")}ms; heard ` + zipThuds.map((t) => `r${t.i + 1}@${t.t.toFixed(0)}`).join(" ") + `; drop released at ${lockedBy.toFixed(0)}ms (first frame after the last lock)`);
  check("…then a double-click seals it", zipClicks.length === 2 && zipClicks[1].t - zipClicks[0].t >= 40 && zipClicks[1].t - zipClicks[0].t < 75,
    zipClicks.map((c) => c.t.toFixed(0) + "ms").join(", "));
  check("zip only ever moves down (no bounce) and draws motion blur", zip.backwards === 0 && zip.maxBlur > 0.5, `peak travel ${zip.maxBlur.toFixed(0)}px/frame; ghosts capped at 0.35 symbol`);
  await waitIdle();

  console.log("\nfast-stop during the spin-out: the old board clears fast, the new one zips in");
  const born = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; el.spinBtn.click();
    for (let i = 0; i < 200; i++) { if (R.fx.exit) break; await new Promise((r) => setTimeout(r, 2)); }
    const ex = R.fx.exit; const wasExit = Boolean(ex); const t0 = performance.now(); el.spinBtn.click();
    let zipped = false, clearedAt = 0;
    for (let i = 0; i < 400; i++) {
      if (R.fx.drop?.zip) zipped = true;
      if (!clearedAt && R.fx.exit !== ex) clearedAt = performance.now() - t0;
      if (zipped && clearedAt) break;
      await new Promise((r) => setTimeout(r, 2)); }
    while (isRoundInFlight()) await new Promise((r) => setTimeout(r, 50));
    return { wasExit, fast: Boolean(ex?.fastAt), zipped, clearedAt, pending: R._zipPending };
  })()`);
  check("press during the spin-out → the old board falls out fast and the new board zips in", born.wasExit && born.fast && born.zipped && born.clearedAt > 0 && born.clearedAt < 300 && born.pending === false,
    `old board gone ${born.clearedAt.toFixed(0)}ms after the press`);
  await waitIdle();
  let live = -1;
  for (let i = 0; i < 40; i++) { live = await evaluate(cdp, `__reelRenderer.shards.live`); if (live === 0) break; await sleep(100); }
  check("shard pool drained (dust counter back to 0)", live === 0 && (await evaluate(cdp, `__reelRenderer.shards.dust`)) === 0);
  check("vacuum and zip state left clean", await evaluate(cdp, `__reelRenderer.fx.vacuum == null && !__reelRenderer.fx.drop`));

  console.log("\nmultiplier magnetism: Bézier flight + pooled trail (#52)");
  await waitIdle();
  const soul = await evaluate(cdp, `(async () => {
    // The path: exact ends, lifted above both, positions even along its length.
    const P = soulPath(100, 400, 600, 300); const q = { x: 0, y: 0 };
    const pts = [0, 0.25, 0.5, 0.75, 1].map((d) => { const o = P.at(d, q); return { x: o.x, y: o.y }; });
    const fine = []; for (let i = 0; i <= 200; i++) { const o = P.at(i / 200, q); fine.push({ x: o.x, y: o.y }); }
    let arc = 0; const marks = [0]; for (let i = 1; i <= 200; i++) { arc += Math.hypot(fine[i].x - fine[i - 1].x, fine[i].y - fine[i - 1].y); if (i % 50 === 0) marks.push(arc); }
    const quarters = marks.slice(1).map((m, i) => m - marks[i]);
    const top = Math.min(...fine.map((p) => p.y));
    // A real flight to the HUD.
    state.spinFlownSouls = new Set(); state.spinMultDisplay = 1;
    const hud = el.psTicker; const hud0 = hud.getBoundingClientRect();
    const t0 = performance.now(); const fly = flyMultiplierSouls([{ row: 2, col: 2, value: 5, id: "probe-soul" }]);
    const frames = []; let maxLive = 0, maxNodes = 0, hudMoved = 0;
    while (performance.now() - t0 < 1100) {
      const orb = document.querySelector(".soul-orb");
      if (orb) { const m = /translate3d\\(([-\\d.]+)px, ([-\\d.]+)px/.exec(orb.style.transform); if (m) frames.push({ t: performance.now() - t0, x: +m[1], y: +m[2] }); }
      if (soulTrails) maxLive = Math.max(maxLive, soulTrails.live);
      maxNodes = Math.max(maxNodes, document.getElementById("soulLayer")?.childElementCount || 0);
      const r = hud.getBoundingClientRect(); hudMoved = Math.max(hudMoved, Math.abs(r.x - hud0.x), Math.abs(r.y - hud0.y), Math.abs(r.width - hud0.width));
      await new Promise((r) => requestAnimationFrame(r));
    }
    await fly;
    for (let i = 0; i < 40 && soulTrails.live; i++) await new Promise((r) => setTimeout(r, 50));
    const steps = frames.slice(1).map((f, i) => Math.hypot(f.x - frames[i].x, f.y - frames[i].y) / Math.max(1, f.t - frames[i].t));
    const half = Math.floor(steps.length / 2);
    const avg = (a) => a.reduce((s, v) => s + v, 0) / Math.max(1, a.length);
    return { pts, quarters, top, early: avg(steps.slice(1, half)), late: avg(steps.slice(half)), maxLive, maxNodes, hudMoved,
      live: soulTrails.live, raf: soulTrails._raf, cap: soulTrails.cap, shown: el.activeMultiplier.textContent };
  })()`);
  const qMean = soul.quarters.reduce((s, v) => s + v, 0) / 4;
  check("the Bézier path starts on the cell, ends on the HUD and arcs above both", Math.hypot(soul.pts[0].x - 100, soul.pts[0].y - 400) < 0.01 && Math.hypot(soul.pts[4].x - 600, soul.pts[4].y - 300) < 0.01 && soul.top < 300 - 30,
    `apex ${(300 - soul.top).toFixed(0)}px above the HUD`);
  check("arc-length parameterised: equal steps of d cover equal distance", soul.quarters.every((v) => Math.abs(v - qMean) / qMean < 0.03),
    soul.quarters.map((v) => v.toFixed(0)).join("/") + "px");
  check("magnetism: the soul is pulled in faster as it nears the HUD", soul.late > soul.early * 2, `${soul.early.toFixed(2)} → ${soul.late.toFixed(2)} px/ms`);
  check("glowing trail comes from the pool (≤ 512), no DOM node per particle", soul.maxLive > 10 && soul.maxLive <= soul.cap && soul.cap === 512 && soul.maxNodes <= 3,
    `${soul.maxLive} particles at peak; ≤ ${soul.maxNodes} nodes in the soul layer`);
  check("trail drains and its loop stops; the value lands on the HUD, which never moves", soul.live === 0 && soul.raf === 0 && soul.shown === "5x" && soul.hudMoved === 0);

  console.log("\nHUD: free-spin countdown, empty multiplier badge, win stat (#46)");
  await waitIdle();
  const hud = await evaluate(cdp, `(async () => {
    const out = {};
    // Countdown: on spin k of n the line shows n − k ("Remaining: 14" on the first of 15 … 0 on the last).
    out.counts = [5, 8, 10, 15, 20].map((n) => { const shown = []; for (let left = n; left >= 1; left--) shown.push(freeSpinsRemainingAfter(left)); return { n, first: shown[0], last: shown[shown.length - 1], steps: shown.every((v, i) => i === 0 || v === shown[i - 1] - 1) }; });
    // A retrigger mid-bonus: 7 left + 10 awarded → the next spin shows 16.
    out.retrigger = freeSpinsRemainingAfter(17);
    // The real ticker line.
    const saved = { auto: state.bonusAutoplay, fs: el.freeSpins.textContent };
    state.bonusAutoplay = true; el.freeSpins.textContent = "15"; ticker.roundStart();
    out.line = el.psTickerText.textContent;
    state.bonusAutoplay = saved.auto; el.freeSpins.textContent = saved.fs; ticker.idle();
    // Badge: entering the bonus with no multiplier yet → laid out but empty (no "1x").
    const B = el.bonusMultiBadge, V = el.bonusMultiBadgeValue;
    updateBonusHud({ freeSpinsLeft: 15, multiplier: 0, bonusTotal: 0 });
    await new Promise((r) => setTimeout(r, 300));
    out.empty = { hidden: B.classList.contains("hidden"), isEmpty: B.classList.contains("is-empty"), text: V.textContent, opacity: getComputedStyle(B).opacity, w: B.getBoundingClientRect().width };
    // A soul flies in during the bonus: carry 3 + a caught 5 → the badge shows 8x at once.
    state.bonusMultiplierCarry = 3; el.activeMultiplier.textContent = "3x"; state.spinMultDisplay = 3; state.spinFlownSouls = new Set();
    const vaultBox = document.querySelector(".vault-window").getBoundingClientRect();
    await flyMultiplierSouls([{ row: 2, col: 3, value: 5, id: "hud-probe" }]);
    await new Promise((r) => setTimeout(r, 300));
    out.caught = { isEmpty: B.classList.contains("is-empty"), text: V.textContent, opacity: getComputedStyle(B).opacity };
    const vaultAfter = document.querySelector(".vault-window").getBoundingClientRect();
    out.boardMoved = Math.abs(vaultAfter.y - vaultBox.y) + Math.abs(vaultAfter.height - vaultBox.height);
    // Bonus over: the badge goes away and resets.
    updateBonusHud({ freeSpinsLeft: 0, multiplier: 0, bonusTotal: 0 });
    state.bonusMultiplierCarry = 0; el.activeMultiplier.textContent = "1x"; state.spinMultDisplay = 1;
    out.after = { hidden: B.classList.contains("hidden"), isEmpty: B.classList.contains("is-empty"), text: V.textContent };
    // Win stat: the ticker's win line, 1.5x the old 0.8 size, still one unclipped line.
    const box = el.psTicker, node = el.psTickerText;
    const before = box.getBoundingClientRect();
    box.dataset.state = "spin"; node.textContent = "Good luck!";
    const spinPx = parseFloat(getComputedStyle(node).fontSize);
    box.dataset.state = "win"; node.textContent = "WIN: 12,345.67";
    const winPx = parseFloat(getComputedStyle(node).fontSize);
    const ui = spinPx / 0.6; // the spin line is 0.6 × --ui (a calc(), so read it back through a size)
    out.win = { winPx, spinPx, ui, fits: node.scrollWidth <= node.clientWidth + 1 && node.getBoundingClientRect().height <= box.getBoundingClientRect().height + 1,
      boxMoved: Math.abs(box.getBoundingClientRect().height - before.height) };
    ticker.idle();
    return out;
  })()`);
  check("free-spin countdown shows the spins left after this one: n−1 on the first, 0 on the last (5/8/10/15/20)",
    hud.counts.every((c) => c.first === c.n - 1 && c.last === 0 && c.steps) && hud.retrigger === 16,
    hud.counts.map((c) => `${c.n}: ${c.first}…${c.last}`).join(", "));
  check("the ticker line reads \"Remaining: 14\" on the first of 15", /Remaining: 14$/.test(hud.line), hud.line);
  check("entering the bonus: the multiplier badge is laid out but empty and invisible (no \"1x\")",
    !hud.empty.hidden && hud.empty.isEmpty && hud.empty.text === "" && Number(hud.empty.opacity) === 0 && hud.empty.w > 0);
  check("the first soul lights it with the running total at once (carry 3 + 5 = 8x), board never moves",
    !hud.caught.isEmpty && hud.caught.text === "8x" && Number(hud.caught.opacity) === 1 && hud.boardMoved === 0, `badge "${hud.caught.text}"`);
  check("after the bonus the badge is gone and cleared", hud.after.hidden && hud.after.isEmpty && hud.after.text === "");
  check("win stat is 1.5x the old size (1.2 × --ui), still one line in the same box",
    Math.abs(hud.win.winPx - 1.2 * hud.win.ui) < 0.6 && hud.win.fits && hud.win.boxMoved === 0, `${hud.win.winPx.toFixed(1)}px (spin line ${hud.win.spinPx.toFixed(1)}px), --ui ${hud.win.ui}, fits ${hud.win.fits}, box moved ${hud.win.boxMoved}`);

  console.log("\nnotification skeleton: every popup through one lifecycle (#49)");
  await waitIdle();
  // Real key presses: Enter and Space carry their text, so a focused button
  // gets its native click, exactly as for a player.
  const press = async (key, code, vk, mods = 0) => {
    const text = key === "Enter" ? "\r" : key === " " ? " " : undefined;
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers: mods, ...(text ? { text } : {}) });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers: mods });
    await sleep(60);
  };
  const ESC = ["Escape", "Escape", 27], ENTER = ["Enter", "Enter", 13], TAB = ["Tab", "Tab", 9], SPACE = [" ", "Space", 32];
  await evaluate(cdp, `(() => { window.__nlog = []; VxNotify.on("open", (d) => __nlog.push("open:" + d.name)); VxNotify.on("close", (d) => __nlog.push("close:" + d.name + ":" + (d.reason || "")));
    window.__board0 = document.querySelector(".vault-window").getBoundingClientRect().toJSON(); window.__moved = 0;
    const watch = () => { const b = document.querySelector(".vault-window").getBoundingClientRect(); __moved = Math.max(__moved, Math.abs(b.x - __board0.x), Math.abs(b.y - __board0.y), Math.abs(b.width - __board0.width), Math.abs(b.height - __board0.height)); requestAnimationFrame(watch); }; requestAnimationFrame(watch);
    return true; })()`);
  const NS = {};
  // Feature screen: slots filled, a tap anywhere closes it.
  await evaluate(cdp, `(window.__f = showFeature("You won 15 Free Spins", "Press anywhere to continue."), true)`);
  NS.feature = await evaluate(cdp, `(() => { const r = el.featureScreen; return { shown: !r.classList.contains("hidden"), kind: r.classList.contains("vx-n--feature"), title: r.querySelector("[data-vx-slot=title]").textContent, state: r.dataset.vxState }; })()`);
  await evaluate(cdp, `(el.featureScreen.click(), true)`);
  NS.featureReason = await evaluate(cdp, `Promise.race([__f, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  NS.featureHidden = await evaluate(cdp, `el.featureScreen.classList.contains("hidden")`);
  // Buy confirm: autofocus on Buy, Tab trapped, Esc cancels, Enter on Cancel cancels, Enter confirms, Space never spins behind it.
  const buy = () => evaluate(cdp, `(window.__b = confirmBuy({ cost: 100, currency: "GEL", costMultiplier: 100 }), true)`);
  await buy(); await sleep(80);
  NS.buyFocus = await evaluate(cdp, `document.activeElement?.id`);
  await press(...TAB); await press(...TAB); await press(...TAB);
  NS.buyTabInside = await evaluate(cdp, `document.getElementById("buyConfirmModal").contains(document.activeElement)`);
  const spinsBefore = await evaluate(cdp, `stats.spins`);
  await evaluate(cdp, `(document.activeElement?.blur(), true)`); // Space off any button: must not spin
  await press(...SPACE);
  NS.spaceSpun = (await evaluate(cdp, `stats.spins`)) !== spinsBefore || (await evaluate(cdp, `isRoundInFlight()`));
  await press(...ESC);
  NS.buyEsc = await evaluate(cdp, `Promise.race([__b, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  await buy(); await sleep(80);
  await evaluate(cdp, `(document.getElementById("buyCancelBtn").focus(), true)`); await press(...ENTER);
  NS.buyEnterOnCancel = await evaluate(cdp, `Promise.race([__b, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  await buy(); await sleep(80); await press(...ENTER);
  NS.buyEnter = await evaluate(cdp, `Promise.race([__b, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  NS.buyHidden = await evaluate(cdp, `document.getElementById("buyConfirmModal").classList.contains("hidden")`);
  // Info modal: focus on the asked section, arrows page, Esc closes, focus returns to the opener.
  await evaluate(cdp, `(el.psInfoBtn.focus(), el.psInfoBtn.click(), true)`); await sleep(80);
  NS.infoFocus = await evaluate(cdp, `document.activeElement?.dataset?.psSection || document.activeElement?.className`);
  await press("ArrowRight", "ArrowRight", 39);
  NS.infoPaged = await evaluate(cdp, `document.activeElement?.dataset?.psSection`);
  await press(...ESC);
  NS.infoClosed = await evaluate(cdp, `el.psInfoModal.hidden && !VxNotify.isOpen("info")`);
  NS.infoFocusBack = await evaluate(cdp, `document.activeElement === el.psInfoBtn`);
  // Free-rounds notice: Space closes it (and never spins).
  await evaluate(cdp, `(window.__fr = VxNotify.open("freeRounds"), true)`); await sleep(60);
  await press(...SPACE);
  NS.fr = await evaluate(cdp, `Promise.race([__fr, new Promise((r) => setTimeout(() => r("still open"), 300))])`);
  // Reality check: Esc does NOT close it; only its buttons do.
  await evaluate(cdp, `(window.__rc = VxNotify.open("reality"), true)`); await sleep(60);
  await press(...ESC);
  NS.realityAfterEsc = await evaluate(cdp, `VxNotify.isOpen("reality") && !document.getElementById("realityCheck").hidden`);
  await evaluate(cdp, `(document.getElementById("realityContinue").click(), true)`);
  NS.reality = await evaluate(cdp, `Promise.race([__rc, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  // Big win: tracked while BigWinController plays it.
  await evaluate(cdp, `(window.__bw = celebrateBigWin(Number(el.betSelect.value || 1) * 30, Number(el.betSelect.value || 1)), true)`); await sleep(300);
  NS.bigwinOpen = await evaluate(cdp, `VxNotify.openNames().includes("bigwin")`);
  await evaluate(cdp, `(bigWin.advance(), true)`); await sleep(600); await evaluate(cdp, `(bigWin.advance(), true)`);
  await evaluate(cdp, `Promise.race([__bw, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`); await sleep(100);
  NS.bigwinClosed = await evaluate(cdp, `!VxNotify.isOpen("bigwin")`);
  // Win combine: a celebration built on demand and removed when done.
  await evaluate(cdp, `(window.__wc = playWinCombineSequence(1, 50, 50), true)`); await sleep(300);
  NS.combine = await evaluate(cdp, `(() => { const o = document.querySelector(".win-combine-overlay"); return Boolean(o && o.classList.contains("vx-n--celebration") && VxNotify.isOpen("winCombine")); })()`);
  await evaluate(cdp, `Promise.race([__wc, new Promise((r) => setTimeout(() => r("TIMEOUT"), 6000))])`);
  NS.combineGone = await evaluate(cdp, `!document.querySelector(".win-combine-overlay") && !VxNotify.isOpen("winCombine")`);
  // Banner: the ticker's transient line.
  await evaluate(cdp, `(VxNotify.banner("Skeleton notice", "info", 900), true)`);
  NS.banner = await evaluate(cdp, `el.psTickerText.textContent`);
  // Skin: swap the art and the open sound without touching the DOM.
  NS.skin = await evaluate(cdp, `(async () => { const played = []; const real = window.Sound.play; window.Sound.play = (n, o) => { played.push(n); return real(n, o); };
    VxNotify.skin("feature", { className: "skin-test", assets: { art: "assets/symbols/Ring.webp" }, audio: { open: "click" } });
    const p = showFeature("Skinned", "x"); const r = el.featureScreen; const out = { cls: r.classList.contains("skin-test"), art: r.style.getPropertyValue("--vx-n-art"), sound: played.includes("click") };
    dismissFeature(); await p; window.Sound.play = real; VxNotify.skin("feature", { className: "" }); return out; })()`);
  NS.log = await evaluate(cdp, `__nlog`);
  NS.moved = await evaluate(cdp, `__moved`);
  check("feature screen: slots filled, a tap anywhere closes it", NS.feature.shown && NS.feature.kind && NS.feature.state === "open" && NS.feature.title === "You won 15 Free Spins" && NS.featureReason === "tap" && NS.featureHidden);
  check("buy confirm: autofocus on Buy, Tab stays inside, Space never spins behind it", NS.buyFocus === "buyConfirmBtn" && NS.buyTabInside && !NS.spaceSpun);
  check("buy confirm: Esc cancels, Enter on Cancel cancels, Enter confirms", NS.buyEsc === false && NS.buyEnterOnCancel === false && NS.buyEnter === true && NS.buyHidden,
    `${NS.buyEsc} / ${NS.buyEnterOnCancel} / ${NS.buyEnter}`);
  check("info modal: opens on its section, arrows page, Esc closes, focus returns to the opener", NS.infoFocus === "rules" && NS.infoPaged && NS.infoPaged !== "rules" && NS.infoClosed && NS.infoFocusBack,
    `${NS.infoFocus} → ${NS.infoPaged}`);
  check("free-rounds notice: Space closes it", NS.fr === "play");
  check("reality check: Esc cannot dismiss it, only its buttons", NS.realityAfterEsc && NS.reality === "continue");
  check("big-win overlay is tracked by the skeleton while it plays", NS.bigwinOpen && NS.bigwinClosed);
  check("win combine: built on demand as a celebration, removed when done", NS.combine && NS.combineGone);
  check("banner: the ticker's transient line goes through the skeleton", NS.banner === "Skeleton notice", NS.banner);
  check("skins swap the class, the art and the sounds without touching the DOM", NS.skin.cls && /Ring\.webp/.test(NS.skin.art) && NS.skin.sound);
  const expect = ["open:feature", "close:feature:tap", "open:buyConfirm", "close:buyConfirm:cancel", "open:info", "close:info:closed", "open:freeRounds", "close:freeRounds:play", "open:reality", "close:reality:continue", "open:bigwin", "close:bigwin:done", "open:winCombine", "close:winCombine:timeout", "open:banner"];
  check("one event stream for every popup (open / close with its reason)", expect.every((e) => NS.log.includes(e)), NS.log.length + " events");
  check("zero layout thrash: the board never moved while any popup was up", NS.moved === 0);

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;

  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nMOTION PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
