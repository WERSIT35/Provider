#!/usr/bin/env node
// Clockwork Menagerie in Chrome, on the demo build (rounds answered in the page by its own engine):
//   1. Layout at every size: nothing outside the viewport, no page scroll, the board clear of
//      every shell control, the logo inside, no console or page errors.
//   2. The states, on real reel stops from the shipped strips (the boards below; the engine
//      resolves and pays them as usual, only the stops are chosen): a key winding its reel and
//      the two respins, a named win, a big win, the feature intro, a wound reel's multiplier
//      climbing in free spins, and a sub-stake return in the UK market (no celebration).
//   3. Idle zero: no animation frame for 3 s after boot and after a round.
//   4. Frame time while the reels move, CPU slowed 4x.
// Screenshots go to games/clockwork/qa/img/.
//   CHROME_PATH=… node tools/probes/clockwork-client.mjs [--sizes 390x844,844x390]
// Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "games", "clockwork", "qa", "img");
fs.mkdirSync(OUT, { recursive: true });
// Stops per board (s96). A wound reel's stop is ignored (the engine holds it).
const BOARDS = {
  respin: [[185, 131, 123, 166, 209], [139, 97, 151, 208, 163], [219, 114, 146, 76, 149]], // key on reel 3, 2 respins, 5.65
  bigWin: [[20, 4, 4, 4, 4]],          // owls across the top, 33.05 at bet 1
  trigger: [[0, 5, 10, 40, 40]],       // 3 music boxes: 8 free spins
  free: [[19, 19, 50, 30, 30], [19, 19, 0, 8, 40]], // free spins: a key on reel 3 at x1, then x2
  subStake: [[209, 1, 201, 31, 51]]    // 0.20 at bet 1
};
const TIERS = ["Wound Up", "Full Tilt", "Grand Menagerie", "Masterwork"];
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };

execFileSync(process.execPath, [path.join(ROOT, "tools/build-demo.mjs")], { stdio: "ignore" });
const DIST = path.join(ROOT, "dist-demo");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((req, res) => {
  let p = path.join(DIST, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(DIST)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, "index.html");
  fs.readFile(p, (err, body) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(body); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const chromePath = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chromePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });

const argv = process.argv.slice(2);
const ALL = [[320, 568], [360, 640], [375, 667], [390, 844], [430, 932], [844, 390], [667, 375], [768, 1024], [1024, 768], [1440, 900], [1920, 1080]];
const SIZES = argv.includes("--sizes") ? argv[argv.indexOf("--sizes") + 1].split(",").map((s) => s.split("x").map(Number)) : ALL;
const touchOf = ([w, h]) => Math.min(w, h) < 600;
const CONTROLS = ["#spinBtn", "#betDownBtn", "#betUpBtn", "#autoplayBtn", "#psMenuBtn", "#psInfoBtn", "#footerBalance", "#betSheetBtn", "#footerWin", "#psTicker", "#buyFreeBtn"];
const SOUNDS = /\/clockwork\/audio\//; // no sound set yet: a missing audio/ file is expected

async function open([w, h], query = "") {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("response", (r) => { if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url()) && !SOUNDS.test(r.url())) errors.push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (!SOUNDS.test(r.url())) errors.push(`request failed: ${r.url()}`); });
  await page.setViewport({ width: w, height: h, isMobile: touchOf([w, h]), hasTouch: touchOf([w, h]) });
  await page.evaluateOnNewDocument(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  });
  await page.goto(`${base}/clockwork/${query}${query ? "&" : "?"}intro=0`, { waitUntil: "networkidle0" }); // the intro splash has its own probe (chrome-identity)
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle && window.__cwBoard, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  return { page, ctx, errors };
}
/** The next boards land on these stops (the engine still resolves and pays them as usual; a held reel stays held). */
const force = (page, boards) => page.evaluate((list) => {
  window.__cwQueue = list.map((s) => s.slice());
  const P = window.Clockwork.SpinEngine.prototype;
  if (!P.__orig) {
    P.__orig = P.land;
    P.land = function (strips, held) {
      const s = window.__cwQueue && window.__cwQueue.shift();
      if (!s) return P.__orig.call(this, strips, held);
      const stops = s.map((x, c) => (held && held[c] ? null : x)), rows = this.rules.layout.rows, matrix = [];
      for (let r = 0; r < rows; r++) matrix.push(strips.map((st, c) => (stops[c] === null ? this.rules.wild.symbol : st[(stops[c] + r) % st.length])));
      return { stops, matrix };
    };
  }
}, boards);
const press = (page) => page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); });
const settled = (page) => page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 60000 });
const idle = (page, ms = 3000) => page.evaluate(async (ms) => { const b = window.__raf; await new Promise((r) => setTimeout(r, ms)); return window.__raf - b; }, ms);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });
const ticker = (page) => page.$eval("#psTickerText", (n) => n.textContent);
/** Tap through the shared big win until the round settles. */
async function finish(page) {
  for (let i = 0; i < 80 && await page.evaluate(() => window.__spinLifecycle.inFlight); i++) {
    if (await page.$("#bigWinOverlay.is-open")) await page.click("#bigWinOverlay").catch(() => {});
    await new Promise((r) => setTimeout(r, 500));
  }
  await settled(page);
}

