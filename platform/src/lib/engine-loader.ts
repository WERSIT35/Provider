import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { installSeededCrypto } from "./seeded-rng";

/**
 * Loads a game's math engine (browser IIFE files, the same ones its client runs) into
 * Node, each game in its OWN `vm` context, and returns its namespace.
 *
 * Games are listed in `games/<code>/game.json` (repo root): the engine files in load
 * order, the namespace they register on, the rules JSON and the client folder. Vault
 * 20K (`games/bananax`) points at client/engine and client/math, so the browser, the
 * RGS and tools/rtp-parity.js still run the exact same files: one source of truth.
 *
 * Isolation: every game gets a fresh context whose only globals are a seeded `crypto`
 * (the RGS's controllable RNG, see seeded-rng.ts), `console` and timers. Two games can
 * both register `SlotEngine` without touching each other or the host's globalThis, and
 * an engine cannot reach `process`, `require` or the host's objects. Code generation
 * from strings is off inside the context (no eval / new Function).
 *
 * The context's `crypto` is the one process-wide seeded controller, so `withSeed()`
 * drives every game's randomness exactly as it drove the single global engine before:
 * same stream, same bytes, same outcomes (proven by scripts/engine-isolation-parity.ts).
 */

export interface GameManifest {
  code: string;
  title: string;
  engine: { dir: string; namespace: string; files: string[] };
  rules: string;
  client: string;
  /** Absolute folder of the manifest (paths above are relative to it). */
  root: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SlotEngineNamespace = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameRules = any;

export interface LoadedEngine {
  ns: SlotEngineNamespace;
  rules: GameRules;
  engineDir: string;
  rulesPath: string;
  manifest: GameManifest;
}

/** The game every pre-registry caller meant (Vault 20K; internal code `bananax`). */
export const DEFAULT_GAME_CODE = "bananax";

function firstExisting(candidates: Array<string | undefined>): string | null {
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return null;
}

/** The repo's games/ folder (GAMES_DIR overrides): from src/lib (tsx), dist/lib (build) or the cwd. */
export function gamesRoot(): string {
  const candidates = [
    process.env.GAMES_DIR,
    path.resolve(__dirname, "../../../games"),
    path.resolve(__dirname, "../../../../games"),
    path.resolve(process.cwd(), "../games"),
    path.resolve(process.cwd(), "games")
  ];
  const found = firstExisting(candidates);
  if (!found) throw new Error(`Could not locate games/. Tried: ${candidates.filter(Boolean).join(", ")}. Set GAMES_DIR.`);
  return found;
}

/** Every game in games/<code>/game.json, by code. */
export function listGames(): GameManifest[] {
  const root = gamesRoot();
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(root, d.name, "game.json")))
    .map((d) => readManifest(d.name))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function readManifest(code: string): GameManifest {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(code)) throw new Error(`invalid game code "${code}"`);
  const root = path.join(gamesRoot(), code);
  const file = path.join(root, "game.json");
  if (!fs.existsSync(file)) throw new Error(`no game "${code}" (missing ${file})`);
  const m = JSON.parse(fs.readFileSync(file, "utf8")) as Omit<GameManifest, "root">;
  if (m.code !== code) throw new Error(`${file}: code "${m.code}" does not match its folder "${code}"`);
  if (!m.engine?.files?.length || !m.engine.namespace || !m.rules) throw new Error(`${file}: engine.files, engine.namespace and rules are required`);
  return { ...m, root };
}

const cache = new Map<string, LoadedEngine>();

/**
 * Load a game's engine (cached per code). For the default game, the legacy overrides
 * ENGINE_DIR / ENGINE_RULES_PATH (or `opts`) still win over its manifest.
 */
export function loadGameEngine(code: string = DEFAULT_GAME_CODE, opts: { engineDir?: string; rulesPath?: string } = {}): LoadedEngine {
  const cached = cache.get(code);
  if (cached) return cached;
  const manifest = readManifest(code);
  const legacy = code === DEFAULT_GAME_CODE;
  const engineDir = path.resolve(manifest.root, (legacy && (opts.engineDir ?? process.env.ENGINE_DIR)) || manifest.engine.dir);
  const rulesPath = path.resolve(manifest.root, (legacy && (opts.rulesPath ?? process.env.ENGINE_RULES_PATH)) || manifest.rules);

  // The seeded controller must exist before the engine captures `crypto` (rng.js reads it once).
  const crypto = installSeededCrypto();
  const sandbox: Record<string, unknown> = { crypto, console, setTimeout, clearTimeout };
  const context = vm.createContext(sandbox, { name: `game:${code}`, codeGeneration: { strings: false, wasm: false } });
  for (const file of manifest.engine.files) {
    const filename = path.join(engineDir, file);
    const src = fs.readFileSync(filename, "utf8");
    // Same call shape as before (a function of module/exports run once); `this` is the
    // context's global, which is what the IIFEs' `globalThis` already resolves to.
    const run = new vm.Script(`(function (module, exports) {${src}\n})`, { filename }).runInContext(context) as (m: unknown, e: unknown) => void;
    run.call(sandbox, { exports: {} }, {});
  }
  const ns = sandbox[manifest.engine.namespace] as SlotEngineNamespace;
  if (!ns || !ns.SpinEngine) throw new Error(`game "${code}": namespace ${manifest.engine.namespace} failed to load (missing SpinEngine)`);

  const rules = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  const loaded: LoadedEngine = { ns, rules, engineDir, rulesPath, manifest };
  cache.set(code, loaded);
  return loaded;
}

/** The default game's engine (every caller before the registry). */
export function loadSlotEngine(opts: { engineDir?: string; rulesPath?: string } = {}): LoadedEngine {
  return loadGameEngine(DEFAULT_GAME_CODE, opts);
}

/** Test seam: force a reload on next call. */
export function _resetEngineCacheForTests(): void {
  cache.clear();
}
