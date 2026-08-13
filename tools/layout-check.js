#!/usr/bin/env node
"use strict";

// Layout regression test for the player view (GitHub #25 / #26 / #27).
//
// Three invariants, checked at real viewport sizes in real Chrome:
//
//   1. ASPECT (#25)   the board keeps its 6/5 shape — letterboxed or
//                     pillarboxed, never stretched — and never collapses.
//   2. NO REFLOW (#27) showing a top-bar message, revealing the bonus HUD
//                     nodes, or writing a Round ID must not move or resize the
//                     board by a single pixel. This is the one that made the
//                     BONUS feel broken: a banner fires on every free spin, so
//                     any rail growth became a per-spin jump.
//   3. NO CACHE THRASH (#26) those same state changes must not trip the
//                     renderer's ResizeObserver into re-rasterizing its sprite
//                     caches, which is what hitched the frame rate mid-spin.
//
// Drives headless Chrome over the DevTools Protocol — no npm dependencies, in
// keeping with tools/rtp-parity.js and tools/spin-lock-test.js. Prints PASS/FAIL
// and exits non-zero on failure.
//
//   node tools/layout-check.js            # all viewports
//   PORT=3111 node tools/layout-check.js  # pick the static port

const http = require("http");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3111);
const ROOT = path.join(__dirname, "..", "client");
// A pixel of slack: sub-pixel layout rounding is not a reflow.
const EPS = 0.5;

// Every shape the issue calls out: phone portrait/landscape, tablet, desktop
// narrow/wide, plus the extremes that have actually broken before.
const VIEWPORTS = [
  { name: "phone portrait (320x568)", w: 320, h: 568 },
  { name: "phone portrait (390x844)", w: 390, h: 844 },
  { name: "phone landscape (844x390)", w: 844, h: 390 },
  { name: "phone landscape short (740x360)", w: 740, h: 360 },
  { name: "tablet portrait (768x1024)", w: 768, h: 1024 },
  { name: "tablet landscape (1024x768)", w: 1024, h: 768 },
  { name: "desktop narrow (1280x720)", w: 1280, h: 720 },
  { name: "desktop (1920x1080)", w: 1920, h: 1080 },
  { name: "ultra-wide short (2560x900)", w: 2560, h: 900 }
];

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`  ok  - ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${name}${detail ? `  [${detail}]` : ""}`);
  }
}

// ─── tiny static server ──────────────────────────────────────────────────────
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".webp": "image/webp", ".png": "image/png",
  ".svg": "image/svg+xml", ".ico": "image/x-icon"
};

function startServer() {
  const server = http.createServer((req, res) => {
    const url = (req.url || "/").split("?")[0];
    const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
    const file = path.join(ROOT, rel);
    // Keep reads inside client/.
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404).end("not found"); return; }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

// ─── chrome + CDP ────────────────────────────────────────────────────────────
function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter(Boolean);
  return candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } });
}

async function getJson(url) {
  const res = await fetch(url);
  return res.json();
}

/** Minimal CDP client over the page's WebSocket debugger endpoint. */
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
  const ready = new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });
  return {
    ready,
    send(method, params) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params: params || {} }));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { ws.close(); }
  };
}

/** Evaluate an expression in the page and return its (JSON) value. */
async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", {
    expression, returnByValue: true, awaitPromise: true
  });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  }
  return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── page-side probes ────────────────────────────────────────────────────────
// Read the board and window boxes, plus a counter of how many times the
// renderer rebuilt its sprite caches (our #26 proxy).
const PROBE_MEASURE = `(() => {
  const q = (s) => document.querySelector(s);
  const box = (s) => { const e = q(s); if (!e) return null; const r = e.getBoundingClientRect();
    return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) }; };
  return {
    stage: box(".reels-stage"),
    window: box(".vault-window"),
    canvas: box(".reels-canvas"),
    rail: box(".hud-message-rail"),
    hud: box(".hud-bar"),
    docScrollW: document.documentElement.scrollWidth,
    innerW: window.innerWidth,
    rebuilds: window.__rebuilds || 0
  };
})()`;

// Count sprite-cache rebuilds. resize() clears symbolSprites; wrapping its
// clear() is the least invasive way to observe the thrash from outside.
const PROBE_INSTRUMENT = `(() => {
  const r = window.__reelRenderer;
  if (!r || !r.symbolSprites) return false;
  window.__rebuilds = 0;
  const orig = r.symbolSprites.clear.bind(r.symbolSprites);
  r.symbolSprites.clear = function () { window.__rebuilds++; return orig(); };
  return true;
})()`;

async function measure(cdp) { return evaluate(cdp, PROBE_MEASURE); }

function boxesEqual(a, b) {
  if (!a || !b) return false;
  return Math.abs(a.x - b.x) <= EPS && Math.abs(a.y - b.y) <= EPS
    && Math.abs(a.w - b.w) <= EPS && Math.abs(a.h - b.h) <= EPS;
}
const fmtBox = (b) => (b ? `${b.w}x${b.h} @${b.x},${b.y}` : "none");

