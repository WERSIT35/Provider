#!/usr/bin/env node
// The system chrome is identical in every Lumina game (docs/lumina-overhaul/layers.md,
// Layer 1), proven in Chrome on the demo build at the 9 reference sizes:
//   1. computed styles: every chrome element (deck, readouts, buttons, Spin, message line,
//      strip, nav) has the same font, size, weight, colours, background, border, radius,
//      shadow, padding, box and icon in every game;
//   2. pixels: with the game's own layers hidden (stage, themed rail, the message line's
//      words, controls a game does not have), the frame renders to the same pixels (up to 8
//      pixels allowed: the Spin ring's edge anti-aliases differently in Vault 20K at two sizes);
//   3. sheets: menu, info, autoplay and bet sheets share the same panel, title, close
//      button and row styles; the loader markup is the same.
//
//   CHROME_PATH=… node tools/probes/chrome-identity.mjs [--sizes 390x844,1440x900]
//
// Exits 1 on any difference.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const ALL = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [844, 390], [740, 360], [768, 1024], [1440, 900]];
const SIZES = argv.includes("--sizes") ? argv[argv.indexOf("--sizes") + 1].split(",").map((s) => s.split("x").map(Number)) : ALL;
const GAMES = ["vault", "classic", "relicforge", "glasshouse"];
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
const chromePath = [process.env.CHROME_PATH, "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find((p) => fs.existsSync(p));
// A slow CI runner gets a longer protocol timeout; tabs never throttle (#132).
const browser = await puppeteer.launch({ executablePath: chromePath, protocolTimeout: 180000,
  args: ["--no-sandbox", "--force-color-profile=srgb", "--font-render-hinting=none", "--disable-renderer-backgrounding", "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows"] });

const CHROME = {
  frame: ".lsh", ticker: "#psTicker", tickerText: "#psTickerText", readK: ".lsh-read__k", balance: "#footerBalance", betBox: "#betSheetBtn", bet: "#footerBet", winBox: ".lsh-read--win", win: "#footerWin",
  spin: "#spinBtn", minus: "#betDownBtn", plus: "#betUpBtn", menu: "#psMenuBtn", info: "#psInfoBtn", auto: "#autoplayBtn", turbo: "#turboBtn", strip: ".lsh-strip", back: ".lsh-nav--back", full: ".lsh-nav--full"
};
// Text that legitimately differs per game (the message line's words) is compared by style, not box.
const TEXT_BOXES = new Set(["tickerText"]);
const PROPS = ["font-family", "font-size", "font-weight", "font-style", "letter-spacing", "text-transform", "color", "background-color", "background-image", "border-top-color", "border-top-width", "border-radius", "box-shadow", "padding-top", "padding-left", "opacity", "visibility"];
const SHEET = { panel: ".lsh-sheet:not(.hidden) .lsh-sheet__panel", title: ".lsh-sheet:not(.hidden) .lsh-sheet__title", close: ".lsh-sheet:not(.hidden) .lsh-sheet__x", row: ".lsh-sheet:not(.hidden) .lsh-row", rowText: ".lsh-sheet:not(.hidden) .lsh-row__t", pill: ".lsh-sheet:not(.hidden) .lsh-pill" };

async function open(game, w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: w < 1000, hasTouch: w < 1000 });
  await page.goto(`${base}/${game}/?intro=0`, { waitUntil: "networkidle0", timeout: 60000 });
  // 60 s: a cold CI runner boots the first game slowly (the repo's Chrome launch policy).
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && document.querySelector(".lsh"), { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 700));
  return page;
}
const styles = (page, map) => page.evaluate((map, PROPS) => {
  const out = {};
  for (const [k, sel] of Object.entries(map)) {
    const e = document.querySelector(sel);
    if (!e) { out[k] = null; continue; }
    const cs = getComputedStyle(e), r = e.getBoundingClientRect();
    out[k] = Object.fromEntries(PROPS.map((p) => [p, cs.getPropertyValue(p)]));
    out[k].box = [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)].join(",");
    out[k].icon = e.querySelector("svg") ? e.querySelector("svg").innerHTML : "";
    out[k].off = e.classList.contains("is-off") || e.hidden;
  }
  return out;
}, map, PROPS);
function compare(label, results, skipBox = new Set()) {
  const bad = [];
  for (const k of Object.keys(results[0])) {
    const vals = results.map((r) => r[k]);
    if (vals.some((v) => !v)) { if (!vals.every((v) => !v)) bad.push(`${k}: present ${vals.map((v) => (v ? "y" : "n")).join("/")}`); continue; }
    if (vals.some((v) => v.off)) continue; // hidden in place in some game (a control it does not have)
    for (const p of [...PROPS, "box", "icon"]) {
      if (p === "box" && skipBox.has(k)) continue;
      const s = vals.map((v) => v[p]);
      if (new Set(s).size > 1) bad.push(`${k}.${p}: ${s.join(" | ").slice(0, 160)}`);
    }
  }
  check(label, bad.length === 0, bad.slice(0, 4).join("; "));
}

