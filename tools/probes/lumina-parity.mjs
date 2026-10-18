#!/usr/bin/env node
// One shell, three games (docs/lumina-overhaul, prompt A1 + A8), proven in Chrome on the demo
// build (games answered in the page by their own engines; no platform needed):
//   1. Shell parity: every shared control (place, size, focus order, name, state at rest) (Spin, bet −/+, autoplay, speed, menu, info, the
//      Balance / Bet / Win readouts, the message line) sits at the SAME place and size in
//      Vault 20K, Moth & Lantern and Relic Forge, at a portrait phone, a landscape phone
//      and a desktop size.
//   2. Idle zero: a resting game draws nothing. After boot and after a played round settles,
//      no requestAnimationFrame callback runs for 3 s and no CSS animation runs forever.
//
//   CHROME_PATH=… node tools/probes/lumina-parity.mjs
//
// Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
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

const GAMES = ["vault", "classic", "relicforge", "glasshouse"];
const CONTROLS = ["#spinBtn", "#betDownBtn", "#betUpBtn", "#autoplayBtn", "#turboBtn", "#psMenuBtn", "#psInfoBtn", "#footerBalance", "#betSheetBtn", "#footerWin", "#psTicker"];
const SIZES = [[390, 844, true], [844, 390, true], [1440, 900, false]];
const SIZES_FIRST = new Set(["390x844"]); // order, names and states do not depend on the size

async function open(game, [w, h, touch]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: touch, hasTouch: touch });
  // Count animation frames from the start: the probe reads the counter over a window.
  await page.evaluateOnNewDocument(() => {
    window.__raf = 0;
    const raf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = (cb) => raf((t) => { window.__raf++; cb(t); });
  });
  await page.goto(`${base}/${game}/`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 1500)); // boot reveal and first paint settle
  return page;
}

/** Frames drawn and forever-running CSS animations over `ms` of rest. */
const idle = (page, ms = 3000) => page.evaluate(async (ms) => {
  const before = window.__raf;
  await new Promise((r) => setTimeout(r, ms));
  const forever = document.getAnimations().filter((a) => a.playState === "running" && a.effect?.getComputedTiming?.().iterations === Infinity)
    .map((a) => a.effect?.target?.className || a.effect?.target?.id || "?");
  return { frames: window.__raf - before, forever };
}, ms);

const geometry = {};
for (const size of SIZES) {
  const key = `${size[0]}x${size[1]}`;
  for (const game of GAMES) {
    const page = await open(game, size);
    geometry[`${game}@${key}`] = await page.evaluate((sels) => {
      const frame = document.querySelector(".lsh");
      const kids = [...frame.children];
      return Object.fromEntries(sels.map((s) => {
        // A readout's value is text (its width follows the number): measure its readout box.
        const v = document.querySelector(s); const n = v?.closest("[data-area]") || v; if (!n) return [s, null];
        const r = n.getBoundingClientRect();
        const box = [r.x, r.y, r.width, r.height].map((x) => Math.round(x));
        // Same order (DOM = focus order), same accessible name, same state at rest. The speed
        // button's name carries the current speed; a game without speed has it hidden in place.
        const label = (n.getAttribute("aria-label") || n.querySelector("[data-k], .lsh-read__k")?.textContent || "").replace(/^Speed: .*/, "Speed").replace(/ · .*/, "");
        const off = n.classList.contains("is-off");
        return [s, { box, order: kids.indexOf(n), label, disabled: Boolean(n.disabled), off }];
      }));
    }, CONTROLS);
    if (size === SIZES[0]) {
      const boot = await idle(page);
      check(`${game}: idle after boot draws nothing (${boot.frames} frames in 3 s)`, boot.frames === 0 && boot.forever.length === 0, boot.forever.join(", "));
      await page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); });
      await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 10000 }).catch(() => {});
      await page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 240000 });
      await new Promise((r) => setTimeout(r, 1500));
      const after = await idle(page);
      check(`${game}: idle after a round draws nothing (${after.frames} frames in 3 s)`, after.frames === 0 && after.forever.length === 0, after.forever.join(", "));
    }
    await page.close();
  }
  const [ref, ...rest] = GAMES.map((g) => geometry[`${g}@${key}`]);
  const show = (sel, f) => GAMES.map((g) => `${g} ${JSON.stringify(f(geometry[`${g}@${key}`][sel]))}`).join(" · ");
  for (const sel of CONTROLS) {
    const pos = rest.every((g) => JSON.stringify(g[sel]?.box) === JSON.stringify(ref[sel]?.box));
    check(`${key}: ${sel} at the same place and size in every game`, Boolean(ref[sel]) && pos, show(sel, (x) => x?.box));
    if (!SIZES_FIRST.has(key)) continue;
    // Relic Forge ships without a speed control (its design): hidden in place, never moved.
    const present = GAMES.map((g) => geometry[`${g}@${key}`][sel]).filter((x) => x && !x.off);
    const same = present.every((x) => x.order === present[0].order && x.label === present[0].label && x.disabled === present[0].disabled);
    check(`${key}: ${sel} same order, name and state at rest`, same, show(sel, (x) => x && [x.order, x.label, x.disabled ? "disabled" : "enabled", x.off ? "off" : "on"]));
  }
}
await browser.close();
server.close();
console.log(`\nlumina-parity: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
