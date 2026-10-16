// Client probe on the real /play page (signed launch token), via puppeteer-core and
// your installed Chrome (no browser download).
//
//   node tools/bench/client.mjs --mode mobile [--spins 20]   # Lighthouse Slow-4G values + 4x CPU, phone viewport
//   node tools/bench/client.mjs --mode soak   [--spins 500]  # unthrottled, turbo, heap sampled after forced GC
//
// Chrome: CHROME_PATH, or a standard install. CHROME_ARGS adds launch flags (space-separated).
// BENCH_HEADLESS=shell for a chrome-headless-shell binary (default: new headless).
// --minutes N (default 20): stop starting new spins after N minutes and report what was measured.
// Writes qa/bench/client-<mode>.json.
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";
import { args, launchPlayer, sleep, startServer, writeResult, pinGeneratorSide } from "./common.mjs";
pinGeneratorSide();

const a = args({ mode: "mobile", spins: 0, pause: 300, minutes: 20 });
const MODE = a.mode;
const SPINS = a.spins || (MODE === "soak" ? 500 : 20);

const chromePath = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .filter(Boolean).find((p) => existsSync(p));
if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

const T0 = Date.now();
const log = (...m) => process.stderr.write(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m.join(" ")}\n`);
const srv = await startServer({ LOG_LEVEL: "warn" });
const extra = (process.env.CHROME_ARGS ?? "").split(" ").filter((x) => x && !x.startsWith("--headless"));
const browser = await puppeteer.launch({
  executablePath: chromePath, headless: process.env.BENCH_HEADLESS === "shell" ? "shell" : true,
  args: [...extra, "--autoplay-policy=no-user-gesture-required"], protocolTimeout: 0
});

let result;
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  await page.setViewport({ width: 412, height: 823, deviceScaleFactor: 1.75, isMobile: true, hasTouch: true });
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  if (MODE === "mobile") {
    // Lighthouse "mobile slow 4G" devtools-throttling values.
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 562.5, downloadThroughput: 1474.56 * 1024 / 8, uploadThroughput: 675 * 1024 / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  }

  const reqs = new Map(); let ready = false;
  cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, bytes: 0, beforeReady: !ready }));
  cdp.on("Network.responseReceived", (e) => { const r = reqs.get(e.requestId); if (r) r.type = e.type; });
  cdp.on("Network.loadingFinished", (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });

  await page.evaluateOnNewDocument(() => {
    window.__bench = { frames: [], long: [], events: [] }; let last = 0;
    const tick = (t) => { if (last) window.__bench.frames.push(t - last); last = t; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__bench.long.push(e.duration); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/^(click|pointerdown|pointerup)$/.test(e.name)) window.__bench.events.push(e.duration); })
      .observe({ type: "event", durationThreshold: 16, buffered: true });
  });

  const url = `http://127.0.0.1:${srv.cred.port}/play?lt=${await launchPlayer(srv.cred, `bench-client-${Date.now()}`)}`;
  const navStart = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 0 });
  await page.waitForFunction(() => document.body.classList.contains("app-ready"), { timeout: 180_000, polling: 50 });
  const timeToReadyMs = Date.now() - navStart; ready = true;
  log("playable", timeToReadyMs, "ms");
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0]; const p = performance.getEntriesByType("paint").find((x) => x.name === "first-contentful-paint");
    return { fcp: p ? Math.round(p.startTime) : null, dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) };
  });
  await sleep(1500);

  await cdp.send("HeapProfiler.enable");
  const heap = async () => { await cdp.send("HeapProfiler.collectGarbage"); const h = await cdp.send("Runtime.getHeapUsage"); const d = await cdp.send("Memory.getDOMCounters");
    return { heapMB: +(h.usedSize / 1048576).toFixed(2), nodes: d.nodes, listeners: d.jsEventListeners }; };
  // Same as tools/spin-e2e.js: the bonus feature screen waits for a click. Other popups close.
  const dismiss = () => page.evaluate(() => {
    const f = document.getElementById("featureScreen"); if (f && !f.classList.contains("hidden")) f.click();
    for (const b of document.querySelectorAll("[data-vx-close], .ps-modal__close")) if (b.offsetParent) b.click();
  });
  let shots = 0;
  const waitIdle = async () => {
    const t = Date.now();
    for (;;) {
      const idle = await page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 3000, polling: 50 }).then(() => true, () => false);
      if (idle) return;
      await dismiss(); // a bonus feature screen holds the round until it is clicked
      if (Date.now() - t > 60_000 && shots < 3) {
        shots++;
        const file = `qa/bench/runs/client-${MODE}-slow-round-${Date.now()}.png`;
        await page.screenshot({ path: file }).catch(() => {});
        log("round still running after", Math.round((Date.now() - t) / 1000), "s; screenshot", file);
      }
    }
  };
  if (MODE === "soak") await page.evaluate(() => { const t = document.getElementById("turboBtn"); if (t && t.getAttribute("aria-pressed") !== "true") t.click(); });
  await page.evaluate(() => { window.__bench.frames = []; window.__bench.long = []; window.__bench.events = []; });

  const heapSamples = []; const roundMs = []; let tapToRequestMs = null; let stuck = 0; let tapsReadAsHold = 0;
  let autoBefore = await page.evaluate(() => window.__spinLifecycle.stats.startedAuto);
  const deadline = Date.now() + a.minutes * 60_000;
  let stoppedEarly = false;
  for (let i = 0; i < SPINS; i++) {
    if (Date.now() > deadline) { stoppedEarly = true; log(`time budget (${a.minutes} min) reached after ${i} spins`); break; }
    await waitIdle();
    await dismiss();
    await sleep(a.pause); // a human never re-taps inside SPIN_SETTLE_GUARD_MS (250 ms): such a press is dropped by design
    if (MODE === "soak" && (i === 25 || (i > 0 && i % 100 === 0))) heapSamples.push({ spin: i, ...(await heap()) });
    const s0 = Date.now();
    let sent = false;
    for (let attempt = 0; attempt < 3 && !sent; attempt++) {
      const req = page.waitForRequest((r) => r.url().includes("/game/v1/spin"), { timeout: 15_000 }).then(() => true, () => false);
      await page.tap("#spinBtn").catch(() => {});
      sent = await req;
      if (!sent) { stuck++; log("tap did not start a spin", i, "attempt", attempt); await dismiss(); }
    }
    if (!sent) { log("giving up at spin", i); break; }
    if (i === 0) tapToRequestMs = Date.now() - s0;
    await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 5000, polling: 16 }).catch(() => {});
    // A tap read as a HOLD starts infinite autoplay (client/main.js SPIN_HOLD_MS timer
    // fires when the main thread is too busy to handle the release in time). Count it
    // (a real defect on slow phones) and stop the autoplay with another press.
    const autoNow = await page.evaluate(() => window.__spinLifecycle.stats.startedAuto);
    if (autoNow > autoBefore) {
      tapsReadAsHold++;
      log("tap was read as a hold: autoplay started; stopping it");
      await page.tap("#spinBtn").catch(() => {});
      autoBefore = autoNow;
    }
    await waitIdle();
    roundMs.push(Date.now() - s0);
    if (i % 100 === 0 || i < 2) log("spin", i, roundMs.at(-1), "ms");
  }
  if (MODE === "soak") heapSamples.push({ spin: roundMs.length, ...(await heap()) });

  const st = await page.evaluate(() => window.__bench);
  const f = st.frames.filter((x) => x < 1000).sort((x, y) => x - y);
  const q = (arr, p) => (arr.length ? +arr[Math.min(arr.length - 1, Math.floor(p * arr.length))].toFixed(1) : null);
  const ev = [...st.events].sort((x, y) => x - y);
  const all = [...reqs.values()]; const kb = (xs) => +(xs.reduce((s, r) => s + r.bytes, 0) / 1024).toFixed(0);
  const byType = {}; for (const r of all) byType[r.type ?? "Other"] = (byType[r.type ?? "Other"] ?? 0) + r.bytes;
  result = {
    mode: MODE, throttling: MODE === "mobile" ? "Slow 4G (562.5 ms, 1.47 Mbps) + 4x CPU" : "none",
    chrome: await browser.version(),
    tier: await page.evaluate(() => [...document.body.classList].filter((c) => c.startsWith("perf-")).join(" ")),
    spins: roundMs.length, spinsRequested: SPINS, stoppedByTimeBudget: stoppedEarly,
    roundMs: roundMs.length ? { p50: q([...roundMs].sort((x, y) => x - y), 0.5), max: Math.max(...roundMs) } : null,
    tapsThatDidNotStartASpin: stuck, tapsReadAsHoldStartingAutoplay: tapsReadAsHold,
    timeToPlayableMs: timeToReadyMs, fcpMs: nav.fcp, domContentLoadedMs: nav.dcl, loadEventMs: nav.load,
    requestsBeforePlayable: all.filter((r) => r.beforeReady).length, kbBeforePlayable: kb(all.filter((r) => r.beforeReady)), kbPerSession: kb(all),
    kbByType: Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, +(v / 1024).toFixed(0)])),
    firstTapToSpinRequestMs: tapToRequestMs,
    inputEventMs: { n: ev.length, p50: q(ev, 0.5), max: ev.length ? Math.max(...ev) : null },
    frames: {
      n: f.length, avgFps: f.length ? +(1000 / (f.reduce((s, x) => s + x, 0) / f.length)).toFixed(1) : null, p95Ms: q(f, 0.95), p99Ms: q(f, 0.99),
      over20msPct: f.length ? +(100 * f.filter((x) => x > 20).length / f.length).toFixed(1) : null,
      over50msPct: f.length ? +(100 * f.filter((x) => x > 50).length / f.length).toFixed(2) : null
    },
    longTasks: { n: st.long.length, maxMs: st.long.length ? Math.max(...st.long) : 0, totalMs: Math.round(st.long.reduce((s, x) => s + x, 0)) },
    heap: heapSamples,
    // Every request before playable, in order: what the critical path is made of.
    requestsBeforePlayableList: all.filter((r) => r.beforeReady).map((r) => `${(r.bytes / 1024).toFixed(1)} KB ${r.url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, "")}`),
    biggestDownloads: all.sort((x, y) => y.bytes - x.bytes).slice(0, 8)
      .map((r) => ({ kb: +(r.bytes / 1024).toFixed(0), path: r.url.replace(/^https?:\/\/[^/]+/, "").replace(/\?.*/, ""), beforePlayable: r.beforeReady }))
  };
} finally {
  await browser.close().catch(() => {});
  srv.child.kill();
  await sleep(500);
}
console.log(JSON.stringify(result, null, 2));
console.log("→", writeResult(`client-${MODE}`, result));
process.exit(0);
