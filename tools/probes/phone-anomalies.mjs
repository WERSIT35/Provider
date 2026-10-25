#!/usr/bin/env node
// Phone anomalies found by driving every game at a phone size (rapid taps, rotation,
// backgrounding, reloads, sheets during a round, autoplay, buys, the same inside a feature),
// one check per fix so none comes back. Runs on the demo build at 390×844 (touch).
//   1. No failed request: loading a game and playing a round asks for nothing that is not
//      there (the games without an icon link asked for /favicon.ico on every load).
//   2. Vault 20K's feature screen (free-spins intro / outro) continues on Spin, Space and
//      Enter, as the shared panel does in the other games: a phone player taps Spin there.
//      Enter on another focused control keeps its own meaning.
//   3. Vault 20K's free spins: the Spins readout and the message line give the same count
//      (the readout lagged one spin behind), and the line shows no base-game tips between
//      free spins ("Buy feature available" while the buy is off).
//   4. A round the server never answers (the connection lost after the 3 s "Waiting for the
//      server…" line): every game says "No connection: round not played" (Vault 20K said
//      nothing), the waiting line never outlives the answer (it stuck for a minute), and the
//      next round plays.
//      The line names what to do when a retry cannot help (no credit, session ended, bet
//      refused) and reads a lost connection in every browser's words (Safari: "Load failed").
//   5. Long numbers fit their readouts on a 320 px phone and a landscape phone (a balance in
//      the millions was cut; a bet of 100.00 was cut at 320 px, 1,000.00 at 390 px).
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
  page.on("requestfailed", (r) => {
    const u = r.url().replace(base, "");
    if (!u.startsWith("data:") && !KNOWN_MISSING.some((re) => re.test(u))) page.missing.push(`failed ${u}`);
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
  // (The buy holds the round lock throughout, so "in flight" proves nothing: the count must drop.)
  check("vault: ...and the free spins run", await page.waitForFunction(() => Number(document.getElementById("footerBet").textContent) < 15, { timeout: 15000 }).then(() => true, () => false));
  // Sample the free spins until the outro opens.
  const seen = { mismatch: [], tips: [], samples: 0 };
  for (const t0 = Date.now(); Date.now() - t0 < 170000 && !(await featureOpen(page));) {
    const r = await page.evaluate(() => ({ left: document.getElementById("footerBet").textContent.trim(), line: document.getElementById("psTicker").textContent.trim() }));
    const m = /^Free spins · Remaining: (\d+)$/.exec(r.line);
    if (m) { seen.samples++; if (m[1] !== r.left) seen.mismatch.push(`${r.left} vs "${r.line}"`); }
    // The base game's resting tips (main.js tips()); bonus lines of their own (wins, scatter
    // counts, "Retrigger Catch") are the bonus talking and are fine.
    else if (/^Minimum \d+ matches|^Tumbles keep paying|^Multipliers up to|scatters award|^Buy feature available|^Win up to|^Hold space/.test(r.line) && !seen.tips.includes(r.line)) seen.tips.push(r.line);
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
  // Enter on another enabled control keeps its own meaning (most are locked during a feature).
  const other = await page.evaluate(() => {
    const b = [...document.querySelectorAll(".lsh button")].find((x) => !x.disabled && x.id !== "spinBtn" && x.getBoundingClientRect().width && !x.closest(".hidden,[hidden]"));
    if (!b) return null;
    b.dataset.probeFocus = "1"; b.focus();
    return document.activeElement === b ? (b.id || b.getAttribute("aria-label") || b.className) : null;
  });
  if (other) {
    await page.keyboard.press("Enter");
    await sleep(400);
    check(`vault: Enter on another focused control (${other}) leaves the intro waiting`, await featureOpen(page));
    await page.keyboard.press("Escape");
    await sleep(300);
  } else console.log("  (no other control is enabled on the intro: Enter there cannot hit one)");
  await page.evaluate(() => document.activeElement?.blur?.());
  // Held past the hold-for-autoplay threshold (400 ms): it continues, it never starts autoplay.
  await page.keyboard.down("Space");
  await sleep(900);
  await page.keyboard.up("Space");
  await sleep(400);
  check("vault: Space continues the intro", !(await featureOpen(page)));
  check("vault: a held Space there starts no autoplay", !(await page.evaluate(() => window.__spinLifecycle.autoplayActive)));
  await untilIdle(page, 170000);
  check("vault: no failed request through two features", page.missing.length === 0, page.missing.slice(0, 3).join(", "));
  await page.close();
}

// 4a. The words for each kind of failure (one function, shared by every game).
{
  const page = await open("classic");
  const said = await page.evaluate(() => {
    const f = window.LuminaShell.roundNotPlayed, E = (message, code) => Object.assign(new Error(message), code ? { code } : {});
    return {
      chrome: f(new TypeError("Failed to fetch")), safari: f(new TypeError("Load failed")), firefox: f(new TypeError("NetworkError when attempting to fetch resource.")),
      games: f(E("NETWORK: connection lost")), funds: f(E("INSUFFICIENT_FUNDS")), session: f(E("SESSION_EXPIRED", "SESSION_EXPIRED")),
      bet: f(E("INVALID_BET", "INVALID_BET")), other: f(E("CHOICE_REQUIRED", "CHOICE_REQUIRED")), plain: f(new Error("boom"))
    };
  });
  const want = { chrome: "No connection: round not played", safari: "No connection: round not played", firefox: "No connection: round not played", games: "No connection: round not played",
    funds: "Not enough credit for this bet", session: "Session ended: please reopen the game", bet: "Bet not accepted: choose another bet",
    other: "Round not played (CHOICE_REQUIRED)", plain: "Round not played: please try again" };
  for (const k of Object.keys(want)) check(`round not played, ${k}: "${want[k]}"`, said[k] === want[k], said[k]);
  await page.close();
}

// 4. A spin the server never answers, in every game.
for (const game of GAMES) {
  const page = await open(game);
  const read = () => page.evaluate(() => ({ line: document.getElementById("psTicker").textContent.trim(), bal: document.getElementById("footerBalance").textContent.trim(), busy: window.__spinLifecycle.inFlight }));
  const before = await read();
  // The connection is down: every spin request fails after 3.6 s (past the 3 s waiting line),
  // retries included, until the game gives up. Vault 20K's in-page engine, the other games'
  // fetch (their demo answers it in the page).
  await page.evaluate((isVault) => {
    window.__down = true;
    const fail = () => new Promise((_, rej) => setTimeout(() => rej(new TypeError("Failed to fetch")), 3600));
    if (isVault) {
      const proto = window.SlotEngine.SpinEngine.prototype, spin = proto.spin;
      proto.spin = function (...a) { return window.__down ? fail() : spin.apply(this, a); };
    } else {
      const f = window.fetch;
      window.fetch = function (input, ...rest) {
        if (window.__down && String(input?.url || input).includes("/game/v1/spin")) return fail();
        return f.call(this, input, ...rest);
      };
    }
  }, game === "vault");
  await page.tap("#spinBtn");
  const said = await page.waitForFunction(() => document.getElementById("psTicker").textContent.trim() === "No connection: round not played", { timeout: 30000, polling: 50 }).then(() => true, () => false);
  await page.evaluate(() => { window.__down = false; });
  check(`${game}: a lost round says "No connection: round not played"`, said, (await read()).line);
  await untilIdle(page, 10000);
  check(`${game}: ...and leaves the balance as it was`, (await read()).bal === before.bal, `${before.bal} -> ${(await read()).bal}`);
  await sleep(4500); // the notice has had its time
  await page.tap("#spinBtn");
  const played = await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 8000 }).then(() => true, () => false);
  await untilIdle(page, 60000);
  check(`${game}: the next round plays`, played);
  const after = (await read()).line;
  if (game !== "vault") check(`${game}: no waiting line left over after it`, !/Waiting for the server/.test(after), after); // Vault 20K shows none
  await page.close();
}

