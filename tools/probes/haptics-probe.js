// Phase 5: haptics and the Settings device controls, in real Chrome.
//   CHROME_PATH=… node tools/probes/haptics-probe.js
// - a touch phone (touch emulation → pointer: coarse) buzzes on a spin (navigator.vibrate,
//   stubbed to record calls), and shows the Vibration switch;
// - switched off (remembered), it never buzzes; reduced motion: never;
// - a desktop (fine pointer) never buzzes and hides the switch;
// - Full screen shows only where the page may go full screen.
// Exits 1 on any failure.
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..", "..", "client");
const PORT = Number(process.env.PORT || 3131);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp",
  ".png": "image/png", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${!ok && detail ? `  [${detail}]` : ""}`); if (!ok) failed++; };

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" }).end(buf);
  });
});

async function open(browser, { touch, reducedMotion = false, hapticsOff = false }) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport({ width: touch ? 390 : 1280, height: touch ? 844 : 800, isMobile: touch, hasTouch: touch });
  if (touch) await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: reducedMotion ? "reduce" : "no-preference" }]);
  await page.evaluateOnNewDocument((off) => {
    window.__buzz = [];
    Object.defineProperty(navigator, "vibrate", { configurable: true, value: (p) => { window.__buzz.push(p); return true; } });
    try { if (off) localStorage.setItem("vx.haptics", "0"); else localStorage.removeItem("vx.haptics"); } catch { /* none */ }
  }, hapticsOff);
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof state !== "undefined" && !!state.sessionId && document.body.classList.contains("app-ready"), { timeout: 60000 });
  return page;
}

async function spinOnce(page) {
  await page.evaluate(() => { window.__buzz.length = 0; document.getElementById("spinBtn").click(); });
  await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 30000 }).catch(() => {});
  await sleep(300);
  return page.evaluate(() => window.__buzz.slice());
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
  if (!chrome) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  try {
    let page = await open(browser, { touch: true });
    check("touch phone: haptics supported", await page.evaluate(() => Haptics.supported));
    check("touch phone: the Vibration switch is shown", await page.evaluate(() => !document.getElementById("hapticsRow").hidden));
    const buzz = await spinOnce(page);
    check("touch phone: a spin buzzes (8 ms at spin start)", buzz.includes(8), JSON.stringify(buzz));
    await page.evaluate(() => { const t = document.getElementById("hapticsToggle"); t.checked = false; t.dispatchEvent(new Event("change")); });
    check("switched off: remembered on this device", await page.evaluate(() => localStorage.getItem("vx.haptics") === "0"));
    check("switched off: a spin never buzzes", (await spinOnce(page)).length === 0);
    await page.close();

    page = await open(browser, { touch: true, hapticsOff: true });
    check("reload after switching off: still off (switch unchecked, no buzz)",
      (await page.evaluate(() => !document.getElementById("hapticsToggle").checked)) && (await spinOnce(page)).length === 0);
    await page.close();

    page = await open(browser, { touch: true, reducedMotion: true });
    check("reduced motion: a spin never buzzes", (await spinOnce(page)).length === 0);
    await page.close();

    page = await open(browser, { touch: false });
    check("desktop (fine pointer): no haptics, switch hidden",
      (await page.evaluate(() => !Haptics.supported && document.getElementById("hapticsRow").hidden)) && (await spinOnce(page)).length === 0);
    const fs = await page.evaluate(() => ({ enabled: document.fullscreenEnabled, shown: !document.getElementById("fullscreenBtn").hidden }));
    check("Full screen: shown exactly when the page may go full screen", fs.enabled === fs.shown, JSON.stringify(fs));
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\nhaptics-probe: ${failed ? `FAIL (${failed})` : "PASS"}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
