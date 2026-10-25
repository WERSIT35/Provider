// Shared by the Lumina probes (no-celebrate, lumina-parity, market-switches).
/** Wait until the round (or feature) is over, in short steps: no single browser call may run
 *  long (puppeteer's protocol timeout is 180 s). Feature intros and outros wait for a tap
 *  (the shell's panel, Vault 20K's feature screen): the probe taps through them, as a player would. */
export async function untilIdle(page, ms) {
  const t0 = Date.now();
  for (;;) {
    const busy = await page.evaluate(() => {
      const N = window.VxNotify;
      const panel = document.querySelector(".lsh-panel:not(.hidden)");
      if (panel) N?.close?.("lsh-panel", "continue");
      const fs = document.getElementById("featureScreen");
      if (fs && !fs.hidden && fs.getAttribute("aria-hidden") !== "true" && getComputedStyle(fs).display !== "none") N?.close?.("feature", "dismissed");
      // A choice the round waits for (Relic Forge's relic draft before each Forge spin): the
      // game is idle meanwhile and a Spin press only reopens it, so take its default choice.
      if (N?.isOpen?.("lsh-ask")) { document.querySelector(".lsh-sheet:not(.hidden) [data-vx-autofocus]")?.click(); return true; }
      return Boolean(window.__spinLifecycle?.inFlight);
    });
    if (!busy) return;
    if (Date.now() - t0 > ms) throw new Error(`round still in flight after ${ms} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}
