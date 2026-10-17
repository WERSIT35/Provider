/*
 * Vault 20K on the Lumina Shell (client/shell/shell.js, docs/lumina-overhaul).
 *
 * Runs before main.js: it mounts the shared player interface and moves the board
 * (.ps-center: the vault window and its canvas) into the shell's stage, so the controls
 * main.js binds by id (spinBtn, betDownBtn, betUpBtn, buyFreeBtn, psTicker, footerBalance,
 * footerBet…) are the shell's own. main.js fills `VaultShell.on` with its handlers once it
 * has loaded (the shell reads them on each event, so late binding is fine).
 *
 * Who owns what:
 *   - The shell: every control's position and look, the menu, info, autoplay and bet
 *     sheets, the speed cycle, the market's hide-in-place.
 *   - main.js: the round lifecycle, the Spin press (hold for turbo autoplay), bet ±, the
 *     buy, and the message line's state machine (it writes #psTicker; the shell's own
 *     notices go through it, `tickerFlash`).
 */
(function (root) {
  "use strict";
  const doc = root.document;
  if (!root.LuminaShell || !doc) return;
  const stage = doc.querySelector(".vault-shell .ps-center");
  const on = {};
  const late = (name) => (...args) => root.VaultShell?.[name]?.(...args);
  const api = root.LuminaShell.mount({
    game: "vault",
    stage,
    features: { buy: true, ante: true, autoplay: true, turbo: true, stop: true },
    on,
    // Vault's message line is main.js's ticker state machine: the shell's notices join it.
    tickerFlash: late("flash"),
    // The ante raises the cycle stake (the bet sheet greys bets over a market's cap).
    stakeMultiplier: () => (doc.getElementById("anteState")?.checked ? 1.25 : 1),
    // Vibration lives in main.js (Haptics); the menu shows its switch where supported.
    haptics: {
      get supported() { return Boolean(root.VaultShell?.haptics?.supported); },
      get on() { return Boolean(root.VaultShell?.haptics?.on); },
      set(v) { root.VaultShell?.haptics?.set(v); }
    },
    build: { title: "Vault 20K" }
  });
  doc.querySelector(".vault-shell")?.classList.add("is-mounted");
  root.VaultShell = { api, on };
})(typeof window !== "undefined" ? window : globalThis);
