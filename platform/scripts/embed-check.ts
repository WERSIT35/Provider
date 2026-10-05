/**
 * Real-browser check: the casino ↔ game embedding boundary (headless Chrome over CDP,
 * platform in-process, plus a tiny "casino" page that frames /play).
 *
 *   A. The registered casino (localhost:<port>) frames the game: `ready` arrives from
 *      the platform's origin with the player's balance; setMuted / getState answer.
 *   B. A spin in the game reports roundStarted → roundEnded (the RGS's round_ref and
 *      balance) → balanceChanged.
 *   C. pause holds the game: a spin press starts no round on the server; resume
 *      lets it play again. A forged command (wrong origin / not from the parent) is
 *      ignored.
 *   D. pause mid-bonus holds the free spins (they stay owed server-side); resume
 *      finishes the bonus; featureState reports start and end.
 *   E. An unregistered site (127.0.0.1:<port>, a different host) cannot frame the
 *      game at all: the browser refuses (CSP frame-ancestors), no session opens.
 *
 *   npm run check:embed
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";

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

/** The casino's game page: frames ?u=<launch url>, records every message, can send commands. */
const CASINO_PAGE = `<!doctype html><html><head><meta charset="utf-8"><title>casino</title></head>
<body style="margin:0;background:#111">
<iframe id="g" style="width:1240px;height:780px;border:0"></iframe>
<script>
  const u = new URLSearchParams(location.search).get('u');
  const target = new URL(u).origin;
  const frame = document.getElementById('g');
  window.msgs = [];
  addEventListener('message', (e) => {
    if (e.source !== frame.contentWindow) return;
    msgs.push(Object.assign({ origin: e.origin }, e.data));
  });
  window.send = (type, data) => frame.contentWindow.postMessage({ protocol: 'vault20k.embed', v: 1, type, data: data || {} }, target);
  frame.src = u;
</script></body></html>`;

