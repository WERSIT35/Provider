import { describe, it, expect } from "vitest";
// The lock is the single source of truth for the client spin lifecycle. It is a
// pure state machine (no DOM), so we exercise it directly here. The same file is
// loaded into the browser as an IIFE; this CommonJS export is the test seam.
import { createSpinLock, PHASE } from "../../client/engine/spin-lock.js";

describe("spin lifecycle lock", () => {
  it("starts idle and unlocked", () => {
    const lock = createSpinLock();
    expect(lock.phase).toBe(PHASE.IDLE);
    expect(lock.isLocked()).toBe(false);
    expect(lock.isAnimating()).toBe(false);
  });

  it("admits exactly one spin under a burst of rapid acquire attempts", () => {
    const lock = createSpinLock();
    // Simulate spamming the spin button: 20 synchronous taps before release.
    const results = Array.from({ length: 20 }, () => lock.tryAcquire());
    const acquired = results.filter(Boolean);
    expect(acquired).toHaveLength(1);
    expect(results[0]).toBe(true); // the first tap wins
    expect(lock.isLocked()).toBe(true);
  });

  it("ignores taps during the starting (network) window, then releases", () => {
    const lock = createSpinLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.phase).toBe(PHASE.STARTING);
    // While starting, a tap neither re-acquires nor counts as animating, so the
    // caller treats it as a no-op (not a fast-stop).
    expect(lock.tryAcquire()).toBe(false);
    expect(lock.isAnimating()).toBe(false);
    lock.release();
    expect(lock.phase).toBe(PHASE.IDLE);
  });

  it("reports the animating phase once the result is committed", () => {
    const lock = createSpinLock();
    lock.tryAcquire();
    lock.markAnimating();
    expect(lock.phase).toBe(PHASE.ANIMATING);
    expect(lock.isAnimating()).toBe(true);
    // A tap now would be routed to fast-stop by the caller; the lock itself
    // still refuses to start a second spin.
    expect(lock.tryAcquire()).toBe(false);
  });

  it("markAnimating is a no-op from idle (cannot animate without acquiring)", () => {
    const lock = createSpinLock();
    lock.markAnimating();
    expect(lock.phase).toBe(PHASE.IDLE);
  });

  it("re-admits a new spin after release (success path)", () => {
    const lock = createSpinLock();
    lock.tryAcquire();
    lock.markAnimating();
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  it("release is safe and idempotent from any phase (error/cancel paths)", () => {
    const lock = createSpinLock();
    lock.tryAcquire();
    lock.release();
    lock.release(); // double release must not throw or wedge the lock
    expect(lock.isLocked()).toBe(false);
    expect(lock.tryAcquire()).toBe(true);
  });

  it("keeps independent lock instances isolated", () => {
    const a = createSpinLock();
    const b = createSpinLock();
    a.tryAcquire();
    expect(a.isLocked()).toBe(true);
    expect(b.isLocked()).toBe(false);
    expect(b.tryAcquire()).toBe(true);
  });
});
