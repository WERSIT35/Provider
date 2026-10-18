#!/usr/bin/env node
// Every Lumina game at the 9 reference sizes (docs/lumina-overhaul, prompt A7 + D "viewport
// audit"), on the demo build, in Chrome:
//   - no shell control outside the viewport, no two controls overlapping, no page errors;
//   - hit areas ≥ 44 px for the main controls (Spin, bet −/+), ≥ 40 px for every other button;
//   - every label and value on the deck ≥ 12 px;
//   - text contrast ≥ 4.5:1 against what is really behind it (measured from the pixels, so
//     translucent decks over game art are judged as the player sees them);
//   - the board (the stage) keeps a usable size.
//
//   CHROME_PATH=… node tools/probes/lumina-audit.mjs [--games vault,classic,relicforge,glasshouse]
//
// Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const GAMES = argv.includes("--games") ? argv[argv.indexOf("--games") + 1].split(",") : ["vault", "classic", "relicforge", "glasshouse"];
const SIZES = [[320, 568], [360, 740], [375, 667], [390, 844], [430, 932], [844, 390], [740, 360], [768, 1024], [1440, 900]];
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
const browser = await puppeteer.launch({ executablePath: chromePath, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });

const MAIN = new Set(["spinBtn", "betDownBtn", "betUpBtn"]);
const measure = (main) => {
  const W = innerWidth, H = innerHeight, out = [], over = [], small = [], tiny = [], texts = [];
  const vis = (e) => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !e.closest("[hidden]") ? r : null; };
  const items = [...document.querySelectorAll(".lsh > button, .lsh > .lsh-read, .lsh > .lsh-ticker, .lsh > .lsh-rail > button")].map((e) => [e.id || e.className, e, vis(e)]).filter((x) => x[2]);
  for (const [n, e, r] of items) {
    if (r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5) out.push(n);
    const floor = main.includes(e.id) ? 44 : 40;
    if (e.matches("button") && (r.width < floor - 0.5 || r.height < floor - 0.5)) small.push(`${n} ${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i][2], b = items[j][2];
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) over.push(`${items[i][0]} / ${items[j][0]}`);
  }
  for (const t of document.querySelectorAll(".lsh-read__k, .lsh-read__v, .lsh-ticker__text, .lsh-chip__k, .lsh-chip__v, .lsh-strip__item")) {
    const r = vis(t); if (!r || !t.textContent.trim()) continue;
    const f = parseFloat(getComputedStyle(t).fontSize);
    if (f < 12) tiny.push(`${t.className} ${f}px`);
    const c = getComputedStyle(t).color.match(/[\d.]+/g).map(Number);
    texts.push({ name: t.className.split(" ")[0] + (t.id ? "#" + t.id : ""), rect: [r.left, r.top, r.width, r.height], color: c.slice(0, 3) });
  }
  const st = document.querySelector(".lsh-stage").getBoundingClientRect();
  return { out, over, small, tiny, texts, stage: [Math.round(st.width), Math.round(st.height)] };
};

// Contrast from the pixels: the text's own colour against the commonest colour in its box
// that is not the text (the background the player sees, deck and art included).
async function contrasts(page, texts) {
  const shot = await page.screenshot({ encoding: "base64" });
  return page.evaluate(async (b64, texts) => {
    const img = new Image(); img.src = "data:image/png;base64," + b64; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const dpr = img.width / innerWidth;
    const lum = ([r, gg, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(gg) + 0.0722 * f(b); };
    return texts.map((t) => {
      const [x, y, w, h] = t.rect.map((v) => Math.round(v * dpr));
      if (w < 2 || h < 2) return { name: t.name, ratio: 21 };
      const d = g.getImageData(x, y, w, h).data;
      const L = lum(t.color), buckets = new Map();
      for (let i = 0; i < d.length; i += 4) {
        const px = [d[i], d[i + 1], d[i + 2]];
        if (Math.abs(lum(px) - L) < 0.08) continue; // the glyphs themselves (and antialiasing near them)
        const k = px.map((v) => v >> 4).join(",");
        buckets.set(k, (buckets.get(k) || 0) + 1);
      }
      let best = null, n = 0;
      for (const [k, v] of buckets) if (v > n) { n = v; best = k; }
      if (!best) return { name: t.name, ratio: 21 };
      const bg = best.split(",").map((v) => Number(v) * 16 + 8);
      const a = lum(t.color), b = lum(bg);
      return { name: t.name, ratio: +((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2) };
    });
  }, shot, texts);
}

for (const game of GAMES) {
  for (const [w, h] of SIZES) {
    const page = await browser.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    const mobile = w < 1000;
    await page.setViewport({ width: w, height: h, isMobile: mobile, hasTouch: mobile });
    await page.goto(`${base}/${game}/`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.body.classList.contains("app-ready") && document.querySelector(".lsh"), { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 900));
    const m = await page.evaluate(measure, [...MAIN]);
    const cs = await contrasts(page, m.texts);
    const low = cs.filter((c) => c.ratio < 4.5).map((c) => `${c.name} ${c.ratio}:1`);
    const bad = [...m.out.map((x) => `outside: ${x}`), ...m.over.map((x) => `overlap: ${x}`), ...m.small.map((x) => `small: ${x}`), ...m.tiny.map((x) => `text: ${x}`), ...low.map((x) => `contrast: ${x}`), ...errs.map((x) => `error: ${x}`)];
    if (m.stage[0] < 200 || m.stage[1] < 150) bad.push(`stage only ${m.stage.join("x")}`);
    check(`${game} @ ${w}x${h}: in view, no overlap, hit areas, labels ≥ 12 px, contrast ≥ 4.5:1`, bad.length === 0, bad.slice(0, 6).join("; "));
    await page.close();
  }
}
await browser.close();
server.close();
console.log(`\nlumina-audit: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
