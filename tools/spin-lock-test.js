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

if (failures === 0) {
  console.log("\nspin-lock: PASS");
  process.exit(0);
} else {
  console.error(`\nspin-lock: FAIL (${failures} assertion(s) failed)`);
  process.exit(1);
}
