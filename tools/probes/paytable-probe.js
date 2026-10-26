// Displayed pays = paid pays (certification item O2). Loads the real client in
// headless Chrome, opens the player Info modal and reads the rendered Base game
// and Free Spins paytables for every RTP profile and every allowed bet. Each
// cell is compared with what the engine actually pays: evaluateWaysWin() on a
// board holding exactly that many symbols, then scaled and rounded the way
// spin-engine.js does (round(sequenceWin × scaler); scatter round(pay × bet × scaler)).
// Also checks the RTP lines show the active profile's declarations and that
// the rules copy carries none of the stale Banana X / 5x4 / Apex Wild / market text.
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn } = require("child_process");

// Temp Chrome profiles: removed on exit so probe runs do not pile up in the OS temp dir.
const _tempProfiles = [];
function tempProfile(prefix) {
  // A profile Chrome still held at our exit (Windows keeps child processes alive a
  // few seconds after kill) is swept by the next run, once it is over an hour old.
  if (!_tempProfiles.length) {
    for (const name of fs.readdirSync(os.tmpdir())) {
      if (!name.startsWith(prefix) || name.startsWith(`${prefix}out-`)) continue; // keep screenshot output dirs
      const full = path.join(os.tmpdir(), name);
      try { if (Date.now() - fs.statSync(full).mtimeMs > 3600e3) fs.rmSync(full, { recursive: true, force: true }); } catch { /* in use */ }
    }
  }
  const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  _tempProfiles.push(d);
  return d;
}
process.on("exit", () => {
  // Chrome may still be releasing its files just after kill(): retry briefly.
  for (const d of _tempProfiles) { try { fs.rmSync(d, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }); } catch { /* best effort */ } }
});

// Usage: node tools/probes/paytable-probe.js [repoRoot]
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, "..", ".."), "client");
const PORT = 3128;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".webp": "image/webp", ".png": "image/png", ".woff2": "font/woff2", ".wav": "audio/wav" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  const rel = url === "/" ? "index.html" : decodeURIComponent(url).replace(/^\/+/, "");
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  fs.readFile(file, (err, buf) => {
    if (err) return res.writeHead(404).end();
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
});

function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 1; const pending = new Map(); const listeners = [];
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method) listeners.forEach((l) => l(m));
    const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
    m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
  });
  return {
    ready: new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); }),
    send: (method, params = {}) => { const i = id++; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((resolve, reject) => pending.set(i, { resolve, reject })); },
    on: (fn) => listeners.push(fn),
    close: () => ws.close()
  };
}
async function evaluate(cdp, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "eval failed");
  return r.result.value;
}

