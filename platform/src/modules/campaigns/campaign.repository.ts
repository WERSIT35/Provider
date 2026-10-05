import { randomUUID } from "node:crypto";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * Operator-granted Free Rounds (Campaign Manager).
 *
 * NOT the engine's scatter-triggered free spins (Session.free_spins_left): a free
 * round is an ordinary spin at the campaign's locked bet, funded by the operator's
 * promotion instead of the player's balance, so the RTP math is unchanged.
 *
 * Concurrency model: this in-memory repository is the arbiter, like every other
 * store in the platform (Postgres is a write-through mirror; see
 * src/persistence). consumeSpin() checks and decrements with no `await` in between,
 * so on Node's single thread two concurrent spin requests can never both take the
 * last spin. Every mutation bumps `version`, and the write-through upsert only
 * applies a newer version, so a stale flush can't resurrect a consumed spin either.
 * migrations/0002_campaigns.sql mirrors every invariant below as a CHECK constraint.
 */
export type CampaignStatus = "active" | "cancelled";
export type GrantStatus = "active" | "exhausted" | "expired" | "cancelled";

export interface Campaign {
  id: string;
  operator_id: string;
  game_id: string;
  name: string;
  currency: string;
  bet_amount: number; // locked bet fed to the engine
  total_spins: number; // spins granted to EACH player
  valid_from: string;
  valid_to: string;
  status: CampaignStatus;
  created_by: string;
  version: number;
  created_at: string;
}

