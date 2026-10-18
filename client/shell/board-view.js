/*
 * Lumina BoardView: the one seam between a game and its board (docs/lumina-overhaul,
 * prompt B). Each game puts its board behind this small interface so a later renderer
 * port (PixiJS/Spine, report Phase 4) replaces only the view, never the round flow, the
 * shell, the RGS calls or the market rules.
 *
 *   mount(host)                    draw the first, resting board into `host`
 *   resize()                       re-fit to the host (a ResizeObserver calls it)
 *   presentRound(payload, timings) show one round from the RGS payload; resolves when the
 *                                  board has explained it. `timings` = { speed, bet,
 *                                  celebrate, ... } (presentation only)
 *   setTheme(name)                 "base" | "feature": the scene the board sits in
 *   destroy()                      stop drawing, drop observers and caches
 *
 * Rules (CLAUDE.md): a view is a pure function of the payload. It never feeds data back,
 * never calls the engine or the RGS, and uses Math.random() for visuals only.
 *
 * A browser IIFE on globalThis.LuminaBoardView (served at /play/shell/board-view.js and,
 * in the demo build, /vault/shell/board-view.js).
 */
(function (root) {
  "use strict";
  const METHODS = Object.freeze(["mount", "resize", "presentRound", "setTheme", "destroy"]);
  const THEMES = Object.freeze(["base", "feature"]);
  const views = new Map();

  root.LuminaBoardView = Object.freeze({
    METHODS,
    THEMES,
    /** Register a game's view. Throws if a method is missing (the contract is checked once). */
    define(game, view) {
      const missing = METHODS.filter((m) => typeof view?.[m] !== "function");
      if (missing.length) throw new Error(`LuminaBoardView: "${game}" is missing ${missing.join(", ")}`);
      const wrapped = Object.freeze(Object.assign(Object.create(null), view, {
        setTheme(name) {
          if (!THEMES.includes(name)) throw new Error(`LuminaBoardView: unknown theme "${name}"`);
          return view.setTheme(name);
        }
      }));
      views.set(game, wrapped);
      return wrapped;
    },
    /** A registered view (probes, a future port), or null. */
    get(game) { return views.get(game) || null; },
    list() { return [...views.keys()]; }
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
