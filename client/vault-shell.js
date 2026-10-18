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
    build: { title: "Vault 20K" },
    // Vault's skin for the themed slots (docs/lumina-overhaul/layers.md, Layer 2): teal steel
    // and gold. The controls themselves are the shared Lumina chrome.
    skin: {
      "--skin-title-font": "var(--font-display)", "--skin-title-case": "uppercase", "--skin-title-weight": "700",
      "--skin-accent": "var(--win-gold)",
      "--skin-slot-bg": "linear-gradient(180deg, #17333b, #0b1a1f)", "--skin-slot-ink": "#e9f6f5",
      "--skin-slot-edge": "inset 0 0 0 1px color-mix(in srgb, var(--steel-sheen) 45%, transparent)",
      "--skin-buy-bg": "linear-gradient(180deg, var(--win-gold), var(--win-gold-deep))", "--skin-buy-ink": "#1d1300",
      "--skin-panel-bg": "linear-gradient(180deg, #123039, #0a171c)", "--skin-panel-ink": "#eef6f6", "--skin-panel-muted": "#a9c4c3",
      "--skin-panel-title": "var(--win-gold-bright)", "--skin-panel-total": "var(--win-gold-bright)",
      "--skin-panel-frame": "0 0 0 2px var(--steel-sheen), 0 0 0 5px #0b1a1f, 0 0 0 7px var(--win-gold-deep), 0 18px 48px rgba(0, 0, 0, 0.6)",
      "--skin-tier-big": "var(--tier-big)", "--skin-tier-mega": "var(--tier-mega)", "--skin-tier-epic": "var(--tier-epic)", "--skin-tier-legendary": "var(--tier-legendary, #7ff6e6)", "--skin-tier-max": "var(--tier-max)",
      "--skin-win-hi": "#ffffff", "--skin-win": "var(--win-gold-bright)", "--skin-win-deep": "var(--win-gold-deep)",
      "--skin-bigwin-scrim": "color-mix(in srgb, var(--bg-vault-door) 80%, transparent)", "--skin-bigwin-core": "var(--bg-vault-door)",
      "--skin-laser": "var(--accent-laser)", "--skin-laser-hot": "var(--accent-laser-hot)"
    }
  });
  doc.querySelector(".vault-shell")?.classList.add("is-mounted");
  root.VaultShell = { api, on };
})(typeof window !== "undefined" ? window : globalThis);
