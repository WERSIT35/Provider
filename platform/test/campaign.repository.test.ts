import { describe, it, expect } from "vitest";
import type { Pool } from "pg";
import { InMemoryCampaignRepository, type Campaign, type PlayerCampaign, type SpinContext } from "../src/modules/campaigns/campaign.repository";
import { PostgresPersistence, type Persistence } from "../src/persistence/persistence";

const T0 = "2026-10-01T00:00:00.000Z";
const NOW = "2026-10-02T12:00:00.000Z";
const T_END = "2026-10-31T00:00:00.000Z";

const CTX: SpinContext = { operator_id: "op1", operator_player_id: "p1", game_id: "g1", currency: "GEL" };

/** Records every write-through save (last write per id = what Postgres would hold). */
function recordingPersistence() {
  const saves: Array<{ table: string; row: Record<string, unknown> }> = [];
  const p: Persistence = {
    save: (table, row) => void saves.push({ table, row: { ...(row as Record<string, unknown>) } }),
    flush: async () => {},
    loadTable: async () => []
  };
  return { p, saves };
}

function setup(spins = 3, overrides: Partial<Parameters<InMemoryCampaignRepository["createCampaign"]>[0]> = {}) {
  const { p, saves } = recordingPersistence();
  const repo = new InMemoryCampaignRepository(p);
  const campaign = repo.createCampaign(
    { operator_id: "op1", game_id: "g1", name: "Welcome", currency: "GEL", bet_amount: 1, total_spins: spins, valid_from: T0, valid_to: T_END, created_by: "adm", ...overrides },
    NOW
  );
  return { repo, campaign, saves };
}

