/*
 * Lumina motion: the ONE timing table every Lumina game reads (docs/lumina-overhaul).
 *
 * Two parts:
 *
 *   GRAMMAR  the studio's motion grammar: one row per event of a round, with durations
 *            for normal, quick and turbo speed and for reduced motion, the message the
 *            motion gives the player, and whether a press may skip it. The values are the
 *            REC column of reports/Slot provider UI and motion.md, Part 4: Lumina's own
 *            recommendations, NOT measured provider timings. `measured` stays null until
 *            Phase 0 (frame-stepped 60 fps recordings of real provider demos) fills it.
 *
 *   GAMES    each game's live constants. Every renderer reads its durations from here, not
 *            from literals in its own file. Step 1 moved them here unchanged (no behaviour
 *            change); later steps move each game onto GRAMMAR.
 *
 * Rules every value obeys (CLAUDE.md, overhaul prompt A5):
 *   - Presentation only: nothing here feeds the engine or changes a payout.
 *   - Reduced motion removes particles, flashes and parallax, never a cause-and-effect
 *     step: a row's `reduced` is its normal duration unless the row is pure decoration.
 *   - Turbo, quick and skips are market switches (regulatory profile): where turbo is
 *     off, `turbo`/`quick` are never used; where slam stop is off, a skip may only shorten
 *     presentation after the result is shown.
 *   - The whole cycle never ends before the market's min_round_ms, paced from the RGS
 *     answer (the games already do this; the table does not encode it).
 *
 * A browser IIFE on globalThis.LuminaMotion (served at /play/shell/motion.js and, in the
 * demo build, /vault/shell/motion.js). Load it before the game's own script.
 */