/** One player's grant within a campaign (DB table: player_campaigns). */
export interface PlayerCampaign {
  id: string;
  campaign_id: string;
  operator_id: string;
  operator_player_id: string;
  spins_granted: number;
  spins_remaining: number;
  total_won: number;
  status: GrantStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCampaignInput {
  operator_id: string;
  game_id: string;
  name: string;
  currency: string;
  bet_amount: number;
  total_spins: number;
  valid_from: string;
  valid_to: string;
  created_by: string;
}

/** What a spin needs to play a free round: the grant it came from + the locked bet. */
export interface ConsumedSpin {
  grant: PlayerCampaign; // state AFTER the decrement
  campaign: Campaign;
}

export interface SpinContext {
  operator_id: string;
  operator_player_id: string;
  game_id: string;
  currency: string;
}

/** Hard ceilings so one bad request can't create an unbounded liability. */
export const MAX_SPINS_PER_GRANT = 1000;
export const MAX_PLAYERS_PER_GRANT_CALL = 10_000;

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

function isIso(s: string): boolean {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

export class InMemoryCampaignRepository {
  private readonly campaigns = new Map<string, Campaign>();
  private readonly grants = new Map<string, PlayerCampaign>();
  /** operator_id + player → grant ids (the spin-path lookup). */
  private readonly byPlayer = new Map<string, Set<string>>();

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  hydrate(rows: { campaigns: Campaign[]; grants: PlayerCampaign[] }): void {
    for (const c of rows.campaigns) this.campaigns.set(c.id, c);
    for (const g of rows.grants) this.index(g);
  }

  // ── campaigns ──────────────────────────────────────────────────────────────

  createCampaign(input: CreateCampaignInput, now = new Date().toISOString()): Campaign {
    if (!input.name?.trim()) throw new Error("CAMPAIGN_NAME_REQUIRED");
    if (!input.currency?.trim()) throw new Error("CAMPAIGN_CURRENCY_REQUIRED");
    if (!(Number.isFinite(input.bet_amount) && input.bet_amount > 0) || round2(input.bet_amount) !== input.bet_amount) {
      throw new Error("CAMPAIGN_BET_INVALID");
    }
    if (!Number.isInteger(input.total_spins) || input.total_spins < 1 || input.total_spins > MAX_SPINS_PER_GRANT) {
      throw new Error("CAMPAIGN_SPINS_INVALID");
    }
    if (!isIso(input.valid_from) || !isIso(input.valid_to)) throw new Error("CAMPAIGN_WINDOW_INVALID");
    const valid_from = new Date(input.valid_from).toISOString();
    const valid_to = new Date(input.valid_to).toISOString();
    if (valid_to <= valid_from || valid_to <= now) throw new Error("CAMPAIGN_WINDOW_INVALID");

    const c: Campaign = {
      id: `cmp_${randomUUID().slice(0, 12)}`,
      operator_id: input.operator_id,
      game_id: input.game_id,
      name: input.name.trim(),
      currency: input.currency.trim().toUpperCase(),
      bet_amount: input.bet_amount,
      total_spins: input.total_spins,
      valid_from,
      valid_to,
      status: "active",
      created_by: input.created_by,
      version: 1,
      created_at: now
    };
    this.campaigns.set(c.id, c);
    this.persistence.save("campaigns", c);
    return clone(c);
  }

  getCampaign(id: string): Campaign | null {
    const c = this.campaigns.get(id);
    return c ? clone(c) : null;
  }

  listCampaigns(operatorId?: string): Campaign[] {
    return Array.from(this.campaigns.values())
      .filter((c) => !operatorId || c.operator_id === operatorId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map(clone);
  }

  /** Cancel a campaign and every still-usable grant in it. Spins already played stand. */
  cancelCampaign(id: string, now = new Date().toISOString()): { campaign: Campaign; grants_cancelled: number } {
    const c = this.campaigns.get(id);
    if (!c) throw new Error("CAMPAIGN_NOT_FOUND");
    let cancelled = 0;
    if (c.status !== "cancelled") {
      c.status = "cancelled";
      c.version += 1;
      this.persistence.save("campaigns", c);
      for (const g of this.grants.values()) {
        if (g.campaign_id === id && g.status === "active") {
          this.mutate(g, now, () => (g.status = "cancelled"));
          cancelled += 1;
        }
      }
    }
    return { campaign: clone(c), grants_cancelled: cancelled };
  }

  /**
   * Withdraw ONE player's unplayed spins in a campaign. Only an active grant changes;
   * an exhausted / expired / already-cancelled one is returned as it is
   * (`cancelled: false`), so a retry is harmless. Spins already played stand, and a
   * scatter feature a free round already triggered still plays out (it is owed).
   */
  cancelGrant(campaignId: string, operatorPlayerId: string, now = new Date().toISOString()): { grant: PlayerCampaign; cancelled: boolean } {
    const g = Array.from(this.grants.values()).find((x) => x.campaign_id === campaignId && x.operator_player_id === operatorPlayerId);
    if (!g) throw new Error("GRANT_NOT_FOUND");
    if (g.status !== "active") return { grant: clone(g), cancelled: false };
    this.mutate(g, now, () => (g.status = "cancelled"));
    return { grant: clone(g), cancelled: true };
  }

  // ── grants ─────────────────────────────────────────────────────────────────

  /**
   * Grant the campaign's spins to each player. Idempotent per (campaign, player):
   * a player who already has a grant in this campaign is skipped, never topped up,
   * so a retried bulk call can't double the operator's liability.
   */
  grantPlayers(
    campaignId: string,
    playerIds: string[],
    now = new Date().toISOString()
  ): { granted: PlayerCampaign[]; skipped: string[] } {
    const c = this.campaigns.get(campaignId);
    if (!c) throw new Error("CAMPAIGN_NOT_FOUND");
    if (c.status !== "active" || c.valid_to <= now) throw new Error("CAMPAIGN_NOT_ACTIVE");
    if (playerIds.length > MAX_PLAYERS_PER_GRANT_CALL) throw new Error("TOO_MANY_PLAYERS");
    // Validate the whole batch first: all-or-nothing, never a half-applied bulk grant.
    const ids = playerIds.map((raw) => (typeof raw === "string" ? raw.trim() : ""));
    if (ids.some((pid) => !pid)) throw new Error("PLAYER_ID_INVALID");

    const existing = new Set(
      Array.from(this.grants.values())
        .filter((g) => g.campaign_id === campaignId)
        .map((g) => g.operator_player_id)
    );
    const granted: PlayerCampaign[] = [];
    const skipped: string[] = [];
    for (const pid of ids) {
      if (existing.has(pid)) {
        skipped.push(pid);
        continue;
      }
      existing.add(pid);
      const g: PlayerCampaign = {
        id: `pcg_${randomUUID().slice(0, 12)}`,
        campaign_id: c.id,
        operator_id: c.operator_id,
        operator_player_id: pid,
        spins_granted: c.total_spins,
        spins_remaining: c.total_spins,
        total_won: 0,
        status: "active",
        version: 1,
        created_at: now,
        updated_at: now
      };
      this.index(g);
      this.persistence.save("player_campaigns", g);
      granted.push(clone(g));
    }
    return { granted, skipped };
  }

  getGrant(id: string): PlayerCampaign | null {
    const g = this.grants.get(id);
    return g ? clone(g) : null;
  }

  listGrants(campaignId: string): PlayerCampaign[] {
    return Array.from(this.grants.values())
      .filter((g) => g.campaign_id === campaignId)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
      .map(clone);
  }

  /**
   * Every open grant this player holds with this operator, across games: active
   * grants of active campaigns whose window hasn't ended (including ones that
   * haven't started yet). Soonest-expiring first. Lazily expires stale grants.
   */
  playerGrants(operatorId: string, operatorPlayerId: string, now = new Date().toISOString()): ConsumedSpin[] {
    const ids = this.byPlayer.get(operatorId + "\u0000" + operatorPlayerId);
    if (!ids) return [];
    const out: ConsumedSpin[] = [];
    for (const id of ids) {
      const grant = this.grants.get(id)!;
      if (grant.status !== "active") continue;
      const campaign = this.campaigns.get(grant.campaign_id);
      if (!campaign || campaign.status !== "active") continue;
      if (campaign.valid_to <= now) {
        this.mutate(grant, now, () => (grant.status = "expired"));
        continue;
      }
      out.push({ grant: clone(grant), campaign: clone(campaign) });
    }
    return out.sort((a, b) => a.campaign.valid_to.localeCompare(b.campaign.valid_to));
  }

  /** Grants this player could play right now in this game/currency, in consume order. */
  available(ctx: SpinContext, now = new Date().toISOString()): ConsumedSpin[] {
    return this.usable(ctx, now).map(({ grant, campaign }) => ({ grant: clone(grant), campaign: clone(campaign) }));
  }

  /**
   * ATOMIC: take one free round for this player, or return null (none left → the
   * caller falls back to a paid spin or rejects). Synchronous on purpose: there is no
   * await between the check and the decrement, so concurrent spins cannot overdraw.
   * The grant expiring soonest is used first.
   */
  consumeSpin(ctx: SpinContext, now = new Date().toISOString()): ConsumedSpin | null {
    const next = this.usable(ctx, now)[0];
    if (!next) return null;
    const { grant, campaign } = next;
    this.mutate(grant, now, () => {
      grant.spins_remaining -= 1;
      if (grant.spins_remaining === 0) grant.status = "exhausted";
    });
    return { grant: clone(grant), campaign: clone(campaign) };
  }

  /**
   * Compensation: give back a spin taken by consumeSpin() when the round then failed
   * before anything was recorded (engine error, wallet rejected the 0-bet). Only an
   * exhausted or active grant can be restored; an expired/cancelled one stays closed.
   */
  restoreSpin(grantId: string, now = new Date().toISOString()): PlayerCampaign {
    const g = this.grants.get(grantId);
    if (!g) throw new Error("GRANT_NOT_FOUND");
    if (g.status !== "active" && g.status !== "exhausted") return clone(g);
    if (g.spins_remaining >= g.spins_granted) throw new Error("GRANT_RESTORE_OVERFLOW");
    this.mutate(g, now, () => {
      g.spins_remaining += 1;
      g.status = "active";
    });
    return clone(g);
  }

  /** Accumulate a free round's win against its grant (reporting / liability). */
  recordWin(grantId: string, amount: number, now = new Date().toISOString()): PlayerCampaign {
    const g = this.grants.get(grantId);
    if (!g) throw new Error("GRANT_NOT_FOUND");
    if (!(Number.isFinite(amount) && amount >= 0)) throw new Error("WIN_AMOUNT_INVALID");
    if (amount > 0) this.mutate(g, now, () => (g.total_won = round2(g.total_won + amount)));
    return clone(g);
  }

  /** Close every active grant whose campaign window has ended. Returns how many. */
  expireDue(now = new Date().toISOString()): number {
    let n = 0;
    for (const g of this.grants.values()) {
      if (g.status !== "active") continue;
      const c = this.campaigns.get(g.campaign_id);
      if (c && c.valid_to <= now) {
        this.mutate(g, now, () => (g.status = "expired"));
        n += 1;
      }
    }
    return n;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private index(g: PlayerCampaign): void {
    this.grants.set(g.id, g);
    const key = g.operator_id + "\u0000" + g.operator_player_id;
    let set = this.byPlayer.get(key);
    if (!set) this.byPlayer.set(key, (set = new Set()));
    set.add(g.id);
  }

  /** Live (uncloned) usable grants, soonest-expiring first. Lazily expires stale ones. */
  private usable(ctx: SpinContext, now: string): Array<{ grant: PlayerCampaign; campaign: Campaign }> {
    const ids = this.byPlayer.get(ctx.operator_id + "\u0000" + ctx.operator_player_id);
    if (!ids) return [];
    const out: Array<{ grant: PlayerCampaign; campaign: Campaign }> = [];
    for (const id of ids) {
      const grant = this.grants.get(id)!;
      if (grant.status !== "active" || grant.spins_remaining <= 0) continue;
      const campaign = this.campaigns.get(grant.campaign_id);
      if (!campaign || campaign.status !== "active") continue;
      if (campaign.valid_to <= now) {
        this.mutate(grant, now, () => (grant.status = "expired"));
        continue;
      }
      if (campaign.valid_from > now) continue; // not started yet
      if (campaign.game_id !== ctx.game_id || campaign.currency !== ctx.currency) continue;
      out.push({ grant, campaign });
    }
    return out.sort(
      (a, b) => a.campaign.valid_to.localeCompare(b.campaign.valid_to) || a.grant.created_at.localeCompare(b.grant.created_at)
    );
  }

  /** Apply a change, bump the version, and enqueue the write-through. */
  private mutate(g: PlayerCampaign, now: string, change: () => void): void {
    change();
    g.version += 1;
    g.updated_at = now;
    this.persistence.save("player_campaigns", g);
  }
}