// ─── the run ─────────────────────────────────────────────────────────────────
async function main() {
  const chromePath = findChrome();
  if (!chromePath) {
    console.error("No Chrome/Edge found. Set CHROME_PATH to a Chromium binary.");
    process.exit(2);
  }

  const server = await startServer();
  const userDataDir = fs.mkdtempSync(path.join(require("os").tmpdir(), "bx-layout-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "--no-first-run", "--no-default-browser-check",
    "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  // Chrome prints the chosen debug port on stderr.
  const wsBase = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome did not report a debug port")), 20000);
    chrome.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); }
    });
  });

  let cdp;
  try {
    const target = await getJson(`${wsBase}/json/new?about:blank`).catch(async () => {
      const list = await getJson(`${wsBase}/json/list`);
      return list.find((t) => t.type === "page");
    });
    cdp = connect(target.webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");

    for (const vp of VIEWPORTS) {
      console.log(`\n${vp.name}`);
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: vp.w, height: vp.h, deviceScaleFactor: 1,
        mobile: vp.w < 820,
        screenWidth: vp.w, screenHeight: vp.h
      });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });
      // Wait for the renderer to have laid the board out at this size. The
      // ResizeObserver is debounced 150ms, so poll rather than guess.
      let ready = false;
      for (let i = 0; i < 80; i++) {
        await sleep(100);
        ready = await evaluate(cdp, `(() => {
          const s = document.querySelector(".reels-stage");
          return !!s && s.getBoundingClientRect().width > 20
            && document.body.classList.contains("public-mode");
        })()`).catch(() => false);
        if (ready) break;
      }
      if (!ready) { check(`${vp.name}: game reached a laid-out state`, false); continue; }
      await sleep(400); // let the debounced resize settle

      // ---- 1. aspect ratio + no collapse -----------------------------------
      const base = await measure(cdp);
      const ar = base.stage.w / base.stage.h;
      check("board holds 6/5 aspect (not stretched)", Math.abs(ar - 1.2) < 0.02,
        `ar=${ar.toFixed(4)} ${fmtBox(base.stage)}`);
      check("board did not collapse", base.stage.w > 60 && base.stage.h > 50,
        fmtBox(base.stage));
      check("board fits inside its window (letterbox/pillarbox, no overflow)",
        base.stage.w <= base.window.w + EPS && base.stage.h <= base.window.h + EPS,
        `stage ${fmtBox(base.stage)} vs window ${fmtBox(base.window)}`);
      check("no horizontal page scroll", base.docScrollW <= base.innerW + EPS,
        `scrollW=${base.docScrollW} innerW=${base.innerW}`);

      // ---- 2/3. state changes must not reflow or thrash --------------------
      // Reveal the Round ID strip FIRST, mirroring the app: initSession() claims
      // that row at bootstrap precisely so the one unavoidable reveal happens
      // while the board is idle, never mid-round. Everything measured after this
      // point is a during-play state change and must cost zero layout.
      await evaluate(cdp, `document.getElementById("roundIdBar").classList.remove("hidden");`);
      await sleep(400);
      await evaluate(cdp, PROBE_INSTRUMENT);
      const before = await measure(cdp);

      // (a) a top-bar message — fires on EVERY free spin in the bonus
      await evaluate(cdp, `(() => {
        const b = document.getElementById("eventBanner");
        document.getElementById("eventBannerText").textContent = "AUTO FREE SPIN...";
        b.classList.remove("hidden");
        b.classList.add("banner-bonus", "live-banner");
      })()`);
      await sleep(350);
      let after = await measure(cdp);
      check("banner shown: board box unchanged (#27)", boxesEqual(before.stage, after.stage),
        `${fmtBox(before.stage)} -> ${fmtBox(after.stage)}`);
      check("banner shown: message rail height unchanged",
        Math.abs(before.rail.h - after.rail.h) <= EPS,
        `${before.rail.h} -> ${after.rail.h}`);

      // (b) the bonus HUD nodes revealing (3 -> 6 nodes)
      await evaluate(cdp, `(() => {
        ["bonusTotalNode","freeSpinsNode","activeMultiplierNode"]
          .forEach((id) => document.getElementById(id)?.classList.remove("hidden"));
        document.getElementById("freeSpins").textContent = "15";
        document.getElementById("bonusTotal").textContent = "1234.50";
        document.getElementById("activeMultiplier").textContent = "128x";
      })()`);
      await sleep(350);
      after = await measure(cdp);
      check("bonus HUD revealed: board box unchanged (#25/#27)",
        boxesEqual(before.stage, after.stage),
        `${fmtBox(before.stage)} -> ${fmtBox(after.stage)}`);
      check("bonus HUD revealed: HUD stays one row",
        Math.abs(before.hud.h - after.hud.h) <= EPS,
        `${before.hud.h} -> ${after.hud.h}`);

      // (c) a Round ID written into the strip, then a much longer one — this is
      //     rewritten after every resolved round, free spins included.
      await evaluate(cdp,
        `document.getElementById("roundIdValue").textContent = "rnd_0f8c2b1e";`);
      await sleep(300);
      const withShortId = await measure(cdp);
      await evaluate(cdp, `document.getElementById("roundIdValue").textContent =
        "rnd_0f8c2b1e-9a44-4c17-bd52-77e1c0a93f6d-overflowing-reference";`);
      await sleep(300);
      after = await measure(cdp);
      check("longer Round ID: board box unchanged (no wrap reflow)",
        boxesEqual(withShortId.stage, after.stage),
        `${fmtBox(withShortId.stage)} -> ${fmtBox(after.stage)}`);

      // (d) banner hiding again — the other half of the per-spin cycle
      await evaluate(cdp, `document.getElementById("eventBanner").classList.add("hidden");`);
      await sleep(350);
      const hidden = await measure(cdp);
      check("banner hidden: board box unchanged",
        boxesEqual(withShortId.stage, hidden.stage),
        `${fmtBox(withShortId.stage)} -> ${fmtBox(hidden.stage)}`);

      // #26: none of the above may have rebuilt the sprite caches.
      const { rebuilds } = await measure(cdp);
      check("no sprite-cache rebuild from any of those state changes (#26)",
        rebuilds === 0, `rebuilds=${rebuilds}`);
    }
  } finally {
    try { cdp?.close(); } catch {}
    chrome.kill();
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  if (failures === 0) {
    console.log("\nlayout: PASS");
    process.exit(0);
  }
  console.error(`\nlayout: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