(function (root) {
  "use strict";

  // ms per speed; `skip`: "yes" | "no" | "shorten" (a Stop shortens it to the turbo value,
  // never removes it) | "after-result" (only once the result is on screen).
  const row = (normal, quick, turbo, reduced, skip, message, extra) =>
    Object.freeze(Object.assign({ normal, quick, turbo, reduced, skip, message, measured: null }, extra || {}));

  const GRAMMAR = Object.freeze({
    spinPress:          row(80, 80, 80, 80, "no", "Your bet is placed (first visible response, max)"),
    spinOut:            row(250, 200, 150, 250, "no", "A new board is coming"),
    columnGap:          row(100, 80, 60, 100, "shorten", "This column is final (read in evaluation order)"),
    spinLand:           row(1550, 1150, 800, 1550, "shorten", "Press to last landing", { min: 300 }),
    anticipation:       row(1200, 700, 350, 1200, "shorten", "One more and the feature starts", { neverInMarkets: [], notSkippableIn: ["UKGC", "ON"] }),
    anticipationMiss:   row(200, 175, 150, 200, "no", "No feature this time"),
    noWinHold:          row(250, 200, 150, 250, "no", "Nothing won"),
    winHighlight:       row(500, 350, 200, 500, "yes", "These symbols paid this much"),
    linesAll:           row(550, 375, 200, 550, "yes", "These lines paid"),
    linePerLine:        row(450, 300, 0, 450, "yes", "This line paid X (turbo: no cycle)"),
    countUpMin:         row(400, 325, 250, 400, "yes", "Your win is X (jumps to final on skip)"),
    countUpMax:         row(1000, 700, 400, 1000, "yes", "Count-up ceiling, log-scaled by × bet"),
    tumbleBurst:        row(260, 200, 150, 260, "shorten", "Winners removed"),
    tumbleFall:         row(380, 300, 230, 380, "no", "Chance of more wins (a refill is never skipped)"),
    tumbleColumnGap:    row(40, 32, 24, 40, "no", "Refill per column"),
    runningTotal:       row(200, 150, 100, 200, "yes", "Round total so far"),
    multiplierLand:     row(300, 240, 180, 300, "no", "A multiplier is on the board"),
    multiplierSum:      row(600, 450, 300, 600, "shorten", "Multipliers add up"),
    multiplierApply:    row(400, 300, 200, 400, "shorten", "Multipliers multiply this round's total"),
    scatterTrigger:     row(800, 600, 400, 800, "no", "You won free spins"),
    featureTransition:  row(1400, 1000, 600, 1400, "no", "Feature rules: N spins, special rule (then a tap)"),
    featureAutoContinue: row(3000, 3000, 3000, 3000, "yes", "Autoplay continues past the intro after this"),
    freeSpinCounter:    row(150, 125, 100, 150, "no", "N spins left"),
    retrigger:          row(900, 675, 450, 900, "no", "More spins added"),
    featureOutro:       row(1700, 1200, 700, 1700, "yes", "Your feature paid X (then a tap)"),
    featureOutroAuto:   row(4000, 4000, 4000, 4000, "yes", "Outro auto-dismiss in autoplay"),
    neutralCredit:      row(300, 300, 300, 300, "no", "Balance updated (no-celebrate markets: return ≤ stake)"),
    buySheet:           row(200, 200, 200, 200, "no", "Price in × bet and currency, confirm required"),
    buyTransition:      row(1400, 1000, 600, 1400, "no", "You paid X to enter the feature"),
    pickReveal:         row(600, 450, 300, 600, "yes", "Offers revealed one by one", { stagger: 120 }),
    pickResolve:        row(500, 375, 250, 500, "no", "You chose this; here is what it does"),
    meterCharge:        row(450, 350, 250, 450, "shorten", "That cluster charged the meter"),
    meterFill:          row(300, 225, 150, 300, "shorten", "The meter fills"),
    waitRing:           row(1000, 1000, 1000, 1000, "no", "Still working (spin ring)"),
    waitMessage:        row(3000, 3000, 3000, 3000, "no", "Still working (ticker line)"),
    idle:               row(0, 0, 0, 0, "no", "Nothing to explain, so nothing moves")
  });

  // The shared big-win ladder, judged on the ROUND total after the final multiplier,
  // in × the cycle stake. Each game names its own tiers. `hold`: ms the title stays up
  // after a skip. Max win is the engine's cap EVENT, not a threshold.
  const BIG_WIN = Object.freeze([
    Object.freeze({ key: "big", minX: 10, normal: 2000, turbo: 800, hold: 400 }),
    Object.freeze({ key: "mega", minX: 25, normal: 3000, turbo: 1100, hold: 450 }),
    Object.freeze({ key: "epic", minX: 50, normal: 4000, turbo: 1400, hold: 500 }),
    Object.freeze({ key: "legendary", minX: 100, normal: 5000, turbo: 1700, hold: 600 })
  ]);
  const MAX_WIN = Object.freeze({ key: "max", normal: 6000, turbo: 2000, hold: 700 });

  // ── each game's live constants ──────────────────────────────────────────────
  // Copied unchanged from the game files in step 1 (2026-10-17). Comments on the
  // physics stay in the game files, next to the code that uses them.
  const GAMES = {
    // Vault 20K (client/main.js).
    vault: {
      ANIMATION_TIMING: { spinBurst: 420, oldBoardDropOff: 480, introDrop: 480, tumbleDrop: 480, celebrateHoldFirst: 500, celebrateHoldChain: 400, explode: 460 },
      PACING: { charge: { small: 0, medium: 80, great: 150 }, burstStaggerMs: 6 },
      WATERFALL: { spinColMs: 100, tumbleColMs: 40 },
      AUTOPLAY_GAP_MS: 500,
      TURBO_SCALE: 0.6,
      SPIN_SETTLE_GUARD_MS: 250,
      TUMBLE_MOMENTUM: { perStep: 0.92, floor: 0.6 },
      FAST_ZIP: { firstMs: 30, colMs: 16, clickGapMs: 50 },
      ANTICIPATION: { holdMs: 650, slowFall: 1.6 },
      MULTI_PUNCH: { scale: 0.08, ms: 200 },
      STRIKE: { beatMs: 140, gapMs: 160, flickerMs: 60, flashPeakMs: 90, flashMs: 220, stopMs: 120 },
      FOCUS: { dim: 0.4, backdrop: 0.32, inMs: 250, outMs: 260 },
      TICKER: { rotateMs: 4500, flashMinMs: 900 },
      COMBINE: { enter: 480, hold: 320, slam: 360, reveal: 1500, totalPeak: 300 },
      SPIN_HOLD_MS: 400
    },
    // Moth & Lantern (games/classic-5x3/client/game.js).
    classic: {
      turbo: 0.5,              // speed() factor in turbo
      reduced: 0.6,            // speed() factor under reduced motion
      minSpin: 260,            // reels spin at least this long before landing
      reelLand: 360,           // one reel's landing
      reelLandAnticipate: 900,
      reelLandQuick: 130,      // a quick-stopped reel
      reelLandColExtra: 25,    // + col × this per reel
      reelGap: 110,            // between reel landings
      reelGapAnticipate: 380,
      errorLand: 120,          // reels settle after a failed round
      linePerLine: 420,
      countUpTier: 300,
      countUpPlain: 500,
      featureAward: 900,
      betweenFreeSpins: 260,
      celebrate: 2200,
      celebrateTurbo: 900,
      celebrateHold: 2500,
      celebrateHoldAuto: 900,
      autoplayGap: 400,
      autoplayGapTurbo: 150
    },
    // Relic Forge (games/relicforge/client/game.js).
    relicforge: {
      reducedCap: 120,         // pace() under reduced motion
      enterColStagger: 55,
      landSoundAt: 230,
      fallBase: 170,
      fallPerSqrtRow: 110,     // fall ms = fallBase + fallPerSqrtRow × √rows
      dropDelay: 40,
      fade: 120,
      exit: 220,
      exitColStagger: 30,
      pop: 260,
      popReduced: 80,
      markHold: 380,
      stepHold: 480,
      stepHoldDetonation: 620,
      afterRefill: 120,
      meltdownChip: 160,
      bannerReducedCap: 1400,
      bannerMaxWin: 3200,
      bannerTier: 2600,
      bannerForge: 2600,
      bannerForgeTotal: 3000,
      bannerForgeEmpty: 2200,
      evolution: 1500,
      evolutionReduced: 900,
      meterPulse: 600
    }
  };

  const clone = (o) => JSON.parse(JSON.stringify(o));

  root.LuminaMotion = Object.freeze({
    GRAMMAR,
    BIG_WIN,
    MAX_WIN,
    /** A game's constants (a fresh copy: a game may not change the table for others). */
    game(code) {
      const g = GAMES[code];
      if (!g) throw new Error(`LuminaMotion: unknown game "${code}"`);
      return clone(g);
    },
    /** One grammar duration for a speed: "normal" | "quick" | "turbo" | "reduced". */
    ms(event, speed = "normal") {
      const r = GRAMMAR[event];
      if (!r) throw new Error(`LuminaMotion: unknown event "${event}"`);
      return r[speed] ?? r.normal;
    },
    /** The big-win tier for a round total in × stake (null below the first tier). */
    tierFor(x) {
      let hit = null;
      for (const t of BIG_WIN) if (x >= t.minX) hit = t;
      return hit;
    }
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
