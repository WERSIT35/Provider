/**
 * Relic Forge seed replay: re-resolve one round exactly as the RGS did, and print it step
 * by step (boards, clusters, pays). For debugging the engine and for disputes.
 *
 *   npx tsx scripts/relicforge-replay.ts --seed <64 hex> [--bet 1] [--game relicforge]
 *       [--pre '<pre_state JSON>'] [--choice N] [--json]
 *   npx tsx scripts/relicforge-replay.ts --export export.json [--json]
 *
 * --export takes a signed round export (GET /operator/v1/rounds/:ref/export) and uses its
 * seed, bet and pre-state. The replay goes through EngineService.resolveDeterministic,
 * the RGS's own path (seeded hmac-sha256-ctr stream), so it reproduces the stored
 * outcome hash when the engine version and rules match.
 */
import { readFileSync } from "node:fs";
import { GameRegistry } from "../src/modules/games/game-registry";
import { outcomeHash } from "../src/lib/outcome-hash";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const LETTER: Record<string, string> = {
  COPPER: "C", IRON: "I", BRONZE: "B", SILVER: "S", RUBY: "R", SAPPHIRE: "P", EMERALD: "E", GOLD: "G", WILD: "W", EMBER: "F", SCATTER: "X"
};
const rowsOf = (board: Array<Array<string | null>>) => board.map((r) => r.map((s) => (s === null ? "." : (LETTER[s] ?? "?"))).join(""));

function main(): void {
  let seed = arg("seed");
  let bet = Number(arg("bet") ?? 1);
  let game = arg("game") ?? "relicforge";
  let pre: Record<string, unknown> = arg("pre") ? JSON.parse(arg("pre") as string) : {};
  let choice = arg("choice") !== undefined ? Number(arg("choice")) : undefined;
  let storedHash: string | undefined;
  const file = arg("export");
  if (file) {
    const b = JSON.parse(readFileSync(file, "utf8")).bundle;
    seed = b.rng?.seed_hex;
    bet = Number(b.round?.bet_amount);
    pre = b.outcome?.pre_state ?? {};
    game = String(pre.game_code ?? game);
    choice = pre.choice as number | undefined;
    storedHash = b.outcome?.outcome_hash;
  }
  if (!seed || !/^[0-9a-f]{64}$/i.test(seed)) throw new Error("usage: relicforge-replay.ts --seed <64 hex> | --export <file>  (see the header)");

  const engine = new GameRegistry().engineFor(game);
  const { result, bytesDrawn } = engine.resolveDeterministic(
    {
      gameId: game,
      featureState: pre.feature_state ?? null,
      playerState: pre.player_state ?? null
    },
    { bet_amount: bet, ...(choice !== undefined ? { choice } : {}) },
    seed
  );
  const hash = outcomeHash(result);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ hash, bytesDrawn, result }, null, 2));
    return;
  }
  const r = result as Record<string, any>;
  console.log(`${game} ${engine.engineVersion()}  rules ${engine.rulesHash().slice(0, 12)}  seed ${seed.slice(0, 12)}…  bet ${bet}`);
  console.log(`initial\n  ${rowsOf(r.initial_board).join("\n  ")}`);
  (r.steps ?? []).forEach((s: any, i: number) => {
    const wins = s.clusters.map((c: any) => `${c.symbol}×${c.size}${c.wilds ? ` (${c.wilds}W)` : ""} = ${c.pay_x}x`).join(", ");
    console.log(`step ${i + 1}: ${wins}  → ${s.step_x}x\n  ${rowsOf(s.board).join("\n  ")}`);
  });
  console.log(`win ${r.win_x}x = ${r.total_win}${r.cap_reached ? "  (MAX WIN CAP)" : ""}  draws ${bytesDrawn} bytes`);
  console.log(`outcome hash ${hash}${storedHash ? (storedHash === hash ? "  = stored ✓" : `  ≠ stored ${storedHash} ✗`) : ""}`);
}

main();
