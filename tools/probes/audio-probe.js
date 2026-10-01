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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && !!state.sessionId`)) break; }
  await sleep(800);
  await evaluate(cdp, `(() => {
    const realApi = api;
    window.__want = "tumble";
    api = async (p, payload) => {
      if (p !== "/api/v1/spin") return realApi(p, payload);
      for (;;) {
        const r = await realApi(p, { ...payload, spin_id: crypto.randomUUID() });
        const x = Number(r.total_win || 0) / Number(payload.bet_amount || 1);
        if (r.free_spins_awarded || x >= 10) continue;
        if (__want === "any" || (r.tumble_steps || []).length >= 2) return r;
      }
    };
    const R = __reelRenderer;
    window.__drops = []; window.__thuds = [];
    const os = R.scheduleColumnStops.bind(R);
    R.scheduleColumnStops = (map, dur) => {
      const now = performance.now(), land = {};
      for (const [k, n] of Object.entries(map || {})) { if (Number(n) <= 0) continue;
        const [r, c] = k.split("-").map(Number);
        land[c] = Math.max(land[c] || 0, now + R.dropDelay(r, c, Number(n)) + R.colDropMs(c) * R.reelProfile(c).contact); }
      __drops.push({ t: now, land, fast: !!state.fastStopRequested });
      return os(map, dur);
    };
    const realPlay = window.Sound.play.bind(window.Sound);
    // A multiplier BANG also plays reel_stop (its heavy thud); those are not column landings.
    window.__inBang = false;
    const oh = R.spawnHeavyImpact.bind(R); R.spawnHeavyImpact = (...x) => { __inBang = true; try { return oh(...x); } finally { __inBang = false; } };
    window.Sound.play = (name, o) => { if (name === "reel_stop" && !__inBang) __thuds.push({ t: performance.now(), col: o && o.index }); return realPlay(name, o); };
    return true;
  })()`);
  const round = async (pre) => {
    await sleep(300); // past the post-settle press guard
    await evaluate(cdp, `(__drops.length = 0, __thuds.length = 0, true)`);
    await evaluate(cdp, pre || `(el.spinBtn.click(), true)`);
    const t0 = Date.now();
    for (;;) { await sleep(60); if (!(await evaluate(cdp, "isRoundInFlight()")) && Date.now() - t0 > 800) break; if (Date.now() - t0 > 60000) break; }
    await sleep(300);
    return evaluate(cdp, `({ drops: __drops.slice(), thuds: __thuds.slice() })`);
  };
  // Attribute each thud to the drop it belongs to (the latest drop scheduled before it).
  const perDrop = ({ drops, thuds }) => drops.map((d, i) => {
    const next = drops[i + 1] ? drops[i + 1].t : Infinity;
    return { d, th: thuds.filter((x) => x.t >= d.t && x.t < next) };
  });

  console.log("\nnormal round with tumbles");
  const a = perDrop(await round());
  const intro = a[0];
  const cols = Object.keys(intro.d.land).map(Number).sort((x, y) => x - y);
  check("opening board: one thud per column, left to right", JSON.stringify(intro.th.map((x) => x.col)) === JSON.stringify(cols), intro.th.map((x) => x.col).join(","));
  const err = intro.th.map((x) => Math.round(x.t - intro.d.land[x.col]));
  check("each thud lands within 30ms of its column's landing", err.every((e) => Math.abs(e) <= 30), `offsets ${err.join(",")}ms`);
  const gaps = intro.th.slice(1).map((x, i) => Math.round(x.t - intro.th[i].t));
  check("thuds follow the ~80ms reel stagger (WATERFALL.colMs)", gaps.every((g) => g >= 65 && g <= 100), `gaps ${gaps.join(",")}ms`);
  const refills = a.slice(1);
  const refillOk = refills.every(({ d, th }) => JSON.stringify(th.map((x) => x.col).sort((x, y) => x - y)) === JSON.stringify(Object.keys(d.land).map(Number).sort((x, y) => x - y)));
  check(`tumble refills (${refills.length}): thuds only on columns that dropped`, refills.length > 0 && refillOk,
    refills.map(({ d, th }) => `[${Object.keys(d.land).join("")}→${th.map((x) => x.col).join("")}]`).join(" "));

  console.log("\nfast-stop before the drop starts");
  await evaluate(cdp, `(window.__want = "any", true)`);
  const b = perDrop(await round(`(el.spinBtn.click(), setTimeout(() => el.spinBtn.click(), 30), true)`));
  // Kinetic pass: the board zips in reel by reel (FAST_ZIP), one thud per reel, inside 130ms.
  const bt = b[0] ? b[0].th : [];
  check("opening board zips in: one thud per reel, left to right, within 130ms", bt.length === 6 && bt.every((x, i) => x.col === i) && bt[5].t - b[0].d.t < 130,
    bt.map((x) => `r${x.col + 1}@${Math.round(x.t - b[0].d.t)}`).join(" "));

  console.log("\nfast-stop mid-waterfall");
  // Press once the opening drop has been scheduled and ~2 columns have landed.
  await evaluate(cdp, `(__drops.length = 0, __thuds.length = 0, el.spinBtn.click(), true)`);
  for (let i = 0; i < 400; i++) { await sleep(10); if (await evaluate(cdp, "__thuds.length >= 2")) break; }
  await evaluate(cdp, `(el.spinBtn.click(), true)`);
  for (let i = 0; i < 400; i++) { await sleep(60); if (!(await evaluate(cdp, "isRoundInFlight()"))) break; }
  const c = perDrop(await evaluate(cdp, `({ drops: __drops.slice(), thuds: __thuds.slice() })`));
  const n = c[0].th.length;
  const cs = c[0].th.map((x) => x.col);
  check("landed reels + the rest zipped in: every reel thuds exactly once, in order", n === 6 && cs.every((x, i) => x === i), `${n} thuds: ${cs.join(",")}`);

  console.log("\nturbo");
  await evaluate(cdp, `(setTurbo(true), window.__want = "any", true)`);
  const d = perDrop(await round());
  const tg = d[0].th.slice(1).map((x, i) => Math.round(x.t - d[0].th[i].t));
  check("turbo compresses the stagger (~26ms) and keeps one thud per column", d[0].th.length === 6 && tg.every((g) => g >= 15 && g <= 45), `gaps ${tg.join(",")}ms`);
  await evaluate(cdp, `(setTurbo(false), true)`);

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nAUDIO PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
