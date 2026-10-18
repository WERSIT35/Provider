#!/usr/bin/env node
// Silhouette check (docs/lumina-overhaul, prompt A7): every symbol of every game, rendered at
// 48 px in grayscale, side by side, so a reviewer can see whether symbols separate by shape
// alone (colour-blind players, small phones, glare). Each game exposes its own symbols to
// probes as window.__luminaSymbols = { ids: [...], render(id, px) → canvas | svg string }.
//
//   CHROME_PATH=… node tools/probes/symbol-sheet.mjs [--write]
//
// Writes the contact sheet (with --write: docs/lumina-overhaul/img/symbols-48-grayscale.png) and
// checks that every game listed its symbols and each rendered something. The review itself
// is a person looking at the sheet.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// --write updates the committed sheet; a plain run (CI) writes to the temp folder.
const WRITE = process.argv.includes("--write");
const OUT = WRITE ? path.join(ROOT, "docs/lumina-overhaul/img/symbols-48-grayscale.png") : path.join((await import("node:os")).tmpdir(), "symbols-48-grayscale.png");
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
const browser = await puppeteer.launch({ executablePath: chromePath, args: ["--no-sandbox"] });

const PX = 48;
const rows = [];
for (const [game, title] of [["vault", "Vault 20K"], ["classic", "Moth & Lantern"], ["relicforge", "Relic Forge"]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 600 });
  await page.goto(`${base}/${game}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__luminaSymbols, { timeout: 30000 });
  const tiles = await page.evaluate(async (px) => {
    const S = window.__luminaSymbols;
    const out = [];
    for (const id of S.ids) {
      let src = await S.render(id, px);
      const c = document.createElement("canvas"); c.width = c.height = px;
      const g = c.getContext("2d");
      if (typeof src === "string") { // an SVG string
        const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(src.replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
        await img.decode().catch(() => {}); src = img;
      }
      g.filter = "grayscale(1)";
      g.drawImage(src, 0, 0, px, px);
      const d = g.getImageData(0, 0, px, px).data; let ink = 0;
      for (let i = 3; i < d.length; i += 4) if (d[i] > 16) ink++;
      out.push({ id, url: c.toDataURL("image/png"), ink });
    }
    return out;
  }, PX);
  await page.close();
  check(`${title}: ${tiles.length} symbols listed`, tiles.length >= 8);
  const blank = tiles.filter((t) => t.ink < PX * PX * 0.05).map((t) => t.id);
  check(`${title}: every symbol renders a shape at ${PX} px`, blank.length === 0, blank.join(", "));
  rows.push({ title, tiles });
}

// Compose the sheet in a page (no image library needed).
const page = await browser.newPage();
const png = await page.evaluate(async (rows, px) => {
  const pad = 10, label = 150, cols = Math.max(...rows.map((r) => r.tiles.length));
  const c = document.createElement("canvas"); c.width = label + cols * (px + pad) + pad; c.height = rows.length * (px + 28) + pad;
  const g = c.getContext("2d"); g.fillStyle = "#808080"; g.fillRect(0, 0, c.width, c.height);
  g.font = "600 13px sans-serif"; g.fillStyle = "#000";
  for (const [ri, r] of rows.entries()) {
    const y = pad + ri * (px + 28);
    g.fillText(r.title, pad, y + px / 2 + 4);
    for (const [ti, t] of r.tiles.entries()) {
      const img = new Image(); img.src = t.url; await img.decode();
      g.drawImage(img, label + ti * (px + pad), y);
      g.font = "10px sans-serif"; g.fillText(t.id.slice(0, 9), label + ti * (px + pad), y + px + 12); g.font = "600 13px sans-serif";
    }
  }
  return c.toDataURL("image/png").split(",")[1];
}, rows, PX);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, Buffer.from(png, "base64"));
console.log(`  sheet: ${path.relative(ROOT, OUT)}`);
await browser.close();
server.close();
console.log(`\nsymbol-sheet: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
