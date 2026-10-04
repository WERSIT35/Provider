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

  const center = async (sel) => evaluate(cdp, `(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) }; })()`);
  const mouse = (type, p, extra = {}) => cdp.send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1, ...extra });
  const key = (type, extra = {}) => cdp.send("Input.dispatchKeyEvent", { type, code: "Space", key: " ", windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32, ...(type === "keyDown" ? { text: " " } : {}), ...extra });
  const stats = () => evaluate(cdp, `({ manual: lifecycleStats.startedManual, auto: lifecycleStats.startedAuto, blocked: lifecycleStats.blockedPresses, inFlight: isRoundInFlight(), autoplay: state.autoplayActive, left: String(state.autoplayLeft), turbo: state.turbo })`);
  // Idle = not in flight AND past the post-settle press guard (a press inside it is a late skip).
  const settle = async (ms = 30000) => { const t = Date.now(); for (;;) { const s = await stats(); if (!s.inFlight) { await sleep(300); return stats(); } if (Date.now() - t > ms) return s; await sleep(80); } };
  const spin = await center("#spinBtn");
  await mouse("mouseMoved", spin);

  console.log("\nmouse");
  let s0 = await stats();
  await mouse("mousePressed", spin); await sleep(80); await mouse("mouseReleased", spin);
  await sleep(150);
  let s1 = await stats();
  check("short tap starts exactly one spin", s1.manual - s0.manual === 1 && !s1.autoplay && s1.turbo === s0.turbo, JSON.stringify(s1));
  await settle();

  // Hammering spin with real taps (~every 50ms incl. CDP latency). Invariants:
  // rounds never overlap, every round starts from a tap (nothing queued), and no
  // round starts within SPIN_SETTLE_GUARD_MS of the previous one settling.
  await evaluate(cdp, `(() => { window.__rounds = []; const rs = ticker.roundStart, re = ticker.roundEnd;
    ticker.roundStart = () => { __rounds.push({ s: performance.now(), e: null, overlap: __rounds.some((r) => r.e === null) }); return rs(); };
    ticker.roundEnd = () => { const r = __rounds[__rounds.length - 1]; if (r) r.e = performance.now(); return re(); };
    window.__taps = []; el.spinBtn.addEventListener("pointerup", () => __taps.push(performance.now()), true); return true; })()`);
  s0 = await stats();
  for (let i = 0; i < 12; i++) { await mouse("mousePressed", spin); await mouse("mouseReleased", spin); await sleep(15); }
  s1 = await settle();
  const ham = await evaluate(cdp, `({ rounds: __rounds.slice(), taps: __taps.slice(), guard: SPIN_SETTLE_GUARD_MS })`);
  const overlaps = ham.rounds.filter((r) => r.overlap).length;
  const fromTap = ham.rounds.every((r) => ham.taps.some((t) => r.s - t >= 0 && r.s - t < 30));
  const guardOk = ham.rounds.slice(1).every((r, i) => r.s - ham.rounds[i].e >= ham.guard);
  check("hammering 12 real taps: no overlap, nothing queued, guard respected", overlaps === 0 && fromTap && guardOk && s1.manual - s0.manual <= 4,
    `${s1.manual - s0.manual} round(s) from 12 taps, blocked +${s1.blocked - s0.blocked}, overlaps ${overlaps}`);
  s0 = await stats();
  for (let i = 0; i < 12; i++) await evaluate(cdp, `el.spinBtn.click(), true`);
  s1 = await settle();
  check("12 presses in one burst still resolve exactly one spin (#28)", s1.manual - s0.manual === 1, `manual +${s1.manual - s0.manual}`);

  s0 = await stats();
  await mouse("mousePressed", spin); await mouse("mouseMoved", { x: spin.x + 300, y: spin.y - 300 }); await mouse("mouseReleased", { x: spin.x + 300, y: spin.y - 300 });
  await sleep(300);
  s1 = await stats();
  check("press then drag off cancels: no spin", s1.manual === s0.manual && !s1.inFlight);
  await mouse("mouseMoved", spin);

  s0 = await stats();
  await mouse("mousePressed", spin); await sleep(650);
  s1 = await stats();
  check("hold ≥ 400ms: turbo on + endless autoplay, while still held", s1.autoplay && s1.turbo && s1.left === "Infinity", JSON.stringify(s1));
  await mouse("mouseReleased", spin); await sleep(1500);
  s1 = await stats();
  check("release after the hold does not stop or add a spin", s1.autoplay && s1.manual === s0.manual, JSON.stringify(s1));
  await sleep(1200);
  const autoBefore = (await stats()).auto;
  await mouse("mousePressed", spin); await sleep(60); await mouse("mouseReleased", spin);
  await sleep(100);
  const sStop = await stats();
  check("tap during autoplay stops it", !sStop.autoplay, JSON.stringify(sStop));
  const sEnd = await settle();
  check("…the current round still resolves, nothing new starts", !sEnd.inFlight && sEnd.manual === s0.manual && sEnd.auto - autoBefore <= 1, `auto +${sEnd.auto - autoBefore}`);
  await evaluate(cdp, `(setTurbo(false), true)`);

  console.log("\nspace bar");
  s0 = await stats();
  await key("keyDown"); await sleep(80); await key("keyUp");
  await sleep(150);
  s1 = await stats();
  check("space tap starts exactly one spin", s1.manual - s0.manual === 1, JSON.stringify(s1));
  await settle();
  s0 = await stats();
  await key("keyDown");
  for (let i = 0; i < 8; i++) { await sleep(70); await key("keyDown", { autoRepeat: true }); }
  s1 = await stats();
  check("space hold (with key auto-repeat): turbo + autoplay, once", s1.autoplay && s1.turbo && s1.manual === s0.manual, JSON.stringify(s1));
  await key("keyUp"); await sleep(1200);
  await key("keyDown"); await sleep(50); await key("keyUp");
  await sleep(100);
  check("space tap during autoplay stops it", !(await stats()).autoplay);
  await settle();
  await evaluate(cdp, `(setTurbo(false), true)`);

  console.log("\nmodal");
  const menu = await center("#psMenuBtn");
  await mouse("mouseMoved", menu); await mouse("mousePressed", menu); await mouse("mouseReleased", menu);
  await sleep(200);
  let m = await evaluate(cdp, `(() => { const r = el.psInfoModal; const cur = r.querySelector(".ps-modal__tab[aria-current='page']");
    const vis = [...r.querySelectorAll(".ps-modal__section")].filter((x) => !x.hidden).map((x) => x.dataset.psSectionId);
    return { open: !r.hidden, tab: cur && cur.dataset.psSection, visible: vis, dot: r.querySelector(".ps-dot.is-active")?.dataset.psDot, focusInside: r.contains(document.activeElement) }; })()`);
  check("menu opens on Settings (tab, section and dot in sync)", m.open && m.tab === "settings" && m.visible.join() === "settings" && m.dot === "settings" && m.focusInside, JSON.stringify(m));
  for (let i = 0; i < 14; i++) await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 });
  check("Tab stays trapped inside the modal", await evaluate(cdp, `el.psInfoModal.contains(document.activeElement)`));
  for (let i = 0; i < 3; i++) await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9, modifiers: 8 });
  check("Shift+Tab stays trapped too", await evaluate(cdp, `el.psInfoModal.contains(document.activeElement)`));
  s0 = await stats();
  await key("keyDown"); await key("keyUp"); await sleep(200);
  check("space does not spin while the modal is open", (await stats()).manual === s0.manual);
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  check("ArrowRight pages to the next section", (await evaluate(cdp, `el.psInfoModal.querySelector(".ps-modal__tab[aria-current='page']").dataset.psSection`)) === "bet");
  const dot = await center(".ps-dot[data-ps-dot='tumble']");
  await mouse("mouseMoved", dot); await mouse("mousePressed", dot); await mouse("mouseReleased", dot);
  check("clicking a dot switches section", (await evaluate(cdp, `[...el.psInfoModal.querySelectorAll(".ps-modal__section")].find((x) => !x.hidden).dataset.psSectionId`)) === "tumble");
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(100);
  check("Escape closes and returns focus to the menu button", await evaluate(cdp, `el.psInfoModal.hidden && document.activeElement === el.psMenuBtn`));
  const info = await center("#psInfoBtn");
  await mouse("mouseMoved", info); await mouse("mousePressed", info); await mouse("mouseReleased", info);
  await sleep(200);
  const rules = await evaluate(cdp, `(() => { const sec = el.psInfoModal.querySelector('[data-ps-section-id="rules"]');
    return { visible: !sec.hidden, meta: sec.querySelector(".ps-rules-meta")?.textContent, pages: sec.querySelectorAll("h4").length }; })()`);
  check("info opens on Game Rules, generated from the rules file", rules.visible && /^RTP \d/.test(rules.meta || "") && rules.pages > 0, JSON.stringify(rules));
  await mouse("mouseMoved", { x: 20, y: 20 }); await mouse("mousePressed", { x: 20, y: 20 }); await mouse("mouseReleased", { x: 20, y: 20 });
  await sleep(100);
  check("backdrop click closes, focus back on the info button", await evaluate(cdp, `el.psInfoModal.hidden && document.activeElement === el.psInfoBtn`));

  console.log("\nticker");
  await evaluate(cdp, `document.activeElement.blur()`);
  await sleep(3500); // let the last round's result hold expire
  // A WIN from an earlier round holds until the next spin (tested below);
  // start the tip rotation from idle explicitly.
  await evaluate(cdp, `(ticker.idle(), true)`);
  const t0 = await evaluate(cdp, `el.psTickerText.textContent`);
  await sleep(4800); // TICKER.rotateMs 4500
  const t1 = await evaluate(cdp, `el.psTickerText.textContent`);
  check("idle messages rotate every 4.5s", t0 !== t1, `"${t0}" → "${t1}"`);
  const msgs = new Set([t0, t1]);
  for (let k = 0; k < 5; k++) { await sleep(4600); msgs.add(await evaluate(cdp, `el.psTickerText.textContent`)); }
  check("idle messages come from the rules file", [...msgs].some((x) => /Win up to 20,000× bet/.test(x)) && [...msgs].some((x) => /Minimum 8 matches/.test(x)) && [...msgs].some((x) => /4 scatters award 15 free spins/.test(x)), [...msgs].join(" | "));
  await evaluate(cdp, `(() => { const real = api; window.__realApi = real; api = async (p, payload) => { if (p !== "/api/v1/spin") return real(p, payload);
    for (;;) { const r = await real(p, { ...payload, spin_id: crypto.randomUUID() }); const x = Number(r.total_win) / Number(payload.bet_amount || 1); if (x > 0 && x < 10 && !r.free_spins_awarded) return r; } }; return true; })()`);
  await mouse("mouseMoved", spin); await mouse("mousePressed", spin); await sleep(60); await mouse("mouseReleased", spin);
  await sleep(250);
  const during = await evaluate(cdp, `el.psTickerText.textContent`);
  check("steps aside during a round", during === "Good luck!" || /^Win: /.test(during), during);
  let sawWin = false;
  for (let i = 0; i < 200; i++) { const tx = await evaluate(cdp, `el.psTickerText.textContent`); if (/^Win: \d/.test(tx)) sawWin = true; if (!(await evaluate(cdp, "isRoundInFlight()"))) break; await sleep(60); }
  await sleep(5000); // the WIN line holds until the next spin, past any tip rotation
  const after = await evaluate(cdp, `({ text: el.psTickerText.textContent, win: el.lastWin.textContent, st: el.psTicker.dataset.state })`);
  check("shows the win live and holds it (gold WIN state) until the next spin", sawWin && after.text === `Win: ${after.win}` && after.st === "win", JSON.stringify(after));
  await sleep(3300);
  const resumed = await evaluate(cdp, `el.psTickerText.textContent`);
  check("resumes idle rotation after the hold", !/^Win d/.test(resumed) && resumed !== "Good luck!", resumed);

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole/network problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;
  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nINPUT PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