describe("campaign repository — creation + grants", () => {
  it("rejects campaigns the DB CHECK constraints would reject", () => {
    const repo = new InMemoryCampaignRepository();
    const base = { operator_id: "op1", game_id: "g1", name: "x", currency: "GEL", bet_amount: 1, total_spins: 5, valid_from: T0, valid_to: T_END, created_by: "a" };
    expect(() => repo.createCampaign({ ...base, bet_amount: 0 }, NOW)).toThrow("CAMPAIGN_BET_INVALID");
    expect(() => repo.createCampaign({ ...base, bet_amount: 1.005 }, NOW)).toThrow("CAMPAIGN_BET_INVALID");
    expect(() => repo.createCampaign({ ...base, total_spins: 0 }, NOW)).toThrow("CAMPAIGN_SPINS_INVALID");
    expect(() => repo.createCampaign({ ...base, total_spins: 2.5 }, NOW)).toThrow("CAMPAIGN_SPINS_INVALID");
    expect(() => repo.createCampaign({ ...base, valid_to: T0 }, NOW)).toThrow("CAMPAIGN_WINDOW_INVALID");
    expect(() => repo.createCampaign({ ...base, valid_to: "2026-10-02T00:00:00Z" }, NOW)).toThrow("CAMPAIGN_WINDOW_INVALID"); // already over
    expect(() => repo.createCampaign({ ...base, name: " " }, NOW)).toThrow("CAMPAIGN_NAME_REQUIRED");
  });

  it("grants are idempotent per player and all-or-nothing per batch", () => {
    const { repo, campaign } = setup();
    const first = repo.grantPlayers(campaign.id, ["p1", "p2", "p1"], NOW);
    expect(first.granted.map((g) => g.operator_player_id)).toEqual(["p1", "p2"]);
    expect(first.skipped).toEqual(["p1"]);

    // A retried bulk call never tops anyone up.
    const again = repo.grantPlayers(campaign.id, ["p1", "p3"], NOW);
    expect(again.granted.map((g) => g.operator_player_id)).toEqual(["p3"]);
    expect(again.skipped).toEqual(["p1"]);

    // One bad id rejects the whole batch: p4 must not be granted.
    expect(() => repo.grantPlayers(campaign.id, ["p4", ""], NOW)).toThrow("PLAYER_ID_INVALID");
    expect(repo.listGrants(campaign.id).map((g) => g.operator_player_id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("campaign repository — atomic spin consumption", () => {
  it("decrements to zero, marks exhausted, then returns null", () => {
    const { repo, campaign } = setup(2);
    repo.grantPlayers(campaign.id, ["p1"], NOW);

    const a = repo.consumeSpin(CTX, NOW)!;
    expect(a.grant.spins_remaining).toBe(1);
    expect(a.campaign.bet_amount).toBe(1);
    const b = repo.consumeSpin(CTX, NOW)!;
    expect(b.grant.spins_remaining).toBe(0);
    expect(b.grant.status).toBe("exhausted");
    expect(repo.consumeSpin(CTX, NOW)).toBeNull();
  });

  it("never overdraws under concurrent async spins", async () => {
    const { repo, campaign, saves } = setup(10);
    repo.grantPlayers(campaign.id, ["p1"], NOW);

    // 50 spin requests interleaving on the event loop, as concurrent HTTP requests would.
    const tick = () => new Promise<void>((r) => setImmediate(r));
    const results = await Promise.all(
      Array.from({ length: 50 }, async (_, i) => {
        for (let k = 0; k < i % 5; k += 1) await tick();
        const got = repo.consumeSpin(CTX, NOW);
        await tick();
        return got;
      })
    );
    const won = results.filter((r) => r !== null);
    expect(won).toHaveLength(10);
    // Every successful consume saw a distinct remaining count 9..0: no double-spend.
    expect(won.map((r) => r!.grant.spins_remaining).sort((x, y) => x - y)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const writes = saves.filter((s) => s.table === "player_campaigns").map((s) => s.row as unknown as PlayerCampaign);
    expect(writes.every((w) => w.spins_remaining >= 0)).toBe(true);
    // Versions are strictly increasing, so the version-guarded upsert keeps the newest.
    const versions = writes.map((w) => w.version);
    expect(versions).toEqual([...versions].sort((x, y) => x - y));
    expect(new Set(versions).size).toBe(versions.length);
  });

  it("only matches the player's own operator, game, currency and window", () => {
    const { repo, campaign } = setup(5);
    repo.grantPlayers(campaign.id, ["p1"], NOW);
    expect(repo.consumeSpin({ ...CTX, operator_id: "op2" }, NOW)).toBeNull(); // same player id, other casino
    expect(repo.consumeSpin({ ...CTX, game_id: "g2" }, NOW)).toBeNull();
    expect(repo.consumeSpin({ ...CTX, currency: "EUR" }, NOW)).toBeNull();
    expect(repo.consumeSpin(CTX, "2026-09-30T00:00:00.000Z")).toBeNull(); // not started
    expect(repo.getGrant(repo.listGrants(campaign.id)[0].id)!.spins_remaining).toBe(5);
  });

  it("expires lazily at the window end and via the sweep", () => {
    const { repo, campaign } = setup(5);
    const [g] = repo.grantPlayers(campaign.id, ["p1", "p2"], NOW).granted;
    expect(repo.consumeSpin(CTX, T_END)).toBeNull();
    expect(repo.getGrant(g.id)!.status).toBe("expired");
    expect(repo.expireDue(T_END)).toBe(1); // p2's grant
    expect(repo.expireDue(T_END)).toBe(0);
  });

  it("uses the soonest-expiring grant first", () => {
    const { repo, campaign: late } = setup(5);
    const soon = repo.createCampaign(
      { operator_id: "op1", game_id: "g1", name: "Flash", currency: "GEL", bet_amount: 2, total_spins: 1, valid_from: T0, valid_to: "2026-10-05T00:00:00Z", created_by: "a" },
      NOW
    );
    repo.grantPlayers(late.id, ["p1"], NOW);
    repo.grantPlayers(soon.id, ["p1"], NOW);
    expect(repo.consumeSpin(CTX, NOW)!.campaign.id).toBe(soon.id);
    expect(repo.consumeSpin(CTX, NOW)!.campaign.id).toBe(late.id);
  });
});

describe("campaign repository — compensation, wins, cancellation", () => {
  it("restores a spin after a failed round, but never above the grant", () => {
    const { repo, campaign } = setup(1);
    const [g] = repo.grantPlayers(campaign.id, ["p1"], NOW).granted;
    expect(() => repo.restoreSpin(g.id, NOW)).toThrow("GRANT_RESTORE_OVERFLOW");
    repo.consumeSpin(CTX, NOW);
    const restored = repo.restoreSpin(g.id, NOW);
    expect(restored.spins_remaining).toBe(1);
    expect(restored.status).toBe("active");
  });

  it("accumulates wins", () => {
    const { repo, campaign } = setup();
    const [g] = repo.grantPlayers(campaign.id, ["p1"], NOW).granted;
    repo.recordWin(g.id, 1.1, NOW);
    expect(repo.recordWin(g.id, 2.25, NOW).total_won).toBe(3.35);
    expect(() => repo.recordWin(g.id, -1, NOW)).toThrow("WIN_AMOUNT_INVALID");
  });

  it("cancelling a campaign closes active grants and blocks new ones", () => {
    const { repo, campaign } = setup(1);
    const [g1] = repo.grantPlayers(campaign.id, ["p1", "p2"], NOW).granted;
    repo.consumeSpin(CTX, NOW); // p1 exhausted → stays exhausted
    const res = repo.cancelCampaign(campaign.id, NOW);
    expect(res.grants_cancelled).toBe(1);
    expect(repo.getGrant(g1.id)!.status).toBe("exhausted");
    expect(repo.consumeSpin({ ...CTX, operator_player_id: "p2" }, NOW)).toBeNull();
    expect(() => repo.grantPlayers(campaign.id, ["p3"], NOW)).toThrow("CAMPAIGN_NOT_ACTIVE");
    expect(repo.cancelCampaign(campaign.id, NOW).grants_cancelled).toBe(0); // idempotent
  });
});

describe("campaign persistence", () => {
  it("hydrates from the last write per row and keeps consuming", () => {
    const { repo, campaign, saves } = setup(3);
    repo.grantPlayers(campaign.id, ["p1"], NOW);
    repo.consumeSpin(CTX, NOW);

    const last = <T>(table: string) => {
      const m = new Map<string, T>();
      for (const s of saves) if (s.table === table) m.set(s.row.id as string, s.row as unknown as T);
      return Array.from(m.values());
    };
    const reborn = new InMemoryCampaignRepository();
    reborn.hydrate({ campaigns: last<Campaign>("campaigns"), grants: last<PlayerCampaign>("player_campaigns") });
    expect(reborn.consumeSpin(CTX, NOW)!.grant.spins_remaining).toBe(1);
  });

  it("emits a version-guarded upsert so a stale flush can't resurrect spins", async () => {
    const queries: string[] = [];
    const params: unknown[][] = [];
    // A drain is ONE statement (`WITH s0 AS (INSERT …), …`): record each upsert in it
    // with its own values, renumbered, as if it had been sent alone.
    const record = (text: string, values: unknown[] = []) => {
      if (!text.startsWith("WITH ")) return void (queries.push(text), params.push(values));
      for (const m of text.matchAll(/s\d+ AS \((INSERT .*?)\)(?=, s\d+ AS \(| SELECT 1$)/g)) {
        const nums = [...m[1].matchAll(/\$(\d+)/g)].map((x) => Number(x[1]));
        const lo = Math.min(...nums), hi = Math.max(...nums);
        queries.push(m[1].replace(/\$(\d+)/g, (_x, n: string) => `$${Number(n) - lo + 1}`));
        params.push(values.slice(lo - 1, hi));
      }
    };
    const client = { query: async (text: string, values?: unknown[]) => record(text, values), release: () => {} };
    const pg = new PostgresPersistence({ connect: async () => client } as unknown as Pool);
    const { repo, campaign } = (() => {
      const r = new InMemoryCampaignRepository(pg);
      const c = r.createCampaign(
        { operator_id: "op1", game_id: "g1", name: "W", currency: "GEL", bet_amount: 1, total_spins: 2, valid_from: T0, valid_to: T_END, created_by: "a" },
        NOW
      );
      return { repo: r, campaign: c };
    })();
    repo.grantPlayers(campaign.id, ["p1"], NOW);
    repo.consumeSpin(CTX, NOW);
    await pg.flush();

    // Granted, then a spin consumed: saved twice in one flush → ONE row in the
    // multi-row upsert, the newest snapshot (1 spin left).
    const grantIdx = queries.findIndex((q) => q.startsWith("INSERT INTO player_campaigns"));
    expect(queries.filter((q) => q.startsWith("INSERT INTO player_campaigns"))).toHaveLength(1);
    expect(queries[grantIdx]).toMatch(/WHERE player_campaigns\.version < EXCLUDED\.version$/);
    const cols = /\(([^)]+)\) VALUES/.exec(queries[grantIdx])![1].split(", ");
    expect(params[grantIdx]).toHaveLength(cols.length);
    expect(params[grantIdx][cols.indexOf("spins_remaining")]).toBe(1);
    expect(queries.find((q) => q.startsWith("INSERT INTO campaigns"))).toMatch(/WHERE campaigns\.version < EXCLUDED\.version$/);
  });
});
