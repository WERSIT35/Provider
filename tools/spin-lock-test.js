#!/usr/bin/env node
"use strict";

// Regression test for the spin-lifecycle lock (GitHub #28). The lock is the
// single guard that makes a spin atomic: no second spin may start until the
// current one releases, and a tap during animation must fast-stop the CURRENT
// spin rather than spawn a new one. spin-lock.js is DOM-free and has a
// module.exports branch, so we require it directly — no browser/DOM needed.
//
// Mirrors the plain-node convention of tools/rtp-parity.js: print PASS/FAIL and
// exit non-zero on any failure so CI can gate on it.

const { createSpinLock, PHASE } = require("../client/engine/spin-lock.js");

let failures = 0;
function check(name, cond) {
  if (cond) {
    console.log(`  ok  - ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL - ${name}`);
  }
}

// --- Phase transitions ------------------------------------------------------
{
  const lock = createSpinLock();
  check("starts idle", lock.phase === PHASE.IDLE);
  check("idle is not locked", !lock.isLocked());
  check("idle is not animating", !lock.isAnimating());

  check("first tryAcquire succeeds", lock.tryAcquire() === true);
  check("acquire moves to starting", lock.phase === PHASE.STARTING);
  check("starting is locked", lock.isLocked());
  check("starting is NOT animating (nothing to fast-stop yet)", !lock.isAnimating());

  lock.markAnimating();
  check("markAnimating moves starting -> animating", lock.phase === PHASE.ANIMATING);
  check("animating reports isAnimating", lock.isAnimating());
  check("animating is still locked", lock.isLocked());

  lock.release();
  check("release returns to idle", lock.phase === PHASE.IDLE);
  check("released lock is free to acquire again", lock.tryAcquire() === true);
}

// --- No overlap: a second tap while in flight is rejected --------------------
{
  const lock = createSpinLock();
  check("owner acquires", lock.tryAcquire() === true);
  check("second tap during starting is rejected", lock.tryAcquire() === false);
  lock.markAnimating();
  check("second tap during animating is rejected", lock.tryAcquire() === false);
  check("phase unchanged by rejected taps", lock.phase === PHASE.ANIMATING);
}

// --- release is safe from any phase -----------------------------------------
{
  const lock = createSpinLock();
  lock.tryAcquire();
  lock.release(); // from starting
  check("release from starting -> idle", lock.phase === PHASE.IDLE);
  lock.release(); // from idle (idempotent)
  check("release from idle stays idle", lock.phase === PHASE.IDLE);
}

// --- Rapid-tap simulation: exactly one owner per round ----------------------
{
  const lock = createSpinLock();
  let owners = 0;
  let fastStops = 0;
  // Simulate 20 rapid taps against a single in-flight spin.
  for (let i = 0; i < 20; i++) {
    if (lock.tryAcquire()) {
      owners += 1;
      // The owning tap immediately begins animating (result committed).
      lock.markAnimating();
    } else if (lock.isAnimating()) {
      // Every subsequent tap is a fast-stop of the current spin, never a spin.
      fastStops += 1;
    }
  }
  check("exactly one spin owner across 20 rapid taps", owners === 1);
  check("all 19 remaining taps become fast-stops, not spins", fastStops === 19);
}

// --- Press decision: a 2nd press in ANY in-flight phase = fast-stop ----------
// Models client/main.js spin() + requestFastStop(): the fast-stop must latch
// during the STARTING window (dropOff + network), not only once ANIMATING — so
// two quick presses accelerate the whole spin and no third press is ever needed.
// This encodes the fix and would FAIL under the old `isAnimating()`-only rule.
{
  const lock = createSpinLock();
  const state = { fastStopRequested: false };
  // A press: first acquire starts a spin (resetting the flag, as spin() does);
  // any press while locked latches a fast-stop (requestFastStop's new guard is
  // `isLocked()`, not `roundAnimating`). A press while idle would start a spin.
  function press() {
    if (lock.tryAcquire()) { state.fastStopRequested = false; return "start"; }
    if (lock.isLocked()) { state.fastStopRequested = true; return "faststop"; }
    return "ignored";
  }

  check("1st press starts the spin", press() === "start");
  check("...and does not request fast-stop yet", state.fastStopRequested === false);
  // Still STARTING (result not committed → markAnimating NOT called yet).
  check("2nd press during STARTING latches fast-stop", press() === "faststop");
  check("...fast-stop flag is set", state.fastStopRequested === true);

  lock.markAnimating(); // result arrives, reels animate
  check("3rd press during ANIMATING is still a fast-stop", press() === "faststop");

  lock.release();
  state.fastStopRequested = false;
  check("after completion, next press starts a fresh spin", press() === "start");
  check("...with the fast-stop flag cleared", state.fastStopRequested === false);
}

