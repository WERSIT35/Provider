import fs from "node:fs";
import path from "node:path";
import { installSeededCrypto } from "./seeded-rng";

/**
 * Loads the existing Banana X client engine (client/engine/*.js) into the Node
 * process and returns its namespace. We deliberately reuse the SAME math code
 * the certified client/sim tooling uses so server resolution is provably at
 * parity — there is one source of truth for the math, not a divergent re-impl.
 *
 * The engine files are browser IIFEs that attach to a `root` global; we execute
 * each in order and let them register onto globalThis.SlotEngine, mirroring the
 * loader in tools/rtp-parity.js.
 */

const ENGINE_FILES = [
  "rng.js",
  "config.js",
  "symbols.js",
  "multipliers.js",
  "matrix.js",
  "payouts.js",
  "tumble.js",
  "near-miss.js",
  "crazy-mode.js",
  "session-store.js",
  "spin-engine.js",
  "simulator.js"
] as const;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotEngineNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameRules = any;

export interface LoadedEngine {
  ns: SlotEngineNamespace;
  rules: GameRules;
  engineDir: string;
  rulesPath: string;
}

let cached: LoadedEngine | null = null;

function firstExisting(candidates: string[]): string | null {
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

function resolveEngineDir(override?: string): string {
  const candidates = [
    override,
    process.env.ENGINE_DIR,
    path.resolve(__dirname, "../../../client/engine"),
    path.resolve(__dirname, "../../../../client/engine"),
    path.resolve(process.cwd(), "../client/engine"),
    path.resolve(process.cwd(), "client/engine")
  ].filter(Boolean) as string[];
  const found = firstExisting(candidates);
  if (!found) {
    throw new Error(
      `Could not locate client/engine. Tried: ${candidates.join(", ")}. Set ENGINE_DIR.`
    );
  }
  return found;
}

function resolveRulesPath(engineDir: string, override?: string): string {
  const candidates = [
    override,
    process.env.ENGINE_RULES_PATH,
    path.resolve(engineDir, "../math/game-rules-v2.json"),
    path.resolve(engineDir, "../../math/game-rules-v2.json")
  ].filter(Boolean) as string[];
  const found = firstExisting(candidates);
  if (!found) {
    throw new Error(
      `Could not locate game-rules-v2.json. Tried: ${candidates.join(", ")}. Set ENGINE_RULES_PATH.`
    );
  }
  return found;
}

export function loadSlotEngine(opts: { engineDir?: string; rulesPath?: string } = {}): LoadedEngine {
  if (cached) return cached;

  // Install the seedable crypto wrapper BEFORE loading the engine so its rng.js
  // captures our controllable `crypto` (enables deterministic, replayable spins).
  installSeededCrypto();
  const g = globalThis as unknown as { SlotEngine?: SlotEngineNamespace };

  const engineDir = resolveEngineDir(opts.engineDir);
  for (const file of ENGINE_FILES) {
    const src = fs.readFileSync(path.join(engineDir, file), "utf8");
    // Execute the IIFE module body with `this` bound to globalThis so its
    // `(function(root){...})(window||globalThis)` wrapper registers SlotEngine.
    const wrap = new Function("module", "exports", src);
    wrap.call(globalThis, { exports: {} }, {});
  }

  const ns = g.SlotEngine;
  if (!ns || !ns.SpinEngine || !ns.Simulator) {
    throw new Error("SlotEngine namespace failed to load (missing SpinEngine/Simulator).");
  }

  const rulesPath = resolveRulesPath(engineDir, opts.rulesPath);
  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));

  cached = { ns, rules, engineDir, rulesPath };
  return cached;
}

/** Test seam: force a reload on next call. */
export function _resetEngineCacheForTests(): void {
  cached = null;
}