async function main(): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

  const casino = createServer((_req, res) => { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); res.end(CASINO_PAGE); });
  await new Promise<void>((r) => casino.listen(0, "127.0.0.1", r));
  const casinoPort = (casino.address() as AddressInfo).port;
  const registeredHost = `localhost:${casinoPort}`; // 127.0.0.1:<port> is the SAME server, a different (unregistered) host

  const logger = createLogger({ level: "silent", pretty: false, env: "test" }) as FastifyBaseLogger;
  const wallet = new SandboxWallet();
  const c = buildContainer({ launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 }, { wallet });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: `sha256:${c.engine.rulesHash()}` });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "Lumina Sandbox Casino", slug: "lumina" });
  c.mgmt.addDomain(op.id, registeredHost, "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 10] });
  wallet.setBalance("player-1", "GEL", 100_000);
  wallet.setBalance("player-2", "GEL", 100_000);
  const launch = (player: string) => c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: player, currency: "GEL", origin: registeredHost }, 60);
  const rounds = (player: string) => c.reporting.listRoundsByPlayer(op.id, player);

  const app = buildApp({ logger, container: c, campaignExpiryIntervalMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;

  const userDataDir = mkdtempSync(join(tmpdir(), "embed-check-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--no-first-run",
    "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required",
    // Keep the cross-site iframe in the page's process so CDP can evaluate inside it.
    // Process placement only: CSP framing and postMessage origin checks are unaffected.
    "--disable-site-isolation-trials", "--disable-features=IsolateOrigins,site-per-process",
    "about:blank"
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
  const consoleText: string[] = [];
  // Execution contexts by origin: the game's is the platform origin's default context.
  const contexts = new Map<number, { origin: string; isDefault: boolean }>();
  cdp.on((m) => {
    if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text);
    if (m.method === "Runtime.executionContextCreated") {
      const ctx = m.params.context;
      contexts.set(ctx.id, { origin: ctx.origin, isDefault: Boolean(ctx.auxData?.isDefault) });
    }
    if (m.method === "Runtime.executionContextDestroyed") contexts.delete(m.params.executionContextId);
    if (m.method === "Runtime.executionContextsCleared") contexts.clear();
    if (m.method === "Log.entryAdded") consoleText.push(String(m.params.entry?.text || ""));
    if (m.method === "Runtime.consoleAPICalled") consoleText.push((m.params.args || []).map((a: any) => a.value ?? a.description ?? "").join(" "));
  });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Log.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr: string, contextId?: number) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const gameContext = (): number | undefined => {
    let id: number | undefined;
    for (const [k, v] of contexts) if (v.origin === base && v.isDefault) id = k;
    return id;
  };
  /** Evaluate inside the framed game. */
  const inGame = async (expr: string) => {
    const id = gameContext();
    if (!id) throw new Error("game frame context not found");
    return evaluate(expr, id);
  };
  const waitFor = async (fn: () => Promise<unknown>, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await fn().catch(() => false)) return true; await sleep(50); }
    return false;
  };
  const nextLoad = () => new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
  const openCasino = async (casinoHost: string, launchToken: string) => {
    const l = nextLoad();
    await cdp.send("Page.navigate", { url: `http://${casinoHost}/?u=${encodeURIComponent(`${base}/play?lt=${launchToken}`)}` });
    await l;
  };
  type Msg = { origin: string; protocol: string; v: number; type: string; data: any };
  const msgs = async (): Promise<Msg[]> => evaluate(`window.msgs || []`);
  const msgsOf = async (type: string) => (await msgs()).filter((m) => m.type === type);
  const waitMsg = async (type: string, pred: (m: Msg) => boolean = () => true, ms = 10000) => {
    let found: Msg | undefined;
    await waitFor(async () => { found = (await msgsOf(type)).find(pred); return Boolean(found); }, ms);
    return found;
  };
  const send = (type: string, data?: object) => evaluate(`window.send(${JSON.stringify(type)}, ${JSON.stringify(data ?? {})}), true`);
  const clickSpin = async () => {
    await waitFor(() => inGame(`!isRoundInFlight() && performance.now() - state.roundSettledAt >= SPIN_SETTLE_GUARD_MS`), 10000);
    await inGame(`document.getElementById('spinBtn').click(), true`);
  };
  const gameIdle = () => inGame(`(() => { const f = document.getElementById('featureScreen'); if (!f.classList.contains('hidden')) f.click(); return !isRoundInFlight() && Number(document.getElementById('freeSpins').textContent || 0) === 0; })()`);
  const shots: string[] = [];
  const shot = async (name: string) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(process.env.SHOTS_DIR || tmpdir(), `embed-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push(file);
  };

  try {
    console.log(`\nA. the registered casino (${registeredHost}) frames the game`);
    await openCasino(registeredHost, launch("player-1"));
    const ready = await waitMsg("ready", () => true, 20000);
    check("game sends `ready` to the casino", Boolean(ready));
    check("…from the platform's origin", ready?.origin === base, ready?.origin);
    check("…with the player's balance and currency", ready?.data?.balance === 100_000 && ready?.data?.currency === "GEL", JSON.stringify(ready?.data));
    check("game side: the bridge connected to the casino origin", (await inGame(`EmbedBridge.parentOrigin`)) === `http://${registeredHost}`);
    await send("setMuted", { muted: true });
    check("setMuted → `muted` answer, and the game is muted", Boolean(await waitMsg("muted", (m) => m.data?.muted === true)) && (await inGame(`Sound.isMuted()`)) === true);
    await send("getState");
    const st = await waitMsg("state");
    check("getState → `state` snapshot", st?.data?.muted === true && st?.data?.paused === false && st?.data?.in_round === false && st?.data?.balance === 100_000, JSON.stringify(st?.data));
    await inGame(`setTurbo(true), true`);

    console.log("\nB. a spin reports its lifecycle");
    const before = rounds("player-1").length;
    await clickSpin();
    const ended = await waitMsg("roundEnded", () => true, 20000);
    const last = rounds("player-1")[0];
    check("roundStarted then roundEnded", (await msgsOf("roundStarted")).length >= 1 && Boolean(ended));
    check("roundEnded carries the RGS round_ref", rounds("player-1").length === before + 1 && ended?.data?.round_ref === last?.round_ref, `${ended?.data?.round_ref} vs ${last?.round_ref}`);
    const walletBal = (await c.wallet.balance({ operatorId: op.id }, { operatorPlayerId: "player-1", currency: "GEL" })).amount;
    check("roundEnded balance = the wallet's balance", ended?.data?.balance === walletBal, `${ended?.data?.balance} vs ${walletBal}`);
    check("balanceChanged sent with the same balance", Boolean(await waitMsg("balanceChanged", (m) => m.data?.balance === walletBal)));
    await waitFor(gameIdle, 30000);

    console.log("\nC. pause / resume, and forged commands");
    await send("pause");
    check("pause → `paused: true`", Boolean(await waitMsg("paused", (m) => m.data?.paused === true)));
    const pausedAt = rounds("player-1").length;
    await clickSpin();
    await sleep(1500);
    check("a spin press while paused starts no round on the server", rounds("player-1").length === pausedAt);
    check("autoplay refuses to start while paused", await inGame(`(startAutoplay(5), !state.autoplayActive)`));
    await send("resume");
    check("resume → `paused: false`", Boolean(await waitMsg("paused", (m) => m.data?.paused === false)));
    await clickSpin();
    check("after resume a spin plays", await waitFor(async () => rounds("player-1").length === pausedAt + 1, 15000));
    await waitFor(gameIdle, 30000);
    // Forged: a message the game posts to itself (source is not the parent), and a
    // synthetic event claiming the parent as source but another origin.
    await inGame(`(window.postMessage({ protocol: 'vault20k.embed', v: 1, type: 'pause', data: {} }, '*'), true)`);
    await inGame(`(window.dispatchEvent(new MessageEvent('message', { data: { protocol: 'vault20k.embed', v: 1, type: 'pause', data: {} }, origin: 'https://evil.example', source: window.parent })), true)`);
    await sleep(500);
    check("forged pause commands are ignored", (await inGame(`state.embedPaused`)) === false);

    console.log("\nD. pause mid-bonus holds the free spins; resume finishes them");
    await inGame(`(() => { el.betSelect.value = '1'; el.betSelect.dispatchEvent(new Event('change')); return true; })()`);
    await inGame(`document.getElementById('buyFreeBtn').click(), true`);
    await waitFor(() => inGame(`!document.getElementById('buyConfirmModal').classList.contains('hidden')`), 5000);
    await inGame(`document.getElementById('buyConfirmBtn').click(), true`);
    const sid = await inGame(`state.sessionId`);
    await waitFor(async () => c.sessions.get(sid).free_spins_left > 0, 20000);
    const dismiss = () => inGame(`(() => { const f = document.getElementById('featureScreen'); if (!f.classList.contains('hidden')) f.click(); return true; })()`);
    check("featureState active:true when the bonus starts", Boolean(await waitMsg("featureState", (m) => m.data?.active === true, 20000)) || (await dismiss(), Boolean(await waitMsg("featureState", (m) => m.data?.active === true, 10000))));
    // Let a couple of free spins play, then pause.
    const trigger = c.ledger.lastTriggerRoundForSession(sid)!.round_ref;
    await waitFor(async () => { await dismiss(); return (c.ledger.featureFamily(trigger)?.rounds.length ?? 0) >= 3; }, 30000);
    await send("pause");
    await waitMsg("paused", (m) => m.data?.paused === true);
    await sleep(2500); // the spin already on screen may finish; nothing after it
    const heldAt = c.ledger.featureFamily(trigger)!.rounds.length;
    await sleep(2500);
    check("no free spin is played while paused", c.ledger.featureFamily(trigger)!.rounds.length === heldAt, `${heldAt} → ${c.ledger.featureFamily(trigger)!.rounds.length}`);
    check("the remaining free spins are still owed server-side", c.sessions.get(sid).free_spins_left > 0, String(c.sessions.get(sid).free_spins_left));
    await shot("D-paused-mid-bonus");
    await send("resume");
    const done = await waitFor(async () => { await dismiss(); return c.sessions.get(sid).free_spins_left === 0 && Boolean(await gameIdle()); }, 120000);
    check("after resume the bonus plays to the end", done, String(c.sessions.get(sid).free_spins_left));
    check("featureState active:false with the bonus win", Boolean(await waitMsg("featureState", (m) => m.data?.active === false, 10000)));
    check("no script errors in the game", exceptions.length === 0, JSON.stringify(exceptions));

    console.log(`\nE. an unregistered site (127.0.0.1:${casinoPort}) cannot frame the game`);
    const sessionsBefore = c.sessions.listByOperator(op.id).filter((s) => s.operator_player_id === "player-2").length;
    consoleText.length = 0;
    await openCasino(`127.0.0.1:${casinoPort}`, launch("player-2"));
    await sleep(5000);
    check("no `ready` from the game", (await msgsOf("ready")).length === 0, JSON.stringify(await msgs()));
    check("no game context loaded in the frame", gameContext() === undefined);
    check("no RGS session opened for the player", c.sessions.listByOperator(op.id).filter((s) => s.operator_player_id === "player-2").length === sessionsBefore);
    check("the browser cites frame-ancestors", consoleText.some((t) => /frame-ancestors/i.test(t)), consoleText.slice(-3).join(" | "));
    await shot("E-refused");
    console.log(`\nscreenshots: ${shots.join("\n             ")}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    casino.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\nembed-check: FAIL (${failures})` : "\nembed-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("embed-check: TIMEOUT"); process.exit(1); }, 300_000).unref();
main().catch((err) => { console.error(err); process.exit(1); });
