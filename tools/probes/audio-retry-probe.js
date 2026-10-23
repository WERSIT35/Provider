// Sound comes back after a failed load, in real Chrome.
//   CHROME_PATH=… node tools/probes/audio-retry-probe.js
// iOS relaunching Safari restores the page before its network is up: the sound list
// (manifest.json) or the first sounds fail to load. Those failures used to be kept for the
// page's life, so the game stayed silent until a reload. Here the server refuses them at
// page load, then comes back, and one tap must bring the sounds back.
// Exits 1 on any failure.
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..", "..", "client");
const PORT = Number(process.env.PORT || 3133);
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp",
  ".png": "image/png", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".mp3": "audio/mpeg", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${!ok && detail ? `  [${detail}]` : ""}`); if (!ok) failed++; };

// What the "network" refuses right now: a predicate over the request path.
let refuse = () => false;
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent((req.url || "/").split("?")[0]).replace(/^\/+/, "") || "index.html";
  if (refuse(rel)) return res.writeHead(503).end();
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(buf);
  });
});

async function open(browser) {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => typeof state !== "undefined" && !!state.sessionId && document.body.classList.contains("app-ready"), { timeout: 60000 });
  await sleep(1500); // the load-time fetches have been tried (and refused)
  return page;
}

// A tap on the message line (no control there): the gesture that unlocks and revives audio.
const tap = (page) => page.tap("#psTicker");
const hasSpinSound = (page) => page.evaluate(() => {
  const m = Sound.debug.manifest();
  const files = (m && m.sounds.spin_start) || [];
  return files.length > 0 && files.some((f) => Sound.debug.loaded().includes(f));
});

async function spinVoiced(page) {
  await page.evaluate(() => document.getElementById("spinBtn").click());
  await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 30000 }).catch(() => {});
  return page.evaluate(() => Sound.debug.recent().some((r) => r.name === "spin_start" && r.file));
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].find((p) => p && fs.existsSync(p));
  if (!chrome) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
  try {
    // 1. The sound list itself fails at load.
    refuse = (rel) => rel.startsWith("assets/audio/");
    let page = await open(browser);
    check("list refused at load: no sound list, nothing loaded", await page.evaluate(() => !Sound.debug.manifest() && Sound.debug.loaded().length === 0));
    refuse = () => false;
    await tap(page);
    const back1 = await page.waitForFunction(() => {
      const m = Sound.debug.manifest();
      return !!m && m.sounds.spin_start.some((f) => Sound.debug.loaded().includes(f));
    }, { timeout: 15000 }).then(() => true, () => false);
    check("list refused at load: one tap later the list and the spin sound load", back1, JSON.stringify(await page.evaluate(() => Sound.debug.trace())));
    check("list refused at load: the next spin is voiced", await spinVoiced(page));
    await page.close();

    // 2. The list loads but the first spin's sound files fail.
    refuse = (rel) => rel.startsWith("assets/audio/") && !rel.endsWith("manifest.json");
    page = await open(browser);
    check("sounds refused at load: list loaded, spin sound missing", await page.evaluate(() => !!Sound.debug.manifest()) && !(await hasSpinSound(page)));
    refuse = () => false;
    await sleep(2100); // retries are spaced 2 s apart
    await tap(page);
    const back2 = await page.waitForFunction(() => Sound.debug.manifest().sounds.spin_start.some((f) => Sound.debug.loaded().includes(f)), { timeout: 15000 }).then(() => true, () => false);
    check("sounds refused at load: one tap later the spin sound loads", back2, JSON.stringify(await page.evaluate(() => Sound.debug.trace())));
    check("sounds refused at load: the next spin is voiced", await spinVoiced(page));
    await page.close();

    // 3. Nothing refused: no retries happen (a healthy page never refetches).
    page = await open(browser);
    await tap(page);
    await sleep(500);
    check("healthy load: no failed loads, no retries", await page.evaluate(() => !Sound.debug.trace().some((t) => /fail|retry/.test(t))), JSON.stringify(await page.evaluate(() => Sound.debug.trace())));
    await page.close();
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\naudio-retry-probe: ${failed ? "FAIL" : "PASS"}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
