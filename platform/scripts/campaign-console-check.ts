/**
 * Real-browser check of the Operator Portal Campaign Manager (headless Chrome over CDP).
 *
 * Boots the platform in-process (in-memory), signs in as an operator admin through the
 * console's stored session, then: create a campaign (bet list limited to the operator's
 * allowed bets, players granted on create, one duplicate) → grant more (duplicate
 * skipped) → cancel via the confirm dialog → status filter → XSS in the campaign name
 * stays text → an operator_viewer sees no write controls. Screenshots are saved.
 *
 *   npm run check:campaigns              (screenshots go to the OS temp dir)
 *   SHOTS_DIR=./shots npm run check:campaigns
 */
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import { buildApp } from "../src/app";
import { buildContainer } from "../src/container";
import { createLogger } from "../src/lib/logger";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { CHROME_LAUNCH_BUDGET_MS, findChrome, launchHeadlessChrome } from "./support/chrome-launch";

const XSS_NAME = `<img src=x onerror="window.__pwned=1">Weekend spins`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`  ok   - ${name}`);
  else { failures += 1; console.error(`  FAIL - ${name}${detail ? `  [${detail}]` : ""}`); }
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

  // ── Platform in-process ───────────────────────────────────────────────────
  const logger = createLogger({ level: "silent", pretty: false, env: "test" }) as FastifyBaseLogger;
  const c = buildContainer({ launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 }, { wallet: new SandboxWallet() });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.1.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "Lumina Sandbox Casino", slug: "lumina" });
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  const token = (role: "operator_admin" | "operator_viewer") => c.adminAuth.mintToken({ admin_id: `adm-${role}`, scope: "operator", operator_id: op.id, role });
  const app = buildApp({ logger, container: c, campaignExpiryIntervalMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;

  // ── Chrome ────────────────────────────────────────────────────────────────
  // Hardened launch (60s port wait, one retry): platform/scripts/support/chrome-launch.ts
  const { chrome, wsBase, userDataDir } = await launchHeadlessChrome(chromePath, "camp-check-", [
    "--headless=new", "--no-first-run",
    "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1366,900", "about:blank"
  ]);
  const list = (await (await fetch(`${wsBase}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const cdp = connect(list.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await cdp.ready;
  const exceptions: string[] = [];
  cdp.on((m) => { if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 900, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr: string) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr: string, ms = 6000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(50); }
    return false;
  };
  const load = async (url: string) => {
    const loaded = new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
    await cdp.send("Page.navigate", { url });
    await loaded;
  };
  const signInAs = async (role: "operator_admin" | "operator_viewer") => {
    await evaluate(`localStorage.setItem('adminToken:operator', ${JSON.stringify(token(role))}); localStorage.setItem('adminScope:operator', 'operator'); true`);
    const loaded = new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
    await cdp.send("Page.reload", { ignoreCache: true });
    await loaded;
  };
  const shotsDir = process.env.SHOTS_DIR || tmpdir();
  const shot = async (name: string) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(shotsDir, `campaigns-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  };
  const rowCount = `document.querySelectorAll('#campTable tbody tr').length`;
  const setVal = (id: string, v: string) => `(() => { const e = document.getElementById('${id}'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('change')); return true; })()`;

  const shots: string[] = [];
  try {
    await load(`${base}/admin#campaigns`);
    await signInAs("operator_admin");

    console.log("\ncampaign list");
    check("Campaigns view opens for an operator admin", await waitFor(`!document.getElementById('campaignsView').hidden && document.querySelector('#nav [data-view="campaigns"]').classList.contains('active')`));
    check("empty state invites creating one", await waitFor(`document.getElementById('campTable').textContent.includes('No campaigns yet')`));
    check("+ New campaign is shown to an admin", (await evaluate(`!document.getElementById('campNewBtn').hidden`)) === true);

    console.log("\ncreate");
    await evaluate(`document.getElementById('campNewBtn').click(), true`);
    check("create dialog opens as a modal", await waitFor(`document.getElementById('campCreateDlg').open`));
    check("game list shows the operator's enabled game by code and currency", await waitFor(`document.getElementById('ccGame').textContent.includes('(bananax) · GEL')`));
    const bets = await evaluate(`[...document.getElementById('ccBet').options].map(o => o.textContent)`);
    check("bet choices are exactly the operator's allowed bets", JSON.stringify(bets) === JSON.stringify(["1.00 GEL", "5.00 GEL"]), JSON.stringify(bets));
    check("window defaults to now → +7 days", await evaluate(`(() => { const f = new Date(document.getElementById('ccFrom').value), t = new Date(document.getElementById('ccTo').value); return Math.round((t - f) / 864e5) === 7; })()`));
    await evaluate(`document.getElementById('campCreateForm').requestSubmit(), true`);
    check("validation: a name is required", await waitFor(`document.getElementById('ccMsg').textContent.includes('name')`));
    await evaluate(setVal("ccName", XSS_NAME));
    await evaluate(setVal("ccBet", "5"));
    await evaluate(setVal("ccSpins", "4"));
    await evaluate(setVal("ccPlayers", "p1, p2\np1"));
    shots.push(await shot("create-dialog"));
    await evaluate(`document.getElementById('campCreateForm').requestSubmit(), true`);
    check("submitting creates it and closes the dialog", await waitFor(`!document.getElementById('campCreateDlg').open && ${rowCount} === 1`));
    const row = await evaluate(`[...document.querySelector('#campTable tbody tr').cells].map(td => td.textContent.trim())`);
    check("row shows game, bet, spins, players, spins left and status", row[1].startsWith("bananax") && row[2] === "5.00" && row[3] === "4" && row[5] === "2" && row[6] === "8" && row[8] === "active", JSON.stringify(row));
    check("status line reports the grant (duplicate id collapsed)", await waitFor(`document.getElementById('campStatus').textContent.includes('Granted 2 players')`));
    check("players drawer opens on the new campaign", await waitFor(`!document.getElementById('campDrawer').hidden && document.querySelectorAll('#campDrawer tbody tr').length === 2`));

    console.log("\ngrant");
    await evaluate(`document.querySelector('#campTable [data-act="grant"]').click(), true`);
    check("grant dialog opens with the campaign terms", await waitFor(`document.getElementById('campGrantDlg').open && document.getElementById('cgInfo').textContent.includes('4 spins at 5.00 GEL')`));
    await evaluate(setVal("cgPlayers", "p2, p3"));
    await evaluate(`document.getElementById('campGrantForm').requestSubmit(), true`);
    check("new player granted, existing one skipped (never topped up)", await waitFor(`document.getElementById('cgMsg').textContent.includes('Granted 1 player.') && document.getElementById('cgMsg').textContent.includes('Already in this campaign: p2')`));
    check("table and drawer refresh to 3 players", await waitFor(`document.querySelector('#campTable tbody tr').cells[5].textContent.trim() === '3' && document.querySelectorAll('#campDrawer tbody tr').length === 3`));
    await evaluate(`document.querySelector('#campGrantDlg [data-close]').click(), true`);
    shots.push(await shot("list"));

    console.log("\ncancel");
    await evaluate(`document.querySelector('#campTable [data-act="cancel"]').click(), true`);
    check("cancel asks for confirmation, stating what is withdrawn", await waitFor(`document.getElementById('campConfirmDlg').open && document.getElementById('cfText').textContent.includes('12 unplayed spins across 3 players')`));
    await evaluate(`document.getElementById('cfConfirm').click(), true`);
    check("confirmed: campaign shows cancelled and its grants are withdrawn", await waitFor(`!document.getElementById('campConfirmDlg').open && document.querySelector('#campTable tbody tr').cells[8].textContent.trim() === 'cancelled' && document.getElementById('campStatus').textContent.includes('3 grants withdrawn')`));
    check("a cancelled campaign offers no Grant / Cancel", (await evaluate(`!document.querySelector('#campTable [data-act="grant"], #campTable [data-act="cancel"]')`)) === true);
    await evaluate(setVal("campState", "active"));
    check("status filter: no active campaigns left", await waitFor(`document.getElementById('campTable').textContent.includes('No campaigns with this status')`));
    await evaluate(setVal("campState", "cancelled"));
    check("status filter: the cancelled one is listed", await waitFor(`${rowCount} === 1`));

    console.log("\nsafety + roles");
    check("campaign name renders as text, never as markup", (await evaluate(`document.getElementById('campTable').textContent.includes('onerror=') && !document.querySelector('#campTable img')`)) === true);
    check("the XSS payload never executed", (await evaluate(`window.__pwned === undefined`)) === true);
    check("no script errors", exceptions.length === 0, JSON.stringify(exceptions));
    await signInAs("operator_viewer");
    await evaluate(setVal("campState", ""));
    check("viewer sees the list", await waitFor(`!document.getElementById('campaignsView').hidden && ${rowCount} === 1`));
    check("viewer gets no + New campaign, Grant or Cancel", (await evaluate(`document.getElementById('campNewBtn').hidden && !document.querySelector('#campTable [data-act="grant"], #campTable [data-act="cancel"]') && !!document.querySelector('#campTable [data-act="players"]')`)) === true);

    console.log(`\nscreenshots: ${shots.join("\n             ")}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\ncampaign-console-check: FAIL (${failures})` : "\ncampaign-console-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("campaign-console-check: TIMEOUT"); process.exit(1); }, 90_000 + CHROME_LAUNCH_BUDGET_MS).unref();
main().catch((err) => { console.error(err); process.exit(1); });