// 5. Long numbers fit their readouts on a small phone, upright and on its side, in every game.
for (const game of GAMES) for (const [w, h] of [[320, 568], [667, 375]]) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
  await page.goto(`${base}/${game}/?intro=0`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready"), { timeout: 30000 });
  const clipped = await page.evaluate(async () => {
    const out = [], tick = () => new Promise((r) => setTimeout(r, 0));
    const ink = (n) => { const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect(); }; // the text itself
    const [bal, bet, win] = ["footerBalance", "footerBet", "footerWin"].map((id) => document.getElementById(id));
    const old = [bal, bet, win].map((n) => n.textContent);
    for (const n of [bal, win]) {
      for (const v of ["1,234,567.89", "12,345,678.90", "123,456,789.01", "1,234,567,890.12"]) {
        n.textContent = v;
        await tick();
        if (n.scrollWidth > n.clientWidth + 0.5) out.push(`${n.id} ${v}`);
        if (parseFloat(getComputedStyle(n).fontSize) < 12) out.push(`${n.id} ${v} below 12 px`);
      }
    }
    // Bet (the narrow centre column) beside a long balance and win: on screen, apart, ≥ 12 px.
    bal.textContent = "1,234,567.89"; win.textContent = "1,234,567.89";
    for (const v of ["1.00", "100.00", "1,000.00", "10,000.00", "100,000.00"]) {
      bet.textContent = v;
      await tick();
      const b = ink(bet), l = ink(bal), w = ink(win);
      if (b.left < 0 || b.right > innerWidth) out.push(`Bet ${v} off screen`);
      const meet = (p, q) => p.left < q.right + 2 && p.right > q.left - 2 && p.top < q.bottom && p.bottom > q.top;
      if (meet(b, l) || meet(b, w)) out.push(`Bet ${v} touches Balance or Win`);
      if (parseFloat(getComputedStyle(bet).fontSize) < 12) out.push(`Bet ${v} below 12 px`);
    }
    [bal, bet, win].forEach((n, i) => { n.textContent = old[i]; });
    return out;
  });
  check(`${game}: numbers up to 1.2 billion fit their readouts at ${w}×${h}`, clipped.length === 0, clipped.slice(0, 3).join(", "));
  await page.close();
}

await browser.close();
server.close();
console.log(`\nphone-anomalies: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
