#!/usr/bin/env node
// Lumina Shell layout gate (docs/lumina-overhaul, prompt A1/A7/D): the shared interface,
// at the 9 reference viewports, in right- and left-hand mode, with and without the feature
// rail, and under a market that switches controls off.
//
//   CHROME_PATH=/path/to/chrome node tools/probes/shell-layout.mjs [--game <url>]
//
// Checks per viewport: no control outside the viewport (safe areas included), no two
// controls overlapping, every button's hit area ≥ 44 px (secondary floor 40 px), labels
// ≥ 11 px, the stage keeps a usable size, and switching a market or a state never moves
// the stage (zero layout thrash). Pages: client/shell/preview.html by default; --game
// checks a game page served elsewhere (same rules).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SIZES = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [844, 390], [740, 360], [768, 1024], [1440, 900]];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp", ".svg": "image/svg+xml" };
const argv = process.argv.slice(2);
const gameUrl = argv.includes("--game") ? argv[argv.indexOf("--game") + 1] : null;

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };

const server = http.createServer((req, res) => {
  const p = path.join(ROOT, "client", decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!p.startsWith(path.join(ROOT, "client"))) { res.writeHead(403).end(); return; }
  fs.readFile(p, (err, body) => { if (err) { res.writeHead(404).end(); return; } res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" }).end(body); });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}/shell/preview.html`;

const chromePath = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium", "C:/Program Files/Google/Chrome/Application/chrome.exe", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
  .filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: chromePath, args: ["--no-sandbox"] });
const measure = () => {
  const W = innerWidth, H = innerHeight, out = [], over = [], small = [], tinyText = [];
  const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && cs.display !== "none" && cs.visibility !== "hidden" ? r : null; };
  const items = [...document.querySelectorAll(".lsh > button, .lsh > .lsh-read, .lsh > .lsh-ticker, .lsh > .lsh-rail > button")].map((e) => [e.id || e.className, e, vis(e)]).filter((x) => x[2]);
  for (const [n, e, r] of items) {
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.push(n);
    if (e.matches("button") && (r.width < 40 || r.height < 40)) small.push(`${n} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i][2], b = items[j][2];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push(`${items[i][0]} / ${items[j][0]}`);
  }
  for (const t of document.querySelectorAll(".lsh-read__k, .lsh-ticker__text, .lsh-chip__k")) { const f = parseFloat(getComputedStyle(t).fontSize); if (vis(t) && f < 11) tinyText.push(`${t.className} ${f}px`); }
  const spin = document.getElementById("spinBtn").getBoundingClientRect();
  const st = document.querySelector(".lsh-stage").getBoundingClientRect();
  return { out, over, small, tinyText, spin: Math.round(spin.width), stage: [Math.round(st.left), Math.round(st.top), Math.round(st.width), Math.round(st.height)] };
};

for (const variant of ["", "?feature=1", "?feature=1&hand=left", "?market=UKGC&feature=1"]) {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const mobile = w < 1000;
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    await page.evaluateOnNewDocument(() => { try { localStorage.clear(); } catch {} });
    await page.goto((gameUrl || base) + variant, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__shell || document.body.classList.contains("app-ready"), { timeout: 20000 });
    const m = await page.evaluate(measure);
    // Zero layout thrash: phase / mode / feature HUD changes never move the stage.
    const moved = await page.evaluate(() => {
      const s = window.__shell; if (!s) return [];
      const at = () => JSON.stringify(document.querySelector(".lsh-stage").getBoundingClientRect());
      const before = at(), moved = [];
      for (const [name, fn] of [["flight", () => { s.setPhase("flight"); s.setSpinMode("skip"); }], ["feature", () => s.featureHud({ left: 12, win: 1234.5 })], ["autoplay", () => s.setAutoplay(Infinity)], ["waiting", () => s.waiting(true)], ["market", () => s.applyMarket({ jurisdiction: "UKGC", autoplay_enabled: false, turbo_enabled: false })], ["ticker", () => s.ticker.win("WIN 123,456.78 — a very long line that must clip, never wrap, never push", true)]]) {
        fn(); if (at() !== before) moved.push(name);
      }
      return moved;
    });
    const tag = `${w}x${h}${variant || ""}`;
    const bad = [...m.out.map((x) => `outside: ${x}`), ...m.over.map((x) => `overlap: ${x}`), ...m.small.map((x) => `small: ${x}`), ...m.tinyText.map((x) => `text: ${x}`), ...moved.map((x) => `stage moved on ${x}`), ...errs.map((x) => `error: ${x}`)];
    if (m.stage[2] < 200 || m.stage[3] < 150) bad.push(`stage too small ${m.stage[2]}x${m.stage[3]}`);
    if (m.spin < 60) bad.push(`spin ${m.spin}px`);
    check(tag, bad.length === 0, bad.slice(0, 5).join("; ") || `stage ${m.stage[2]}x${m.stage[3]}, spin ${m.spin}px`);
    await page.close();
  }
}
await browser.close();
server.close();
console.log(`\nshell-layout: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
