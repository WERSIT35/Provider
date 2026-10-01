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
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && !!state.sessionId && !!state.rules`)) break; }
  await sleep(800);
  const settle = async () => { for (let i = 0; i < 900; i++) { if (!(await evaluate(cdp, "isRoundInFlight()"))) { await sleep(300); return; } await sleep(60); } };

  console.log("\nanticipation decision (pure)");
  const unit = await evaluate(cdp, `(() => {
    const B = (cells) => { const m = Array.from({ length: 5 }, () => Array(6).fill("RED_GEM")); cells.forEach(([r, c]) => (m[r][c] = "SCATTER")); return m; };
    return {
      split3: findAnticipation(B([[0, 0], [2, 1], [4, 2]]), 4),
      lastCol3: findAnticipation(B([[0, 5], [1, 5], [2, 5]]), 4),
      two: findAnticipation(B([[0, 0], [1, 1]]), 4),
      jump: findAnticipation(B([[0, 0], [1, 0], [2, 1], [3, 1]]), 4),
      thenTrigger: findAnticipation(B([[0, 0], [1, 1], [2, 2], [3, 4]]), 4),
      freeSpin: findAnticipation(B([[0, 0], [1, 3]]), 3),
      targets: [scatterTargetFor({ is_free_spin: false }), scatterTargetFor({ is_free_spin: true })]
    };
  })()`);
  check("3 scatters across cols 0-2 → cols 3+ anticipate", unit.split3?.fromCol === 3);
  check("3 scatters all in the last column → none (nothing left to wait)", unit.lastCol3 === null);
  check("2 scatters → none", unit.two === null);
  check("jumps straight to 4 in one column → none (already triggered)", unit.jump === null);
  check("one short after col 2, triggers later → still anticipates (the tease pays off)", unit.thenTrigger?.fromCol === 3);
  check("free spins use the retrigger count (3): one short at 2", unit.freeSpin?.fromCol === 4, JSON.stringify(unit.freeSpin));
  check("targets come from the rules: base 4, free spins 3", unit.targets.join() === "4,3", unit.targets.join());

  // Instrumentation shared by the round tests.
  await evaluate(cdp, `(() => {
    const R = __reelRenderer;
    window.__ev = [];
    const push = (e) => __ev.push({ t: Math.round(performance.now()), ...e });
    const sp = window.Sound.play.bind(window.Sound);
    window.Sound.play = (n, o) => { if (n === "reel_stop" && !(o && o.index < 0)) push({ k: "thud", col: o && o.index }); if (n === "win_tick" && o && o.progress !== undefined) push({ k: "tick", p: o.progress }); return sp(n, o); };
    const oc = R.onScatterCount; R.onScatterCount = (n, need) => { push({ k: "count", n, need, ticker: null }); oc(n, need); __ev[__ev.length - 1].ticker = el.psTickerText.textContent; };
    const oa = R.onAnticipation; R.onAnticipation = (ph, ms) => { push({ k: "antic", ph, ms: Math.round(ms || 0) }); oa(ph, ms); push({ k: "drone", on: anticipationDrone.isPlaying() }); };
    const ol = R.drawAnticipationLanes.bind(R); R.drawAnticipationLanes = (...a) => { window.__lanes = (window.__lanes || 0) + 1; return ol(...a); };
    window.__realApi = window.__realApi || api;
    return true;
  })()`);
  const forceBoard = (cond) => evaluate(cdp, `(() => { window.__tries = 0; api = async (p, payload) => { if (p !== "/api/v1/spin") return __realApi(p, payload);
    for (;;) { window.__tries++; const r = await __realApi(p, { ...payload, spin_id: crypto.randomUUID() }); const m0 = r.tumble_steps?.[0]?.matrix || r.matrix;
      if (r.free_spins_awarded) continue; if ((${cond})(r, m0)) { window.__forced = r; return r; } } }; return true; })()`);

  console.log("\ngenuine anticipation round");
  await forceBoard(`(r, m0) => findAnticipation(m0, 4) && r.near_miss?.pattern !== "scatter_one_short"`);
  await evaluate(cdp, `(__ev.length = 0, window.__lanes = 0, el.spinBtn.click(), true)`);
  await settle();
  let ev = await evaluate(cdp, `({ ev: __ev.slice(), from: findAnticipation((__forced.tumble_steps?.[0]?.matrix || __forced.matrix), 4).fromCol, tries: __tries, lanes: __lanes, drone: anticipationDrone.isPlaying() })`);
  const thuds = ev.ev.filter((e) => e.k === "thud").slice(0, 6);
  const gap = (c) => thuds[c].t - thuds[c - 1].t;
  const f = ev.from;
  check(`anticipated columns wait (from col ${f}): gap before col ${f} ≥ 650ms`, thuds.length === 6 && gap(f) >= 650, `gaps ${thuds.slice(1).map((x, i) => x.t - thuds[i].t).join(",")}ms, after ${ev.tries} engine draws`);
  check("columns before it keep the normal ~65ms waterfall", thuds.slice(1, f).every((x, i) => x.t - thuds[i].t < 90));
  const antic = ev.ev.filter((e) => e.k === "antic");
  const droneOn = ev.ev.filter((e) => e.k === "drone");
  check("drone starts with the tension and stops at the last landing", antic.map((a) => a.ph).join() === "start,end" && droneOn[0]?.on === true && droneOn[1]?.on === false && !ev.drone, JSON.stringify(antic));
  check("drone starts when the column before the anticipated ones lands", Math.abs(antic[0].t - thuds[f - 1].t) < 25, `${antic[0].t - thuds[f - 1].t}ms`);
  check("red lanes drawn while anticipating", ev.lanes > 10, `${ev.lanes} frames`);
  const counts = ev.ev.filter((e) => e.k === "count");
  check("scatter count climbs 1, 2, 3… as each lands", counts.length >= 3 && counts.every((c, i) => c.n === i + 1 && c.need === 4), counts.map((c) => `${c.n}/${c.need}`).join(" "));
  check("HUD readout follows: SCATTERS n/4", counts.every((c) => c.ticker === `Scatters ${c.n}/4`), counts.map((c) => c.ticker).join(" | "));
  // A scatter ping is the win_tick fired in the same instant as its count.
  const pings = counts.map((c) => ev.ev.find((e) => e.k === "tick" && Math.abs(e.t - c.t) <= 1)?.p).filter((p) => p !== undefined);
  check("pings ascend in pitch", pings.length >= 3 && pings.every((p, i) => i === 0 || p > pings[i - 1]), pings.map((p) => p.toFixed(2)).join(" → "));

  console.log("\nOption B: engineered near-miss");
  // An engineered tease whose scatters WOULD trigger anticipation: only the
  // suppression can explain the absence of a slowdown.
  await forceBoard(`(r, m0) => r.near_miss?.pattern === "scatter_one_short" && !!findAnticipation(m0, 4)`);
  await evaluate(cdp, `(__ev.length = 0, window.__lanes = 0, el.spinBtn.click(), true)`);
  await settle();
  ev = await evaluate(cdp, `({ ev: __ev.slice(), tries: __tries, lanes: __lanes, would: !!findAnticipation((__forced.tumble_steps?.[0]?.matrix || __forced.matrix), 4) })`);
  const t2 = ev.ev.filter((e) => e.k === "thud").slice(0, 6);
  check("no slowdown, no drone, no red lanes on an engineered tease", ev.would && t2.slice(1).every((x, i) => x.t - t2[i].t < 90) && !ev.ev.some((e) => e.k === "antic") && ev.lanes === 0,
    `gaps ${t2.slice(1).map((x, i) => x.t - t2[i].t).join(",")}ms; board would have anticipated: ${ev.would}; ${ev.tries} draws`);
  const c2 = ev.ev.filter((e) => e.k === "count");
  check("…but its scatters still ping and count (that part is truthful)", c2.length >= 1 && c2[c2.length - 1].n >= 3, c2.map((c) => `${c.n}/${c.need}`).join(" "));

  console.log("\nfast-stop during anticipation");
  await forceBoard(`(r, m0) => { const a = findAnticipation(m0, 4); return a && a.fromCol <= 4 && r.near_miss?.pattern !== "scatter_one_short"; }`);
  await evaluate(cdp, `(__ev.length = 0, el.spinBtn.click(), true)`);
  for (let i = 0; i < 400; i++) { if (await evaluate(cdp, `__ev.some((e) => e.k === "antic" && e.ph === "start")`)) break; await sleep(10); }
  const tPress = await evaluate(cdp, `(el.spinBtn.click(), performance.now())`);
  await sleep(150);
  ev = await evaluate(cdp, `({ ev: __ev.slice(), drone: anticipationDrone.isPlaying(), antic: !!__reelRenderer.fx.drop?.antic, scat: (__forced.tumble_steps?.[0]?.matrix || __forced.matrix).flat().filter((s) => s === "SCATTER").length })`);
  const after = ev.ev.filter((e) => e.t >= tPress - 1);
  check("skip ends the tension at once: drone off, anticipation cleared", !ev.drone && !ev.antic && after.some((e) => e.k === "antic" && e.ph === "end"), `drone ${ev.drone} antic ${ev.antic} events ${JSON.stringify(after.filter((e) => e.k === "antic"))}`);
  const finalCount = ev.ev.filter((e) => e.k === "count").pop();
  check("…remaining scatters land together with the final count", finalCount && finalCount.n === ev.scat, `${finalCount?.n} of ${ev.scat}`);
  // Kinetic pass: the skip zips the remaining reels in left to right (FAST_ZIP), one thud each, all inside 130ms.
  const zt = after.filter((e) => e.k === "thud");
  check("…and the remaining reels zip in left to right within 130ms", zt.length >= 1 && zt.every((e, i) => i === 0 || e.col > zt[i - 1].col) && zt.every((e) => e.t - tPress < 130),
    zt.map((e) => `r${e.col + 1}@${Math.round(e.t - tPress)}`).join(" "));
  await settle();

  console.log("\nlock-on (trigger + retrigger)");
  const lock = await evaluate(cdp, `(async () => {
    const R = __reelRenderer; const seen = [];
    const od = R.drawScatterLocks.bind(R); R.drawScatterLocks = (...a) => { if (R.fx.lockOn) seen.push({ t: performance.now(), n: R.fx.lockOn.cells.length }); return od(...a); };
    const m = Array.from({ length: 5 }, () => Array(6).fill("RED_GEM")); [[0, 1], [2, 2], [3, 4], [4, 5]].forEach(([r, c]) => (m[r][c] = "SCATTER"));
    const t0 = performance.now();
    let hlAt = 0; const oh = R.highlight.bind(R); R.highlight = (...a) => { hlAt = hlAt || performance.now(); return oh(...a); };
    await celebrateScatterCatch({ matrix: m, tumble_steps: [{ matrix: m }] }, "Bonus Catch");
    const r1 = { frames: seen.length, cells: seen[0]?.n, lockedBeforeHighlight: seen.length > 0 && seen[seen.length - 1].t <= hlAt + 20, lockMs: Math.round(hlAt - t0) };
    seen.length = 0; hlAt = 0;
    const m2 = Array.from({ length: 5 }, () => Array(6).fill("RED_GEM")); [[1, 0], [2, 3], [0, 5]].forEach(([r, c]) => (m2[r][c] = "SCATTER"));
    await celebrateScatterCatch({ matrix: m2, tumble_steps: [{ matrix: m2 }], is_free_spin: true }, "Retrigger Catch");
    return { trigger: r1, retrigger: { frames: seen.length, cells: seen[0]?.n }, cleared: R.fx.lockOn === null };
  })()`);
  check("trigger: reticles lock on all 4 scatters before the feature reveal", lock.trigger.cells === 4 && lock.trigger.frames > 10 && lock.trigger.lockedBeforeHighlight, JSON.stringify(lock.trigger));
  check("retrigger: lock-on on all 3", lock.retrigger.cells === 3 && lock.retrigger.frames > 10, JSON.stringify(lock.retrigger));
  check("lock-on state cleared afterwards", lock.cleared);

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nSTEP5 PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
