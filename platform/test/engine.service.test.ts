import { describe, it, expect } from "vitest";
import { EngineService } from "../src/modules/engine/engine.service";

const EPSILON = 0.011; // engine rounds money to 2 dp

describe("EngineService (server-authoritative spin)", () => {
  it("creates a session with starting balance and allowed bets", () => {
    const svc = new EngineService();
    const init = svc.createSession({ currency: "GEL" });
    expect(init.session_id).toBeTruthy();
    expect(init.balance).toBeGreaterThan(0);
    expect(init.allowed_bets).toContain(500);
    expect(svc.hasSession(init.session_id)).toBe(true);
  });

  it("resolves a spin with a structurally valid 6x5 board and consistent balance", () => {
    const svc = new EngineService();
    const init = svc.createSession();
    const before = init.balance;
    const result = svc.spin(init.session_id, { bet_amount: 1, ante_enabled: false });

    // 30-cell grid (6 reels x 5 rows), rectangular.
    const rows = result.matrix.length;
    const cols = result.matrix[0]?.length ?? 0;
    expect(rows * cols).toBe(30);
    expect(result.matrix.every((r) => r.length === cols)).toBe(true);

    // Money invariant: balance_after = balance_before - bet_charged + total_win.
    const expected = before - result.bet_charged + result.total_win;
    expect(Math.abs(result.balance_after - expected)).toBeLessThan(EPSILON);

    // With ante off, the charged amount equals the bet.
    expect(result.bet_charged).toBeCloseTo(1, 5);

    // Win is capped (sanity, not exact): never absurdly large vs bet.
    expect(result.total_win).toBeLessThanOrEqual(1 * 20000 + EPSILON);
  });

  it("is idempotent for a repeated spin_id (no double charge)", () => {
    const svc = new EngineService();
    const init = svc.createSession();
    const first = svc.spin(init.session_id, { bet_amount: 1, spin_id: "fixed-1" });
    const second = svc.spin(init.session_id, { bet_amount: 1, spin_id: "fixed-1" });
    expect(second.total_win).toBe(first.total_win);
    expect(second.balance_after).toBe(first.balance_after);
  });

  it("buyFreeSpins guarantees a free-spins trigger", () => {
    const svc = new EngineService();
    const init = svc.createSession();
    const result = svc.buyFreeSpins(init.session_id, { bet_amount: 1 });
    expect(result.free_spins_awarded).toBeGreaterThan(0);
    expect(result.free_spins_left).toBeGreaterThan(0);
  });

  it("rejects spins for unknown sessions", () => {
    const svc = new EngineService();
    expect(() => svc.spin("does-not-exist", { bet_amount: 1 })).toThrow("SESSION_NOT_FOUND");
  });
});
