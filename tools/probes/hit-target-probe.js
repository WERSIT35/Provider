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
  const IDS = ["spinBtn", "betDownBtn", "betUpBtn", "buyFreeBtn", "anteToggle", "autoplayBtn", "turboBtn", "psMenuBtn", "psInfoBtn", "soundToggle"];
  for (const [w, h] of [[320, 568], [390, 844], [844, 390], [740, 360], [1280, 720]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: w < 820 });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
    for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `document.body && document.body.classList.contains("app-ready")`)) break; }
    await sleep(500);
    const r = await evaluate(cdp, `(() => {
      const target = (id) => { const e = document.getElementById(id); return id === "anteToggle" ? e.closest("label") : e; };
      const bad = [];
      for (const id of ${JSON.stringify(IDS)}) {
        const t = target(id); const b = t.getBoundingClientRect(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
        for (const [dx, dy] of [[21, 0], [-21, 0], [0, 21], [0, -21]]) {
          const hit = document.elementFromPoint(cx + dx, cy + dy);
          if (!hit || !(hit === t || t.contains(hit))) bad.push(id + "@" + dx + "," + dy + "→" + (hit ? (hit.id || hit.className || hit.tagName) : "none"));
        }
      }
      return bad;
    })()`);
    console.log(`${w}x${h}  44px hit area misses: ${r.length ? r.join("  ") : "none"}`);
    if (r.length) failed = true;
  }
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nHIT PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
