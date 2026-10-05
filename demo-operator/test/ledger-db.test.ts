import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openCasinoDb } from "../src/db/database";
import { PlayerStore } from "../src/store/player-store";
import { ProviderStore } from "../src/store/provider-store";
import { testConfig } from "./support/fake-platform-client";

describe("SQLite casino ledger", () => {
  it("players, balances, ledger and providers survive a restart (file database)", () => {
    const dir = mkdtempSync(join(tmpdir(), "casino-db-"));
    const path = join(dir, "casino.sqlite");
    try {
      const db1 = openCasinoDb(path);
      const s1 = new PlayerStore(db1);
      new ProviderStore(testConfig(), db1).add({ ...testConfig(), name: "Second RGS" });
      const p = s1.register("persist@example.com", "hash", 100);
      s1.debit({ playerId: p.id, idempotencyKey: "r1:debit", amount: 10, currency: "GEL", roundRef: "r1", gameCode: "bananax", roundType: "paid" });
      db1.close();

      const db2 = openCasinoDb(path);
      const s2 = new PlayerStore(db2);
      expect(s2.getById(p.id)?.balance).toBe(90);
      expect(s2.transactionsFor(p.id)).toHaveLength(1);
      expect(new ProviderStore(undefined, db2).getAll().map((x) => x.name)).toContain("Second RGS");
      // A replayed webhook after the restart still moves nothing.
      s2.debit({ playerId: p.id, idempotencyKey: "r1:debit", amount: 10, currency: "GEL", roundRef: "r1" });
      expect(s2.getById(p.id)?.balance).toBe(90);
      db2.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the wallet ledger is append-only", () => {
    const db = openCasinoDb();
    const s = new PlayerStore(db);
    const p = s.register("worm@example.com", "hash", 100);
    s.debit({ playerId: p.id, idempotencyKey: "w:debit", amount: 5, currency: "GEL", roundRef: "w" });
    expect(() => db.exec("UPDATE wallet_transactions SET amount_minor = 1")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM wallet_transactions")).toThrow(/append-only/);
  });

  it("classifies webhook money moves and keeps their attribution", () => {
    const s = new PlayerStore();
    const p = s.register("types@example.com", "hash", 100);
    s.debit({ playerId: p.id, idempotencyKey: "a:debit", amount: 2, currency: "GEL", roundRef: "a", gameCode: "bananax", roundType: "paid" });
    s.credit({ playerId: p.id, idempotencyKey: "a:credit", amount: 7.5, currency: "GEL", roundRef: "a", gameCode: "bananax", roundType: "paid" });
    s.debit({ playerId: p.id, idempotencyKey: "f:debit", amount: 0, currency: "GEL", roundRef: "f", txType: "FREE_ROUND_BET", campaignId: "cmp_1", gameCode: "bananax", roundType: "free_round" });
    s.credit({ playerId: p.id, idempotencyKey: "f:credit", amount: 3, currency: "GEL", roundRef: "f", txType: "FREE_ROUND_WIN", campaignId: "cmp_1", gameCode: "bananax", roundType: "free_round" });
    s.credit({ playerId: p.id, idempotencyKey: "fs:credit", amount: 1.25, currency: "GEL", roundRef: "fs", gameCode: "bananax", roundType: "free_spin" });

    const byKey = new Map(s.transactionsFor(p.id).map((t) => [t.idempotencyKey, t]));
    expect(byKey.get("a:debit")).toMatchObject({ type: "debit", txType: "WAGER", amount: 2, gameCode: "bananax", roundType: "paid" });
    expect(byKey.get("a:credit")).toMatchObject({ type: "credit", txType: "CREDIT", amount: 7.5 });
    expect(byKey.get("f:debit")).toMatchObject({ txType: "FREE_ROUND_BET", amount: 0, campaignId: "cmp_1", roundType: "free_round" });
    expect(byKey.get("f:credit")).toMatchObject({ txType: "FREE_ROUND_WIN", campaignId: "cmp_1" });
    expect(s.getById(p.id)?.balance).toBe(109.75); // 100 - 2 + 7.5 + 3 + 1.25, exact in minor units

    const rounds = new Map(s.recentRounds().map((r) => [r.roundRef, r]));
    expect(rounds.get("a")).toMatchObject({ bet: 2, win: 7.5, gameCode: "bananax", playerEmail: "types@example.com" });
    expect(rounds.get("fs")).toMatchObject({ bet: 0, win: 1.25, roundType: "free_spin" }); // credit-only free spin
    expect(rounds.get("f")).toMatchObject({ bet: 0, win: 3, campaignId: "cmp_1" });
  });

  it("a debit is rolled back once, at its own amount and currency", () => {
    const s = new PlayerStore();
    const p = s.register("rb@example.com", "hash", 100);
    const d = s.debit({ playerId: p.id, idempotencyKey: "rb:debit", amount: 25, currency: "EUR", roundRef: "rb" });
    const first = s.rollback({ idempotencyKey: "rb:rollback", originalOperatorTxRef: d.operatorTxRef, roundRef: "rb" });
    const again = s.rollback({ idempotencyKey: "rb:rollback-retry", originalOperatorTxRef: d.operatorTxRef, roundRef: "rb" });
    expect(again).toEqual(first);
    expect(s.getById(p.id)?.balance).toBe(100);
    const rb = s.transactionsFor(p.id).find((t) => t.type === "rollback");
    expect(rb).toMatchObject({ txType: "ROLLBACK", amount: 25, currency: "EUR", reversesTxRef: d.operatorTxRef });
    expect(s.recentRounds()[0]).toMatchObject({ roundRef: "rb", bet: 0, rolledBack: true });
  });

  it("groups a bonus by featureRef: trigger round + its free spins", () => {
    const s = new PlayerStore();
    const p = s.register("bonus@example.com", "hash", 1000);
    // Trigger (a buy), then two paying free spins of it, then an unrelated paid round.
    s.debit({ playerId: p.id, idempotencyKey: "t:debit", amount: 100, currency: "GEL", roundRef: "r_t", roundType: "buy" });
    s.credit({ playerId: p.id, idempotencyKey: "t:credit", amount: 6, currency: "GEL", roundRef: "r_t", roundType: "buy" });
    s.credit({ playerId: p.id, idempotencyKey: "fs1:credit", amount: 2.5, currency: "GEL", roundRef: "r_fs1", roundType: "free_spin", featureRef: "r_t" });
    s.credit({ playerId: p.id, idempotencyKey: "fs2:credit", amount: 40, currency: "GEL", roundRef: "r_fs2", roundType: "free_spin", featureRef: "r_t" });
    s.debit({ playerId: p.id, idempotencyKey: "x:debit", amount: 1, currency: "GEL", roundRef: "r_x", roundType: "paid" });

    const rounds = new Map(s.recentRounds().map((r) => [r.roundRef, r]));
    expect(rounds.get("r_t")?.featureRef).toBeNull();
    expect(rounds.get("r_fs1")?.featureRef).toBe("r_t");
    expect(rounds.get("r_fs2")?.featureRef).toBe("r_t");
    expect(rounds.get("r_x")?.featureRef).toBeNull();
    const summaries = s.bonusSummaries(["r_t", "r_x", "r_unknown"]);
    expect([...summaries.keys()]).toEqual(["r_t"]);
    expect(summaries.get("r_t")).toMatchObject({ payingSpins: 2, win: 42.5, currency: "GEL" });

    // A rollback inherits the group of the move it reverses.
    const d = s.debit({ playerId: p.id, idempotencyKey: "g:debit", amount: 3, currency: "GEL", roundRef: "r_g", roundType: "free_spin", featureRef: "r_t" });
    s.rollback({ idempotencyKey: "g:rollback", originalOperatorTxRef: d.operatorTxRef, roundRef: "r_g" });
    expect(s.transactionsFor(p.id).find((t) => t.type === "rollback")?.featureRef).toBe("r_t");
  });

  it("idempotency keys are scoped per provider", () => {
    const s = new PlayerStore();
    const p = s.register("scope@example.com", "hash", 100);
    s.debit({ providerId: "rgs-a", playerId: p.id, idempotencyKey: "same:debit", amount: 10, currency: "GEL", roundRef: "x" });
    s.debit({ providerId: "rgs-b", playerId: p.id, idempotencyKey: "same:debit", amount: 10, currency: "GEL", roundRef: "y" });
    expect(s.getById(p.id)?.balance).toBe(80);
  });
});
