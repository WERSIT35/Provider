(function (root) {
  "use strict";

  // Per-cell chances. Crazy mode was previously too generous on the initial
  // matrix — players saw 4+ scatters and 2+ multipliers on the very first
  // drop nearly every spin. Tumble fills keep similar chances so cascades
  // still reward, but initial drops are toned down.
  const CRAZY_OVERRIDES = {
    scatterChanceBase: 0.030,
    scatterChanceAnte: 0.045,
    multiChanceBase: 0.022,
    multiChanceAnte: 0.030,
    multiChanceFreeSpin: 0.045,
    multiplierWeights: {
      2: 6, 3: 5, 4: 5, 5: 6, 6: 7,
      8: 10, 10: 14, 12: 14, 15: 16,
      20: 18, 25: 16, 50: 14,
      100: 10, 250: 7, 500: 4, 1000: 2
    },
    payoutScaler: 4.5,
    freeSpinPayoutScaler: 5.5,
    forceFreeSpinTriggerProbability: 0.55,
    freeSpinPersistentMultiplierStart: 0
  };

  // Go Crazy is about EXPECTATION, not just bigger payouts. Base mode makes the
  // high-value symbols the rarest (see symbols.js scarcity ladder); crazy mode
  // INVERTS that so the premium symbols become the common ones — the board
  // visibly fills with the good stuff so every spin feels like a near-jackpot.
  // Absolute weights (replace the base ladder entirely when crazy is on).
  const CRAZY_SYMBOL_WEIGHTS = {
    TOP_CROWN: 1.0,
    HOURGLASS: 0.95,
    RING: 0.9,
    CHALICE: 0.85,
    RED_GEM: 0.8,
    PURPLE_TRIANGLE: 0.72,
    YELLOW_HEX: 0.62,
    GREEN_TRIANGLE: 0.56,
    BLUE_DIAMOND: 0.5
  };

  // Same-symbol flood: on SOME crazy spins, pick one premium symbol and stamp a
  // cluster of it onto the opening board so the player sees a wall of one
  // high-value type — the "I'm about to win huge" rush. Kept occasional (not
  // every spin) and modest in size so it builds ANTICIPATION and lands real big
  // wins without turning the game into a guaranteed max-cap money printer (which
  // would remove all suspense).
  const CRAZY_CLUSTER = {
    probability: 0.4,
    minCells: 5,
    maxCells: 8
  };

  function getSymbolWeightOverrides(crazyMode) {
    return crazyMode ? CRAZY_SYMBOL_WEIGHTS : null;
  }

  function getClusterPlan(crazyMode) {
    return crazyMode ? CRAZY_CLUSTER : null;
  }

  function getRates({ crazyMode, isFreeSpin, anteEnabled }) {
    if (crazyMode) {
      const scatterChance = isFreeSpin
        ? CRAZY_OVERRIDES.scatterChanceBase
        : anteEnabled ? CRAZY_OVERRIDES.scatterChanceAnte : CRAZY_OVERRIDES.scatterChanceBase;
      const multiChance = isFreeSpin
        ? CRAZY_OVERRIDES.multiChanceFreeSpin
        : anteEnabled ? CRAZY_OVERRIDES.multiChanceAnte : CRAZY_OVERRIDES.multiChanceBase;
      return { scatterChance, multiChance };
    }
    const scatterChance = Math.min(0.045, anteEnabled ? 0.0172 : 0.0086);
    const multiChance = isFreeSpin ? 0.014 : anteEnabled ? 0.0072 : 0.0042;
    return { scatterChance, multiChance };
  }

  function getMultiplierWeights(crazyMode) {
    if (!crazyMode) return null;
    return CRAZY_OVERRIDES.multiplierWeights;
  }

  function getPayoutScalers({ crazyMode, profile }) {
    if (crazyMode) {
      return {
        basePayoutScaler: CRAZY_OVERRIDES.payoutScaler,
        freeSpinPayoutScaler: CRAZY_OVERRIDES.freeSpinPayoutScaler
      };
    }
    return {
      basePayoutScaler: Number(profile?.payout_scaler ?? profile?.base_payout_scaler ?? 1.5),
      freeSpinPayoutScaler: Number(profile?.free_spin_payout_scaler ?? profile?.payout_scaler ?? 1.5)
    };
  }

  function shouldForceFreeSpinTrigger(crazyMode) {
    if (!crazyMode) return false;
    const { randomFloat } = root.SlotEngine.RNG;
    return randomFloat() < CRAZY_OVERRIDES.forceFreeSpinTriggerProbability;
  }

  function persistentMultiplierStart(crazyMode) {
    return crazyMode ? CRAZY_OVERRIDES.freeSpinPersistentMultiplierStart : 0;
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.CrazyMode = {
    CRAZY_OVERRIDES,
    CRAZY_SYMBOL_WEIGHTS,
    CRAZY_CLUSTER,
    getRates,
    getMultiplierWeights,
    getSymbolWeightOverrides,
    getClusterPlan,
    getPayoutScalers,
    shouldForceFreeSpinTrigger,
    persistentMultiplierStart
  };
})(typeof window !== "undefined" ? window : globalThis);
