/**
 * Real-browser check of the demo casino's game page: the casino frames the game, the
 * postMessage bridge connects, and the casino's Pause / Mute controls drive the game.
 * Platform + casino run in-process over real HTTP (test/support/stack.ts).
 *
 *   npm run check:casino-embed
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { startStack } from "../test/support/stack";

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
  const stack = await startStack({ startingBalance: 1_000 });
  const addr = stack.demo.server.address();
  if (!addr || typeof addr === "string") throw new Error("casino not listening");
  // The casino's real address must be a registered domain, or the game refuses the frame.
  const casinoHost = `localhost:${addr.port}`;
  stack.container.mgmt.addDomain(stack.container.mgmt.listOperators()[0].id, casinoHost, "prod");

  const userDataDir = mkdtempSync(join(tmpdir(), "casino-embed-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--no-first-run",
    "--disable-gpu", "--mute-audio", "--autoplay-policy=no-user-gesture-required", "about:blank"
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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  const evaluate = async (expr: string) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr: string, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(100); }
    return false;
  };
  const text = (id: string) => evaluate(`document.getElementById('${id}').textContent`);

  try {
    const loaded = new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
    await cdp.send("Page.navigate", { url: `http://${casinoHost}/` });
    await loaded;
    await evaluate(`(document.getElementById('tabRegister').click(), document.getElementById('authEmail').value = 'embed-${Date.now()}@example.com', document.getElementById('authPassword').value = '${randomUUID()}', submitAuth(), true)`);
    check("player registered and sees the lobby", await waitFor(`!!document.querySelector('#lobbyGrid button[data-code]')`));
    await evaluate(`document.querySelector('#lobbyGrid button[data-code]').click(), true`);
    check("game iframe launched", await waitFor(`!document.getElementById('gameFrame').hidden && document.getElementById('gameFrame').src.includes('/play?lt=')`));
    check("casino receives `ready` from the game", await waitFor(`/game ready/.test(document.getElementById('gameStatus').textContent)`, 30000), String(await text("gameStatus")));
    check("Pause / Mute controls enabled", await evaluate(`!document.getElementById('gamePauseBtn').disabled && !document.getElementById('gameMuteBtn').disabled`));
    await evaluate(`document.getElementById('gameMuteBtn').click(), true`);
    check("Mute → the game answers muted", await waitFor(`document.getElementById('gameMuteBtn').textContent === 'Unmute'`));
    await evaluate(`document.getElementById('gamePauseBtn').click(), true`);
    check("Pause → the game answers paused", await waitFor(`document.getElementById('gamePauseBtn').textContent === 'Resume' && /paused/.test(document.getElementById('gameStatus').textContent)`));
    await evaluate(`document.getElementById('gamePauseBtn').click(), true`);
    check("Resume → the game answers resumed", await waitFor(`document.getElementById('gamePauseBtn').textContent === 'Pause'`));
    check("no script errors on the casino page", exceptions.length === 0, JSON.stringify(exceptions));
  } finally {
    cdp.close();
    chrome.kill();
    await stack.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\ncasino-embed-check: FAIL (${failures})` : "\ncasino-embed-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("casino-embed-check: TIMEOUT"); process.exit(1); }, 120_000).unref();
main().catch((err) => { console.error(err); process.exit(1); });
