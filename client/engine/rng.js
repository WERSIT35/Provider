(function (root) {
  "use strict";

  const cryptoObj = root.crypto || root.msCrypto;

  function randomInt(maxExclusive) {
    const n = Math.max(1, Math.floor(maxExclusive));
    if (n === 1) return 0;
    const buf = new Uint32Array(1);
    const range = 0x100000000;
    const limit = range - (range % n);
    while (true) {
      cryptoObj.getRandomValues(buf);
      if (buf[0] < limit) return buf[0] % n;
    }
  }

  function randomFloat() {
    const buf = new Uint32Array(2);
    cryptoObj.getRandomValues(buf);
    return ((buf[0] >>> 5) * 0x4000000 + (buf[1] >>> 6)) / 0x20000000000000;
  }

  function uuid() {
    if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
      return cryptoObj.randomUUID();
    }
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0"));
    return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
  }

  function weightedPick(items, weightOf) {
    let total = 0;
    for (const item of items) total += Number(weightOf(item)) || 0;
    if (total <= 0) return items[items.length - 1];
    let r = randomFloat() * total;
    for (const item of items) {
      r -= Number(weightOf(item)) || 0;
      if (r <= 0) return item;
    }
    return items[items.length - 1];
  }

  let multiplierNonce = 0;
  function nextMultiplierId() {
    multiplierNonce += 1;
    return `m_${multiplierNonce}_${uuid().slice(0, 8)}`;
  }

  root.SlotEngine = root.SlotEngine || {};
  root.SlotEngine.RNG = { randomInt, randomFloat, uuid, weightedPick, nextMultiplierId };
})(typeof window !== "undefined" ? window : globalThis);
