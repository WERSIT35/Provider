#!/usr/bin/env node
"use strict";

// End-to-end spin-lifecycle test (GitHub #28) against the REAL client in a real
// browser. tools/spin-lock-test.js models the rules; this one proves the wiring
// by counting the spins the client actually resolves while the spin button is
// hammered — through the base game AND all the way through a bought bonus.
//
// The invariant, stated as the issue does: a press while a round is in flight
// must ACCELERATE that round, never start another. So a burst of N presses can
// only ever produce ONE spin, and N presses spread across a 15-free-spin bonus
// must produce exactly the 15 free spins and not one more.
//
// Needs backend/server.js (started here) and Chrome. No npm dependencies.
//
//   node tools/spin-e2e.js

const path = require("path");
const fs = require("fs");
const os = require("os");
const { spawn } = require("child_process");

const PORT = Number(process.env.PORT || 3141);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok  - ${name}`);
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

async function main() {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

  const server = spawn(process.execPath, [path.join(__dirname, "..", "backend", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  // Wait for the MVP server to answer.
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    try { const r = await fetch(`http://127.0.0.1:${PORT}/api/v1/health`); if (r.ok) break; } catch {}
  }

  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "bx-e2e-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`,
    "--no-first-run", "--disable-gpu", "--hide-scrollbars",
    "--force-device-scale-factor=1", "--autoplay-policy=no-user-gesture-required",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  const wsBase = await new Promise((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome debug port not reported")), 20000);
    chrome.stderr.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); }
    });
  });

  try {
    const list = await (await fetch(`${wsBase}/json/list`)).json();
    const cdp = connect(list.find((t) => t.type === "page").webSocketDebuggerUrl);
    await cdp.ready;
    await cdp.send("Runtime.enable");
    await cdp.send("Page.enable");
    await cdp.send("Network.enable");

    // Count RESOLVED SPINS. Outside platform mode the client resolves spins on
    // the local engine rather than over HTTP, so counting network requests would
    // count nothing. spin() logs one `[spin] id=… steps=…` line per resolved
    // round on every path (base, autoplay, free spin), which is exactly the
    // "a spin happened" signal this test needs, transport-independent.
    const calls = { spin: 0, buy: 0 };
    cdp.on((msg) => {
      if (msg.method === "Network.requestWillBeSent") {
        const url = msg.params.request.url;
        if (url.includes("/api/v1/buy-free-spins")) calls.buy += 1;
        return;
      }
      if (msg.method !== "Runtime.consoleAPICalled") return;
      const first = msg.params.args?.[0]?.value;
      if (typeof first === "string" && first.startsWith("[spin] id=")) calls.spin += 1;
    });

    const ev = async (expr) => {
      const r = await cdp.send("Runtime.evaluate", {
        expression: expr, returnByValue: true, awaitPromise: true
      });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
      return r.result.value;
    };


    /** Dismiss the feature panel if it is up — it gates bonus entry and exit. */
    const dismissFeature = () => ev(`(() => {
      const f = document.getElementById("featureScreen");
      if (f && !f.classList.contains("hidden")) f.click();
    })()`).catch(() => {});

    /** Wait until the lifecycle is genuinely idle. The spin button's
     *  `is-spinning` cue is dropped the moment the result arrives — long before
     *  the reels stop — so polling that would resume mid-animation and make a
     *  press land as a fast-stop instead of a new spin. window.__spinLifecycle
     *  reports the real state. */
    /** Wait for the resolved-spin counter to reach `n`. A spin is only logged
     *  AFTER the board's drop-off animation and the resolve, so a fixed sleep
     *  races it; poll instead. Returns the count actually reached. */
    async function waitForSpins(n, maxMs = 15000) {
      const until = Date.now() + maxMs;
      while (calls.spin < n && Date.now() < until) await sleep(100);
      return calls.spin;
    }

    async function waitIdle(maxMs = 45000) {
      const until = Date.now() + maxMs;
      while (Date.now() < until) {
        await sleep(100);
        await dismissFeature();
        const busy = await ev(`window.__spinLifecycle.inFlight`).catch(() => true);
        if (!busy) return true;
      }
      return false;
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
      screenWidth: 1280, screenHeight: 800
    });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html` });

    // Wait for a live session (the spin button is only meaningful after init).
    let booted = false;
    for (let i = 0; i < 150; i++) {
      await sleep(100);
      booted = await ev(`(() => {
        const s = document.getElementById("sessionId");
        return !!s && s.textContent && s.textContent !== "-" && s.textContent.length > 3;
      })()`).catch(() => false);
      if (booted) break;
    }
    check("client booted and initialized a session", booted);
    if (!booted) return;
    await sleep(600);

    // Turbo on, so rounds resolve quickly and the test stays short.
    await ev(`document.getElementById("turboBtn")?.click();`);
    await sleep(200);

    // ── 1. base game: a burst of presses must produce exactly ONE spin ───────
    calls.spin = 0;
    await ev(`(() => {
      const b = document.getElementById("spinBtn");
      for (let i = 0; i < 12; i++) b.click();
    })()`);
    // Read the lifecycle straight away — the burst must have put exactly one
    // round in flight, and with turbo on it can finish in well under a second.
    check("base game: the burst put a round in flight",
      await ev(`window.__spinLifecycle.inFlight`) === true);
    await waitForSpins(1);
    await sleep(600); // give any leaked second spin time to show up
    check("base game: 12 rapid presses resolve exactly 1 spin (#28)",
      calls.spin === 1, `resolved spins=${calls.spin}`);
    check("base game: the burst round settles to idle", await waitIdle());
    check("base game: still only 1 spin after the round settled",
      calls.spin === 1, `resolved spins=${calls.spin}`);

    // ── 2. a normal single press still works ─────────────────────────────────
    calls.spin = 0;
    await ev(`document.getElementById("spinBtn").click();`);
    check("base game: a single press does start a spin", await waitForSpins(1) === 1,
      `resolved spins=${calls.spin}`);
    await waitIdle();

    // ── 3. BONUS: buy the feature, then hammer spin all the way through ──────
    // Every press during the bought round and during free-spin autoplay must be
    // a fast-stop. The only spin requests allowed are the free spins themselves.
    calls.spin = 0;
    calls.buy = 0;
    const statsBefore = await ev(`window.__spinLifecycle.stats`);
    const manualBefore = statsBefore.startedManual;
    const autoBefore = statsBefore.startedAuto;
    const blockedBefore = statsBefore.blockedPresses;
    // The buy confirm is a modal; accept it as soon as it appears.
    await ev(`(() => {
      document.getElementById("buyFreeBtn").click();
      return true;
    })()`);
    let confirmed = false;
    for (let i = 0; i < 60; i++) {
      await sleep(100);
      confirmed = await ev(`(() => {
        const btn = document.querySelector("#buyConfirmModal button[data-confirm], #buyConfirmModal .confirm-yes, #buyConfirmModal .btn-confirm");
        if (btn) { btn.click(); return true; }
        // Fall back to any visible modal button whose label reads as confirmation.
        const modal = document.querySelector(".modal:not(.hidden), .confirm-modal:not(.hidden)");
        if (!modal) return false;
        const b = [...modal.querySelectorAll("button")]
          .find((x) => /buy|confirm|yes|ok/i.test(x.textContent || ""));
        if (b) { b.click(); return true; }
        return false;
      })()`).catch(() => false);
      if (confirmed) break;
    }
    check("bonus: buy-feature confirm accepted", confirmed);

    // Hammer the spin button for the whole bonus while it plays out.
    let hammered = 0;
    let freeSpinsSeen = 0;
    for (let i = 0; i < 400; i++) {
      await sleep(100);
      await ev(`document.getElementById("spinBtn").click();`).catch(() => {});
      hammered += 1;
      // A feature panel gates the bonus start/end — dismiss it so the run proceeds.
      await dismissFeature();
      const left = await ev(`Number(document.getElementById("freeSpins").textContent || "0")`).catch(() => 0);
      if (left > 0) freeSpinsSeen = Math.max(freeSpinsSeen, left);
      // Done when the bonus has run and free spins are exhausted.
      if (freeSpinsSeen > 0 && left === 0) break;
    }
    await sleep(1500);

    const stats = await ev(`window.__spinLifecycle.stats`);
    const manualStarts = stats.startedManual - manualBefore;
    console.log(`  ..  bonus summary: awarded>=${freeSpinsSeen} resolved=${calls.spin} `
      + `presses=${hammered} manualStarts=${manualStarts} blocked=${stats.blockedPresses - blockedBefore}`);

    check("bonus: the feature actually ran and awarded free spins", freeSpinsSeen > 0,
      `maxFreeSpins=${freeSpinsSeen}`);
    // THE #28 INVARIANT. Not "resolved <= awarded" — retriggers legitimately add
    // free spins mid-bonus, so the resolved count is not a fixed number. What
    // must hold is that none of those rounds was started by a PRESS: every spin
    // in a bonus belongs to the free-spin autoplay.
    check(`bonus: ${hammered} presses during the bonus started 0 rounds (#28)`,
      manualStarts === 0, `manual starts=${manualStarts}`);
    check("bonus: those presses were all seen and blocked, not dropped",
      stats.blockedPresses - blockedBefore > 0,
      `blocked=${stats.blockedPresses - blockedBefore}`);
    check("bonus: every round that ran came from the free-spin autoplay",
      calls.spin > 0 && stats.startedAuto - autoBefore === calls.spin,
      `autoStarts=${stats.startedAuto - autoBefore} resolved=${calls.spin}`);
    check("bonus: the game returned to an idle, spinnable state",
      await ev(`!document.getElementById("spinBtn").disabled`) === true);

    // ── 4. after the bonus, a fresh press must still start a spin ────────────
    check("the bonus lifecycle released cleanly", await waitIdle());
    const beforeFinal = calls.spin;
    await ev(`document.getElementById("spinBtn").click();`);
    check("after the bonus completes, a press starts a new spin again",
      await waitForSpins(beforeFinal + 1) === beforeFinal + 1,
      `${beforeFinal} -> ${calls.spin}`);
  } finally {
    chrome.kill();
    server.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
  }

  if (failures === 0) { console.log("\nspin-e2e: PASS"); process.exit(0); }
  console.error(`\nspin-e2e: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(2); });
