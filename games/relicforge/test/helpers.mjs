// Test helpers: load the engine the way the RGS does (its own vm context, the manifest's
// file order, a seeded crypto), and build scripted RNGs for the pure functions.
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const GAME = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const manifest = JSON.parse(fs.readFileSync(path.join(GAME, "game.json"), "utf8"));
// Unit tests run on a frozen fixture (the pre-tuning rules), so tuning never breaks them;
// shipped.test.mjs checks the shipped rules.
export const rules = () => JSON.parse(fs.readFileSync(path.join(GAME, "test/fixtures/rules-fixture.json"), "utf8"));
export const shippedRules = () => JSON.parse(fs.readFileSync(path.join(GAME, manifest.rules), "utf8"));

/** A deterministic getRandomValues: SHA-256 of (seed, counter), like a seeded stream. */
export function seededCrypto(seed) {
  let counter = 0;
  let pool = Buffer.alloc(0);
  return {
    getRandomValues(arr) {
      const need = arr.byteLength;
      while (pool.length < need) {
        pool = Buffer.concat([pool, createHash("sha256").update(`${seed}/${counter++}`).digest()]);
      }
      Buffer.from(arr.buffer, arr.byteOffset, need).set(pool.subarray(0, need));
      pool = pool.subarray(need);
      return arr;
    },
    randomUUID: () => "00000000-0000-4000-8000-000000000000"
  };
}

/** The RelicForge namespace in a fresh context; `seed` drives its crypto. */
export function loadEngine(seed = "test") {
  const context = vm.createContext({ crypto: seededCrypto(seed), console });
  for (const file of manifest.engine.files) {
    const src = fs.readFileSync(path.join(GAME, manifest.engine.dir, file), "utf8");
    new vm.Script(`(function (module, exports) {${src}\n})`, { filename: file }).runInContext(context).call(context, { exports: {} }, {});
  }
  return context.RelicForge;
}

/** An RNG that returns these floats in order (and fails loudly when they run out). */
export function scriptedRng(floats) {
  const queue = floats.slice();
  return {
    randomFloat() {
      if (!queue.length) throw new Error("scripted RNG exhausted");
      return queue.shift();
    },
    randomInt(n) {
      return Math.floor(this.randomFloat() * n);
    },
    left: () => queue.length
  };
}

/** The float that makes drawSymbol(table) return `symbol` (the middle of its slice). */
export function floatFor(table, symbol) {
  const i = table.symbols.indexOf(symbol);
  if (i < 0) throw new Error(`no ${symbol} in table`);
  const lo = i === 0 ? 0 : table.cumulative[i - 1];
  return (lo + table.cumulative[i]) / 2 / table.total;
}

/** Compact boards: one string per row, one letter per cell ("." = empty). */
export const LETTERS = { C: "COPPER", I: "IRON", B: "BRONZE", S: "SILVER", R: "RUBY", P: "SAPPHIRE", E: "EMERALD", G: "GOLD", W: "WILD", F: "EMBER", X: "SCATTER" };
export function board(RF, rows) {
  return RF.Grid.fromSymbols(rows.map((r) => [...r].map((ch) => (ch === "." ? null : LETTERS[ch]))));
}
export function letters(symbolRows) {
  const back = Object.fromEntries(Object.entries(LETTERS).map(([k, v]) => [v, k]));
  return symbolRows.map((r) => r.map((s) => (s === null ? "." : back[s])).join(""));
}

/** Engine objects come from another realm; compare their JSON (deepStrictEqual checks prototypes). */
export const plain = (x) => JSON.parse(JSON.stringify(x));

/** A Forge in progress (the trigger state, with overrides). */
export function forgeState(over = {}) {
  return { forge: Object.assign({ spins_total: 10, spins_left: 10, trigger: "scatter", round_x: 0, relics: { IGNITE: 0, CHAIN: 0, EXPAND: 0, MAGNET: 0, HOARD: 0, SURGE: 0 }, evolutions: [], relic_bonus: 1, carried_mult: null, stuck: [], pending_offer: ["IGNITE", "CHAIN", "EXPAND"] }, over) };
}
