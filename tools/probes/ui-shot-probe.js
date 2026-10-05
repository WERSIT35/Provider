#!/usr/bin/env node
"use strict";

// Visual snapshot of the player view: the board idle and with a winning cluster lit,
// at desktop, phone landscape and phone portrait. For reviewing styling work by eye;
// layout-check.js is the pass/fail gate.
//
//   node tools/probes/ui-shot-probe.js            # PNGs to the OS temp dir
//   SHOTS_DIR=out LABEL=after node tools/probes/ui-shot-probe.js

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3117);
const ROOT = path.join(__dirname, "..", "..", "client");
const OUT = process.env.SHOTS_DIR || os.tmpdir();
const LABEL = process.env.LABEL || "shot";
const VIEWPORTS = [
  { name: "desktop", w: 1440, h: 900, mobile: false },
  { name: "landscape", w: 844, h: 390, mobile: true },
  { name: "portrait", w: 390, h: 844, mobile: true }
];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ico": "image/x-icon" };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}
function findChrome() {
  return [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    .filter(Boolean).find((p) => fs.existsSync(p));
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  return { ready, send: (method, params) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }, close: () => ws.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A board with an 8-symbol win of one symbol, played through the renderer's real win
// highlight (no engine involved).
const LIGHT_WIN = `(() => {
  const r = window.__reelRenderer;
  const m = r.board.matrix.map((row) => row.slice());
  const sym = m[0][0];
  const cells = [[0,0],[0,1],[1,0],[1,2],[2,1],[3,3],[4,4],[2,5]];
  for (const [row, col] of cells) m[row][col] = sym;
  r.setBoard(m);
  r.highlight(m, { winning: cells.map(([row, col]) => ({ row, col })) }, 4000); // the real celebration, captured mid-hold
  return true;
})()`;

async function main() {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }
  const server = await startServer();
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "bx-shot-"))}`, "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsBase = await new Promise((resolve) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); });
  const list = await (await fetch(`${wsBase}/json/list`)).json();
  const cdp = connect(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  const ev = async (e) => { const r = await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); return r.result?.value; };
  const files = [];
  try {
    for (const vp of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: vp.w, height: vp.h, deviceScaleFactor: 1, mobile: vp.mobile, screenWidth: vp.w, screenHeight: vp.h });
      const loaded = new Promise((res) => { const t = setInterval(async () => { if (await ev(`typeof state !== 'undefined' && !!state.sessionId && document.body.classList.contains('app-ready')`).catch(() => false)) { clearInterval(t); res(); } }, 100); });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?reset` });
      await loaded;
      await sleep(1500);
      for (const [state, setup] of [["idle", null], ["win", LIGHT_WIN]]) {
        if (setup) { await ev(setup); await sleep(1200); }
        const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
        const file = path.join(OUT, `ui-${LABEL}-${vp.name}-${state}.png`);
        fs.writeFileSync(file, Buffer.from(data, "base64"));
        files.push(file);
      }
    }
  } finally {
    cdp.close();
    chrome.kill();
    server.close();
  }
  console.log(files.join("\n"));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
