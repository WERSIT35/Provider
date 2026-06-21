(function (root) {
  "use strict";

  // Single source of truth for "is a spin currently in flight?".
  //
  // The spin lifecycle has THREE phases and the lock must cover ALL of them so
  // rapid clicks can never start a second concurrent spin:
  //
  //   idle      → no spin in flight; a tap may start one.
  //   starting  → bet locked, board dropping off, network round being resolved.
  //               The result is NOT on screen yet. Taps here are IGNORED (there
  //               is nothing to fast-stop — the spin hasn't begun visually).
  //   animating → the result is committed and the reels are playing it out.
  //               Taps here request a fast-stop (drop everything immediately).
  //
  // Previously the only guard was `roundAnimating`, which flips true AFTER the
  // dropOff + network await — leaving the entire `starting` window unguarded, so
  // a second click spawned a whole second spin (the "spin 1, flash of spin 2,
  // lightning with no multiplier" glitch). This lock closes that window.
  const PHASE = Object.freeze({
    IDLE: "idle",
    STARTING: "starting",
    ANIMATING: "animating"
  });

  function createSpinLock() {
    let phase = PHASE.IDLE;

    return {
      PHASE,
      /** @returns {string} current lifecycle phase. */
      get phase() {
        return phase;
      },
      /** True while a spin occupies any non-idle phase. */
      isLocked() {
        return phase !== PHASE.IDLE;
      },
      /** True only once the result is committed and the reels are animating. */
      isAnimating() {
        return phase === PHASE.ANIMATING;
      },
      /**
       * Attempt to begin a spin. Synchronous and atomic — call it as the very
       * first statement of the spin handler, before any `await`.
       * @returns {boolean} true if this caller now owns the spin; false if a
       *   spin is already in flight (caller must NOT proceed).
       */
      tryAcquire() {
        if (phase !== PHASE.IDLE) return false;
        phase = PHASE.STARTING;
        return true;
      },
      /** Promote the in-flight spin to the visible animation phase. */
      markAnimating() {
        if (phase === PHASE.STARTING) phase = PHASE.ANIMATING;
      },
      /** Release the lock. Safe to call from any phase (success/error/cancel). */
      release() {
        phase = PHASE.IDLE;
      }
    };
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.SpinLock = { createSpinLock, PHASE };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createSpinLock, PHASE };
  }
})(typeof window !== "undefined" ? window : globalThis);
