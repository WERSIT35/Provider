import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { hashPayload } from "../src/modules/ledger/hash-chain";
import type { Pool } from "pg";
import { buildContainer, type Container } from "../src/container";
import { SandboxWallet } from "../src/modules/wallet/sandbox-wallet";
import { InMemoryRoundRepository } from "../src/modules/ledger/memory-repositories";
import { PostgresPersistence, type Persistence } from "../src/persistence/persistence";
import { RoundVerificationService } from "../src/modules/rounds/round-verification.service";
import type { RoundLedgerService } from "../src/modules/ledger/round-ledger.service";
import type { AuthoritativeResolver } from "../src/modules/rng/authoritative-resolver";
import type { RoundInput, RoundRecord } from "../src/modules/ledger/ledger.types";

const CONFIG = { launchSecret: "s1", sessionSecret: "s2", adminSecret: "s3", hmacSkewSeconds: 30, rateLimitPerMin: 10_000 };

function provision(persistence?: Persistence): { c: Container; sessionId: string } {
  const wallet = new SandboxWallet();
  const c = buildContainer(CONFIG, { wallet, persistence });
  const game = c.mgmt.registerGame({ code: "bananax", title: "Banana X" });
  let cfg = c.mgmt.createMathConfig({ game_id: game.id, version: "3.0.0", rtp_profile_key: "bananax", theoretical_rtp: 96.38, config_hash: "h" });
  cfg = c.mgmt.submitMathConfigForReview(cfg.id);
  cfg = c.mgmt.approveMathConfig(cfg.id, "lead");
  const op = c.mgmt.createOperator({ name: "A", slug: "a" });
  c.mgmt.addDomain(op.id, "casino.example.com", "prod");
  c.mgmt.assignGame({ operator_id: op.id, game_id: game.id, math_config_id: cfg.id, currency: "GEL", allowed_bets: [1, 5] });
  wallet.setBalance("p1", "GEL", 1000);
  const token = c.sessions.createLaunchToken({ operator_id: op.id, game_code: "bananax", operator_player_id: "p1", currency: "GEL", origin: "casino.example.com" });
  return { c, sessionId: c.sessions.initSession(token).id };
}

describe("engine_version on rounds", () => {
  it("every recorded round carries the loaded engine's ENGINE_VERSION", async () => {
    const { c, sessionId } = provision();
    expect(c.engine.engineVersion()).toBe("1.2.0");
    for (let i = 0; i < 5; i += 1) {
      const out = await c.orchestrator.spin(sessionId, { bet_amount: 1, idempotency_key: `k-${i}` });
      expect(c.ledger.getRound(out.round_ref)?.engine_version).toBe("1.2.0");
    }
  });

  it("every recorded round carries the rules hash; the hash ignores key order but not values", async () => {
    const { c, sessionId } = provision();
    const hash = c.engine.rulesHash();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    const out = await c.orchestrator.spin(sessionId, { bet_amount: 1, idempotency_key: "rh" });
    expect(c.ledger.getRound(out.round_ref)?.rules_hash).toBe(hash);

    const rules = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../client/math/game-rules-v2.json"), "utf8"));
    expect(hashPayload(rules)).toBe(hash);
    const reordered = Object.fromEntries(Object.entries(rules).reverse());
    expect(hashPayload(reordered)).toBe(hash);
    rules.rtp_profiles[0].payout_scaler = Number(rules.rtp_profiles[0].payout_scaler) + 0.0001;
    expect(hashPayload(rules)).not.toBe(hash);
  });

  it("a legacy (unversioned) round and versioned rounds survive a Postgres round-trip with the chain intact", () => {
    const saved: Array<Record<string, unknown>> = [];
    const recorder: Persistence = {
      save: (table, row) => void (table === "rounds" && saved.push({ ...(row as Record<string, unknown>) })),
      flush: async () => {},
      loadTable: async () => []
    };
    const repo = new InMemoryRoundRepository(recorder);
    const base: RoundInput = {
      round_ref: "r0", session_id: "s", operator_id: "o", operator_player_id: "p", game_id: "g", math_config_id: "m",
      bet_amount: 1, bet_charged: 1, is_free_spin: false, ante_enabled: false, rng_seed_hex: "00", rng_algo: "a",
      rng_bytes_drawn: 1, outcome_hash: "h", total_win: 0, multiplier_applied: 1, status: "resolved", outcome: {} as never,
      pre_state: { game_code: "bananax", balance: 0, free_spins_left: 0, free_spin_multiplier_carry: 0, ante_enabled: false, resolve_mode: "spin" }
    };
    repo.append(base); // recorded before versioning existed: no engine_version key at all
    repo.append({ ...base, round_ref: "r1", engine_version: "1.0.0" }); // versioned, rules not yet hashed
    repo.append({ ...base, round_ref: "r2", engine_version: "1.1.0", rules_hash: "f".repeat(64) });
    expect("engine_version" in saved[0]).toBe(false);

    return (async () => {
      // Postgres returns every column; NULL where the app never wrote one.
      const pg = new PostgresPersistence({
        query: async () => ({
          rows: saved.map((r) => {
            const row: Record<string, unknown> = { ...r, outcome_jsonb: r.outcome };
            for (const col of ["campaign_id", "grant_id", "engine_version", "rules_hash"]) if (row[col] === undefined) row[col] = null;
            return row;
          })
        })
      } as unknown as Pool);
      const reborn = new InMemoryRoundRepository();
      reborn.hydrate((await pg.loadTable("rounds")) as never);
      expect(reborn.verifyChain()).toMatchObject({ ok: true, length: 3 });
    })();
  });
});

