(function (root) {
  "use strict";

  // The ambiance layer is retired (docs/lumina-overhaul/vault-multiplier.md): Vault 20K
  // has no animated backdrop, no mascot and no sky effects, and its board stays still at
  // rest. The game still calls Ambiance.react(type, opts) at its big moments; those calls
  // are kept as hooks (a no-op) so a future scene layer plugs in without touching main.js.
  root.Ambiance = Object.freeze({ init() {}, react() {} });
})(typeof window !== "undefined" ? window : globalThis);
