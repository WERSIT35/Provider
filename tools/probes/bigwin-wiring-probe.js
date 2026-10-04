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
  await sleep(600);

  // Force a 10x+ round through the REAL lifecycle: keep drawing genuine engine
  // outcomes until one qualifies. Test-only; the client never does this.
  await evaluate(cdp, `(() => {
    const realApi = api;
    window.__tries = 0;
    api = async (p, payload) => {
      if (p !== "/api/v1/spin" || !window.__wantBig) return realApi(p, payload);
      for (;;) {
        window.__tries++;
        const r = await realApi(p, { ...payload, spin_id: crypto.randomUUID() });
        if (Number(r.total_win || 0) >= 10 * Number(payload.bet_amount || 1) && !r.free_spins_awarded) return r;
      }
    };
    window.__overlay = document.getElementById("bigWinOverlay");
    return true;
  })()`);
  const st = () => evaluate(cdp, `({ open: __overlay.classList.contains("is-open"), done: __overlay.classList.contains("is-done"),
    tier: __overlay.dataset.tier || "", paused: !!__reelRenderer._paused, inFlight: isRoundInFlight(), locked: spinLock.isLocked(),
    amount: document.querySelector("[data-bw-amount]").textContent, meter: el.lastWin.textContent })`);
  const waitFor = async (pred, ms) => { const t = Date.now(); for (;;) { const s = await st(); if (pred(s)) return s; if (Date.now() - t > ms) return s; await sleep(50); } };

  console.log("\nmanual spin, 10x+ win, skipped with the spin button");
  await evaluate(cdp, `(window.__wantBig = true, el.spinBtn.click(), true)`);
  let s = await waitFor((x) => x.open, 30000);
  const tries = await evaluate(cdp, "__tries");
  check("overlay opens at round end", s.open, `after ${tries} engine draws`);
  check("reel renderer paused while overlay is up", s.paused);
  check("round still in flight (spin lock held)", s.inFlight && s.locked);
  check("HUD win meter already shows the settled total", s.meter !== "0.00", s.meter);
  // Tab comes back while the overlay is up: must NOT wake the board.
  await evaluate(cdp, `document.dispatchEvent(new Event("visibilitychange")), true`);
  check("visibilitychange does not resume the board under the overlay", (await st()).paused);
  await sleep(500);
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`); // spin press → requestFastStop → bigWin.advance → skip
  await sleep(60);
  s = await st();
  check("spin press skips the count to the final amount", s.done && s.amount === s.meter, `${s.amount} vs meter ${s.meter}`);
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`); // inside the skip guard
  await sleep(60);
  check("press inside the skip guard is ignored", (await st()).open);
  await sleep(500);
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`); // dismiss
  s = await waitFor((x) => !x.inFlight, 8000);
  check("next press dismisses; round settles; lock released", !s.open && !s.inFlight && !s.locked);
  check("board rendering resumed", !s.paused);
  const started = await evaluate(cdp, "lifecycleStats.startedManual");
  check("none of those presses started a new spin", started === 1, `startedManual=${started}`);

  console.log("\nmanual spin, 10x+ win, nobody taps (auto-dismiss)");
  const t0 = Date.now();
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`);
  s = await waitFor((x) => x.open, 30000);
  check("overlay opens", s.open);
  s = await waitFor((x) => !x.inFlight, 30000);
  check("round settles on its own (4s auto-dismiss), lock released", !s.open && !s.inFlight && !s.paused, `${Date.now() - t0}ms total`);

  console.log("\nturbo, 10x+ win");
  await evaluate(cdp, `(setTurbo(true), true)`);
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`);
  s = await waitFor((x) => x.open, 30000);
  const tOpen = Date.now();
  s = await waitFor((x) => x.done, 15000);
  check("turbo count finishes quickly", s.done && Date.now() - tOpen < 3500, `${Date.now() - tOpen}ms`);
  s = await waitFor((x) => !x.inFlight, 15000);
  check("turbo round settles", !s.inFlight);
  await evaluate(cdp, `(setTurbo(false), window.__wantBig = false, true)`);

  console.log("\nordinary spins still work afterwards");
  await sleep(300); // past the post-settle press guard
  await evaluate(cdp, `el.spinBtn.click(), true`);
  s = await waitFor((x) => !x.inFlight, 20000);
  check("a normal spin completes and settles", !s.inFlight && !s.open);

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nWIRED PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
