/**
 * Real-browser check of the Promotions views (Tournaments, Prize Drops, Promo Win Search)
 * in the Operator Portal (headless Chrome over CDP).
 *
 * Boots the platform in-process (in-memory), signs in as an operator admin, then: create a
 * tournament (validation, XSS in the name stays text) → its drawer shows an empty live
 * board → create a prize drop from "amount x count" tiers → cancel it via the in-page
 * dialog → Promo Win Search finds a seeded prize by player → an operator_viewer sees no
 * write controls. Screenshots are saved.
 *
 *   npm run check:promotions             (screenshots go to the OS temp dir)
 *   SHOTS_DIR=./shots npm run check:promotions
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

const XSS_NAME = `<img src=x onerror="window.__pwned=1">Weekend race`;
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
  const app = buildApp({ logger, container: c, campaignExpiryIntervalMs: 0, promotionsIntervalMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;
  await sleep(500);
  // A pending prize to search for, seeded after the job's start-up sweep (interval 0 = no
  // further sweeps), so it stays unpaid: no money moves in this check.
  const seedDrop = c.promotions.createPrizeDrop({ operator_id: op.id, name: "Seeded drop", game_codes: ["bananax"], currency: "GEL", min_bet: 0, odds: 1,
    prizes: [{ amount: 25, count: 1 }, { amount: 5, count: 3 }], created_by: "check", starts_at: new Date(Date.now() - 3_600_000).toISOString(), ends_at: new Date(Date.now() + 3_600_000).toISOString() });
  c.promotions.awardDrop(seedDrop.id, { operator_player_id: "player-77", round_ref: "rnd_seeded" }, () => 0);

  // ── Chrome ────────────────────────────────────────────────────────────────
  // Hardened launch (60s port wait, one retry): platform/scripts/support/chrome-launch.ts
  const { chrome, wsBase, userDataDir } = await launchHeadlessChrome(chromePath, "promo-check-", [
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
    const file = join(shotsDir, `promotions-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  };
  const setVal = (id: string, v: string) => `(() => { const e = document.getElementById('${id}'); e.value = ${JSON.stringify(v)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`;
  const rows = (id: string) => `document.querySelectorAll('#${id} tr.clickable').length`;

  const shots: string[] = [];
  try {
    await load(`${base}/admin#tournaments`);
    await signInAs("operator_admin");

    console.log("\nnav");
    check("Promotions group lists Free Rounds, Tournaments, Prize Drops, Promo Win Search", (await evaluate(`['campaigns','tournaments','prizeDrops','promoWins'].every(v => !!document.querySelector('#nav [data-view="' + v + '"]'))`)) === true);
    check("Tournaments view opens", await waitFor(`!document.getElementById('tournamentsView').hidden && document.querySelector('#nav [data-view="tournaments"]').classList.contains('active')`));
    check("empty state invites creating one", await waitFor(`document.getElementById('tournamentsTable').textContent.includes('None yet. Create one')`));
    check("+ New tournament is shown to an admin", (await evaluate(`!document.getElementById('tournamentsNew').hidden`)) === true);

    console.log("\ntournament");
    await evaluate(`document.getElementById('tournamentsNew').click(), true`);
    check("dialog opens with tournament fields only", await waitFor(`document.getElementById('promoDlg').open && document.getElementById('pfMetric').offsetParent !== null && document.getElementById('pfOdds').offsetParent === null && document.getElementById('pfTiers').offsetParent === null`));
    check("window defaults to now → +7 days", await evaluate(`(() => { const f = new Date(document.getElementById('pfFrom').value), t = new Date(document.getElementById('pfTo').value); return Math.round((t - f) / 864e5) === 7; })()`));
    await evaluate(setVal("pfName", XSS_NAME));
    await evaluate(setVal("pfGames", "bananax"));
    await evaluate(setVal("pfCurrency", "gel"));
    await evaluate(setVal("pfPlaces", "500, 250, 100"));
    await evaluate(setVal("pfTo", "2020-01-01T00:00"));
    await evaluate(`document.getElementById('promoForm').requestSubmit(), true`);
    check("validation: the end must be after the start", await waitFor(`document.getElementById('pfMsg').textContent.includes('end must be after')`));
    await evaluate(`(() => { const d = new Date(Date.now() + 864e5); const p = (n) => String(n).padStart(2, '0'); document.getElementById('pfTo').value = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); document.getElementById('pfTo').dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
    check("fixing a field clears the message", await waitFor(`document.getElementById('pfMsg').hidden`));
    shots.push(await shot("create-dialog"));
    await evaluate(`document.getElementById('promoForm').requestSubmit(), true`);
    check("submitting creates it and closes the dialog", await waitFor(`!document.getElementById('promoDlg').open && ${rows("tournamentsTable")} === 1`));
    const trow = await evaluate(`[...document.querySelector('#tournamentsTable tr.clickable').cells].map(td => td.textContent.trim())`);
    check("the whole row fits: State is visible without scrolling", (await evaluate(`(() => { const w = document.querySelector("#tournamentsTable .tbl-wrap"); return w.scrollWidth <= w.clientWidth; })()`)) === true);
    check("row shows games, metric, prize pool, places and state", trow[1] === "bananax" && trow[2].startsWith("best round") && trow[4] === "850.00 GEL" && trow[5] === "0 / 3" && trow[6] === "running", JSON.stringify(trow));
    check("drawer opens on the new tournament with an empty live board", await waitFor(`!document.getElementById('tournamentsDrawer').hidden && document.getElementById('tournamentsDrawer').textContent.includes('Live leaderboard') && document.getElementById('tournamentsDrawer').textContent.includes('No counted rounds yet')`));
    shots.push(await shot("tournament"));

    console.log("\nprize drop");
    await evaluate(`document.querySelector('#nav [data-view="prizeDrops"]').click(), true`);
    check("Prize Drops view lists the seeded drop", await waitFor(`!document.getElementById('prizeDropsView').hidden && ${rows("prizeDropsTable")} === 1`));
    await evaluate(`document.getElementById('prizeDropsNew').click(), true`);
    check("dialog opens with drop fields only", await waitFor(`document.getElementById('promoDlg').open && document.getElementById('promoDlgTitle').textContent === 'New prize drop' && document.getElementById('pfMetric').offsetParent === null && document.getElementById('pfPlaces').offsetParent === null && document.getElementById('pfOdds').offsetParent !== null`));
    await evaluate(setVal("pfName", "Friday drops"));
    await evaluate(setVal("pfGames", "bananax"));
    await evaluate(setVal("pfCurrency", "GEL"));
    await evaluate(setVal("pfOdds", "200"));
    await evaluate(setVal("pfTiers", "fifty x ten"));
    await evaluate(`document.getElementById('promoForm').requestSubmit(), true`);
    check("validation: tiers must read 'amount x how many'", await waitFor(`document.getElementById('pfMsg').textContent.includes('amount x how many')`));
    await evaluate(setVal("pfTiers", "50 x 10, 500 x 1"));
    await evaluate(`document.getElementById('promoForm').requestSubmit(), true`);
    check("submitting creates it", await waitFor(`!document.getElementById('promoDlg').open && ${rows("prizeDropsTable")} === 2`));
    check("drawer shows the tiers and how many are left", await waitFor(`document.getElementById('prizeDropsDrawer').textContent.includes('1 × 500.00, 10 × 50.00 · 11 left')`));
    await evaluate(`document.querySelector('#prizeDropsDrawer [data-promo-cancel]').click(), true`);
    check("cancel asks in an in-page dialog", await waitFor(`document.getElementById('promoConfirmDlg').open && document.getElementById('promoConfirmText').textContent.includes('Friday drops')`));
    await evaluate(`document.getElementById('promoConfirmBtn').click(), true`);
    check("confirmed: the drop shows cancelled and offers no Cancel (the tournament keeps its own)", await waitFor(`!document.getElementById('promoConfirmDlg').open && document.getElementById('prizeDropsDrawer').textContent.includes('cancelled') && !document.querySelector('#prizeDropsDrawer [data-promo-cancel]') && !!document.querySelector('#tournamentsDrawer [data-promo-cancel]')`));

    console.log("\npromo win search");
    await evaluate(`document.querySelector('#nav [data-view="promoWins"]').click(), true`);
    await evaluate(setVal("pwPlayer", "player-77"));
    await evaluate(`document.getElementById('pwRun').click(), true`);
    check("finds the seeded prize by player, with totals", await waitFor(`document.getElementById('pwStatusLine').textContent.startsWith('1 prize') && document.getElementById('pwTable').textContent.includes('rnd_seeded') && document.getElementById('pwTable').textContent.includes('pending')`));
    check("an unpaid prize offers Pay now to an admin", (await evaluate(`!!document.querySelector('#pwTable [data-retry]')`)) === true);
    await evaluate(setVal("pwPlayer", "nobody"));
    await evaluate(`document.getElementById('pwRun').click(), true`);
    check("no match says so", await waitFor(`document.getElementById('pwTable').textContent.includes('No prizes match')`));
    await evaluate(setVal("pwPlayer", ""));
    await evaluate(`document.getElementById('pwRun').click(), true`);
    await waitFor(`!!document.querySelector('#pwTable [data-retry]')`);
    shots.push(await shot("promo-wins"));

    console.log("\nsafety + roles");
    await evaluate(`document.querySelector('#nav [data-view="tournaments"]').click(), true`);
    await waitFor(`${rows("tournamentsTable")} === 1`);
    check("promotion name renders as text, never as markup", (await evaluate(`document.getElementById('tournamentsTable').textContent.includes('onerror=') && !document.querySelector('#tournamentsTable img')`)) === true);
    check("the XSS payload never executed", (await evaluate(`window.__pwned === undefined`)) === true);
    check("no script errors", exceptions.length === 0, JSON.stringify(exceptions));
    await signInAs("operator_viewer");
    check("viewer sees the list", await waitFor(`!document.getElementById('tournamentsView').hidden && ${rows("tournamentsTable")} === 1`));
    check("viewer gets no + New buttons", (await evaluate(`document.getElementById('tournamentsNew').hidden && document.getElementById('prizeDropsNew').hidden`)) === true);
    await evaluate(`document.querySelector('#nav [data-view="promoWins"]').click(), document.getElementById('pwRun').click(), true`);
    check("viewer sees prizes but no Pay now", await waitFor(`document.getElementById('pwTable').textContent.includes('rnd_seeded') && !document.querySelector('#pwTable [data-retry]')`));

    console.log(`\nscreenshots: ${shots.join("\n             ")}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\npromotions-console-check: FAIL (${failures})` : "\npromotions-console-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("promotions-console-check: TIMEOUT"); process.exit(1); }, 90_000 + CHROME_LAUNCH_BUDGET_MS).unref();
main().catch((err) => { console.error(err); process.exit(1); });
