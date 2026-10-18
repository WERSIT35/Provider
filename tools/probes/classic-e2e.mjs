// classic-5x3 client in real Chrome against the real platform (bench server, sandbox wallet).
//   CHROME_PATH=… node tools/probes/classic-e2e.mjs        (needs `npm --prefix platform run build`)
// Checks the round lifecycle the way tools/spin-e2e.js checks Vault 20K's:
//  1. 12 rapid presses resolve exactly ONE spin;
//  2. hammering Spin through a whole Free Spins feature starts NO round of its own (every
//     feature spin comes from the feature run, the bet stays locked);
//  3. an unlimited autoplay with a 1x-bet loss limit stops on its own once the loss reaches it;
//  4. there is no buy and no ante control.
// Exits 1 on any failure.
import puppeteer from "puppeteer-core";
import { startServer, launchPlayer, sleep } from "../bench/common.mjs";

let failed = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "ok  " : "FAIL"} - ${name}${!ok && detail ? `  [${detail}]` : ""}`); if (!ok) failed++; };
const srv = await startServer({ BENCH_PORT: process.env.BENCH_PORT || "8193" });
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH, args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  const spins = [];
  page.on("request", (r) => { if (r.url().includes("/game/v1/spin")) spins.push(Date.now()); });
  await page.goto(`http://127.0.0.1:${srv.cred.port}/play?lt=${await launchPlayer(srv.cred, `classic-e2e-${Date.now()}`, "classic-5x3")}`);
  await page.waitForFunction(() => document.body.classList.contains("app-ready") && window.__spinLifecycle, { timeout: 60000 });
  const idle = () => page.waitForFunction(() => !window.__spinLifecycle.inFlight, { timeout: 120000, polling: 50 });
  // The shell's speed button cycles normal → quick → turbo.
  await page.click("#turboBtn"); await page.click("#turboBtn");

  // 1. a burst of presses = one spin
  spins.length = 0;
  await page.evaluate(() => { const b = document.getElementById("spinBtn"); for (let i = 0; i < 12; i++) { b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); } });
  await idle(); await sleep(400);
  check("12 rapid presses resolve exactly 1 spin", spins.length === 1, `spins=${spins.length}`);

  // 2. play until a feature triggers, then hammer Spin through it
  let feature = false;
  for (let i = 0; i < 2000 && !feature; i++) {
    await page.click("#spinBtn");
    await page.waitForFunction(() => window.__spinLifecycle.inFlight, { timeout: 5000, polling: 16 }).catch(() => {});
    // the feature run starts right after the trigger round: watch for it while that round lands
    feature = await page.waitForFunction(() => document.querySelector(".lsh.is-feature") !== null, { timeout: 4000, polling: 50 }).then(() => true, () => false);
    if (!feature) await idle();
  }
  check("a Free Spins feature triggered", feature);
  if (feature) {
    const before = await page.evaluate(() => ({ ...window.__spinLifecycle.stats }));
    let presses = 0;
    // Through the whole feature: its intro and outro panels too (a press there only continues).
    while (await page.evaluate(() => window.__spinLifecycle.inFlight || document.querySelector(".lsh.is-feature") !== null)) { await page.evaluate(() => { const b = document.getElementById("spinBtn"); b.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 })); b.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0 })); }); presses++; await sleep(120); }
    const after = await page.evaluate(() => ({ ...window.__spinLifecycle.stats }));
    check(`${presses} presses during the feature started 0 rounds of their own`, after.startedManual === before.startedManual, `manual ${before.startedManual} -> ${after.startedManual}`);
    check("the feature's spins all came from the feature run", after.startedAuto > before.startedAuto, `auto ${before.startedAuto} -> ${after.startedAuto}`);
  }

  // 3. autoplay loss limit (a 1x-bet option added for the test; the player's list starts at 10x)
  await idle();
  await page.click("#autoplayBtn");
  await page.waitForSelector('[data-limit="loss"]', { visible: true });
  await page.evaluate(() => { const sel = document.querySelector('[data-limit="loss"]'); sel.add(new Option("test", "1")); sel.value = "1"; document.querySelector('[data-auto="inf"]').click(); });
  await page.waitForFunction(() => !window.__spinLifecycle.autoplayActive && !window.__spinLifecycle.inFlight, { timeout: 180000, polling: 100 });
  const msg = await page.$eval("#psTickerText", (e) => e.textContent);
  check("an unlimited autoplay with a loss limit stops on its own", /loss limit/.test(msg), msg);

  // 4. no buy, no ante
  check("no buy or ante control", await page.evaluate(() => [...document.querySelectorAll("#buyFreeBtn, #anteToggle")].every((e) => !e.getClientRects().length)));
} finally {
  await browser.close();
  srv.child.kill();
}
console.log(`\nclassic-e2e: ${failed ? `FAIL (${failed})` : "PASS"}`);
process.exit(failed ? 1 : 0);
