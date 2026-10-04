// One-off verification for Step 1: tokens resolve, fonts load, no console
// errors/warnings, plus phone + desktop screenshots. Borrows layout-check's
// zero-dependency CDP approach.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

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
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "vx-probe-"))}`,
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
  console.log("\nspin-out: no wind-up, gravity from the press");
  const out = await evaluate(cdp, `(async () => {
    const R = __reelRenderer, rs = R.getLayout().rowStep;
    const t0 = performance.now(); const p = R.dropOff(); const samples = []; let minAll = 0;
    while (R.fx.drop && R.fx.drop.exit) {
      const t = performance.now() - t0; const o = {};
      for (let r = 0; r < R.rows; r++) for (let c = 0; c < R.cols; c++) { const y = R.cellOffset(r, c, rs) / rs; minAll = Math.min(minAll, y); o[r + "-" + c] = y; }
      samples.push({ t, o });
      await new Promise((r) => requestAnimationFrame(r));
    }
    await p;
    const firstMove = (k) => (samples.find((s) => s.o[k] > 0) || { t: Infinity }).t;
    return { minAll, frames: samples.length, bottom0: firstMove("4-0"), top0: firstMove("0-0"), bottom5: firstMove("4-5") };
  })()`);
  check("no symbol ever moves up during the spin-out", out.minAll >= 0, `lowest offset ${out.minAll} rows over ${out.frames} frames`);
  check("gravity takes over at once: reel 1's bottom symbol is falling on the first frames", out.bottom0 < 40, `${out.bottom0.toFixed(0)}ms`);
  check("bottom symbols leave before the ones above them", out.bottom0 < out.top0, `bottom ${out.bottom0.toFixed(0)}ms, top ${out.top0.toFixed(0)}ms`);

  console.log("\ntiered reel inertia + stop/lock");
  const prof = await evaluate(cdp, `(() => {
    const R = __reelRenderer, rs = R.getLayout().rowStep, saved = R.fx.drop, out = {};
    for (const col of [0, 2, 4]) {
      const p = R.reelProfile(col); const curve = []; const sq = [];
      const mk = (t) => ({ start: performance.now() - t, duration: 1000, map: { ["0-" + col]: 5 }, heavy: new Map() });
      R.fx.drop = mk(0); const delay = R.dropDelay(0, col, 5), dur = R.colDropMs(col);
      for (let t = delay; t <= dur + delay; t += 1) {
        R.fx.drop = mk(t);
        curve.push(R.cellOffset(0, col, rs) / (rs * 5));
        const d = R.dropDeform(0, col); sq.push(d.sy);
      }
      out[col] = { name: p.name, dur, contact: p.contact, squash: p.squash, curve, sq };
    }
    R.fx.drop = saved; return out;
  })()`);
  for (const col of ["0", "2", "4"]) {
    const p = prof[col], o = p.curve;
    const over = Math.max(...o);
    const first = o.findIndex((y) => y >= 0) / p.dur;
    const v0 = o[1] - o[0], vPeak = Math.max(...o.slice(1).map((y, i) => y - o[i]));
    const minSq = Math.min(...p.sq), maxAfter = Math.max(...p.sq.slice(Math.ceil(p.contact * p.dur)));
    // Heavy and tension reels gather speed from rest; the snap reels launch
    // hard by design (low warp): their first ms is still well under peak.
    const launch = v0 / vPeak;
    check(`reel ${+col + 1} (${p.name}): ${p.dur}ms, launch ${(launch * 100).toFixed(1)}% of peak speed, lock ${(over * 100).toFixed(2)}% at contact ${first.toFixed(3)}, settles`,
      launch < (p.name === "snap" ? 0.2 : 0.05) && Math.abs(first - p.contact) < 0.004 && over < 0.02 && Math.abs(o[o.length - 1]) < 1e-9);
    check(`reel ${+col + 1}: ${(p.squash * 100).toFixed(1)}% micro-squash on contact, never rebounds past 1`,
      Math.abs(1 - minSq - p.squash) < 0.0015 && maxAfter <= 1 + 1e-9, `min sy ${minSq.toFixed(4)}`);
  }
  check("reels speed up across the groups (heavy > tension > snap)", prof[0].dur > prof[2].dur && prof[2].dur > prof[4].dur, `${prof[0].dur}/${prof[2].dur}/${prof[4].dur}ms`);
  const lockRank = [0, 2, 4].map((c) => Math.max(...prof[c].curve));
  check("lock overshoot tightens from heavy to snap (gear detent last)", lockRank[0] > lockRank[1] && lockRank[1] > lockRank[2] && lockRank[2] < 0.004,
    lockRank.map((v) => (v * 100).toFixed(2) + "%").join(" / "));

  console.log("\nper-symbol rat-a-tat (opening drop)");
  await waitIdle();
  const sync = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; __snd.length = 0; const lands = []; const realS = R.symbolLanded.bind(R);
    R.symbolLanded = (r, c) => { lands.push({ r, c, t: performance.now(), n: R.shards.live }); realS(r, c); lands[lands.length - 1].added = R.shards.live - lands[lands.length - 1].n; };
    let ticks = 0; const realTick = R.onSymbolLand; R.onSymbolLand = (r, c) => { ticks++; realTick?.(r, c); };
    const realDrop = R.drop.bind(R); let pred = null, start = 0;
    R.drop = async (...a) => { const p = realDrop(...a); if (!pred && R.fx.drop && !R.fx.drop.exit) { start = R.fx.drop.start; pred = {};
      for (const k of Object.keys(R.fx.drop.map)) { const [r, c] = k.split("-").map(Number); const n = R.fx.drop.map[k];
        pred[k] = R.dropDelay(r, c, n) + R.cellFallMs(c, n) * R.reelProfile(c).contact; } } return p; };
    el.spinBtn.click();
    for (let i = 0; i < 200 && !pred; i++) await new Promise((r) => setTimeout(r, 10));
    await new Promise((r) => setTimeout(r, 1700));
    R.drop = realDrop; R.symbolLanded = realS; R.onSymbolLand = realTick;
    const thuds = __snd.filter((s) => s.n === "reel_stop" && s.i >= 0 && s.t >= start).slice(0, 6).map((s) => ({ c: s.i, t: s.t - start }));
    return { pred, ticks, thuds, lands: lands.filter((l) => l.t >= start).map((l) => ({ r: l.r, c: l.c, t: l.t - start, added: l.added })) };
  })()`);
  const L = sync.lands.slice(0, 30);
  const err = L.map((l) => Math.abs(l.t - sync.pred[l.r + "-" + l.c]));
  check("all 30 symbols land one by one, each on its own predicted moment", L.length === 30 && Math.max(...err) < 20, `max error ${Math.max(...err).toFixed(0)}ms`);
  const perCol = [0, 1, 2, 3, 4, 5].map((c) => L.filter((l) => l.c === c));
  check("inside every reel the bottom symbol lands first, then each one above it", perCol.every((cl) => cl.map((l) => l.r).join() === "4,3,2,1,0"),
    perCol.map((cl) => cl.map((l) => l.r).join("")).join(" "));
  const gaps = perCol.flatMap((cl) => cl.slice(1).map((l, i) => l.t - cl[i].t));
  const sched = [0, 1, 2, 3, 4, 5].flatMap((c) => [3, 2, 1, 0].map((r) => sync.pred[r + "-" + c] - sync.pred[(r + 1) + "-" + c]));
  check("rat-a-tat: symbols in a reel are scheduled exactly 18ms apart", sched.every((g) => Math.abs(g - 18) < 1), `scheduled ${Math.min(...sched).toFixed(1)}-${Math.max(...sched).toFixed(1)}ms`);
  check("…and are heard/seen apart, never together (timer jitter only)", gaps.every((g) => g >= 4), `observed ${Math.min(...gaps).toFixed(0)}-${Math.max(...gaps).toFixed(0)}ms`);
  const order = L.map((l) => l.c).join("");
  check("reels never interleave: reel k finishes before reel k+1 starts", order === "000001111122222333334444455555", order);
  check("each landing gets its own glint and tick", L.every((l) => l.added === 2) && sync.ticks >= 30, `ticks ${sync.ticks}`);
  check("each reel's thud accents its last (top) symbol", sync.thuds.length === 6 && sync.thuds.every((th) => Math.abs(th.t - perCol[th.c][4].t) < 8),
    sync.thuds.map((th) => `r${th.c + 1}@${th.t.toFixed(0)}`).join(" "));

  console.log("\nper-symbol fall + refill order");
  const own = await evaluate(cdp, `(() => {
    const R = __reelRenderer, saved = R.fx.drop;
    R.fx.drop = { start: performance.now(), duration: 380, map: { "4-4": 1, "3-4": 1, "0-4": 1 }, heavy: new Map() };
    R.fx.drop.order = R._dropOrder(R.fx.drop.map);
    const short = R.cellFallMs(4, 1), long = R.cellFallMs(4, 5);
    const firstDelay = R.dropDelay(4, 4, 1), nextDelay = R.dropDelay(3, 4, 1);
    R.fx.drop = saved; return { short, long, firstDelay, nextDelay };
  })()`);
  check("a symbol falling 1 row is quicker than one falling 5 (own velocity, √distance)", own.short < own.long * 0.6, `${own.short.toFixed(0)} vs ${own.long.toFixed(0)}ms`);
  check("a refill on reel 5 alone starts at once (no wait for reels that stay put)", own.firstDelay < 30 && own.nextDelay > own.firstDelay,
    `bottom symbol ${own.firstDelay}ms, next ${own.nextDelay}ms`);

  console.log("\ntumble vacuum");
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
    R.drop = (...a) => { const p = realDrop(...a); if (R.fx.drop && Object.keys(a[2] || {}).length && a[3] === ANIMATION_TIMING.tumbleDrop) durs.push({ d: R.fx.drop.duration, tempo: R.fx.drop.tempo }); return p; };
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
    for (let i = 0; i < 400; i++) { if (R.fx.drop && !R.fx.drop.exit && performance.now() - R.fx.drop.start > 150) break; await new Promise((r) => setTimeout(r, 5)); }
    __snd.length = 0;
    const t0 = performance.now(); el.spinBtn.click();
    const z = R.fx.drop?.zip; const frames = []; let maxBlur = 0; const prev = new Map(); let backwards = 0;
    while (R.fx.drop && R.fx.drop.zip && performance.now() - t0 < 400) {
      const now = performance.now() - t0; const offs = {};
      for (const k of Object.keys(R.fx.drop.map)) { const [r, c] = k.split("-").map(Number); const y = R.cellOffset(r, c, rs); if (prev.has(k) && y < prev.get(k) - 1e-6) backwards++; prev.set(k, y); maxBlur = Math.max(maxBlur, R.zipBlur(k, c, rs)); offs[k] = y; }
      frames.push({ now, maxAbs: Math.max(0, ...Object.values(offs).map(Math.abs)) });
      await new Promise((r) => requestAnimationFrame(r));
    }
    const done = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 200));
    return { had: Boolean(z), ends: z ? z.ends : null, frames, maxBlur, backwards, done,
      snd: __snd.map((s) => ({ n: s.n, i: s.i, t: s.t - t0 })) };
  })()`);
  // Only the zip's own sounds: later tumbles in the same round thud too.
  const zipThuds = zip.snd.filter((s) => s.n === "reel_stop" && s.i >= 0 && s.t < 200);
  const zipClicks = zip.snd.filter((s) => s.n === "click" && s.t < 250);
  const lockedBy = zip.done; // the drop is released only once every reel has locked
  check("the press zips the reels instead of teleporting them", zip.had && zip.frames.length > 2, `${zip.frames.length} zip frames`);
  check("reels lock left to right, all within 120ms", zipThuds.length >= 1 && zipThuds.every((t, k) => k === 0 || (t.i > zipThuds[k - 1].i && t.t > zipThuds[k - 1].t)) && Math.max(...zip.ends) <= 110 && Math.max(...zipThuds.map((t) => t.t)) < 130 && lockedBy < 140,
    `scheduled ${zip.ends.join("/")}ms; heard ` + zipThuds.map((t) => `r${t.i + 1}@${t.t.toFixed(0)}`).join(" ") + `; drop released at ${lockedBy.toFixed(0)}ms (first frame after the last lock)`);
  check("…then a double-click seals it", zipClicks.length === 2 && zipClicks[1].t - zipClicks[0].t >= 40 && zipClicks[1].t - zipClicks[0].t < 75,
    zipClicks.map((c) => c.t.toFixed(0) + "ms").join(", "));
  check("zip only ever moves down (no bounce) and draws motion blur", zip.backwards === 0 && zip.maxBlur > 0.5, `peak travel ${zip.maxBlur.toFixed(0)}px/frame; ghosts capped at 0.35 symbol`);
  await waitIdle();

  console.log("\nfast-stop during the spin-out: next board is born zipping");
  const born = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; el.spinBtn.click();
    for (let i = 0; i < 200; i++) { if (R.fx.drop?.exit) break; await new Promise((r) => setTimeout(r, 5)); }
    const wasExit = Boolean(R.fx.drop?.exit); el.spinBtn.click();
    let zipped = false; for (let i = 0; i < 400; i++) { if (R.fx.drop && !R.fx.drop.exit && R.fx.drop.zip) { zipped = true; break; } if (!isRoundInFlight()) break; await new Promise((r) => setTimeout(r, 2)); }
    while (isRoundInFlight()) await new Promise((r) => setTimeout(r, 50));
    return { wasExit, zipped, pending: R._zipPending };
  })()`);
  check("press during the exit → the opening board zips in", born.wasExit && born.zipped && born.pending === false);
  await waitIdle();
  let live = -1;
  for (let i = 0; i < 40; i++) { live = await evaluate(cdp, `__reelRenderer.shards.live`); if (live === 0) break; await sleep(100); }
  check("shard pool drained", live === 0);
  check("vacuum and zip state left clean", await evaluate(cdp, `__reelRenderer.fx.vacuum == null && !__reelRenderer.fx.drop`));

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;

  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nMOTION PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
