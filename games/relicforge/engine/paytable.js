(function (root) {
  "use strict";

  /**
   * Cluster pays in bet multiples, by size band. Bands are written "5", "6", "7-8",
   * "12-14", "15+" in the rules; a size pays its band's value (0 below the smallest).
   */
  function makePaytable(rules) {
    const bySymbol = new Map();
    for (const [symbol, bands] of Object.entries(rules.paytable || {})) {
      const parsed = Object.entries(bands)
        .map(([key, value]) => {
          const m = /^(\d+)(?:-(\d+)|(\+))?$/.exec(key);
          if (!m) throw new Error(`RF_BAD_PAY_BAND:${symbol}:${key}`);
          const lo = Number(m[1]);
          const hi = m[3] ? Infinity : m[2] ? Number(m[2]) : lo;
          return { lo, hi, value: Number(value) };
        })
        .sort((a, b) => a.lo - b.lo);
      bySymbol.set(symbol, parsed);
    }
    function clusterPay(symbol, size) {
      const bands = bySymbol.get(symbol);
      if (!bands) return 0;
      for (const b of bands) if (size >= b.lo && size <= b.hi) return b.value;
      const top = bands[bands.length - 1];
      return top && size > top.hi ? top.value : 0;
    }
    return { clusterPay, symbols: [...bySymbol.keys()] };
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Paytable = { makePaytable };
})(typeof window !== "undefined" ? window : globalThis);
