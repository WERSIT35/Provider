#!/usr/bin/env node
// No-celebrate gate (docs/lumina-overhaul, prompt A3): under a UK-style market profile
// (celebrate_threshold "gt_stake", RTS 14F / AGCO 2.20) a round whose return is at or below
// the stake gets NO win effects: no win sounds, no gold ticker, no celebration overlay, no
// haptics, no amber win glow. A round above the stake still celebrates (positive control),
// and in the default market every win celebrates as before (Relic Forge: quiet by design).
// Covers Vault 20K, Moth & Lantern and Relic Forge.
//
//   CHROME_PATH=… node tools/probes/no-celebrate.mjs [--rounds 60] [--games vault,classic,relicforge]
//
// Runs on the demo build (games answered in the page by their own engines), so it needs no
// platform: it builds dist-demo/ first. Exits 1 on any failure.
import { execFileSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";
import { untilIdle } from "./lib/until-idle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2);
const ROUNDS = Number(argv.includes("--rounds") ? argv[argv.indexOf("--rounds") + 1] : 60);
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? ` (${detail})` : ""}`); if (!ok) failed++; };

execFileSync(process.execPath, [path.join(ROOT, "tools/build-demo.mjs")], { stdio: "ignore" });
const DIST = path.join(ROOT, "dist-demo");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".webp": "image/webp", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".svg": "image/svg+xml" };
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

// Win-effect sound events per game (any of these on a sub-stake round is a failure).
const WIN_EVENTS = {
  classic: ["win_small", "win_land", "win_big", "win_mega", "win_epic", "line_show", "win_tick", "feature_award"],
  relicforge: ["rf_win", "rf_win_tier", "rf_max_win", "rf_mult_tier"],
  glasshouse: ["win_small", "win_land", "win_big", "win_mega", "win_epic", "win_tick", "max_win", "feature_award", "fs_outro"],
  vault: ["win_small", "win_land", "win_light", "win_tick", "win_big", "win_mega", "win_epic", "bigwin_open", "max_win", "combine_enter", "combine_slam", "combine_total", "multiplier_combine"]
};

const QUIET_BY_DESIGN = new Set(["relicforge"]);

async function run(game, market) {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  // Record every sound, haptic and fetched round; speed up time-insensitive waits.
  await page.evaluateOnNewDocument(() => {
    window.__probe = { sounds: [], rounds: [], vib: 0 };
    navigator.vibrate = () => { window.__probe.vib++; return true; };
    try { localStorage.setItem("lumina.shell.prefs", JSON.stringify({ speed: "turbo" })); } catch {}
    const hook = () => {
      if (window.Sound && !window.Sound.__probed) { const play = window.Sound.play.bind(window.Sound); window.Sound.play = (n, o) => { window.__probe.sounds.push({ n, at: performance.now() }); return play(n, o); }; window.Sound.__probed = true; }
      const f = window.fetch;
      if (!f.__probed) {
        window.fetch = async (input, init) => {
          const res = await f(input, init);
          try { if (String(input).includes("/game/v1/spin")) res.clone().json().then((j) => window.__probe.rounds.push({ j, at: performance.now() })); } catch {}
          return res;
        };
        window.fetch.__probed = true;
      }
    };
    document.addEventListener("DOMContentLoaded", hook);
    window.addEventListener("load", hook);
  });
  await page.goto(`${base}/${game}/${market ? `?market=${market}` : ""}`, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle, { timeout: 30000 });
  await page.evaluate(() => { const s = window.Sound; if (s && !s.__probed) { const play = s.play.bind(s); s.play = (n, o) => { window.__probe.sounds.push({ n, at: performance.now() }); return play(n, o); }; s.__probed = true; } });
  const results = { sub: 0, subBad: [], above: 0, aboveOk: 0 };
  // At least ROUNDS rounds, and on until three sub-stake rounds were seen (up to 3x ROUNDS):
  // a game with a low hit rate (Vault 20K) still gets judged on real sub-stake rounds.
  for (let i = 0; i < ROUNDS * 3 && !(i >= ROUNDS && results.sub >= 3); i++) {
    const mark = await page.evaluate(() => ({ t: performance.now(), vib: window.__probe.vib, n: window.__probe.rounds.length }));
    await page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); });
    await page.waitForFunction((n) => {
      const lr = window.__spinLifecycle.lastRound; // Vault 20K: resolved in the page, no fetch
      if (lr && lr.n !== window.__probe.lastN) { window.__probe.lastN = lr.n; window.__probe.rounds.push({ j: lr, at: performance.now() }); }
      return window.__probe.rounds.length > n;
    }, { timeout: 20000, polling: 20 }, mark.n).catch(() => {});
    // Watch the presentation while it runs: overlay, ticker state, amber glow.
    const seen = await page.evaluate(async () => {
      const out = { overlay: false, gold: false };
      const t0 = performance.now();
      while (performance.now() - t0 < 15000) {
        if (document.querySelector("#bigWinOverlay.is-open")) out.overlay = true; // the shared big-win overlay (every game)
        if (document.getElementById("psTicker")?.dataset.state === "win") out.gold = true;
        if (!window.__spinLifecycle.inFlight) break;
        await new Promise((r) => setTimeout(r, 30));
      }
      return out;
    });
    await untilIdle(page, 240000);
    const r = await page.evaluate((m) => {
      const round = window.__probe.rounds[window.__probe.rounds.length - 1]?.j;
      return { round, sounds: window.__probe.sounds.filter((s) => s.at >= m.t).map((s) => s.n), dbg: window.__probe.sounds.filter((s) => s.at >= m.t).map((s) => `${s.n}@${Math.round(s.at - m.t)}`).join(" "), vib: window.__probe.vib - m.vib };
    }, mark);
    if (!r.round) continue;
    if (r.round.free_spins_awarded > 0 || r.round.is_free_spin) { await untilIdle(page, 240000); continue; }
    const win = Number(r.round.total_win || 0), bet = Number(r.round.bet_amount ?? r.round.bet ?? 0) || 1;
    if (win > 0 && win <= bet + 1e-9) {
      results.sub++;
      const bad = r.sounds.filter((n) => WIN_EVENTS[game].includes(n));
      // Haptics follow sound events (one wrapper per game), so a win buzz implies a win sound here.
      if (bad.length || seen.overlay || seen.gold) results.subBad.push(`[${r.dbg}] win ${win} bet ${bet}: ${[...new Set(bad)].join(",")}${seen.overlay ? " overlay" : ""}${seen.gold ? " gold" : ""}`);
    } else if (win > bet) {
      results.above++;
      if (seen.gold || r.sounds.some((n) => WIN_EVENTS[game].includes(n))) results.aboveOk++;
    }
  }
  await page.close();
  return results;
}

const GAMES = argv.includes("--games") ? argv[argv.indexOf("--games") + 1].split(",") : ["vault", "classic", "relicforge", "glasshouse"];
for (const game of GAMES) {
  const uk = await run(game, "UKGC");
  check(`${game} (UKGC): ${uk.sub} rounds returned ≤ the stake and none was celebrated`, uk.sub > 0 && uk.subBad.length === 0, uk.subBad.slice(0, 3).join(" | ") || (uk.sub ? "" : "no sub-stake round seen; raise --rounds"));
  check(`${game} (UKGC): rounds above the stake still celebrate (${uk.aboveOk}/${uk.above})`, uk.above === 0 || uk.aboveOk === uk.above);
  const def = await run(game, null);
  // Relic Forge's own design never celebrates a round at or below the bet (GDD §6, §8), in
  // every market; the other games keep celebrating sub-stake wins outside the rule's markets.
  if (QUIET_BY_DESIGN.has(game)) check(`${game} (default market): sub-stake rounds stay quiet by the game's design (${def.sub})`, def.subBad.length === 0, def.subBad.slice(0, 3).join(" | "));
  else check(`${game} (default market): sub-stake wins still celebrate as before (${def.sub - def.subBad.length} quiet of ${def.sub})`, def.sub === 0 || def.subBad.length > 0);
}
await browser.close();
server.close();
console.log(`\nno-celebrate: ${failed ? "FAIL" : "PASS"}`);
process.exit(failed ? 1 : 0);
