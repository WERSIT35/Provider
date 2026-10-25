#!/usr/bin/env node
"use strict";

// The scatter celebration lights ONLY scatters, on the board the player sees.
//
// The bug this guards: the celebrated cells used to be the union of every cell
// that held a SCATTER in ANY tumble step, drawn on the FINAL board. A scatter
// that fell during a tumble left its old cell in that union, and the glow landed
// on whatever symbol sits there now.
//
// Seeded and deterministic. The page gets a seedable crypto.getRandomValues
// (test fixture only, like tools/rtp-parity.js's seeded crypto); each round is
// picked by trying seeds `<prefix>/0`, `<prefix>/1`, … with the engine session
// restored between tries, so the same seeds give the same rounds on every
// machine. Three callers of celebrateScatterCatch() are played through the real
// client:
//   1. base trigger where a scatter MOVED during a tumble
//   2. free-spin retrigger (+5)
//   3. bought feature where a scatter moved
// For every celebration it records the cells handed to lockOn / highlight /
// celebrateCluster and the board on screen at that moment, and asserts: every
// celebrated cell shows SCATTER, the set equals the scatters on screen, the count
// equals the engine's scatter_count, and the dev-mode check logged nothing. It
// also proves each scenario is real: the old union would have lit a non-scatter.
//
// Needs backend/server.js (started here) and Chrome. No npm dependencies.
//   node tools/scatter-celebration-check.js

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3143);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  - ${name}${detail ? `  (${detail})` : ""}`);
  else { failures += 1; console.error(`  FAIL - ${name}${detail ? `  [${detail}]` : ""}`); }
}

function findChrome() {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean).find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const listeners = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) { listeners.forEach((fn) => fn(msg)); return; }
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return {
    ready,
    on(fn) { listeners.push(fn); },
    send(method, params) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    }
  };
}

// Installed before any page script: crypto.getRandomValues becomes seedable.
// __seedRng(text) switches to a deterministic stream (sfc32 seeded by xmur3);
// __seedRng(null) goes back to the real CSPRNG.
const SEEDABLE_RNG = `(() => {
  const real = crypto.getRandomValues.bind(crypto);
  let gen = null;
  function xmur3(str) { let h = 1779033703 ^ str.length; for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); } return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return (h ^= h >>> 16) >>> 0; }; }
  function sfc32(a, b, c, d) { return () => { a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0; let t = (a + b) | 0; a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0; t = (t + d) | 0; c = (c + t) | 0; return t >>> 0; }; }
  crypto.getRandomValues = (arr) => {
    if (!gen) return real(arr);
    if (arr instanceof Uint32Array) { for (let i = 0; i < arr.length; i++) arr[i] = gen(); return arr; }
    const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
    for (let i = 0; i < bytes.length; i++) bytes[i] = gen() & 255;
    return arr;
  };
  window.__seedRng = (text) => { if (text == null) { gen = null; return; } const s = xmur3(String(text)); gen = sfc32(s(), s(), s(), s()); };
})();`;

// In-page harness: the seeded outcome picker and the celebration recorder.
const HARNESS = `(() => {
  const H = window.__sc = { celebrations: [], picks: [], plan: null };
  const scatterSet = (m) => { const out = []; (m || []).forEach((row, r) => (row || []).forEach((s, c) => { if (s === "SCATTER") out.push(r + "-" + c); })); return out; };
  // The pre-fix union: every cell that held a SCATTER in ANY tumble step.
  H.legacyUnion = (p) => { const seen = new Set(); (p.tumble_steps || []).forEach((st) => scatterSet(st.matrix).forEach((k) => seen.add(k))); return [...seen]; };
  H.moved = (p) => { const fin = new Set(scatterSet((p.tumble_steps || []).slice(-1)[0]?.matrix)); return H.legacyUnion(p).some((k) => !fin.has(k)); };

  const real = window.__realApi || api;
  window.__realApi = real;
  api = async (path, payload) => {
    const plan = H.plan && H.plan[path];
    if (!plan) return real(path, payload);
    const eng = await getEngine();
    const snap = Object.fromEntries(Object.entries(eng.session).filter(([, v]) => v === null || typeof v !== "object"));
    let last = null;
    for (let i = 0; i < plan.tries; i++) {
      Object.assign(eng.session, snap);
      const seed = plan.prefix + "/" + i;
      window.__seedRng(seed);
      try { last = await real(path, { ...payload, spin_id: crypto.randomUUID() }); } finally { window.__seedRng(null); }
      if (plan.want(last)) {
        H.picks.push({ path, seed, scatter_count: last.scatter_count, moved: H.moved(last), is_free_spin: Boolean(last.is_free_spin), awarded: last.free_spins_awarded });
        if (plan.keepSpins != null && Number(last.free_spins_left) > plan.keepSpins) { eng.session.freeSpinsLeft = plan.keepSpins; last.free_spins_left = plan.keepSpins; }
        if (plan.then) H.plan[path] = plan.then; else delete H.plan[path];
        return last;
      }
    }
    H.picks.push({ path, seed: null, error: "no seed matched in " + plan.tries + " tries" });
    delete H.plan[path];
    return last;
  };

  // Record what each celebration step is handed, and the board on screen then.
  const rec = (name) => {
    const orig = reelRenderer[name].bind(reelRenderer);
    reelRenderer[name] = (...args) => {
      if (H.active) {
        const cells = name === "highlight" ? (args[1]?.winning || []) : args[0];
        H.active.calls.push({ name, cells: (cells || []).map((p) => p.row + "-" + p.col),
          board: (reelRenderer.board.matrix || []).map((r) => r.slice()) });
      }
      return orig(...args);
    };
  };
  ["lockOn", "highlight", "celebrateCluster"].forEach(rec);
  const origCelebrate = celebrateScatterCatch;
  celebrateScatterCatch = async (payload, label) => {
    H.active = { label, payload, calls: [], displayed: scatterSet(reelRenderer.board.matrix), legacy: H.legacyUnion(payload) };
    try { return await origCelebrate(payload, label); }
    finally { H.celebrations.push(H.active); H.active = null; }
  };
  // Feature screens and big wins close themselves; speed them up.
  setInterval(() => {
    if (VxNotify.isOpen("feature")) dismissFeature();
    const bw = document.getElementById("bigWinOverlay");
    if (bw?.classList.contains("is-done")) bw.click();
  }, 400);
  H.summary = () => H.celebrations.map((c) => {
    const p = c.payload;
    const finalBoard = (p.tumble_steps || []).slice(-1)[0]?.matrix || [];
    return {
      label: c.label,
      is_free_spin: Boolean(p.is_free_spin),
      engineCount: p.scatter_count,
      displayed: c.displayed,
      legacyNonScatter: c.legacy.filter((k) => { const [r, col] = k.split("-").map(Number); return finalBoard[r]?.[col] !== "SCATTER"; }),
      calls: c.calls.map((x) => ({ name: x.name, cells: x.cells,
        nonScatter: x.cells.filter((k) => { const [r, col] = k.split("-").map(Number); return x.board[r]?.[col] !== "SCATTER"; }),
        sameAsDisplayed: x.cells.slice().sort().join() === scatterSet(x.board).sort().join() }))
    };
  });
  return true;
})()`;

async function main() {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

  const server = spawn(process.execPath, [path.join(__dirname, "..", "backend", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`); if (r.ok) break; } catch {}
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-scatter-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`,
    "--no-first-run", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsBase = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome debug port not reported")), 60000);
    chrome.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); }
    });
  });

  try {
    // Chrome reports its port before it lists the about:blank page: ask again until it does.
    let page;
    for (let i = 0; i < 50 && !page; i++) {
      page = (await (await fetch(`${wsBase}/json/list`)).json()).find((t) => t.type === "page");
      if (!page) await new Promise((r) => setTimeout(r, 200));
    }
    if (!page) throw new Error("chrome listed no page target");
    const cdp = connect(page.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    const consoleErrors = [];
    cdp.on((msg) => {
      if (msg.method !== "Runtime.consoleAPICalled" || msg.params.type !== "error") return;
      const text = (msg.params.args || []).map((a) => a.value ?? a.description).join(" ");
      if (text.includes("[scatter-check]")) consoleErrors.push(text);
    });
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: SEEDABLE_RNG });
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const ev = async (expr) => {
      const r = await cdp.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
      return r.result.value;
    };
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/?reset` });
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      try { if (await ev(`document.body.classList.contains("app-ready") && typeof state !== "undefined" && !!state.sessionId`)) break; } catch {}
    }
    await sleep(800);
    await ev(HARNESS);
    await ev(`(() => { if (!state.turbo) setTurbo(true); return true; })()`);
    const waitIdle = async (ms = 120000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (await ev(`!isRoundInFlight() && !state.bonusAutoplay && VxNotify.openNames().length === 0`)) {
          await sleep(500);
          if (await ev(`!isRoundInFlight() && !state.bonusAutoplay && VxNotify.openNames().length === 0`)) return true;
        }
        await sleep(200);
      }
      return false;
    };

    // 1 + 2. Base trigger with a moved scatter; then a retrigger on the first
    // free spin. The bonus is cut to a couple of spins (test only).
    // The retrigger plan follows the base pick (`then`): the bonus's first free
    // spin goes through the same api path.
    await ev(`(() => { __sc.plan = {
      "/api/v1/spin": { prefix: "scatter-move", tries: 20000, keepSpins: 1,
        want: (r) => !r.is_free_spin && Number(r.free_spins_awarded) > 0 && __sc.moved(r) && !(r.events || []).length,
        then: { prefix: "scatter-retrigger", tries: 20000, keepSpins: 1,
          want: (r) => r.is_free_spin && Number(r.free_spins_awarded) > 0 && !(r.events || []).length } }
    }; return true; })()`);
    await ev(`document.getElementById("spinBtn").click(), true`);
    check("base trigger + retrigger rounds played to idle", await waitIdle());

    // 3. The buy-feature path, with a moved scatter.
    await ev(`(() => { __sc.plan = { "/api/v1/buy-free-spins": { prefix: "scatter-buy", tries: 20000, keepSpins: 1,
      want: (r) => Number(r.free_spins_awarded) > 0 && __sc.moved(r) && !(r.events || []).length } }; return true; })()`);
    await ev(`document.getElementById("buyFreeBtn").click(), true`);
    for (let i = 0; i < 50 && !(await ev(`VxNotify.isOpen("buyConfirm")`)); i++) await sleep(100);
    await ev(`document.getElementById("buyConfirmBtn").click(), true`);
    check("bought feature played to idle", await waitIdle());

    const picks = await ev(`__sc.picks`);
    const seeds = picks.map((p) => `${p.path.split("/").pop()}:${p.seed}${p.is_free_spin ? " (free spin)" : ""}`).join(", ");
    check("every scenario found a seeded round", picks.length >= 3 && picks.every((p) => p.seed), seeds);
    const cels = await ev(`__sc.summary()`);
    const base = cels.find((c) => c.label === "Bonus Catch" && !c.is_free_spin);
    const retrig = cels.find((c) => c.label === "Retrigger Catch");
    const bought = cels.filter((c) => c.label === "Bonus Catch" && !c.is_free_spin)[1];
    check("base trigger celebrated", Boolean(base));
    check("free-spin retrigger celebrated", Boolean(retrig));
    check("bought feature celebrated", Boolean(bought));
    check("base trigger: a scatter moved during a tumble (the old union lit a non-scatter)",
      Boolean(base && base.legacyNonScatter.length), base && `old union lit ${base.legacyNonScatter.join(" ")}`);
    check("bought feature: a scatter moved during a tumble (the old union lit a non-scatter)",
      Boolean(bought && bought.legacyNonScatter.length), bought && `old union lit ${bought.legacyNonScatter.join(" ")}`);
    for (const c of cels) {
      const tag = `${c.label}${c.is_free_spin ? " (free spin)" : ""}`;
      check(`${tag}: lockOn, highlight and celebrateCluster all ran`, ["lockOn", "highlight", "celebrateCluster"].every((n) => c.calls.some((x) => x.name === n)));
      for (const x of c.calls) {
        check(`${tag}: ${x.name} lights only SCATTER cells on the board on screen`, x.nonScatter.length === 0 && x.cells.length > 0,
          x.nonScatter.length ? `non-scatter ${x.nonScatter.join(" ")}` : `${x.cells.length} cells`);
        check(`${tag}: ${x.name} lights every scatter on screen`, x.sameAsDisplayed);
      }
      check(`${tag}: celebrated count = engine scatter_count`, c.displayed.length === c.engineCount, `${c.displayed.length} vs ${c.engineCount}`);
    }
    check("dev-mode scatter check logged no mismatch", consoleErrors.length === 0 && (await ev(`window.__scatterAssertFailures || 0`)) === 0,
      consoleErrors.join(" | "));
  } finally {
    chrome.kill();
    server.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  if (failures === 0) { console.log("\nscatter-celebration: PASS"); process.exit(0); }
  console.error(`\nscatter-celebration: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