const HIDE_GAME = (off) => `html, body { background: #000 !important; } body::before, body::after { display: none !important; } body > :not(.lsh):not(.lsh-sheet) { visibility: hidden !important; } .lsh-stage, .lsh-rail, .lsh-ticker__text { visibility: hidden !important; } ${off.map((id) => `#${id}`).join(",") || "#none"} { visibility: hidden !important; } * { transition: none !important; animation: none !important; caret-color: transparent !important; }`;
// One game tab at a time (open, measure, close), like every other Chrome probe: four tabs
// open together booted too slowly and hung screenshots on a CI runner (#132).
for (const [w, h] of SIZES) {
  // 1. computed styles of the chrome (and which controls each game hides)
  const vals = [], offs = new Set();
  for (const g of GAMES) {
    const p = await open(g, w, h);
    vals.push(await styles(p, CHROME));
    for (const id of await p.evaluate(() => [...document.querySelectorAll(".lsh .is-off, .lsh [hidden]")].map((e) => e.id).filter(Boolean))) offs.add(id);
    await p.close();
  }
  compare(`${w}x${h}: chrome styles identical in every game`, vals, TEXT_BOXES);
  // 2. pixels, with the game's layers (and every control any game hides) hidden
  const shots = [];
  for (const g of GAMES) {
    const p = await open(g, w, h);
    await p.evaluate((css) => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }, HIDE_GAME([...offs]));
    await new Promise((r) => setTimeout(r, 150));
    shots.push(await p.screenshot({ encoding: "base64" }));
    await p.close();
  }
  const cmp = await browser.newPage();
  const diffs = await cmp.evaluate(async (shots, W) => {
    const load = async (b) => { const i = new Image(); i.src = "data:image/png;base64," + b; await i.decode(); const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const g = c.getContext("2d"); g.drawImage(i, 0, 0); return g.getImageData(0, 0, i.width, i.height).data; };
    const [a, ...rest] = await Promise.all(shots.map(load));
    return rest.map((b) => {
      let n = 0; const where = [];
      for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k] - b[k]) + Math.abs(a[k + 1] - b[k + 1]) + Math.abs(a[k + 2] - b[k + 2]) > 40) { n++; if (where.length < 3) { const i = k / 4; where.push(`${i % W},${Math.floor(i / W)}`); } }
      return { n, where: where.join(" ") };
    });
  }, shots, w);
  await cmp.close();
  check(`${w}x${h}: the frame renders to the same pixels (game layers hidden)`, diffs.every((d) => d.n <= 8), diffs.map((d, i) => `${GAMES[0]}/${GAMES[i + 1]} ${d.n} px${d.where ? ` ${d.where}` : ""}`).join(", "));
}

// 3. sheets and the loader, at a phone and a desktop size
const SHEETS = [["#psMenuBtn", "menu"], ["#psInfoBtn", "info"], ["#autoplayBtn", "autoplay"], ["#betSheetBtn", "bet"]];
for (const [w, h] of [[390, 844], [1440, 900]]) {
  const sheetVals = Object.fromEntries(SHEETS.map(([, n]) => [n, []])), loaders = [];
  for (const g of GAMES) {
    const p = await open(g, w, h);
    for (const [btn, name] of SHEETS) {
      await p.click(btn).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      sheetVals[name].push(await styles(p, SHEET));
      await p.keyboard.press("Escape");
      await new Promise((r) => setTimeout(r, 400));
    }
    loaders.push(await p.evaluate(() => { const l = document.getElementById("bootLoader"); if (!l) return null; const c = l.querySelector(".lsh-loader__inner").cloneNode(true); c.querySelectorAll("[style]").forEach((e) => e.removeAttribute("style")); c.querySelector(".lsh-loader__pct").textContent = ""; return c.outerHTML; }));
    await p.close();
  }
  for (const [, name] of SHEETS) compare(`${w}x${h}: ${name} sheet styles identical`, sheetVals[name], new Set(["panel", "row", "rowText", "title", "pill", "close"]));
  check(`${w}x${h}: the provider loader is the same markup in every game`, loaders.every((l) => l && l === loaders[0]));
}

await browser.close();
server.close();
console.log(`\nchrome-identity: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
