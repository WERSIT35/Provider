import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { startStack, newPlayer, gameCall, type Stack } from "./support/stack";

/**
 * Sandbox pass, failure paths: platform + demo casino over real HTTP with real
 * HMAC-signed wallet webhooks. Network faults are injected on the platform's
 * outbound webhook calls (the request reaches the casino; the answer is lost),
 * and every assertion about money is made against the casino's own SQLite ledger.
 */

const ledgerFor = (s: Stack, playerId: string) => s.store.transactionsFor(playerId).reverse(); // oldest first
const balanceOf = (s: Stack, playerId: string) => s.store.getById(playerId)!.balance;
const cents = (n: number) => Math.round(n * 100);

describe("insufficient funds", () => {
  let s: Stack;
  beforeAll(async () => { s = await startStack({ startingBalance: 3 }); });
  afterAll(async () => { await s.close(); });

  it("the casino declines the WAGER with 402 and the RGS halts the spin with nothing recorded", async () => {
    const p = await newPlayer(s, "broke@example.com");

    const declined = await gameCall(s, p.sessionToken, "spin", "nf-1", { bet_amount: 5 });
    expect(declined.statusCode).toBe(402);
    expect(declined.json()).toMatchObject({ error: { code: "INSUFFICIENT_FUNDS" } });

    // Ante: a 1.25x stake that does not fit is declined the same way.
    const anteDeclined = await gameCall(s, p.sessionToken, "spin", "nf-2", { bet_amount: 5, ante_enabled: true });
    expect(anteDeclined.statusCode).toBe(402);
    // Buy feature (100x) likewise.
    const buyDeclined = await gameCall(s, p.sessionToken, "buy-feature", "nf-3", { bet_amount: 1 });
    expect(buyDeclined.statusCode).toBe(402);

    // Casino: no ledger row, balance untouched. Platform: no round, no wallet transaction.
    expect(ledgerFor(s, p.playerId)).toHaveLength(0);
    expect(balanceOf(s, p.playerId)).toBe(3);
    for (const key of ["nf-1", "nf-2", "nf-3"]) expect(s.container.ledger.getRound(`r_${key}`)).toBeNull();
    expect(s.container.transactions.size()).toBe(0);

    // A decline is not cached as an outcome: the same key is declined again, not replayed.
    const again = await gameCall(s, p.sessionToken, "spin", "nf-1", { bet_amount: 5 });
    expect(again.statusCode).toBe(402);

    // The session is still healthy: an affordable spin goes through, debited exactly once.
    const ok = await gameCall(s, p.sessionToken, "spin", "nf-4", { bet_amount: 1 });
    expect(ok.statusCode).toBe(200);
    const wagers = ledgerFor(s, p.playerId).filter((t) => t.txType === "WAGER");
    expect(wagers).toHaveLength(1);
    expect(wagers[0].amount).toBe(1);
  });
});

