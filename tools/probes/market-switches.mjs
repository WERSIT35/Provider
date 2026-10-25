#!/usr/bin/env node
// Market switches on the client (docs/lumina-overhaul, prompt A2), proven in Chrome on the demo
// build with its review markets (demo/demo.js ?market=, values mirroring the platform presets;
// illustrative, not legal advice):
//   UKGC  autoplay and speed hidden in place, no slam stop, rounds at least 2.5 s apart, no
//         feature buy over the 5.00 stake cap;
//   DE    the same, rounds at least 5 s apart, the feature buy hidden, the panic button
//         shown and the RTP at the stake;
//   none  everything the game has is shown.
// Run for Vault 20K, Moth & Lantern and Relic Forge (Relic Forge has no speed control or
// slam stop in any market: its own design).
//
//   CHROME_PATH=… node tools/probes/market-switches.mjs [--games vault,classic,relicforge]
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
const argv = process.argv.slice(2);
const GAMES = argv.includes("--games") ? argv[argv.indexOf("--games") + 1].split(",") : ["vault", "classic", "relicforge", "glasshouse", "clockwork"];
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

// What each game has at all (before any market switches it off).
const HAS = { vault: { turbo: true, slam: true, buy: true }, classic: { turbo: true, slam: true, buy: false }, relicforge: { turbo: false, slam: false, buy: false }, glasshouse: { turbo: true, slam: true, buy: true }, clockwork: { turbo: true, slam: true, buy: true } };
// UKGC allows the buy, but its 5.00 stake cap hides a buy that costs more (100x a 1.00 bet).
const MARKETS = { UKGC: { autoplay: false, turbo: false, buy: false, minMs: 2500 }, DE: { autoplay: false, turbo: false, buy: false, minMs: 5000 }, "": { autoplay: true, turbo: true, buy: true, minMs: 0 } };

async function run(game, market) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  // Round arrivals: the page's fetch (Moth & Lantern, Relic Forge) or Vault's round in view.
  await page.evaluateOnNewDocument(() => {
    window.__rounds = [];
    const hook = () => {
      const f = window.fetch;
      if (f.__probed) return;
      window.fetch = async (input, init) => {
        const res = await f(input, init);
        if (String(input).includes("/game/v1/spin")) { const at = performance.now(); res.clone().json().then((j) => { if (!j.is_free_spin) window.__rounds.push(at); }).catch(() => {}); } // free spins are never paced
        return res;
      };
      window.fetch.__probed = true;
    };
    document.addEventListener("DOMContentLoaded", hook);
    // Vault 20K resolves rounds in the page: note each round it starts showing.
    let last = 0;
    const poll = setInterval(() => { const lr = window.__spinLifecycle?.lastRound; if (lr && lr.n !== last) { last = lr.n; if (!lr.is_free_spin) (window.__luminaRounds ||= []).push(lr.at); } }, 20);
    window.addEventListener("pagehide", () => clearInterval(poll));
  });
  await page.goto(`${base}/${game}/${market ? `?market=${market}` : ""}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle, { timeout: 30000 });
  await new Promise((r) => setTimeout(r, 800));
  const shown = await page.evaluate(() => {
    const vis = (id) => { const n = document.getElementById(id); return Boolean(n) && !n.hidden && !n.closest("[hidden]") && getComputedStyle(n).visibility !== "hidden" && !n.classList.contains("is-off") && !n.classList.contains("is-reg-off"); };
    const panic = document.querySelector(".lsh-panic");
    return { autoplay: vis("autoplayBtn"), turbo: vis("turboBtn"), buy: vis("buyFreeBtn"), panic: Boolean(panic) && !panic.hidden && panic.getBoundingClientRect().height >= 40, betLabel: document.querySelector('.lsh [data-k="bet"]')?.textContent || "", rtp: (() => { const n = document.querySelector(".lsh-rtp"); return n && !n.hidden && n.getBoundingClientRect().width > 0 ? n.textContent.replace(/\s+/g, " ").trim() : ""; })() };
  });
  // Three paid rounds, each pressed the moment the game is idle again: the gaps between the
  // rounds' answers must keep the market's minimum (the client paces; it never queues).
  // A press that lands in a feature plays a free spin (never paced, not counted), so press
  // until three paid rounds are in (at most 8 presses).
  const slams = [];
  const paid = () => page.evaluate(() => (window.__luminaRounds || window.__rounds || []).length);
  for (let i = 0; i < 8 && (i < 3 || (await paid()) < 3); i++) {
    await untilIdle(page, 240000);
    const press = () => page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); });
    await press();
    // Slam: a second press during the round (Vault keeps its flag on the state).
    await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 150));
    await press();
    if (game === "vault") slams.push(await page.evaluate(() => typeof state !== "undefined" && Boolean(state.fastStopRequested)));
  }
  await untilIdle(page, 240000);
  // Answer times: the page's fetch (Moth & Lantern, Relic Forge), or Vault's rounds in view.
  const arrivals = await page.evaluate(() => (window.__luminaRounds || window.__rounds).slice(0, 3));
  await page.close();
  const gaps = arrivals.slice(1).map((t, i) => Math.round(t - arrivals[i]));
  return { shown, gaps, slams };
}

for (const game of GAMES) {
  for (const [market, want] of Object.entries(MARKETS)) {
    const label = `${game} (${market || "no market"})`;
    const r = await run(game, market);
    check(`${label}: autoplay ${want.autoplay ? "shown" : "hidden"}`, r.shown.autoplay === want.autoplay);
    check(`${label}: speed ${want.turbo && HAS[game].turbo ? "shown" : "hidden"}`, r.shown.turbo === (want.turbo && HAS[game].turbo));
    // DE: the panic button (GlüStV §6i) and the RTP at the stake (§22a(3)); nowhere else.
    check(`${label}: panic button ${market === "DE" ? "shown (40 px hit)" : "hidden"}`, r.shown.panic === (market === "DE"));
    check(`${label}: RTP at the stake ${market === "DE" ? "shown" : "not shown"}`, market === "DE" ? /^RTP \d+\.\d\d%$/.test(r.shown.rtp) : r.shown.rtp === "", r.shown.rtp);
    if (HAS[game].buy) check(`${label}: feature buy ${want.buy ? "shown" : "hidden"}`, r.shown.buy === want.buy);
    if (want.minMs) check(`${label}: rounds at least ${want.minMs} ms apart`, r.gaps.length >= 2 && r.gaps.every((g) => g >= want.minMs - 60), r.gaps.join(", ") + " ms");
    if (game === "vault" && HAS[game].slam) check(`${label}: slam stop ${market ? "ignored" : "honoured"}`, market ? r.slams.every((s) => !s) : r.slams.some(Boolean), r.slams.join(","));
  }
}
await browser.close();
server.close();
console.log(`\nmarket-switches: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
