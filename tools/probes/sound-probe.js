#!/usr/bin/env node
"use strict";

// Sound engine probe (client/audio/audio.js) in real headless Chrome, with
// autoplay allowed. Checks: every game event plays a decoded FILE (not the
// synth fallback); variations rotate (never the same twice in a row); the mix
// graph (buses + limiter) and ONE AudioContext for the whole client; every
// .m4a (Safari) decodes too; music moods crossfade base → freeSpins → bigWin
// (temporary) → back; the music ducks under a win and recovers; mute persists
// and silences; suspend/resume park and restore the context.
//
//   node tools/probes/sound-probe.js

const http = require("http");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3131);
const ROOT = path.join(__dirname, "..", "..", "client");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".webp": "image/webp", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ogg": "audio/ogg", ".m4a": "audio/mp4" };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(path.resolve(ROOT))) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end(); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}
function findChrome() {
  return [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
    .filter(Boolean).find((p) => fs.existsSync(p));
}
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  return { ready, send: (method, params) => { const id = nextId++; ws.send(JSON.stringify({ id, method, params: params || {} })); return new Promise((resolve, reject) => pending.set(id, { resolve, reject })); }, close: () => ws.close() };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failed = 0;
function check(name, ok, detail = "") {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }
  const server = await startServer();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vx-sound-"));
  const chrome = spawn(chromePath, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--autoplay-policy=no-user-gesture-required", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => { let b = ""; chrome.stderr.on("data", (d) => { b += d; const m = b.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); }); });
  const list = await (await fetch(`${base}/json/list`)).json();
  const cdp = connect(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await cdp.ready;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  const ev = async (e) => { const r = await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed"); return r.result?.value; };
  // Count every AudioContext the page creates.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { const C = window.AudioContext; if (!C) return; window.__ctxCount = 0; window.AudioContext = class extends C { constructor(...a) { super(...a); window.__ctxCount++; } }; })();` });
  try {
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?reset` });
    for (let i = 0; i < 200; i++) { if (await ev("typeof state !== 'undefined' && !!state.sessionId && document.body.classList.contains('app-ready')").catch(() => false)) break; await sleep(100); }

    console.log("\nloading");
    const load = await ev(`(async () => {
      Sound.setMuted(false); Sound.unlock(); await Sound.debug.ready();
      const m = Sound.debug.manifest(); if (!m) return { manifest: false };
      const all = Object.values(m.sounds).flat().concat(Object.values(m.music));
      const t0 = performance.now();
      while (Sound.debug.loaded().length < all.length && performance.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 100));
      return { manifest: true, ext: Sound.debug.ext(), want: all.length, got: Sound.debug.loaded().length, ms: Math.round(performance.now() - t0) };
    })()`);
    check("the manifest loads and every file decodes", load.manifest && load.got === load.want, `${load.got}/${load.want} ${load.ext} in ${load.ms}ms`);
    const m4a = await ev(`(async () => {
      const m = Sound.debug.manifest(); const all = Object.values(m.sounds).flat().concat(Object.values(m.music)); const ctx = new OfflineAudioContext(1, 1, 48000); let bad = [];
      for (const p of all) { try { const b = await (await fetch("assets/audio/" + p + ".m4a")).arrayBuffer(); await ctx.decodeAudioData(b); } catch (e) { bad.push(p); } }
      return { n: all.length, bad };
    })()`);
    check("every .m4a (the Safari set) decodes too", m4a.bad.length === 0, m4a.bad.length ? m4a.bad.join(", ") : `${m4a.n} files`);

    console.log("\nmix graph");
    const graph = await ev(`({ buses: Sound.debug.buses(), limiter: Sound.debug.hasLimiter(), contexts: window.__ctxCount })`);
    check("buses sfx / ui / music / ambience, and a limiter", ["sfx", "ui", "music", "ambience"].every((b) => graph.buses.includes(b)) && graph.limiter, graph.buses.join(","));
    check("one AudioContext for the whole client", graph.contexts === 1, `${graph.contexts} created`);

    console.log("\nevents");
    const events = await ev(`(async () => {
      const opts = { bet_change: { up: true }, turbo_toggle: { on: true }, reel_stop: { index: 2 }, tick: { row: 3, col: 1, rows: 5 }, tumble: { step: 2 }, explode: { tier: "blast-great" },
        win_tick: { progress: 0.5 }, scatter_land: { n: 2, need: 4 }, multiplier_drop: { value: 100 }, multiplier_catch: { value: 10 } };
      const names = ["click", "bet_change", "turbo_toggle", "spin_start", "reel_stop", "tick", "tumble", "explode", "win_tick", "scatter_land", "win_small", "win_big", "win_mega", "max_win",
        "multiplier_strike", "multiplier_drop", "multiplier_catch", "multiplier_combine", "bonus_trigger", "fs_intro", "fs_outro", "buy_feature"];
      const out = [];
      for (const n of names) { const before = Sound.debug.recent().length; Sound.play(n, opts[n] || {}); const r = Sound.debug.recent(); const last = r[r.length - 1]; out.push({ n, played: r.length > before || r.length === 64, file: last && last.name === n ? last.file : null, synth: last ? last.synth : true }); await new Promise((r) => setTimeout(r, 120)); }
      return out;
    })()`);
    const synthed = events.filter((e) => !e.file || e.synth);
    check("every game event plays a sound FILE (no synth fallback once loaded)", synthed.length === 0, synthed.length ? "synth: " + synthed.map((e) => e.n).join(", ") : `${events.length} events`);
    const rot = await ev(`(async () => {
      const res = {};
      for (const [n, o, key] of [["reel_stop", { index: 0 }, "reel_stop"], ["tick", { row: 4, col: 0, rows: 5 }, "tick"], ["explode", {}, "explode"], ["win_tick", {}, "win_tick"]]) {
        const files = []; for (let i = 0; i < 8; i++) { Sound.play(n, o); const r = Sound.debug.recent(); files.push(r[r.length - 1].file); await new Promise((r) => setTimeout(r, 70)); }
        let repeats = 0; for (let i = 1; i < files.length; i++) if (files[i] === files[i - 1]) repeats++;
        res[key] = { distinct: new Set(files).size, repeats };
      }
      return res;
    })()`);
    check("variations rotate, never the same one twice in a row", Object.values(rot).every((r) => r.repeats === 0 && r.distinct >= 2), Object.entries(rot).map(([k, r]) => `${k}:${r.distinct}`).join(" "));

    console.log("\nmusic");
    const mus = await ev(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms)); const seq = [];
      Sound.setMusic("base"); await wait(300); seq.push(Sound.debug.music().playing);
      Sound.setMusic("freeSpins"); await wait(300); seq.push(Sound.debug.music().playing);
      Sound.setMusic("bigWin", { temporary: true }); await wait(300); seq.push(Sound.debug.music().playing);
      Sound.endTemporaryMusic(); await wait(300); seq.push(Sound.debug.music().playing);
      Sound.setMusic("base"); await wait(300); seq.push(Sound.debug.music().playing);
      return seq;
    })()`);
    check("music moods crossfade base → freeSpins → bigWin → back → base", mus.join(",") === "base,freeSpins,bigWin,freeSpins,base", mus.join(" → "));
    const duck = await ev(`(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = Sound.debug.duckLevel(); Sound.play("win_big"); await wait(250); const low = Sound.debug.duckLevel(); await wait(3000); const after = Sound.debug.duckLevel();
      return { before, low, after };
    })()`);
    check("the music ducks under a win and comes back", duck.before > 0.95 && duck.low < 0.5 && duck.after > 0.9, `${duck.before.toFixed(2)} → ${duck.low.toFixed(2)} → ${duck.after.toFixed(2)}`);

    console.log("\nprefs + lifecycle");
    const life = await ev(`(async () => {
      Sound.setMuted(true); const stored = JSON.parse(localStorage.getItem("bananax.sound") || "{}").muted;
      const n0 = Sound.debug.recent().length; Sound.play("explode"); const n1 = Sound.debug.recent().length;
      Sound.setMuted(false); Sound.suspendAudio(); await new Promise((r) => setTimeout(r, 200)); const susp = Sound.contextState();
      Sound.resumeAudio(); await new Promise((r) => setTimeout(r, 300)); const res = Sound.contextState();
      return { stored, silent: n1 === n0, susp, res };
    })()`);
    check("mute is remembered and silences every sound", life.stored === true && life.silent);
    check("a hidden tab parks the audio, and it comes back", life.susp === "suspended" && life.res === "running", `${life.susp} → ${life.res}`);
  } finally {
    cdp.close();
    chrome.kill();
    server.close();
    setTimeout(() => { try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ } }, 300);
  }
  console.log(`\nSOUND PROBE: ${failed ? "FAIL" : "PASS"}`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
