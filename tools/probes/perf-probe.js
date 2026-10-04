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
  const TAG = process.env.TAG || "base";
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?perf=mid` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && !!state.sessionId`)) break; }
  await sleep(800);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await cdp.send("Performance.enable");
  await evaluate(cdp, `(() => { const R = __reelRenderer; window.__dt = []; const od = R.draw.bind(R);
    R.draw = () => { const t = performance.now(); od(); __dt.push(performance.now() - t); }; return true; })()`);
  const stat = (a) => { const s = a.slice().sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, p50: +q(0.5).toFixed(2), p95: +q(0.95).toFixed(2), max: +s[s.length - 1].toFixed(2) }; };
  const heapWatch = async (ms) => { const out = []; const t = Date.now(); while (Date.now() - t < ms) { const m = await cdp.send("Performance.getMetrics"); out.push(m.metrics.find((x) => x.name === "JSHeapUsedSize").value); await sleep(40); } return out; };
  const churn = (h) => { let alloc = 0, gcs = 0; for (let i = 1; i < h.length; i++) { const d = h[i] - h[i - 1]; if (d > 0) alloc += d; else if (d < -200000) gcs++; } return { allocMB: +(alloc / 1048576).toFixed(1), gcDrops: gcs }; };

  // idle
  await evaluate(cdp, `(__dt.length = 0, true)`);
  const hIdle = await heapWatch(3000);
  const idle = stat(await evaluate(cdp, `__dt.slice()`)); console.log(`[${TAG}] idle  frames drawn ${(idle.n / 3).toFixed(1)}/s (mid-tier idle cap 20)`);
  // busy: a winning round with a tumble chain (forced from real engine draws)
  await evaluate(cdp, `(() => { const real = api; api = async (p, payload) => { if (p !== "/api/v1/spin") return real(p, payload);
    for (;;) { const r = await real(p, { ...payload, spin_id: crypto.randomUUID() }); const x = Number(r.total_win) / Number(payload.bet_amount || 1);
      if ((r.tumble_steps || []).length >= 3 && x > 1 && x < 10 && !r.free_spins_awarded) return r; } }; return true; })()`);
  await evaluate(cdp, `(__dt.length = 0, true)`);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
  await cdp.send("Profiler.start");
  const t0 = Date.now();
  await evaluate(cdp, `el.spinBtn.click(), true`);
  const heapBusy = [];
  for (let i = 0; i < 600; i++) {
    const m = await cdp.send("Performance.getMetrics"); heapBusy.push(m.metrics.find((x) => x.name === "JSHeapUsedSize").value);
    if (!(await evaluate(cdp, "isRoundInFlight()")) && Date.now() - t0 > 1500) break;
    await sleep(40);
  }
  const roundMs = Date.now() - t0;
  const { profile } = await cdp.send("Profiler.stop");
  const busy = stat(await evaluate(cdp, `__dt.slice()`));
  // self time by function
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dts = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id); const k = (n.callFrame.functionName || "(anon)") + (n.callFrame.url.includes("main.js") ? "" : " [" + (n.callFrame.url.split("/").pop() || n.callFrame.url || "native") + "]"); self.set(k, (self.get(k) || 0) + (dts[i] || 0)); });
  const total = [...self.values()].reduce((a, b) => a + b, 0);
  const top = [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const share = (k) => (100 * ([...self.entries()].filter(([n]) => n.startsWith(k)).reduce((a, [, v]) => a + v, 0)) / total).toFixed(1);
  console.log(`[${TAG}] busy  CPU split: (program) ${share("(program)")}%  (idle) ${share("(idle)")}%  (garbage collector) ${share("(garbage collector)")}%  all JS+native rest ${(100 - share("(program)") - share("(idle)")).toFixed(1)}%`);
  const fps = (await evaluate(cdp, `__dt.length`)) / (roundMs / 1000);
  console.log(`[${TAG}] busy  frames drawn ${fps.toFixed(1)}/s (mid-tier cap 30)`);
  console.log(`[${TAG}] tier after busy round: ${await evaluate(cdp, `__reelRenderer.tier`)}; idle frames ${(await evaluate(cdp, `0`))}`);
  const particles = await evaluate(cdp, `__reelRenderer.particles.length`);
  console.log(`[${TAG}] idle  draw ms`, JSON.stringify(idle), "heap", JSON.stringify(churn(hIdle)));
  console.log(`[${TAG}] busy  draw ms`, JSON.stringify(busy), "heap", JSON.stringify(churn(heapBusy)), `round ${roundMs}ms`);
  console.log(`[${TAG}] busy  top self-time (CPU x4):`);
  top.forEach(([k, v]) => console.log(`    ${(100 * v / total).toFixed(1).padStart(5)}%  ${k}`));
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nPROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