describe("idempotency and retries", () => {
  let s: Stack;
  beforeAll(async () => { s = await startStack({ startingBalance: 10_000 }); });
  afterAll(async () => { await s.close(); });

  it("a WAGER whose response is lost is not debited twice when the spin is retried", async () => {
    const p = await newPlayer(s, "flaky-debit@example.com");
    let lost = 0;
    s.faults.loseResponse = (action) => action === "debit" && lost++ === 0;

    const first = await gameCall(s, p.sessionToken, "spin", "retry-debit", { bet_amount: 5 });
    expect(first.statusCode).toBe(502); // the RGS cannot know whether the debit landed
    // ...but it did: the casino holds exactly one WAGER for it.
    expect(ledgerFor(s, p.playerId).filter((t) => t.txType === "WAGER")).toHaveLength(1);
    expect(balanceOf(s, p.playerId)).toBe(10_000 - 5);

    // The client retries with the SAME idempotency key: the casino replays the original
    // debit (same operatorTxRef, no second row) and the round completes normally.
    s.faults.loseResponse = undefined;
    const retry = await gameCall(s, p.sessionToken, "spin", "retry-debit", { bet_amount: 5 });
    expect(retry.statusCode).toBe(200);
    const out = retry.json() as { round_ref: string; total_win: number; settlement: string };
    expect(out.settlement).toBe("settled");

    const rows = ledgerFor(s, p.playerId);
    expect(rows.filter((t) => t.txType === "WAGER")).toHaveLength(1);
    expect(rows.filter((t) => t.type === "credit")).toHaveLength(out.total_win > 0 ? 1 : 0);
    expect(cents(balanceOf(s, p.playerId))).toBe(cents(10_000 - 5 + out.total_win));

    // Replaying a completed spin returns the stored outcome and moves no money.
    const before = rows.length;
    const replay = await gameCall(s, p.sessionToken, "spin", "retry-debit", { bet_amount: 5 });
    expect(replay.json()).toMatchObject({ round_ref: out.round_ref, idempotent_replay: true });
    expect(ledgerFor(s, p.playerId)).toHaveLength(before);
  });

  it("a CREDIT whose response is lost is settled by the provider without paying the win twice", async () => {
    const p = await newPlayer(s, "flaky-credit@example.com");
    const startBalance = balanceOf(s, p.playerId);
    // Lose the response of the first credit; spin until a round wins.
    let armed = true;
    s.faults.loseResponse = (action) => action === "credit" && armed && !(armed = false);
    let round: { round_ref: string; total_win: number; settlement: string } | null = null;
    let staked = 0;
    for (let i = 0; i < 500 && armed; i++) {
      const res = await gameCall(s, p.sessionToken, "spin", `credit-${i}`, { bet_amount: 1 });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { round_ref: string; total_win: number; settlement: string; bet_charged: number };
      staked += body.bet_charged;
      if (!armed) round = body;
    }
    s.faults.loseResponse = undefined;
    expect(round).not.toBeNull();
    const won = round!;
    expect(won.settlement).toBe("credit_pending"); // the RGS saw a failure...
    const creditsFor = () => ledgerFor(s, p.playerId).filter((t) => t.roundRef === won.round_ref && t.type === "credit");
    expect(creditsFor()).toHaveLength(1); // ...but the casino had already paid it
    const before = balanceOf(s, p.playerId);

    // Provider ops settle the failed-settlement queue: the retry re-sends the original
    // idempotency key, so the casino answers with the credit it already made.
    const settled = await s.container.lifecycle.settleRound(won.round_ref, "ops", "credit response timed out");
    expect(settled.effective_status).toBe("settled");
    expect(creditsFor()).toHaveLength(1);
    expect(balanceOf(s, p.playerId)).toBe(before);
    expect(s.container.transactions.listFailedSettlements().some((t) => t.round_ref === won.round_ref)).toBe(false);
    // Every cent the casino moved is accounted for: stakes out, wins in, nothing twice.
    const wins = ledgerFor(s, p.playerId).filter((t) => t.type === "credit").reduce((a, t) => a + cents(t.amount), 0);
    expect(cents(balanceOf(s, p.playerId))).toBe(cents(startBalance) - cents(staked) + wins);
  });

  it("a signed webhook replayed with the same key returns the original result", async () => {
    const p = await newPlayer(s, "replay@example.com");
    const ctx = { operatorId: s.container.mgmt.listOperators()[0].id };
    const move = { idempotencyKey: "manual-replay:credit", roundRef: "r_manual-replay", operatorPlayerId: p.playerId, amount: 12.34, currency: "GEL", gameCode: "bananax", roundType: "paid" as const };
    const a = await s.container.wallet.credit(ctx, move);
    const b = await s.container.wallet.credit(ctx, move);
    expect(b).toEqual(a); // same operatorTxRef, same balanceAfter
    expect(ledgerFor(s, p.playerId).filter((t) => t.roundRef === "r_manual-replay")).toHaveLength(1);
    expect(balanceOf(s, p.playerId)).toBe(10_000 + 12.34);
  });
});

