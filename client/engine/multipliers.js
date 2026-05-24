(function (root) {
  "use strict";

  const DEFAULT_MULTIPLIER_WEIGHTS = {
    2: 42,
    3: 28,
    4: 15,
    5: 8,
    6: 4,
    8: 2,
    10: 1.1,
    12: 0.7,
    15: 0.3,
    20: 0.15,
    25: 0.08,
    50: 0.03,
    100: 0.01,
    250: 0.0025,
    500: 0.001,
    1000: 0.0004
  };

  function buildMultiplierValues(rules) {
    const allowed = rules.features?.multipliers?.allowed_values || [2, 3, 5, 10];
    return allowed.map(Number);
  }

  function randomMultiplierValue(values, weights) {
    const { weightedPick } = root.SlotEngine.RNG;
    const w = weights || DEFAULT_MULTIPLIER_WEIGHTS;
    return weightedPick(values, (v) => w[v] ?? 1);
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.Multipliers = {
    DEFAULT_MULTIPLIER_WEIGHTS,
    buildMultiplierValues,
    randomMultiplierValue
  };
})(typeof window !== "undefined" ? window : globalThis);
