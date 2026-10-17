(function (root) {
  "use strict";

  // The relic draft (docs/relic-forge/01-GDD.md §3.1). Before every Forge spin the server
  // deals an offer of 3 different relics, uniformly from those below Lv3; the player's
  // pick (the spin's `choice`, an index into the offer) levels that relic up. At least 3
  // relics are always below Lv3: 10 picks can max at most 3 of the 6.

  /** Deal an offer: `size` distinct relics below the max level, one randomInt each. */
  function makeOffer(levels, size, rng) {
    const { RELICS, MAX_LEVEL } = root.RelicForge.Relics;
    const pool = RELICS.filter((r) => (levels[r] || 0) < MAX_LEVEL);
    if (pool.length < size) throw new Error("RF_OFFER_POOL_TOO_SMALL");
    const offer = [];
    for (let i = 0; i < size; i += 1) offer.push(pool.splice(rng.randomInt(pool.length), 1)[0]);
    return offer;
  }

  /**
   * Apply a pick to the Forge's relics. Returns the new levels and evolutions, what was
   * picked, the evolutions it completed, and the pick's Relic bonus factor (equal-EV
   * table, looked up on the state BEFORE the pick).
   */
  function applyPick(forge, choice, rules, evTable) {
    const { Relics, EvTable } = root.RelicForge;
    const offer = forge.pending_offer;
    if (!Array.isArray(offer) || !Number.isInteger(choice) || choice < 0 || choice >= offer.length) throw new Error("INVALID_CHOICE");
    const relic = offer[choice];
    const sig = EvTable.signature(forge.relics, forge.evolutions, forge.spins_left);
    const levels = Object.assign({}, forge.relics);
    levels[relic] = (levels[relic] || 0) + 1;
    const evolved = Relics.newEvolutions(levels, forge.evolutions, rules);
    return {
      relic,
      level: levels[relic],
      levels,
      evolutions: forge.evolutions.concat(evolved),
      evolved,
      factor: EvTable.factor(evTable, sig, relic)
    };
  }

  root.RelicForge = root.RelicForge || {};
  root.RelicForge.Draft = { makeOffer, applyPick };
})(typeof window !== "undefined" ? window : globalThis);
