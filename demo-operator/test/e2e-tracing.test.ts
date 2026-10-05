import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startStack, newPlayer, type Stack } from "./support/stack";

/**
 * One player action, one W3C trace: the game client's `traceparent` on a spin reaches
 * the RGS, its ledger row, the signed wallet webhook and the casino's own ledger row.
 */
describe("W3C trace context across provider and casino", () => {
  let s: Stack;
  beforeAll(async () => { s = await startStack({ startingBalance: 1_000 }); });
  afterAll(async () => { await s.close(); });

  it("the client's trace id is on both ledgers' rows for the round", async () => {
    const p = await newPlayer(s, "traced@example.com");
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const res = await s.platform.inject({
      method: "POST",
      url: "/game/v1/spin",
      headers: {
        authorization: `Bearer ${p.sessionToken}`,
        "content-type": "application/json",
        "idempotency-key": "traced-1",
        traceparent: `00-${traceId}-b7ad6b7169203331-01`
      },
      payload: JSON.stringify({ bet_amount: 1 })
    });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers.traceparent)).toContain(traceId);

    const casinoRows = s.store.transactionsFor(p.playerId).filter((t) => t.roundRef === "r_traced-1");
    expect(casinoRows.length).toBeGreaterThan(0);
    for (const row of casinoRows) expect(row.traceId).toBe(traceId);
    const rgsRows = s.container.transactions.list({ round_ref: "r_traced-1" });
    expect(rgsRows.length).toBeGreaterThan(0);
    for (const row of rgsRows) expect(row.trace_id).toBe(traceId);
  });

  it("a webhook without traceparent stores no trace id", async () => {
    const p = await newPlayer(s, "untraced@example.com");
    const ctx = { operatorId: s.container.mgmt.listOperators()[0].id };
    await s.container.wallet.credit(ctx, { idempotencyKey: "manual:credit", roundRef: "r_manual", operatorPlayerId: p.playerId, amount: 1, currency: "GEL" });
    expect(s.store.transactionsFor(p.playerId).find((t) => t.roundRef === "r_manual")?.traceId).toBeNull();
  });
});
