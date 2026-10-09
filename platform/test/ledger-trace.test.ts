import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { hashPayload } from "../src/modules/ledger/hash-chain";
import { InMemoryAuditRepository, InMemoryRoundRepository } from "../src/modules/ledger/memory-repositories";
import { PostgresPersistence, type Persistence } from "../src/persistence/persistence";
import { runWithTrace } from "../src/lib/trace-context";
import type { AuditInput, RoundInput } from "../src/modules/ledger/ledger.types";

/**
 * trace_id on the round + audit ledgers (migration 0011). Both ledgers are hash-chained
 * over every key the app wrote, so the key must appear only when there is a trace:
 * rounds recorded before 0011 or outside a request must hash exactly as they always did,
 * and survive a Postgres round-trip (NULL column → no key) with the chain intact.
 */

const TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const trace = { traceId: TRACE, spanId: "00f067aa0ba902b7", parentSpanId: null, sampled: true };

const ROUND: RoundInput = {
  round_ref: "r0", session_id: "s", operator_id: "o", operator_player_id: "p", game_id: "g", math_config_id: "m",
  bet_amount: 1, bet_charged: 1, is_free_spin: false, ante_enabled: false, rng_seed_hex: "00", rng_algo: "a",
  rng_bytes_drawn: 1, outcome_hash: "h", total_win: 0, multiplier_applied: 1, status: "resolved", outcome: {} as never,
  // Every recorded round carries its pre-state (a jsonb column, not omitNull).
  pre_state: { game_code: "bananax", balance: 0, free_spins_left: 0, free_spin_multiplier_carry: 0, ante_enabled: false, resolve_mode: "spin" }
};
const AUDIT: AuditInput = { operator_id: "o", actor_type: "system", actor_id: "spin-resolver", action: "round.resolved", target_type: "round", target_id: "r0" };

/** Records every save per table, as the write-through persistence would send it. */
function recorder(): { persistence: Persistence; saved: Record<string, Array<Record<string, unknown>>> } {
  const saved: Record<string, Array<Record<string, unknown>>> = {};
  return {
    saved,
    persistence: {
      save: (table, row) => void (saved[table] ??= []).push({ ...(row as Record<string, unknown>) }),
      flush: async () => {},
      loadTable: async () => []
    }
  };
}

/** Postgres hands back every column of the table, NULL where the app never wrote one. */
function pgReturning(rows: Array<Record<string, unknown>>, nullable: string[], extra: (r: Record<string, unknown>) => Record<string, unknown> = () => ({})): PostgresPersistence {
  return new PostgresPersistence({
    query: async () => ({
      rows: rows.map((r) => {
        const row: Record<string, unknown> = { ...r, ...extra(r) };
        for (const col of nullable) if (row[col] === undefined) row[col] = null;
        return row;
      })
    })
  } as unknown as Pool);
}

describe("trace_id on the round ledger", () => {
  it("stamps the current request's trace, and leaves the key out entirely without one", () => {
    const repo = new InMemoryRoundRepository();
    const traced = runWithTrace(trace, () => repo.append({ ...ROUND, round_ref: "r1" }));
    const untraced = repo.append({ ...ROUND, round_ref: "r2" });
    expect(traced.trace_id).toBe(TRACE);
    expect("trace_id" in untraced).toBe(false);
    expect(repo.verifyChain()).toMatchObject({ ok: true, length: 2 });
  });

  it("an untraced round hashes exactly as a round recorded before 0011 (no key, not a null key)", () => {
    const repo = new InMemoryRoundRepository();
    // An explicit undefined must not leak in either: stableStringify would hash it as null.
    const rec = repo.append({ ...ROUND, trace_id: undefined });
    const { id: _id, prev_hash: _p, payload_hash, chain_hash: _c, ...content } = rec;
    expect(payload_hash).toBe(hashPayload(content));
    expect(payload_hash).toBe(hashPayload({ ...ROUND, seq: rec.seq, created_at: rec.created_at }));
  });

  it("an explicit trace_id wins over the ambient one", () => {
    const repo = new InMemoryRoundRepository();
    const rec = runWithTrace(trace, () => repo.append({ ...ROUND, trace_id: "f".repeat(32) }));
    expect(rec.trace_id).toBe("f".repeat(32));
  });

  it("the trace is covered by the chain: editing it is detected as tampering", () => {
    const repo = new InMemoryRoundRepository();
    runWithTrace(trace, () => repo.append(ROUND));
    repo.__unsafeTamper(0, { trace_id: "0".repeat(31) + "1" });
    expect(repo.verifyChain().ok).toBe(false);
  });

  it("pre-0011 rounds and traced rounds survive a Postgres round-trip with the chain intact", async () => {
    const { persistence, saved } = recorder();
    const repo = new InMemoryRoundRepository(persistence);
    repo.append(ROUND); // before 0011 / outside a request: no trace_id key
    runWithTrace(trace, () => repo.append({ ...ROUND, round_ref: "r1" }));
    repo.append({ ...ROUND, round_ref: "r2", engine_version: "1.2.0" });
    expect("trace_id" in saved.rounds[0]).toBe(false);

    const pg = pgReturning(saved.rounds, ["campaign_id", "grant_id", "engine_version", "rules_hash", "trace_id"], (r) => ({ outcome_jsonb: r.outcome }));
    const reborn = new InMemoryRoundRepository();
    reborn.hydrate((await pg.loadTable("rounds")) as never);
    expect(reborn.verifyChain()).toMatchObject({ ok: true, length: 3 });
    expect(reborn.getByRef("r1")?.trace_id).toBe(TRACE);
    expect(reborn.getByRef("r0") && "trace_id" in reborn.getByRef("r0")!).toBe(false);
  });
});

describe("trace_id on the audit ledger", () => {
  it("stamps the trace, keeps untraced entries hashing as before, and survives a Postgres round-trip", async () => {
    const { persistence, saved } = recorder();
    const repo = new InMemoryAuditRepository(persistence);
    const plain = repo.append(AUDIT); // e.g. a background job: no request, no trace
    const traced = runWithTrace(trace, () => repo.append({ ...AUDIT, target_id: "r1" }));
    expect("trace_id" in plain).toBe(false);
    expect(traced.trace_id).toBe(TRACE);
    expect(plain.payload_hash).toBe(hashPayload({ ...AUDIT, seq: plain.seq, created_at: plain.created_at }));

    const pg = pgReturning(saved.audit_records, ["trace_id"]);
    const reborn = new InMemoryAuditRepository();
    reborn.hydrate((await pg.loadTable("audit_records")) as never);
    expect(reborn.verifyChain()).toMatchObject({ ok: true, length: 2 });
    expect(reborn.list({ action: "round.resolved" }).map((a) => a.trace_id ?? null)).toEqual([null, TRACE]);
  });
});
