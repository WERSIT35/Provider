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
  const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) failed = true; };
  for (const [w, h] of [[1280, 720], [390, 844], [1920, 1080]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 900 });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready") && !!state.sessionId`)) break; }
    await sleep(900);
    await evaluate(cdp, `(el.spinBtn.click(), true)`);
    const res = await evaluate(cdp, `(async () => {
      const R = __reelRenderer, g = R.canvas.getContext("2d"), dpr = R.dpr;
      for (let i = 0; i < 400; i++) { if (R.fx.drop && !R.fx.drop.exit) break; await new Promise((r) => setTimeout(r, 2)); }
      const d0 = R.fx.drop, L = R.getLayout(), T = R.getTableRect();
      const realNow = performance.now.bind(performance), realRandom = Math.random;
      const frozen = (t, fn) => { performance.now = () => t; let seed = 1; Math.random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
        try { R.board.hidden = true; R.draw(); const a = fn(); R.board.hidden = false; seed = 1; R.draw(); const b = fn(); return [a, b]; } finally { performance.now = realNow; Math.random = realRandom; } };
      // central 70% of a lane: art is up to 1.12× wide, so a neighbouring resting
      // symbol may legitimately overhang a lane edge by a few px.
      const lanePx = (c, y0, y1) => g.getImageData(Math.round((L.padX + L.laneW * (c + 0.15)) * dpr), Math.round(y0 * dpr), Math.round(L.laneW * 0.7 * dpr), Math.max(1, Math.round((y1 - y0) * dpr))).data;
      const diff = (a, b) => { let n = 0; for (let p = 0; p < a.length; p += 4) if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > 24) n++; return n; };
      const bandTop = T.inY + 2;
      // (1) just before release: nothing of the waiting board, even 0.1 row into row 0
      const [a0, b0] = frozen(d0.start - 1, () => [0, 1, 2, 3, 4, 5].map((c) => lanePx(c, bandTop, L.top + L.rowStep * 0.1)));
      const waitLeak = a0.reduce((n, d, c) => n + diff(d, b0[c]), 0);
      // (2) through the drop: lanes whose row-0 symbol is still > half a row above its slot
      let enterLeak = 0, lanesChecked = 0, samples = 0;
      for (let at = 0; at <= 1200; at += 40) {
        const t = d0.start + at;
        performance.now = () => t;
        const lanes = [0, 1, 2, 3, 4, 5].filter((c) => d0.map["0-" + c] > 0 && R.cellOffset(0, c, L.rowStep) < -L.rowStep * 0.5);
        performance.now = realNow;
        if (!lanes.length) continue;
        // up to the last whole pixel above the grid edge (the edge pixel row is
        // anti-aliased by the clip itself)
        const [a, b] = frozen(t, () => lanes.map((c) => lanePx(c, bandTop, Math.floor(L.top))));
        lanes.forEach((c, k) => { enterLeak += diff(a[k], b[k]); });
        lanesChecked += lanes.length; samples++;
      }
      return { waitLeak, enterLeak, lanesChecked, samples, band: +(L.top - bandTop).toFixed(1) };
    })()`);
    check(`${w}x${h}: waiting symbols fully hidden (frame band + first 10% of row 0)`, res.waitLeak === 0, `${res.waitLeak} px`);
    if (res.band <= 0) { console.log(`  --   - ${w}x${h}: the frame edge is already below row 0 here (band ${res.band}px): nothing to leak into`); } else check(`${w}x${h}: entering symbols never show above row 0`, res.samples > 5 && res.enterLeak === 0, `${res.enterLeak} px over ${res.lanesChecked} lane-frames in ${res.samples} frozen frames; band ${res.band}px`);
    for (let i = 0; i < 300; i++) { if (!(await evaluate(cdp, "isRoundInFlight()"))) break; await sleep(50); }
  }
  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;

  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nMASK PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
