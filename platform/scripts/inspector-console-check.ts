/**
 * Real-browser check of the Round Inspector (headless Chrome over CDP): player search,
 * the bonus timeline (trigger ➔ free spins), per-spin tumble playback, the forensic
 * multiplier HUD, autoplay across spins, deep links, and operator scoping.
 *
 * Boots the platform in-process (in-memory), plays a player with paid spins and bought
 * bonuses, then drives /provider and /admin with stored console sessions.
 *
 *   npm run check:inspector              (screenshots go to the OS temp dir)
 *   SHOTS_DIR=./shots npm run check:inspector
 */
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

async function main(): Promise<void> {
  const chromePath = findChrome();
  if (!chromePath) { console.error("No Chrome found. Set CHROME_PATH."); process.exit(2); }

  // ── Platform in-process, with a player who played paid spins and two bonuses ──
  const logger = createLogger({ level: "silent", pretty: false, env: "test" }) as FastifyBaseLogger;
  const wallet = new SandboxWallet();
  const c = buildContainer({ launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 }, { wallet });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: `sha256:${c.engine.rulesHash()}` });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "Lumina Sandbox Casino", slug: "lumina" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1] });
  wallet.setBalance("player-7", "GEL", 1_000_000);
  const s = c.sessions.initSession(c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "player-7", currency: "GEL", origin: "casino.example.com" }));
  let k = 0;
  const triggers: string[] = [];
  for (let i = 0; i < 8; i++) await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `p${k++}` });
  // Keep buying until a bonus has a free spin that banked a multiplier (for the HUD checks).
  let bankedSpin: string | null = null;
  for (let b = 0; b < 12 && (!bankedSpin || triggers.length < 2); b++) {
    triggers.push((await c.orchestrator.buyFeature(s.id, { bet_amount: 1, idempotency_key: `buy${b}` })).round_ref);
    while (c.sessions.get(s.id).free_spins_left > 0) {
      const out = await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `fs${k++}` });
      if (!bankedSpin && Number((out.result as { multiplier_gain_applied?: number }).multiplier_gain_applied || 0) > 0) bankedSpin = out.round_ref;
    }
  }
  for (let i = 0; i < 4; i++) await c.orchestrator.spin(s.id, { bet_amount: 1, idempotency_key: `p${k++}` });
  console.log(`seeded: ${triggers.length} bonuses, banked multiplier spin: ${bankedSpin ? "yes" : "no"}`);
  const providerToken = c.adminAuth.mintToken({ admin_id: "prov", scope: "provider", role: "provider_super_admin" });
  const operatorToken = c.adminAuth.mintToken({ admin_id: "op", scope: "operator", operator_id: op.id, role: "operator_admin" });

  const app = buildApp({ logger, container: c, campaignExpiryIntervalMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;

  // ── Chrome ────────────────────────────────────────────────────────────────
  const userDataDir = mkdtempSync(join(tmpdir(), "insp-check-"));
  const chrome = spawn(chromePath, [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${userDataDir}`, "--no-first-run",
    "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--window-size=1440,1000", "about:blank"
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
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });

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
  const nextLoad = () => new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
  // Always a real page load: a navigation that only changes the #fragment is
  // same-document and fires no load event, so go via about:blank.
  const open = async (url: string) => {
    for (const u of ["about:blank", url]) {
      const loaded = nextLoad();
      await cdp.send("Page.navigate", { url: u });
      await loaded;
    }
  };
  const signIn = async (kind: "provider" | "operator", tok: string, hash: string) => {
    const page = `${base}/${kind === "provider" ? "provider" : "admin"}`;
    await open(page);
    await evaluate(`localStorage.setItem('adminToken:${kind}', ${JSON.stringify(tok)}); localStorage.setItem('adminScope:${kind}', '${kind}'); true`);
    await open(page + hash);
  };
  const shotsDir = process.env.SHOTS_DIR || tmpdir();
  const shots: string[] = [];
  const shot = async (name: string) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const file = join(shotsDir, `inspector-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push(file);
  };
  const curChip = `[...document.querySelectorAll('#tlStrip .tl-chip')].findIndex(b => b.classList.contains('cur'))`;

  try {
    await signIn("provider", providerToken, "#inspector");
    console.log("\nplayer search (provider, no operator id)");
    check("inspector opens with Round ID / Player search tabs", await waitFor(`!document.getElementById('inspectorView').hidden && document.querySelectorAll('#inspectorView [data-itab]').length === 2`));
    await evaluate(`inspectorTab('player'), true`);
    await evaluate(`(() => { document.getElementById('ipPlayer').value = 'player-7'; searchPlayerRounds(); return true; })()`);
    const total = c.reporting.listRoundsByPlayer(op.id, "player-7").length;
    check("search lists every round of the player", await waitFor(`document.querySelectorAll('#ipResults tr.clickable').length === ${total}`), String(await evaluate(`document.querySelectorAll('#ipResults tr.clickable').length`)));
    const headers = await evaluate(`[...document.querySelectorAll('#ipResults th')].map(t => t.textContent)`);
    check("columns: Timestamp, Operator, Game, Bet, Win, Bonus, Round", JSON.stringify(headers) === JSON.stringify(["Timestamp", "Operator", "Game", "Bet", "Win", "Bonus", "Round"]), JSON.stringify(headers));
    check("bonus triggers are tagged with their free-spin count", (await evaluate(`[...document.querySelectorAll('#ipResults .tag.trig')].length`)) === triggers.length);
    check("free spins are tagged k/N and marked as bonus rows", await evaluate(`(() => { const fs = [...document.querySelectorAll('#ipResults tr.in-bonus')]; return fs.length > 0 && fs.every(tr => /Free spin \\d+\\/\\d+/.test(tr.textContent)); })()`));
    check("free spins show bet as 'free'", await evaluate(`[...document.querySelectorAll('#ipResults tr.in-bonus')].every(tr => tr.cells[3].textContent === 'free')`));
    await shot("player-search");

    console.log("\nbonus timeline (dimension 1)");
    const famRef = triggers[0];
    const fam = c.ledger.featureFamily(famRef)!;
    const target = fam.rounds[3].round_ref; // free spin 3
    await evaluate(`document.querySelector('#ipResults tr[data-ref="${target}"]').click(), true`);
    check("clicking a free spin opens the bonus timeline", await waitFor(`!!document.getElementById('tlStrip')`));
    check("timeline = trigger + every free spin of the bonus", (await evaluate(`document.querySelectorAll('#tlStrip .tl-chip').length`)) === fam.rounds.length);
    check("first chip is the Trigger, the rest Free spin 1..N", await evaluate(`(() => { const b = [...document.querySelectorAll('#tlStrip .tl-chip b')].map(x => x.textContent); return b[0] === 'Trigger' && b.slice(1).every((t, i) => t === 'Free spin ' + (i + 1)); })()`));
    check("the clicked spin is the current chip", (await evaluate(curChip)) === 3);
    check("deep link updated to that spin", (await evaluate(`location.hash`)) === `#inspector?round=${encodeURIComponent(target)}`);
    await evaluate(`document.getElementById('nextSpin').click(), true`);
    check("Next spin ▶ moves along the bonus", await waitFor(`${curChip} === 4 && location.hash.endsWith('${encodeURIComponent(fam.rounds[4].round_ref)}')`));
    await evaluate(`document.querySelector('#tlStrip .tl-chip[data-spin="0"]').click(), true`);
    check("clicking a chip jumps to it (the trigger)", await waitFor(`${curChip} === 0 && document.getElementById('prevSpin').disabled`));
    check("the trigger HUD shows the bonus running win (no bank on a paid spin)", await evaluate(`(() => { const t = document.querySelector('.totals.hud').textContent; return t.includes('Bonus running win') && !t.includes('Multiplier Bank'); })()`));

    console.log("\ntumbles (dimension 2) + forensics");
    const boards = (c.ledger.getRound(fam.rounds[1].round_ref)!.outcome as { tumble_steps: unknown[] }).tumble_steps.length;
    await evaluate(`selectSpin(1), true`);
    check("a free spin's playback has one stage per stored board", await waitFor(`${curChip} === 1 && document.querySelector('.step-ctrl').textContent.includes('/ ${boards}')`));
    check("stage 1 is the spin's board (not the final board)", await evaluate(`document.querySelector('.totals:not(.hud)').textContent.includes('Spin board')`));
    check("HUD tracks the Global Multiplier Bank and the bonus running win", await evaluate(`(() => { const t = document.querySelector('.totals.hud').textContent; return t.includes('Global Multiplier Bank') && t.includes('Bonus running win'); })()`));
    check("HUD pay arithmetic matches the stored win", await evaluate(`/✓/.test(document.querySelector('.totals.hud').textContent)`));
    check("the multiplier resolution is logged", await evaluate(`!!document.querySelector('.mlog')`));
    if (bankedSpin) {
      await evaluate(`(() => { document.getElementById('roundRefInput').value = ${JSON.stringify(bankedSpin)}; lookupRound(); return true; })()`);
      check("a spin that banked multipliers says ADDED and APPLIED, with the bank before → after", await waitFor(`(() => { const m = document.querySelector('.mlog.good'); return !!m && m.textContent.includes('ADDED to the bank') && m.textContent.includes('APPLIED'); })()`));
      const lastStage = await evaluate(`boardsOf(inspectorRound).length`);
      await evaluate(`(() => { stepIdx = 0; for (let i = 0; i < ${lastStage}; i++) { if (document.querySelector('.cell.mnew')) return true; document.getElementById('nextStep').click(); } return true; })()`);
      check("newly landed multipliers are marked on the board where they landed", await waitFor(`!!document.querySelector('.cell.mnew') && document.querySelector('.totals:not(.hud)').textContent.includes('Landed here')`));
      await shot("forensics");
    } else {
      console.log("  (no free spin banked a multiplier in this run; ADDED/APPLIED check skipped)");
    }

    console.log("\nautoplay across spins");
    await evaluate(`selectSpin(1), true`);
    await waitFor(`${curChip} === 1`);
    await evaluate(`document.getElementById('playStep').click(), true`);
    check("Play bonus walks the tumbles and carries on into the next free spin", await waitFor(`${curChip} >= 2`, 20000));
    await evaluate(`document.getElementById('playStep').click(), true`);
    const pausedAt = await evaluate(curChip);
    await sleep(2200);
    check("Pause stops it", (await evaluate(curChip)) === pausedAt);
    await shot("timeline");

    console.log("\ndeep link + operator scope");
    await open(`${base}/provider#inspector?round=${encodeURIComponent(fam.rounds[2].round_ref)}`);
    check("#inspector?round=<free spin> opens straight into its bonus", await waitFor(`${curChip} === 2`));
    await signIn("operator", operatorToken, "#inspector");
    await evaluate(`inspectorTab('player'), true`);
    check("operator console hides the operator-id box", await evaluate(`getComputedStyle(document.getElementById('ipOp')).display === 'none' || document.getElementById('ipOp').offsetParent === null`));
    await evaluate(`(() => { document.getElementById('ipPlayer').value = 'player-7'; searchPlayerRounds(); return true; })()`);
    check("operator admin finds their own player's rounds", await waitFor(`document.querySelectorAll('#ipResults tr.clickable').length === ${total}`));
    check("no script errors", exceptions.length === 0, JSON.stringify(exceptions));
    console.log(`\nscreenshots: ${shots.join("\n             ")}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\ninspector-console-check: FAIL (${failures})` : "\ninspector-console-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("inspector-console-check: TIMEOUT"); process.exit(1); }, 120_000).unref();
main().catch((err) => { console.error(err); process.exit(1); });
