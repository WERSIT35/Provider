import path from "node:path";
import { listGames, DEFAULT_GAME_CODE, type GameManifest } from "../../lib/engine-loader";
import { EngineService, UnknownGameError, type EngineSource } from "../engine/engine.service";

/**
 * Every game the RGS can resolve (games/<code>/game.json), each with its own engine in
 * its own vm context. Rounds, sessions, campaigns, reports and exports already carry the
 * session's game code; this is where that code picks the math.
 *
 * Engines load on first use (or `preload()` at boot), then stay for the process.
 */
export class GameRegistry implements EngineSource {
  private readonly manifests: GameManifest[];
  private readonly engines = new Map<string, EngineService>();
  /** Session game code (incl. RTP variants such as bananax_94) → the game's code. */
  private readonly byCode = new Map<string, string>();

  constructor(private readonly opts: { engineDir?: string; rulesPath?: string; only?: string[] } = {}) {
    this.manifests = listGames().filter((m) => !opts.only || opts.only.includes(m.code));
    if (!this.manifests.some((m) => m.code === DEFAULT_GAME_CODE)) throw new Error(`games/${DEFAULT_GAME_CODE} is missing`);
  }

  /** Vault 20K: what every caller before the registry used. */
  get default(): EngineService {
    return this.game(DEFAULT_GAME_CODE);
  }

  /** The registered games (code, title). */
  list(): Array<{ code: string; title: string }> {
    return this.manifests.map((m) => ({ code: m.code, title: m.title }));
  }

  /** Load every engine now (boot), so the first round of a game pays no load cost. */
  preload(): this {
    for (const m of this.manifests) this.game(m.code);
    return this;
  }

  /** A game by its own code (the folder name). */
  game(code: string): EngineService {
    let engine = this.engines.get(code);
    if (!engine) {
      if (!this.manifests.some((m) => m.code === code)) throw new UnknownGameError(code);
      engine = new EngineService({ gameCode: code, ...(code === DEFAULT_GAME_CODE ? { engineDir: this.opts.engineDir, rulesPath: this.opts.rulesPath } : {}) });
      this.engines.set(code, engine);
      for (const c of engine.codes()) if (!this.byCode.has(c)) this.byCode.set(c, code);
    }
    return engine;
  }

  /** The folder a game's player client is served from (/play for Vault 20K, /play/g/<code>/ otherwise). */
  clientDir(code: string): string | null {
    const m = this.manifests.find((x) => x.code === code);
    return m ? path.resolve(m.root, m.client) : null;
  }

  /**
   * The controls a session's game allows at most (manifest `presentation`; missing =
   * allowed). The session payload ANDs them with the market's regulatory switches.
   */
  presentationFor(gameCode?: string | null): { turbo: boolean; slam_stop: boolean } {
    const code = this.engineFor(gameCode).gameCode;
    const p = this.manifests.find((x) => x.code === code)?.presentation ?? {};
    return { turbo: p.turbo !== false, slam_stop: p.slam_stop !== false };
  }

  /** A game's rules JSON (the client shows the pays the engine pays: one file). */
  rulesPath(code: string): string | null {
    const m = this.manifests.find((x) => x.code === code);
    return m ? path.resolve(m.root, m.rules) : null;
  }

  /** True if some game resolves this session game code (none = Vault 20K). */
  has(gameCode?: string | null): boolean {
    try {
      this.engineFor(gameCode);
      return true;
    } catch {
      return false;
    }
  }

  /** The engine for a session's game code (an RTP variant included); none = Vault 20K. */
  engineFor(gameCode?: string | null): EngineService {
    if (!gameCode) return this.default;
    const code = String(gameCode).toLowerCase();
    const hit = this.byCode.get(code);
    if (hit) return this.game(hit);
    for (const m of this.manifests) {
      const engine = this.game(m.code);
      if (engine.codes().includes(code)) return engine;
    }
    throw new UnknownGameError(String(gameCode));
  }
}