// ── 1. layout at every size ──────────────────────────────────────────────
console.log("layout");
for (const size of SIZES) {
  const name = `${size[0]}x${size[1]}`;
  const { page, ctx, errors } = await open(size);
  const g = await page.evaluate((sels) => {
    const vw = innerWidth, vh = innerHeight;
    const rect = (n) => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; };
    const board = rect(document.getElementById("board"));
    const ctl = sels.map((s) => { const n = document.querySelector(s); if (!n || n.closest("[hidden]") || getComputedStyle(n).visibility === "hidden" || n.offsetParent === null) return null; return [s, rect(n.closest("[data-area]") || n)]; }).filter(Boolean);
    const outside = ctl.filter(([, r]) => r.x < -0.5 || r.y < -0.5 || r.r > vw + 0.5 || r.b > vh + 0.5).map(([s]) => s);
    const overlap = ctl.filter(([, r]) => r.x < board.r - 1 && r.r > board.x + 1 && r.y < board.b - 1 && r.b > board.y + 1).map(([s]) => s);
    const logo = rect(document.querySelector(".logo img"));
    return { board, outside, overlap, scroll: document.documentElement.scrollWidth > vw + 0.5 || document.documentElement.scrollHeight > vh + 0.5,
      boardIn: board.x >= -0.5 && board.y >= -0.5 && board.r <= vw + 0.5 && board.b <= vh + 0.5, cell: board.w / 5, logoW: logo.w, logoIn: logo.x >= -0.5 && logo.r <= vw + 0.5 && logo.y >= -0.5,
      tap: ctl.filter(([s]) => /Btn$/.test(s)).map(([s, r]) => [s, Math.round(Math.min(r.w, r.h))]) };
  }, CONTROLS);
  check(`${name}: board inside the viewport, cell ${g.cell.toFixed(0)} px`, g.boardIn && g.cell >= 40, JSON.stringify(g.board));
  check(`${name}: no control outside the viewport`, g.outside.length === 0, g.outside.join(", "));
  check(`${name}: no control over the board`, g.overlap.length === 0, g.overlap.join(", "));
  check(`${name}: no page scroll`, !g.scroll);
  check(`${name}: logo visible and inside`, g.logoIn && g.logoW > 100, `logo ${g.logoW.toFixed(0)} px`);
  const small = g.tap.filter(([, v]) => v < 40);
  check(`${name}: tap targets ≥ 40 px`, small.length === 0, small.map((t) => t.join(" ")).join(", "));
  await shot(page, name);
  check(`${name}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 2. states (portrait phone and desktop) ──────────────────────────────
for (const size of [[390, 844], [1440, 900]]) {
  const tag = `${size[0]}x${size[1]}`;
  console.log(`states @ ${tag}`);
  const { page, ctx, errors } = await open(size);
  check(`${tag}: idle after boot draws nothing`, (await idle(page)) === 0);
  await force(page, BOARDS.respin);
  await press(page);
  await page.waitForFunction(() => window.__cwBoard.wound.length === 1, { timeout: 20000 });
  const first = await page.evaluate(() => window.__cwBoard.wound);
  check(`${tag}: the key winds reel 3 for 2 respins`, JSON.stringify(first) === '[[2,2,"turns"]]', JSON.stringify(first));
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, `state-wound-${tag}`);
  await page.waitForFunction(() => /Respin 2 of 2/.test(document.getElementById("psTickerText").textContent), { timeout: 30000 });
  await page.waitForFunction(() => /Wound up/.test(document.getElementById("psTickerText").textContent), { timeout: 30000 });
  await shot(page, `state-win-${tag}`);
  check(`${tag}: the win is named and the meter shows the round total (${await ticker(page)})`, /Wound up: 5\.65/.test(await ticker(page)));
  await settled(page);
  check(`${tag}: the reel unwinds after the round`, (await page.evaluate(() => window.__cwBoard.wound.length)) === 0);
  check(`${tag}: idle after a round draws nothing`, (await idle(page)) === 0);
  await force(page, BOARDS.bigWin);
  await press(page);
  await page.waitForFunction(() => document.querySelector("#bigWinOverlay.is-open"), { timeout: 30000 }); // the shared Lumina big win
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, `state-bigwin-${tag}`);
  const title = await page.$eval("#bigWinOverlay [data-bw-label]", (n) => n.textContent.trim());
  check(`${tag}: big win titled in the workshop's words`, TIERS.includes(title), title);
  await finish(page);
  await force(page, [...BOARDS.trigger, ...BOARDS.free]);
  await press(page);
  await page.waitForFunction(() => { const p = document.querySelector(".lsh-panel"); return p && !p.classList.contains("hidden") && /free spins/.test(p.textContent); }, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, `state-feature-intro-${tag}`);
  const intro = await page.evaluate(() => document.querySelector(".lsh-panel").innerText.replace(/\s+/g, " ").trim());
  check(`${tag}: feature intro: one line of rules and the spin count`, /8 free spins/.test(intro) && /up to ×5/.test(intro), intro.slice(0, 90));
  if (size[0] === 390) {
    await press(page); // start the feature
    await page.waitForFunction(() => document.body.classList.contains("night") && window.__cwBoard.wound.some((w) => w[1] === 2), { timeout: 60000 });
    await new Promise((r) => setTimeout(r, 400));
    await shot(page, "state-free-x2-390x844");
    check("free spins: the wound reel stays and climbs to ×2", JSON.stringify(await page.evaluate(() => window.__cwBoard.wound)) === '[[2,2,"mult"]]');
  }
  check(`${tag}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 3. UK: a return at or below the stake is shown plainly ───────────────
{
  console.log("UKGC sub-stake @ 390x844");
  const { page, ctx, errors } = await open([390, 844], "?market=UKGC");
  await force(page, BOARDS.subStake);
  await press(page);
  await page.waitForFunction(() => window.__cwBoard.highlighted && /Credit/.test(document.getElementById("psTickerText").textContent), { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await shot(page, "state-uk-substake-390x844");
  const t = await ticker(page);
  check(`UKGC: the line is neutral (${t})`, /^Credit/.test(t));
  check("UKGC: no celebration overlay", await page.evaluate(() => !document.querySelector("#bigWinOverlay.is-open")));
  const hidden = await page.evaluate(() => ["#autoplayBtn", "#turboBtn", "#buyFreeBtn"].map((s) => { const n = document.querySelector(s); return !n || n.offsetParent === null || n.classList.contains("is-off") || getComputedStyle(n).visibility === "hidden"; }));
  check("UKGC: autoplay, turbo and buy are off", hidden.every(Boolean), JSON.stringify(hidden));
  check("UKGC: no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 4. frame time while the reels move (mid-range phone: CPU slowed 4x) ──
{
  console.log("frames while the reels move @ 390x844, CPU 4x slower");
  const { page, ctx, errors } = await open([390, 844]);
  const cdp = await page.createCDPSession();
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  const intervals = [];
  for (const boards of [BOARDS.respin, BOARDS.bigWin]) {
    await force(page, boards);
    // Frame-to-frame intervals while the reels move (both ends of an interval inside motion).
    const sample = page.evaluate(() => new Promise((resolve) => {
      const out = []; let last = 0, was = false;
      const tick = (t) => { const now = window.__cwBoard.moving; if (now && was && last) out.push(t - last); last = t; was = now; if (window.__spinLifecycle.inFlight || out.length === 0) requestAnimationFrame(tick); else resolve(out); };
      requestAnimationFrame(tick);
    }));
    await press(page);
    await finish(page);
    intervals.push(...await sample);
  }
  intervals.sort((a, b) => a - b);
  const p95 = intervals[Math.floor(intervals.length * 0.95)] || 0;
  // A 60 Hz display shows a frame every 16.67 ms; Chrome's timestamps carry ~0.1 ms of jitter.
  check(`reels: p95 frame interval ${p95.toFixed(1)} ms over ${intervals.length} frames (≤ 16.7 ms + 0.2 ms timer jitter)`, intervals.length > 20 && p95 <= 16.9);
  check("reels: no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
