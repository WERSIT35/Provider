/**
 * Real-browser check: the game client + RGS restore the player's state on a page
 * refresh or a casino relaunch (headless Chrome over CDP, platform in-process).
 *
 *   A. Buy the bonus at 5.00 in the real client, reload mid-autoplay AFTER the 60s-style
 *      launch token has expired: same session, bet 5.00, controls locked, "Resuming
 *      Bonus", and the rest of the bonus plays at 5.00 — every awarded spin played.
 *   B. Mid-bonus, the casino relaunches the game (new launch URL, no saved token):
 *      the RGS resumes the same session.
 *   C. Base game: after a spin at 10.00 with ante, a reload starts on 10.00 + ante.
 *   D. A bet + ante the player chose but has not played yet survive a reload and a relaunch.
 *   E. Standalone client (no launch token): bet + ante survive a reload after a spin and
 *      without one; a reload on the bonus award screen resumes the bonus at its bet.
 *   G. Canvas context loss: the loop pauses, then on restore rebuilds its caches and
 *      re-syncs the balance from the RGS.
 *
 *   npm run check:resume              (screenshots go to the OS temp dir)
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

  const logger = createLogger({ level: "silent", pretty: false, env: "test" }) as FastifyBaseLogger;
  const wallet = new SandboxWallet();
  const c = buildContainer({ launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 100_000 }, { wallet });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Vault 20K" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: c.engine.rulesVersion(), rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: `sha256:${c.engine.rulesHash()}` });
  cfg = c.mgmt.approveMathConfig(c.mgmt.submitMathConfigForReview(cfg.id).id, "lead");
  const op = c.mgmt.createOperator({ name: "Lumina Sandbox Casino", slug: "lumina" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5, 10] });
  wallet.setBalance("player-1", "GEL", 100_000);
  const launch = (ttl: number) => c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "player-1", currency: "GEL", origin: "casino.example.com" }, ttl);
  const sessionsOfPlayer = () => c.sessions.listByOperator(op.id).filter((s) => s.operator_player_id === "player-1");

  const app = buildApp({ logger, container: c, campaignExpiryIntervalMs: 0 });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("not listening");
  const base = `http://127.0.0.1:${addr.port}`;

  // Hardened launch (60s port wait, one retry): platform/scripts/support/chrome-launch.ts
  const { chrome, wsBase, userDataDir } = await launchHeadlessChrome(chromePath, "resume-check-", [
    "--headless=new", "--no-first-run",
    "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", "--mute-audio",
    "--autoplay-policy=no-user-gesture-required", "about:blank"
  ]);
  const list = (await (await fetch(`${wsBase}/json/list`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const cdp = connect(list.find((t) => t.type === "page")!.webSocketDebuggerUrl);
  await cdp.ready;
  const exceptions: string[] = [];
  cdp.on((m) => { if (m.method === "Runtime.exceptionThrown") exceptions.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text); });
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });

  const evaluate = async (expr: string) => {
    const r = await cdp.send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  };
  const waitFor = async (expr: string, ms = 10000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (await evaluate(expr).catch(() => false)) return true; await sleep(50); }
    return false;
  };
  const nextLoad = () => new Promise<void>((res) => cdp.on((m) => { if (m.method === "Page.loadEventFired") res(); }));
  const ready = `typeof state !== 'undefined' && !!state.sessionId && document.body.classList.contains('app-ready')`;
  const open = async (url: string) => { const l = nextLoad(); await cdp.send("Page.navigate", { url }); await l; return waitFor(ready, 20000); };
  const reload = async () => { const l = nextLoad(); await cdp.send("Page.reload", {}); await l; return waitFor(ready, 20000); };
  const featureUp = `!document.getElementById('featureScreen').classList.contains('hidden')`;
  const dismiss = () => evaluate(`(() => { const f = document.getElementById('featureScreen'); if (!f.classList.contains('hidden')) f.click(); return true; })()`).catch(() => true);
  const shots: string[] = [];
  const shot = async (name: string) => {
    const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
    const file = join(process.env.SHOTS_DIR || tmpdir(), `resume-${name}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    shots.push(file);
  };
  /** Buy the feature at `bet` through the real UI; returns the trigger round_ref. */
  const buyInUi = async (bet: number) => {
    await evaluate(`(() => { el.betSelect.value = '${bet}'; el.betSelect.dispatchEvent(new Event('change')); setTurbo(true); return true; })()`);
    await evaluate(`document.getElementById('buyFreeBtn').click(), true`);
    await waitFor(`document.getElementById('buyConfirmModal') && !document.getElementById('buyConfirmModal').classList.contains('hidden')`, 5000);
    await evaluate(`document.getElementById('buyConfirmBtn').click(), true`);
    const sid = await evaluate(`state.sessionId`);
    const end = Date.now() + 20000;
    while (Date.now() < end && c.sessions.get(sid).free_spins_left === 0) await sleep(50);
    return { sid, trigger: c.ledger.lastTriggerRoundForSession(sid)!.round_ref };
  };
  /** Let the UI autoplay until `n` free spins of the bonus have been played server-side. */
  const playFreeSpins = async (trigger: string, n: number) => {
    const end = Date.now() + 30000;
    while (Date.now() < end) {
      await dismiss();
      const fam = c.ledger.featureFamily(trigger);
      if (fam && fam.rounds.length - 1 >= n) return true;
      await sleep(100);
    }
    return false;
  };
  // Done = no round in flight and no free spins left (dismissing any feature screen).
  const idle = `(() => { const f = document.getElementById('featureScreen'); if (!f.classList.contains('hidden')) f.click(); return !isRoundInFlight() && Number(document.getElementById('freeSpins').textContent || 0) === 0; })()`;
  // Turbo is a UI preference and is not restored on reload; switch it back on so a
  // resumed bonus does not take minutes at normal animation speed.
  const turbo = () => evaluate(`(setTurbo(true), true)`);
  const familyPlayedOut = (trigger: string) => {
    const fam = c.ledger.featureFamily(trigger)!;
    const awarded = fam.rounds.reduce((s, r) => s + Number((r.outcome as { free_spins_awarded?: number }).free_spins_awarded || 0), 0);
    return { fam, awarded, played: fam.rounds.length - 1 };
  };

  try {
    console.log("\nA. reload mid-bonus after the launch token expired");
    const lt = launch(6); // short-lived on purpose: the reload must not need it
    const ltIssued = Date.now();
    check("game boots from the launch URL", await open(`${base}/play?lt=${encodeURIComponent(lt)}`));
    const { sid, trigger } = await buyInUi(5);
    check("bonus bought at 5.00 through the UI", c.ledger.getRound(trigger)?.bet_amount === 5);
    check("autoplay played some free spins", await playFreeSpins(trigger, 2));
    await sleep(Math.max(0, 6500 - (Date.now() - ltIssued))); // the launch token is now expired
    check("…and the launch token has expired", ((await (await fetch(`${base}/game/v1/session/init`, { method: "POST", headers: { authorization: `Bearer ${lt}` } })).json()) as { error?: { code?: string } }).error?.code === "TOKEN_EXPIRED");
    const before = c.sessions.get(sid);
    check("player is mid-bonus server-side", before.free_spins_left > 0, String(before.free_spins_left));
    check("page reloads into the game (no launch-token error)", await reload());
    check("same RGS session (no new one opened)", (await evaluate(`state.sessionId`)) === sid && sessionsOfPlayer().length === 1);
    const live = c.sessions.get(sid);
    check("resume screen announces the remaining free spins", await waitFor(`${featureUp} && /Resuming Bonus — ${live.free_spins_left} Free Spins/.test(document.getElementById('featureScreen').textContent)`, 5000),
      String(await evaluate(`document.getElementById('featureScreen').textContent`)));
    check("bet restored to 5.00 (not reset to 1.00)", (await evaluate(`[el.betSelect.value, el.betView.textContent]`)).join() === "5,5.00");
    check("bet, ante and buy are locked before the bonus resumes", await evaluate(`el.betSelect.disabled && el.anteToggle.disabled && el.buyFreeBtn.disabled && (!el.betUpBtn || el.betUpBtn.disabled) && (!el.betDownBtn || el.betDownBtn.disabled)`));
    check("bonus HUD shows the banked multiplier", (await evaluate(`el.activeMultiplier.textContent`)).includes(String(live.free_spin_multiplier_carry)), `${await evaluate(`el.activeMultiplier.textContent`)} vs ${live.free_spin_multiplier_carry}`);
    await shot("A-resume-screen");
    await turbo();
    await dismiss();
    const doneA = await waitFor(idle, 120000);
    check("the rest of the bonus autoplays to the end", doneA && c.sessions.get(sid).free_spins_left === 0,
      JSON.stringify({ server_left: c.sessions.get(sid).free_spins_left, client: await evaluate(`({ fs: document.getElementById('freeSpins').textContent, inFlight: isRoundInFlight(), bonusAutoplay: state.bonusAutoplay, feature: document.getElementById('featureScreen').classList.contains('hidden') ? null : document.getElementById('featureScreen').textContent.trim().slice(0, 80), msgs: state.activityLog ? state.activityLog.slice(-4) : null })`) }));
    const a = familyPlayedOut(trigger);
    check("every awarded free spin was played (nothing stranded)", a.played === a.awarded, `${a.played}/${a.awarded}`);
    check("every free spin was played at the locked 5.00", a.fam.rounds.every((r) => r.bet_amount === 5));
    check("after the bonus the bet is still 5.00 and the controls are back", await waitFor(`el.betSelect.value === '5' && !el.betSelect.disabled && !el.anteToggle.disabled`, 5000));

    console.log("\nB. casino relaunch mid-bonus (new launch URL, no saved token)");
    const b = await buyInUi(5);
    check("autoplay played some free spins", await playFreeSpins(b.trigger, 2));
    check("relaunch boots", await open(`${base}/play?lt=${encodeURIComponent(launch(60))}`));
    check("the RGS resumed the same session", (await evaluate(`state.sessionId`)) === b.sid && sessionsOfPlayer().length === 1);
    check("resume screen + locked bet 5.00", await waitFor(`${featureUp} && /Resuming Bonus/.test(document.getElementById('featureScreen').textContent) && el.betSelect.value === '5' && el.betSelect.disabled`, 5000));
    await turbo();
    await dismiss();
    await waitFor(idle, 120000);
    const bb = familyPlayedOut(b.trigger);
    check("bonus completed in full after the relaunch", bb.played === bb.awarded && c.sessions.get(b.sid).free_spins_left === 0, `${bb.played}/${bb.awarded}`);

    console.log("\nC. base-game reload keeps the bet and ante");
    await evaluate(`(() => { el.betSelect.value = '10'; el.betSelect.dispatchEvent(new Event('change')); if (!el.anteToggle.checked) { el.anteToggle.checked = true; el.anteToggle.dispatchEvent(new Event('change')); } return true; })()`);
    await waitFor(idle, 120000);
    const roundsBefore = c.reporting.listRoundsByPlayer(op.id, "player-1").length;
    await waitFor(`performance.now() - state.roundSettledAt >= SPIN_SETTLE_GUARD_MS`, 5000);
    await evaluate(`document.getElementById('spinBtn').click(), true`);
    const startEnd = Date.now() + 10000;
    while (Date.now() < startEnd && c.reporting.listRoundsByPlayer(op.id, "player-1").length === roundsBefore) await sleep(50);
    await waitFor(idle, 120000);
    check("a spin at 10.00 with ante was played", c.reporting.listRoundsByPlayer(op.id, "player-1").some((r) => r.bet_amount === 10 && r.ante_enabled && !r.is_free_spin));
    check("reload boots", await reload());
    check("bet 10.00 and ante restored, no resume screen", await waitFor(`el.betSelect.value === '10' && el.betView.textContent === '10.00' && el.anteToggle.checked && !(${featureUp})`, 5000),
      JSON.stringify(await evaluate(`[el.betSelect.value, el.anteToggle.checked, ${featureUp}]`)));
    check("controls are usable", await evaluate(`!el.betSelect.disabled && !el.anteToggle.disabled`));
    await shot("C-base-reload");

    const choose = (bet: number, ante: boolean) => evaluate(`(() => { el.betSelect.value = '${bet}'; el.betSelect.dispatchEvent(new Event('change')); if (el.anteToggle.checked !== ${ante}) { el.anteToggle.checked = ${ante}; el.anteToggle.dispatchEvent(new Event('change')); } return true; })()`);
    const betIs = (bet: number, ante: boolean) => waitFor(`el.betSelect.value === '${bet}' && el.betView.textContent === '${bet.toFixed(2)}' && el.anteToggle.checked === ${ante}`, 5000);
    const shown = () => evaluate(`JSON.stringify([el.betSelect.value, el.betView.textContent, el.anteToggle.checked])`);

    console.log("\nD. a bet chosen but not yet played survives a reload and a relaunch");
    await choose(5, false); // the server's last played round is still 10.00 + ante
    check("reload boots", await reload());
    check("bet 5.00 with ante off (the player's newer choice, not the last played 10.00 + ante)", await betIs(5, false), await shown());
    check("casino relaunch boots", await open(`${base}/play?lt=${encodeURIComponent(launch(60))}`));
    check("…still 5.00 with ante off", await betIs(5, false), await shown());

    console.log("\nE. standalone client (no launch token, local engine)");
    check("standalone client boots", await open(`${base}/play/`));
    await choose(5, true);
    await turbo();
    await waitFor(`performance.now() - state.roundSettledAt >= SPIN_SETTLE_GUARD_MS`, 5000);
    await evaluate(`document.getElementById('spinBtn').click(), true`);
    await sleep(300);
    await waitFor(idle, 60000);
    check("reload boots", await reload());
    check("bet 5.00 + ante restored after a spin (was reset to 1.00)", await betIs(5, true), await shown());
    await choose(10, false);
    check("reload boots", await reload());
    check("bet 10.00, ante off restored without a spin", await betIs(10, false), await shown());
    // Buy at 2.00, then reload while the award screen is still up (before any free spin).
    await choose(2, false);
    await evaluate(`document.getElementById('buyFreeBtn').click(), true`);
    await waitFor(`!document.getElementById('buyConfirmModal').classList.contains('hidden')`, 5000);
    await evaluate(`document.getElementById('buyConfirmBtn').click(), true`);
    check("bonus awarded", await waitFor(`Number(document.getElementById('freeSpins').textContent || 0) > 0 && ${featureUp}`, 20000));
    await choose(2, false); // no-op while locked; the award screen is up
    check("reload mid-bonus boots", await reload());
    check("resume screen + bet 2.00 + controls locked (was 1.00)", await waitFor(`${featureUp} && /Resuming Bonus/.test(document.getElementById('featureScreen').textContent) && el.betSelect.value === '2' && el.betSelect.disabled`, 5000), await shown());
    // Record the bet of every free spin the local engine plays from here on.
    await evaluate(`getEngine().then((e) => { window.__bets = []; const spin = e.spin.bind(e); e.spin = (p) => { window.__bets.push(Number(p.bet_amount)); return spin(p); }; return true; })`);
    await turbo();
    await dismiss();
    check("the bonus plays to the end", await waitFor(idle, 120000));
    const bets = (await evaluate(`window.__bets`)) as number[];
    check("every resumed free spin played at 2.00", bets.length > 0 && bets.every((b) => b === 2), JSON.stringify(bets));
    await shot("E-standalone-bonus");

    console.log("\nG. canvas context loss: pause, rebuild, re-sync with the RGS");
    check("platform game boots", await open(`${base}/play?lt=${encodeURIComponent(launch(60))}`));
    await waitFor(idle, 60000);
    // Browsers have no API to force a 2D context loss; dispatch the same events.
    await evaluate(`(document.getElementById("reels").dispatchEvent(new Event("contextlost", { cancelable: true })), true)`);
    check("on loss the render loop stops", (await evaluate(`window.__reelRenderer._paused === true && contextGuard.lost === 1`)) === true);
    wallet.setBalance("player-1", "GEL", 4242); // the server's balance moved meanwhile
    await evaluate(`(document.getElementById("reels").dispatchEvent(new Event("contextrestored")), true)`);
    check("on restore it resumes and rebuilds its caches",
      await waitFor(`window.__reelRenderer._paused === false && contextGuard.restored === 1 && !!window.__reelRenderer.stageCacheFront`, 5000),
      String(await evaluate(`JSON.stringify({ paused: window.__reelRenderer._paused, restored: contextGuard.restored, sprites: window.__reelRenderer.symbolSprites.size, stage: !!window.__reelRenderer.stageCacheFront, hidden: document.hidden })`)));
    check("…and re-syncs the balance from the RGS", await waitFor(`el.balance.textContent === "4,242.00" || el.balance.textContent === "4242.00"`, 5000),
      String(await evaluate(`el.balance.textContent`)));
    check("no script errors", exceptions.length === 0, JSON.stringify(exceptions));
    console.log(`\nscreenshots: ${shots.join("\n             ")}`);
  } finally {
    cdp.close();
    chrome.kill();
    await app.close();
    try { rmSync(userDataDir, { recursive: true, force: true }); } catch { /* chrome may still hold files */ }
  }
  console.log(failures ? `\nresume-check: FAIL (${failures})` : "\nresume-check: PASS");
  process.exit(failures ? 1 : 0);
}

setTimeout(() => { console.error("resume-check: TIMEOUT"); process.exit(1); }, 240_000 + CHROME_LAUNCH_BUDGET_MS).unref();
main().catch((err) => { console.error(err); process.exit(1); });