describe("rollbacks", () => {
  let s: Stack;
  beforeAll(async () => { s = await startStack({ startingBalance: 1_000 }); });
  afterAll(async () => { await s.close(); });

  it("a round that fails after its WAGER is rolled back and the balance restored", async () => {
    const p = await newPlayer(s, "rollback@example.com");
    // The RGS debits, then fails to resolve the round (e.g. an engine fault).
    const spy = vi.spyOn(s.container.resolver, "resolve").mockImplementationOnce(() => { throw new Error("RESOLVE_FAILED"); });
    const res = await gameCall(s, p.sessionToken, "spin", "rb-1", { bet_amount: 10, ante_enabled: true });
    spy.mockRestore();
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const rows = ledgerFor(s, p.playerId);
    expect(rows.map((t) => t.txType)).toEqual(["WAGER", "ROLLBACK"]);
    const [wager, rollback] = rows;
    expect(wager.amount).toBe(12.5); // ante stake 10 x 1.25
    expect(rollback.reversesTxRef).toBe(wager.operatorTxRef);
    expect(rollback.amount).toBe(wager.amount);
    expect(rollback.currency).toBe(wager.currency);
    expect(balanceOf(s, p.playerId)).toBe(1_000);
    // Not played: the platform recorded no round for it.
    expect(s.container.ledger.getRound("r_rb-1")).toBeNull();

    // A retried rollback (same key) and a second rollback of the same debit (new key)
    // both return the existing reversal; the stake is refunded exactly once.
    const ctx = { operatorId: s.container.mgmt.listOperators()[0].id };
    const again = await s.container.wallet.rollback(ctx, { idempotencyKey: "rb-1:rollback", originalOperatorTxRef: wager.operatorTxRef, roundRef: "r_rb-1" });
    const other = await s.container.wallet.rollback(ctx, { idempotencyKey: "rb-1:rollback-2", originalOperatorTxRef: wager.operatorTxRef, roundRef: "r_rb-1" });
    expect(again.operatorTxRef).toBe(rollback.operatorTxRef);
    expect(other.operatorTxRef).toBe(rollback.operatorTxRef);
    expect(ledgerFor(s, p.playerId)).toHaveLength(2);
    expect(balanceOf(s, p.playerId)).toBe(1_000);

    // And the player plays on normally afterwards.
    const next = await gameCall(s, p.sessionToken, "spin", "rb-2", { bet_amount: 1 });
    expect(next.statusCode).toBe(200);
  });

  it("a rollback of an unknown debit is refused and moves nothing", async () => {
    const p = await newPlayer(s, "rollback-unknown@example.com");
    const ctx = { operatorId: s.container.mgmt.listOperators()[0].id };
    await expect(
      s.container.wallet.rollback(ctx, { idempotencyKey: "ghost:rollback", originalOperatorTxRef: "dop_does-not-exist", roundRef: "r_ghost" })
    ).rejects.toMatchObject({ code: "ORIGINAL_DEBIT_NOT_FOUND" });
    expect(ledgerFor(s, p.playerId)).toHaveLength(0);
    expect(balanceOf(s, p.playerId)).toBe(1_000);
  });
});

describe("bonus grouping (featureRef)", () => {
  let s: Stack;
  beforeAll(async () => { s = await startStack({ startingBalance: 100_000 }); });
  afterAll(async () => { await s.close(); });

  it("free-spin moves carry the trigger round; the ledger and back-office group them", async () => {
    const p = await newPlayer(s, "bonus@example.com");
    // A free spin that wins nothing sends no webhook, so buy until a bonus paid out.
    let trigger = "";
    for (let i = 0; i < 10; i++) {
      const buy = await gameCall(s, p.sessionToken, "buy-feature", `buy-${i}`, { bet_amount: 1 });
      expect(buy.statusCode).toBe(200);
      trigger = (buy.json() as { round_ref: string }).round_ref;
      let left = (buy.json() as { free_spins_left: number }).free_spins_left;
      for (let k = 0; left > 0; k++) {
        const fs = await gameCall(s, p.sessionToken, "spin", `buy-${i}-fs-${k}`, { bet_amount: 1 });
        expect(fs.statusCode).toBe(200);
        left = (fs.json() as { free_spins_left: number }).free_spins_left;
      }
      if (ledgerFor(s, p.playerId).some((t) => t.featureRef === trigger)) break;
    }

    const rows = ledgerFor(s, p.playerId);
    const freeSpinRows = rows.filter((t) => t.roundType === "free_spin");
    expect(freeSpinRows.length).toBeGreaterThan(0);
    // Every free-spin move names the buy that triggered it; nothing else carries a ref.
    const triggers = new Set(rows.filter((t) => t.roundType === "buy").map((t) => t.roundRef));
    for (const t of freeSpinRows) expect(triggers.has(t.featureRef ?? "")).toBe(true);
    for (const t of rows.filter((x) => x.roundType !== "free_spin")) expect(t.featureRef).toBeNull();
    const group = rows.filter((t) => t.featureRef === trigger);
    expect(group.length).toBeGreaterThan(0);

    // Back-office: the trigger row carries the bonus summary, its free spins the ref.
    const login = await s.demo.inject({ method: "POST", url: "/api/staff/login", payload: s.staff });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers["set-cookie"]).split(";")[0];
    const res = await s.demo.inject({ method: "GET", url: "/api/admin/rounds?limit=1000", headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const rounds = (res.json() as { rounds: Array<{ roundRef: string; featureRef: string | null; bonus: { payingSpins: number; win: number } | null }> }).rounds;
    const head = rounds.find((r) => r.roundRef === trigger)!;
    expect(head.featureRef).toBeNull();
    expect(head.bonus).toMatchObject({ payingSpins: new Set(group.map((t) => t.roundRef)).size });
    expect(cents(head.bonus!.win)).toBe(group.reduce((a, t) => a + cents(t.amount), 0));
    const members = rounds.filter((r) => r.featureRef === trigger);
    expect(members.length).toBe(head.bonus!.payingSpins);
    for (const r of rounds.filter((x) => x.featureRef === null && !triggers.has(x.roundRef))) expect(r.bonus).toBeNull();
  });
});
