#!/usr/bin/env node
// Glasshouse in Chrome, on the demo build (rounds answered in the page by its own engine):
//   1. Layout at every size of the brief (DESIGN §14): nothing outside the viewport, no page
//      scroll, the board clear of every shell control, no console or page errors.
//   2. The states the brief asks screenshots of, on real reel stops from the shipped strips
//      (tools/probes/fixtures/glasshouse-boards.json; the engine resolves them as usual, only
//      the stops are chosen): beam mid-path, a win, the feature intro, a big win, and a
//      sub-stake return in the UK market (no celebration, a neutral "Credit" line).
//   3. Idle zero: no animation frame for 3 s after boot and after a round.
// Screenshots go to games/glasshouse/qa/img/.
//   CHROME_PATH=… node tools/probes/glasshouse-client.mjs [--sizes 390x844,844x390]
// Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "games", "glasshouse", "qa", "img");
fs.mkdirSync(OUT, { recursive: true });
const BOARDS = JSON.parse(fs.readFileSync(path.join(ROOT, "tools", "probes", "fixtures", "glasshouse-boards.json"), "utf8"));
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

async function open([w, h], query = "") {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  // Sounds come in Stage 4: until then a missing audio/ file is expected and reported apart.
  const missing = [];
  page.on("response", (r) => { if (r.status() >= 400 && !/\/favicon\.ico$/.test(r.url())) (/\/glasshouse\/audio\//.test(r.url()) ? missing : errors).push(`${r.status()} ${r.url()}`); });
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  page.on("requestfailed", (r) => { if (!/\/glasshouse\/audio\//.test(r.url())) errors.push(`request failed: ${r.url()}`); });
  await page.setViewport({ width: w, height: h, isMobile: touchOf([w, h]), hasTouch: touchOf([w, h]) });
  await page.evaluateOnNewDocument(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  });
  await page.goto(`${base}/glasshouse/${query}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle && window.__ghBoard, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  page.on("close", () => missing.forEach((m) => missingSounds.add(m.replace(/^\d+ https?:\/\/[^/]+/, ""))));
  return { page, ctx, errors, missing };
}
const missingSounds = new Set();
/** The next paid spins land on these stops (the engine still resolves and pays them as usual). */
const force = (page, ...stops) => page.evaluate((list) => {
  window.__ghQueue = list.slice();
  const P = window.Glasshouse.SpinEngine.prototype;
  if (!P.__orig) { P.__orig = P.land; P.land = function (strips) { const s = window.__ghQueue && window.__ghQueue.shift(); if (!s) return P.__orig.call(this, strips); const rows = this.rules.layout.rows; const matrix = []; for (let r = 0; r < rows; r++) matrix.push(strips.map((st, c) => st[(s[c] + r) % st.length])); return { stops: s.slice(), matrix }; }; }
}, stops);
const press = (page) => page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); });
const settled = (page) => page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 30000 });
const idle = (page, ms = 3000) => page.evaluate(async (ms) => { const b = window.__raf; await new Promise((r) => setTimeout(r, ms)); return window.__raf - b; }, ms);
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

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
    const logo = rect(document.querySelector(".logo svg"));
    return { vw, vh, board, outside, overlap, scroll: document.documentElement.scrollWidth > vw + 0.5 || document.documentElement.scrollHeight > vh + 0.5,
      boardIn: board.x >= -0.5 && board.y >= -0.5 && board.r <= vw + 0.5 && board.b <= vh + 0.5, cell: board.w / 6, logoW: logo.w, logoIn: logo.x >= -0.5 && logo.r <= vw + 0.5,
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
  await force(page, BOARDS.beamWin.stops);
  await press(page);
  await page.waitForFunction(() => window.__ghBoard.beaming, { timeout: 20000 });
  await new Promise((r) => setTimeout(r, 330));
  await shot(page, `state-beam-${tag}`);
  check(`${tag}: the beam draws`, true);
  await page.waitForFunction(() => window.__ghBoard.highlighted && /Sunlit/.test(document.getElementById("psTickerText").textContent), { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await shot(page, `state-win-${tag}`);
  const winText = await page.$eval("#psTickerText", (n) => n.textContent);
  check(`${tag}: the win is named (${winText})`, /Sunlit/.test(winText));
  await settled(page);
  check(`${tag}: idle after a round draws nothing`, (await idle(page)) === 0);
  await force(page, BOARDS.bigWin.stops);
  await press(page);
  await page.waitForFunction(() => !document.getElementById("celebration").hidden, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 900));
  await shot(page, `state-bigwin-${tag}`);
  const title = await page.$eval("#celTitle", (n) => n.textContent);
  check(`${tag}: big win titled "Sunlit"`, title === "Sunlit", title);
  await page.click("#celebration");
  await settled(page);
  await force(page, BOARDS.trigger.stops);
  await press(page);
  await page.waitForFunction(() => { const p = document.querySelector(".lsh-panel"); return p && !p.classList.contains("hidden") && /free spins/.test(p.textContent); }, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));
  await shot(page, `state-feature-intro-${tag}`);
  const intro = await page.evaluate(() => document.querySelector(".lsh-panel").innerText.replace(/\s+/g, " ").trim());
  check(`${tag}: feature intro: one line of rules and the spin count`, /10 free spins/.test(intro) && /two more spins/.test(intro), intro.slice(0, 90));
  check(`${tag}: no console or page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 3. UK: a return at or below the stake is shown plainly ───────────────
{
  console.log("UKGC sub-stake @ 390x844");
  const { page, ctx, errors } = await open([390, 844], "?market=UKGC");
  await force(page, BOARDS.subStake.stops);
  await press(page);
  await page.waitForFunction(() => window.__ghBoard.highlighted && /Credit/.test(document.getElementById("psTickerText").textContent), { timeout: 20000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 200));
  await shot(page, "state-uk-substake-390x844");
  const t = await page.$eval("#psTickerText", (n) => n.textContent);
  check(`UKGC: the line is neutral (${t})`, /^Credit/.test(t));
  check("UKGC: no celebration overlay", await page.$eval("#celebration", (n) => n.hidden));
  const hidden = await page.evaluate(() => ["#autoplayBtn", "#turboBtn", "#buyFreeBtn"].map((s) => { const n = document.querySelector(s); return !n || n.offsetParent === null || n.classList.contains("is-off") || getComputedStyle(n).visibility === "hidden"; }));
  check("UKGC: autoplay, turbo and buy are off", hidden.every(Boolean), JSON.stringify(hidden));
  check("UKGC: no console or page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
}

await browser.close();
server.close();
if (missingSounds.size) console.log(`\nnote: ${missingSounds.size} Glasshouse sound file(s) not built yet (Stage 4): ${[...missingSounds].slice(0, 4).join(", ")}`);
console.log(failed ? `\n${failed} check(s) failed` : "\nall checks passed");
process.exit(failed ? 1 : 0);
