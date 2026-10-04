/**
 * Real-browser check of the casino back-office (headless Chrome over CDP, no deps).
 *
 * Boots the demo-operator app in-process on an in-memory database, seeds rounds through
 * the real ledger code (one player's email is an XSS payload), then drives the page:
 * sign-in redirect → wrong password → sign in → spin history columns → Verify on Provider
 * link → XSS stays text → no CSP violations → sign out → reload stays signed out.
 *
 *   npm run check:back-office            (screenshots go to the OS temp dir)
 *   SHOTS_DIR=./shots npm run check:back-office
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app";
import { openCasinoDb } from "../src/db/database";
import { PlayerStore } from "../src/store/player-store";

const XSS_EMAIL = `"><img src=x onerror="window.__pwned=1">@evil.test`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  ok   - ${name}`);
  else { failures += 1; console.error(`  FAIL - ${name}${detail ? `  [${detail}]` : ""}`); }
}

function findChrome(): string | undefined {
  return [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  ].filter((p): p is string => Boolean(p)).find((p) => existsSync(p));
}

function connect(wsUrl: string) {
  const ws = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  const listeners: Array<(m: any) => void> = [];
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.method) { listeners.forEach((fn) => fn(msg)); return; }
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  const ready = new Promise((res, rej) => { ws.addEventListener("open", res, { once: true }); ws.addEventListener("error", rej, { once: true }); });
  return {
    ready,
    on(fn: (m: any) => void) { listeners.push(fn); },
    send(method: string, params: object = {}) {
      const id = nextId++;
      ws.send(JSON.stringify({ id, method, params }));
      return new Promise<any>((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    close() { ws.close(); }
  };
}

async function main(): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

  // ── App + seed data (real ledger code, in-memory SQLite) ──────────────────
  const db = openCasinoDb();
  const store = new PlayerStore(db);
  const app = buildApp({
    db, store, logger: false,
    config: {
      port: 0, platformUrl: "http://127.0.0.1:8080", operatorId: "op", apiKeyId: "ak", apiSecret: "as",
      webhookSecret: "ws", adminToken: "at", origin: "demo", gameCode: "bananax", currency: "GEL",
      sessionSecret: "s", startingBalance: 1000, staffUsername: "casino_admin", staffPassword: "demo123",
      providerPortalUrl: "http://localhost:8080"
    }
  });
  const alice = store.register("alice@example.com", "x", 500);
  const mallory = store.register(XSS_EMAIL, "x", 500);
  const move = (p: { id: string }, ref: string, bet: number, win: number, roundType = "paid") => {
    if (bet > 0) store.debit({ playerId: p.id, idempotencyKey: `${ref}:debit`, amount: bet, currency: "GEL", roundRef: ref, gameCode: "bananax", roundType });
    if (win > 0) store.credit({ playerId: p.id, idempotencyKey: `${ref}:credit`, amount: win, currency: "GEL", roundRef: ref, gameCode: "bananax", roundType });
  };
  move(alice, "r_paid_loss", 1, 0);
  move(alice, "r_paid_win", 1, 12.4);
  move(alice, "r_free_spin", 0, 3.75, "free_spin");
  move(mallory, "r_xss_round", 2, 0);
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;

  // ── Chrome ────────────────────────────────────────────────────────────────
  const userDataDir = mkdtempSync(join(tmpdir(), "bo-check-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--no-first-run",
    "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1366,860", "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });
  const wsBase = await new Promise<string>((resolve, reject) => {
    let buf = "";
    const t = setTimeout(() => reject(new Error("chrome debug port not reported")), 20000);
    chrome.stderr!.on("data", (d) => {
      buf += d.toString();
      const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(t); resolve(`http://127.0.0.1:${m[1]}`); }
    });
  });
  const list = (await (await fetch(`${wsBase}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const cdp = connect(list.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await cdp.ready;

  const exceptions: string[] = [];
  cdp.on((m) => { if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 860, deviceScaleFactor: 1, mobile: false });
  // Runs before page scripts on every load (CDP-injected, so the page's CSP does not apply to it).
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: "window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));"
  });

  const evaluate = async (expr: string) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr: string, ms = 5000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(50); }
    return false;
  };
  const goto = async (url: string) => {
    const loaded = new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
    await cdp.send("Page.navigate", { url });
    await loaded;
  };
  const shotsDir = process.env.SHOTS_DIR || tmpdir();
  const shot = async (name: string) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(shotsDir, `back-office-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  };
  const visible = (id: string) => `!document.getElementById('${id}').hidden`;
  const signIn = (u: string, p: string) => evaluate(`(() => {
    document.getElementById('loginUser').value = ${JSON.stringify(u)};
    document.getElementById('loginPass').value = ${JSON.stringify(p)};
    document.getElementById('loginForm').requestSubmit(); return true; })()`);

  try {
    console.log("\nsign-in gate");
    const res = await fetch(`${base}/back-office`);
    const csp = res.headers.get("content-security-policy") || "";
    check("page is served with a nonce CSP, frame-ancestors 'none', no-store", /script-src 'nonce-[^']+'/.test(csp) && csp.includes("frame-ancestors 'none'") && res.headers.get("cache-control") === "no-store", csp);
    await goto(`${base}/back-office`);
    check("no session → the sign-in view, not the dashboard", await waitFor(`${visible("loginView")} && !(${visible("appView")})`));
    const loginShot = await shot("login");

    await signIn("casino_admin", "wrong-password");
    check("wrong password → error message, still signed out", await waitFor(`document.getElementById('loginMsg').textContent.includes('Wrong username or password')`) && !(await evaluate(visible("appView"))));

    console.log("\nspin history");
    await signIn("casino_admin", "demo123");
    check("right credentials → dashboard on Spin history", await waitFor(`${visible("appView")} && ${visible("roundsView")}`));
    check("seeded rounds are listed", await waitFor(`document.querySelectorAll('#roundsBody tr').length === 4`), String(await evaluate(`document.querySelectorAll('#roundsBody tr').length`)));
    const headers = await evaluate(`[...document.querySelectorAll('#roundsView thead th')].map(th => th.textContent.trim())`);
    check("columns: Timestamp, Player ID, Game, Round, Bet, Win, Verify", JSON.stringify(headers) === JSON.stringify(["Timestamp", "Player ID", "Game", "Round", "Bet", "Win", "Verify"]), JSON.stringify(headers));
    const winRow = await evaluate(`(() => { const a = document.querySelector('a[href$="round=r_paid_win"]'); const tr = a && a.closest('tr');
      return tr && { cells: [...tr.cells].map(td => td.textContent.trim()), href: a.href, target: a.target, rel: a.rel }; })()`);
    check("a winning round shows its game, bet and win", !!winRow && winRow.cells[2] === "bananax" && winRow.cells[4] === "1.00 GEL" && winRow.cells[5] === "12.40 GEL", JSON.stringify(winRow?.cells));
    check("Verify on Provider → the provider's Round Inspector deep link", winRow?.href === "http://localhost:8080/admin#inspector?round=r_paid_win", winRow?.href);
    check("…opens in a new tab with no opener and no referrer", winRow?.target === "_blank" && /noopener/.test(winRow?.rel) && /noreferrer/.test(winRow?.rel), `${winRow?.target} ${winRow?.rel}`);
    check("every row has a Verify on Provider link", await evaluate(`[...document.querySelectorAll('#roundsBody tr')].every(tr => tr.querySelector('a.btn-verify[href*="/admin#inspector?round="]'))`));
    const freeSpin = await evaluate(`(() => { const tr = document.querySelector('a[href$="round=r_free_spin"]').closest('tr'); return [...tr.cells].map(td => td.textContent.trim()); })()`);
    check("a free spin shows bet 0.00 and its win, badged Free spin", freeSpin[4] === "0.00 GEL" && freeSpin[5] === "3.75 GEL" && freeSpin[3].startsWith("Free spin"), JSON.stringify(freeSpin));
    await evaluate(`(() => { const f = document.getElementById('roundsFilter'); f.value = 'alice'; f.dispatchEvent(new Event('input')); return true; })()`);
    check("filter narrows the table", await waitFor(`document.querySelectorAll('#roundsBody tr').length === 3`));
    await evaluate(`(() => { const f = document.getElementById('roundsFilter'); f.value = ''; f.dispatchEvent(new Event('input')); return true; })()`);
    const dashShot = await shot("spin-history");

    console.log("\nsafety");
    check("player-supplied email renders as text, never as markup", await evaluate(`document.getElementById('roundsBody').textContent.includes('onerror=') && !document.querySelector('#roundsBody img')`));
    check("the XSS payload never executed", (await evaluate(`window.__pwned === undefined`)) === true);
    await evaluate(`document.querySelector('#nav [data-view="players"]').click(), true`);
    check("Players tab lists both players (email escaped there too)", await waitFor(`document.querySelectorAll('#playersBody tr').length === 2 && !document.querySelector('#playersBody img')`));
    await evaluate(`document.querySelector('#nav [data-view="providers"]').click(), true`);
    check("Providers tab shows masked secrets only", await waitFor(`document.getElementById('providersBody').textContent.includes('••••')`) && !(await evaluate(`document.body.textContent.includes('"ws"')`)));
    const violations = await evaluate(`window.__csp`);
    check("no CSP violations, no script errors", violations.length === 0 && exceptions.length === 0, JSON.stringify({ violations, exceptions }));

    console.log("\nsign out");
    await evaluate(`document.getElementById('logoutBtn').click(), true`);
    check("sign out → back to the sign-in view", await waitFor(`${visible("loginView")} && document.getElementById('loginMsg').textContent.includes('signed out')`));
    const reloaded = new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
    await cdp.send("Page.reload", { ignoreCache: true });
    await reloaded;
    check("after reload the session is gone (cookie revoked server-side)", await waitFor(`${visible("loginView")} && !(${visible("appView")})`));

    console.log(`\nscreenshots: ${loginShot}\n             ${dashShot}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    db.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\nback-office-check: FAIL (${failures})` : "\nback-office-check: PASS");
  process.exit(failures ? 1 : 0);
}

// Never hang silently (e.g. a navigation that fires no load event).
setTimeout(() => { console.error("back-office-check: TIMEOUT"); process.exit(1); }, 60_000).unref();
main().catch((err) => { console.error(err); process.exit(1); });