// --- The full press gate, incl. BONUS rounds (GitHub #28) -------------------
// The lock alone is not the whole rule. main.js drives rounds from four places
// and only some of them own the lock, so spin() gates on the OR of four signals.
// This models that gate exactly (see the `busy` block in client/main.js spin())
// and pins the behaviour the bonus used to get wrong: during free spins the
// press was returned early and swallowed, so speed-up was dead in the bonus.
function makeGame() {
  const lock = createSpinLock();
  const g = {
    lock,
    roundAnimating: false,
    autoplayActive: false,
    bonusAutoplay: false,
    fastStopRequested: false,
    autoplayStopped: false,
    spinsStarted: 0,
    /** Mirrors requestFastStop(): in flight = lock held OR a round on screen. */
    requestFastStop() {
      if (!lock.isLocked() && !g.roundAnimating) return false;
      g.fastStopRequested = true;
      return true;
    },
    /** Mirrors the manual branch of spin(). */
    press() {
      const busy =
        g.bonusAutoplay || g.autoplayActive || g.roundAnimating || lock.isLocked();
      if (busy) {
        if (g.autoplayActive) { g.autoplayActive = false; g.autoplayStopped = true; }
        return g.requestFastStop() ? "faststop" : "ignored";
      }
      if (!lock.tryAcquire()) return g.requestFastStop() ? "faststop" : "ignored";
      g.spinsStarted += 1;
      g.fastStopRequested = false;
      return "start";
    }
  };
  return g;
}

// Free-spin autoplay: entered from a manual spin, so the manual spin holds the
// lock across the whole bonus.
{
  const g = makeGame();
  check("bonus: manual spin starts the triggering round", g.press() === "start");
  g.lock.markAnimating();
  g.roundAnimating = true;
  // ...trigger resolves, bonus autoplay takes over (manual spin still holds lock)
  g.bonusAutoplay = true;
  check("bonus: press during a free spin fast-stops it", g.press() === "faststop");
  check("bonus: ...and the flag is actually latched", g.fastStopRequested === true);
  check("bonus: no second spin was started", g.spinsStarted === 1);
  // Between free spins the reels are momentarily idle but the bonus is not over.
  g.roundAnimating = false;
  check("bonus: press BETWEEN free spins never starts a base spin",
    g.press() === "faststop");
  check("bonus: still exactly one owner", g.spinsStarted === 1);
}

// Buy-feature: nobody had the lock during the bought round, which let a tap
// start a real concurrent spin. buyFreeSpins() now acquires it.
{
  const g = makeGame();
  check("buy: buyFreeSpins acquires the lock", g.lock.tryAcquire() === true);
  g.lock.markAnimating();
  g.roundAnimating = true;
  check("buy: press during the bought round fast-stops it", g.press() === "faststop");
  check("buy: no concurrent spin started", g.spinsStarted === 0);
  g.bonusAutoplay = true; // free spins begin, lock still held by buyFreeSpins
  check("buy: press during the bought bonus fast-stops", g.press() === "faststop");
  check("buy: still no concurrent spin", g.spinsStarted === 0);
}

// Resumed bonus (session restored mid-bonus): autoplayBonus() takes the lock.
{
  const g = makeGame();
  check("resume: autoplayBonus acquires the lock", g.lock.tryAcquire() === true);
  g.bonusAutoplay = true;
  g.lock.markAnimating();
  g.roundAnimating = true;
  check("resume: press fast-stops the resumed free spin", g.press() === "faststop");
  check("resume: no spin started", g.spinsStarted === 0);
}

// Base autoplay: a press stops the run AND speeds up the round on screen.
{
  const g = makeGame();
  check("autoplay: startAutoplay acquires the lock", g.lock.tryAcquire() === true);
  g.autoplayActive = true;
  g.lock.markAnimating();
  g.roundAnimating = true;
  check("autoplay: press fast-stops the current spin", g.press() === "faststop");
  check("autoplay: ...and cancels the run", g.autoplayStopped === true);
  check("autoplay: the running round was not aborted into a new spin",
    g.spinsStarted === 0);
}

// Rapid input across a WHOLE bonus lifecycle: exactly one round is ever owned.
{
  const g = makeGame();
  g.press();            // manual trigger spin
  g.lock.markAnimating();
  g.roundAnimating = true;
  const phases = [
    () => {},                                   // triggering round animating
    () => { g.bonusAutoplay = true; },          // bonus begins
    () => { g.roundAnimating = false; },        // between free spins
    () => { g.roundAnimating = true; },         // next free spin animating
    () => { g.bonusAutoplay = false; g.roundAnimating = false; } // bonus over
  ];
  let started = 0;
  for (const advance of phases) {
    advance();
    for (let i = 0; i < 10; i++) if (g.press() === "start") started += 1;
  }
  // Only the final phase (bonus over, lock released below) could ever start one,
  // and the lock is still held by the manual spin, so nothing new may begin.
  check("rapid input across a full bonus starts no extra spins", started === 0);
  check("exactly one round owned for the whole bonus", g.spinsStarted === 1);

  g.lock.release(); // manual spin's finally, after the bonus returned
  check("only once the bonus completes does a press start a new spin",
    g.press() === "start");
}

if (failures === 0) {
  console.log("\nspin-lock: PASS");
  process.exit(0);
} else {
  console.error(`\nspin-lock: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}