describe("replay verification is engine-version and rules aware", () => {
  const round = (engine_version?: string, rules_hash?: string): RoundRecord =>
    ({
      round_ref: "r", rng_seed_hex: "00", outcome_hash: "stored", bet_amount: 1, ante_enabled: false,
      seq: 1, prev_hash: "p", payload_hash: "q", chain_hash: "c",
      pre_state: { game_code: "bananax", balance: 0, free_spins_left: 0, free_spin_multiplier_carry: 0, ante_enabled: false, resolve_mode: "spin" },
      ...(engine_version ? { engine_version } : {}),
      ...(rules_hash ? { rules_hash } : {})
    }) as unknown as RoundRecord;
  const RULES = "a".repeat(64);
  const verifier = (r: RoundRecord, replayOk: boolean, chainOk = true) =>
    new RoundVerificationService(
      { getRound: () => r, verifyIntegrity: () => ({ rounds: { ok: chainOk } }) } as unknown as RoundLedgerService,
      {
        engineVersion: () => "1.0.0",
        rulesHash: () => RULES,
        verifyReplayDetailed: () => ({ ok: replayOk, recomputed_hash: replayOk ? "stored" : "other" })
      } as unknown as AuthoritativeResolver
    );

  it("same engine version and rules: a hash mismatch is tampering", () => {
    expect(verifier(round("1.0.0", RULES), false).verify("r")?.verdict).toBe("tampered");
    expect(verifier(round("1.0.0", RULES), true).verify("r")?.verdict).toBe("legitimate");
  });

  it("different or missing engine version: a mismatch is inconclusive, with the reason", () => {
    const other = verifier(round("0.9.0", RULES), false).verify("r")!;
    expect(other.verdict).toBe("inconclusive");
    expect(other.notes.join(" ")).toMatch(/resolved by engine 0.9.0; this platform runs 1.0.0/);
    const legacy = verifier(round(undefined, RULES), false).verify("r")!;
    expect(legacy.verdict).toBe("inconclusive");
    expect(legacy.notes.join(" ")).toMatch(/predates engine versioning/);
  });

  it("different or missing rules hash: a mismatch is inconclusive, with the reason", () => {
    const other = verifier(round("1.0.0", "b".repeat(64)), false).verify("r")!;
    expect(other.verdict).toBe("inconclusive");
    expect(other.notes.join(" ")).toMatch(/resolved with rules bbbbbbbbbbbb…; this platform runs rules aaaaaaaaaaaa…/);
    const legacy = verifier(round("1.0.0"), false).verify("r")!;
    expect(legacy.verdict).toBe("inconclusive");
    expect(legacy.notes.join(" ")).toMatch(/predates rules hashing/);
  });

  it("a replay that matches is legitimate even across versions; a broken chain is always tampering", () => {
    expect(verifier(round("0.9.0", "b".repeat(64)), true).verify("r")?.verdict).toBe("legitimate");
    expect(verifier(round("0.9.0", "b".repeat(64)), false, false).verify("r")?.verdict).toBe("tampered");
  });
});
