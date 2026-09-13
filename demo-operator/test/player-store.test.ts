import { describe, it, expect, beforeEach } from "vitest";
import { PlayerStore, InsufficientFundsError } from "../src/store/player-store";

describe("PlayerStore", () => {
  let store: PlayerStore;

  beforeEach(() => {
    store = new PlayerStore();
  });

  it("registers a player with a starting balance and rejects a duplicate email", () => {
    const p = store.register("alice@example.com", "hash", 1000);
    expect(p.balance).toBe(1000);
    expect(store.findByEmail("ALICE@example.com")?.id).toBe(p.id); // case-insensitive
    expect(() => store.register("alice@example.com", "hash2", 500)).toThrow("EMAIL_TAKEN");
  });

  it("debits and credits the correct player balance", () => {
    const p = store.register("bob@example.com", "hash", 100);
    const debit = store.debit({ playerId: p.id, idempotencyKey: "k1:debit", amount: 40, currency: "GEL", roundRef: "r1" });
    expect(debit.balanceAfter).toBe(60);
    const credit = store.credit({ playerId: p.id, idempotencyKey: "k1:credit", amount: 15, currency: "GEL", roundRef: "r1" });
    expect(credit.balanceAfter).toBe(75);
    expect(store.getById(p.id)?.balance).toBe(75);
  });

  it("rejects a debit that would exceed the balance, without changing it", () => {
    const p = store.register("carl@example.com", "hash", 10);
    expect(() => store.debit({ playerId: p.id, idempotencyKey: "k2:debit", amount: 50, currency: "GEL", roundRef: "r2" })).toThrow(InsufficientFundsError);
    expect(store.getById(p.id)?.balance).toBe(10);
  });

  it("is idempotent: replaying the same debit/credit key never moves money twice", () => {
    const p = store.register("dana@example.com", "hash", 100);
    const first = store.debit({ playerId: p.id, idempotencyKey: "dup:debit", amount: 30, currency: "GEL", roundRef: "r3" });
    const second = store.debit({ playerId: p.id, idempotencyKey: "dup:debit", amount: 30, currency: "GEL", roundRef: "r3" });
    expect(second).toEqual(first);
    expect(store.getById(p.id)?.balance).toBe(70); // only charged once
  });

  it("rollback reverses the exact original debit by its operatorTxRef", () => {
    const p = store.register("eve@example.com", "hash", 100);
    const debit = store.debit({ playerId: p.id, idempotencyKey: "k4:debit", amount: 25, currency: "GEL", roundRef: "r4" });
    expect(store.getById(p.id)?.balance).toBe(75);
    const rollback = store.rollback({ idempotencyKey: "k4:rollback", originalOperatorTxRef: debit.operatorTxRef, roundRef: "r4", currency: "GEL" });
    expect(rollback.balanceAfter).toBe(100);
    expect(store.getById(p.id)?.balance).toBe(100);
  });

  it("records transactions newest-first, scoped to the right player", () => {
    const a = store.register("a@example.com", "hash", 100);
    const b = store.register("b@example.com", "hash", 100);
    store.debit({ playerId: a.id, idempotencyKey: "a1:debit", amount: 10, currency: "GEL", roundRef: "ra" });
    store.debit({ playerId: b.id, idempotencyKey: "b1:debit", amount: 20, currency: "GEL", roundRef: "rb" });
    store.credit({ playerId: a.id, idempotencyKey: "a1:credit", amount: 5, currency: "GEL", roundRef: "ra" });

    const aTx = store.transactionsFor(a.id);
    expect(aTx.every((t) => t.playerId === a.id)).toBe(true);
    expect(aTx.map((t) => t.type)).toEqual(["credit", "debit"]); // newest first
  });
});
