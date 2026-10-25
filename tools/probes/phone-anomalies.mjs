#!/usr/bin/env node
// Phone anomalies found by driving every game at a phone size (rapid taps, rotation,
// backgrounding, reloads, sheets during a round, autoplay, buys, the same inside a feature),
// one check per fix so none comes back. Runs on the demo build at 390×844 (touch).
//   1. No failed request: loading a game and playing a round asks for nothing that is not
//      there (the games without an icon link asked for /favicon.ico on every load).
//   2. Vault 20K's feature screen (free-spins intro / outro) continues on Spin, Space and
//      Enter, as the shared panel does in the other games: a phone player taps Spin there.
//   3. Vault 20K's free spins: the Spins readout and the message line give the same count
//      (the readout lagged one spin behind), and the line shows no base-game tips between
//      free spins ("Buy feature available" while the buy is off).
//
//   CHROME_PATH=… node tools/probes/phone-anomalies.mjs
//
// Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { untilIdle } from "./lib/until-idle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const GAMES = ["vault", "classic", "relicforge", "glasshouse", "clockwork"];
// Glasshouse has no sound set yet (its audio/ folder is not built): the sound engine's
// requests for it are known and not what this probe is about.
const KNOWN_MISSING = [/^\/glasshouse\/audio\//];

async function open(game) {
  const page = await browser.newPage();
  page.missing = [];
  page.on("response", (r) => {
    const u = r.url().replace(base, "");
    if (r.status() >= 400 && !KNOWN_MISSING.some((re) => re.test(u))) page.missing.push(`${r.status()} ${u}`);
  });
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`${base}/${game}/?intro=0`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle, { timeout: 30000 });
  await sleep(1000);
  return page;
}

// 1. No failed request in any game: load + one round.
for (const game of GAMES) {
  const page = await open(game);
  await page.tap("#spinBtn");
  await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 5000 }).catch(() => {});
  await untilIdle(page, 60000);
  await sleep(500);
  check(`${game}: load and a round ask for nothing missing`, page.missing.length === 0, page.missing.slice(0, 3).join(", "));
  await page.close();
}

// 2. Vault 20K's feature screen continues on Spin, Space and Enter.
const featureOpen = (page) => page.evaluate(() => VxNotify.isOpen("feature"));
const waitFeature = (page, ms) => page.waitForFunction(() => VxNotify.isOpen("feature"), { timeout: ms, polling: 100 }).then(() => true, () => false);
async function buy(page) {
  await page.tap("#buyFreeBtn");
  await page.waitForFunction(() => VxNotify.isOpen("buyConfirm"), { timeout: 5000 });
  await page.evaluate(() => document.getElementById("buyConfirmBtn").click());
}
{
  const page = await open("vault");
  await buy(page);
  check("vault: the bought feature opens its intro", await waitFeature(page, 60000));
  await page.tap("#spinBtn");
  await sleep(400);
  check("vault: Spin continues the intro", !(await featureOpen(page)));
  check("vault: ...and the free spins run", await page.evaluate(() => window.__spinLifecycle.inFlight));
  // Sample the free spins until the outro opens.
  const seen = { mismatch: [], tips: [], samples: 0 };
  for (const t0 = Date.now(); Date.now() - t0 < 170000 && !(await featureOpen(page));) {
    const r = await page.evaluate(() => ({ left: document.getElementById("footerBet").textContent.trim(), line: document.getElementById("psTicker").textContent.trim() }));
    const m = /^Free spins · Remaining: (\d+)$/.exec(r.line);
    if (m) { seen.samples++; if (m[1] !== r.left) seen.mismatch.push(`${r.left} vs "${r.line}"`); }
    else if (!/^(Win|Credit): |^Scatters |^\+\d|^Free spins complete$/.test(r.line) && !seen.tips.includes(r.line)) seen.tips.push(r.line);
    await sleep(60);
  }
  check("vault: the feature ends on its outro", await featureOpen(page));
  check("vault: the free spins were sampled", seen.samples > 10, String(seen.samples));
  check("vault: the Spins readout and the message line give the same count", seen.mismatch.length === 0, seen.mismatch.slice(0, 3).join(", "));
  check("vault: no base-game tips between free spins", seen.tips.length === 0, seen.tips.slice(0, 3).join(" / "));
  await page.keyboard.press("Enter");
  await sleep(400);
  check("vault: Enter continues the outro", !(await featureOpen(page)));
  await untilIdle(page, 60000);
  await buy(page);
  check("vault: a second bought feature opens its intro", await waitFeature(page, 60000));
  await page.keyboard.press("Space");
  await sleep(400);
  check("vault: Space continues the intro", !(await featureOpen(page)));
  check("vault: no autoplay started by that press", !(await page.evaluate(() => window.__spinLifecycle.autoplayActive)));
  await untilIdle(page, 170000);
  check("vault: no failed request through two features", page.missing.length === 0, page.missing.slice(0, 3).join(", "));
  await page.close();
}

await browser.close();
server.close();
console.log(`\nphone-anomalies: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