// Runs in the page: the rendered tables vs. the engine, for one profile.
const PAGE_CHECK = (gameId) => `(async () => {
  const engine = await getEngine();
  const { regularSymbols } = engine.ctx.tables;
  const payoutsCtx = engine.ctx.payoutsCtx;
  const rules = engine.getDecoratedRules();
  const profile = engine.getRtpProfile(${JSON.stringify(gameId)});
  const sc = window.SlotEngine.CrazyMode.getPayoutScalers({ crazyMode: false, profile });
  const groups = rules.symbol_payout_display.groups;
  const scatterRaw = rules.symbol_payout_display.symbols.find((s) => s.symbol === "SCATTER").payouts;
  const tiers = Object.keys(scatterRaw).map(Number).sort((a, b) => a - b);
  const board = (code, n) => {
    const others = regularSymbols.filter((s) => s !== code);
    const cells = Array.from({ length: 30 }, (_, i) => (i < n ? code : others[i % others.length]));
    return Array.from({ length: 5 }, (_, r) => cells.slice(r * 6, r * 6 + 6));
  };
  // What the engine pays for that board (spin-engine.js scaling + rounding).
  const paid = (code, n, bet, scaler) => Number((payoutsCtx.evaluateWaysWin(board(code, n), bet).total * scaler).toFixed(2));
  const paidScatter = (n, bet, scaler) => Number((payoutsCtx.scatterPayoutByCount(n) * bet * scaler).toFixed(2));

  state.gameId = ${JSON.stringify(gameId)};
  const mismatches = [];
  let cells = 0;
  const bets = [...el.betSelect.options].map((o) => Number(o.value));
  for (const bet of bets) {
    el.betSelect.value = String(bet);
    el.betSelect.dispatchEvent(new Event("change"));
    const tables = [...el.psInfoModal.querySelectorAll(".ps-paytable__table")]; // the rules template the Info sheet shows
    if (tables.length !== 2) { mismatches.push("expected 2 tables, got " + tables.length); break; }
    [[tables[0], sc.basePayoutScaler], [tables[1], sc.freeSpinPayoutScaler]].forEach(([table, scaler]) => {
      const rows = [...table.querySelectorAll("tr")].slice(1).map((tr) => [...tr.children].map((c) => c.textContent));
      for (const row of rows) {
        if (row[0] === "Scatter") {
          tiers.forEach((t, i) => {
            const want = paidScatter(t, bet, scaler).toFixed(2);
            const label = i === tiers.length - 1 ? t + "+" : String(t);
            cells += 1;
            if (row[i + 1] !== label + ": " + want) mismatches.push(table.caption.textContent + " bet " + bet + " scatter " + row[i + 1] + " != " + label + ": " + want);
          });
          // the top tier is a lower bound: 7+ pays what 6 pays
          if (paidScatter(tiers[tiers.length - 1] + 1, bet, scaler) !== paidScatter(tiers[tiers.length - 1], bet, scaler)) mismatches.push("scatter top tier not a lower bound");
          continue;
        }
        // The row shows the player-facing name (main.js SYMBOL_NAMES); its id comes from the rules label.
        const shown = typeof SYMBOL_NAMES === "object" ? Object.keys(SYMBOL_NAMES).find((k) => SYMBOL_NAMES[k] === row[0]) : null;
        const code = (shown || row[0]).toUpperCase().replace(/\\s+/g, "_");
        if (!regularSymbols.includes(code)) { mismatches.push("unknown symbol row " + row[0]); continue; }
        groups.forEach((g, i) => {
          for (const n of [g.match_min, g.match_max === 30 ? 30 : g.match_max]) {
            const want = paid(code, n, bet, scaler).toFixed(2);
            cells += 1;
            if (row[i + 1] !== want) mismatches.push(table.caption.textContent + " bet " + bet + " " + code + " x" + n + ": shown " + row[i + 1] + " pays " + want);
          }
        });
      }
    });
  }
  const rtp = [...el.psInfoModal.querySelectorAll(".ps-rtp li")].map((li) => li.textContent);
  const meta = el.psInfoModal.querySelector(".ps-rules-meta")?.textContent || "";
  return { cells, bets: bets.length, mismatches: mismatches.slice(0, 20), mismatchCount: mismatches.length, rtp, meta,
    declared: [profile.theoretical_percent, profile.ante_bet_percent, profile.buy_free_spins_percent] };
})()`;

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const chrome = spawn(process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe", [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${tempProfile("vx-probe-")}`,
    "--no-first-run", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const base = await new Promise((resolve) => {
    let buf = "";
    chrome.stderr.on("data", (d) => { buf += d; const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//); if (m) resolve(`http://127.0.0.1:${m[1]}`); });
  });
  const target = await (await fetch(`${base}/json/new?about:blank`, { method: "PUT" })).json();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;
  const logs = [];
  cdp.on((m) => {
    if (m.method === "Runtime.consoleAPICalled" && ["warning", "error"].includes(m.params.type))
      logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    if (m.method === "Runtime.exceptionThrown") logs.push(`exception: ${m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text}`);
  });
  await cdp.send("Runtime.enable"); await cdp.send("Page.enable");

  let failed = false;
  const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) failed = true; };

  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await cdp.send("Page.navigate", { url: `http://127.0.0.1:${PORT}/index.html?reset` });
  for (let i = 0; i < 100; i++) { await sleep(100); if (await evaluate(cdp, `typeof state !== "undefined" && !!(state.sessionId && state.rules)`)) break; }
  await sleep(500);

  // Player path: public mode, the Info button opens the shell's Info sheet with the rules.
  const opened = await evaluate(cdp, `(() => { document.getElementById("psInfoBtn").click();
    const s = [...document.querySelectorAll(".lsh-sheet")].find((x) => !x.classList.contains("hidden") && x.querySelector(".vx-info"));
    const out = { publicMode: document.body.classList.contains("public-mode"), visible: Boolean(s) && s.getClientRects().length > 0,
      tables: s ? s.querySelectorAll(".ps-paytable__table").length : 0, text: s ? s.textContent : "" };
    VxNotify.get("lsh-info")?.close("close");
    return out; })()`);
  check("player Info sheet shows the paytable (public mode)", opened.publicMode && opened.visible && opened.tables === 2, `tables=${opened.tables}`);
  const stale = ["banana", "5 reels", "4 rows", "apex", "live market", "ontario", "malta", "united kingdom", "coming soon"]
    .filter((w) => opened.text.toLowerCase().includes(w));
  check("rules copy has no stale Banana X / 5x4 / Apex Wild / market text", stale.length === 0, stale.join(", "));
  check("rules copy describes the 6 x 5 grid and Vault 20K", /6 reels and 5 rows/.test(opened.text) && /Vault 20K/.test(opened.text));

  for (const gameId of ["bananax", "bananax_94", "bananax_92"]) {
    const r = await evaluate(cdp, PAGE_CHECK(gameId));
    check(`${gameId}: every displayed pay equals the engine pay (${r.cells} cells, ${r.bets} bets, base + free spins)`,
      r.mismatchCount === 0 && r.cells > 0, r.mismatches.join(" | "));
    const pct = (n) => `${Number(n).toFixed(2)}%`;
    const [base, ante, buy] = r.declared;
    check(`${gameId}: RTP lines show this profile's declarations (${pct(base)} / ante ${pct(ante)} / buy ${pct(buy)})`,
      r.rtp.length === 3 && r.rtp[0].includes(pct(base)) && r.rtp[1].includes(pct(ante)) && r.rtp[2].includes(pct(buy)) && r.meta.includes(pct(base)),
      JSON.stringify(r.rtp));
  }

  const relevant = logs.filter((l) => !/AudioContext|autoplay/i.test(l));
  console.log("\nconsole problems:", relevant.length ? relevant : "none");
  if (relevant.length) failed = true;

  cdp.close(); chrome.kill(); server.close();
  console.log(failed ? "\nPAYTABLE PROBE: FAIL" : "\nPROBE: PASS");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
