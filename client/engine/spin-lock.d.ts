// Type declarations for the plain-JS spin lock (spin-lock.js). The browser
// loads the JS as an IIFE; the Vitest suite imports its CommonJS export, so
// this declaration gives the typecheck the shape of that export.

export type SpinPhase = "idle" | "starting" | "animating";

export const PHASE: {
  readonly IDLE: "idle";
  readonly STARTING: "starting";
  readonly ANIMATING: "animating";
};

export interface SpinLock {
  readonly PHASE: typeof PHASE;
  /** Current lifecycle phase. */
  readonly phase: SpinPhase;
  /** True while a spin occupies any non-idle phase. */
  isLocked(): boolean;
  /** True only once the result is committed and the reels are animating. */
  isAnimating(): boolean;
  /** Attempt to begin a spin; true if this caller now owns it. */
  tryAcquire(): boolean;
  /** Promote the in-flight spin to the visible animation phase. */
  markAnimating(): void;
  /** Release the lock. Safe from any phase. */
  release(): void;
}

export function createSpinLock(): SpinLock;
