import { randomUUID } from "node:crypto";
import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * Operator promotions: Tournaments and Prize Drops, and the cash prizes they pay
 * (promo wins). Migrations 0016 / 0017 mirror every invariant below.
 *
 * A promotion never changes a game's math or a round. A tournament ranks players on
 * rounds they already played (read from the round ledger when it closes); a prize drop
 * picks qualifying rounds after they were played (jobs/promotions.ts). The prize is the operator's money, credited through the casino
 * wallet as PROMO_WIN (promo-payout.ts).
 *
 * Like every store here, this in-memory repository is the arbiter (Postgres is a
 * write-through mirror); every mutation bumps `version`, so a stale flush never wins.
 */
export type PromoStatus = "open" | "closed" | "cancelled";
export type TournamentMetric = "max_multiplier" | "total_win" | "turnover";
export const TOURNAMENT_METRICS: readonly TournamentMetric[] = ["max_multiplier", "total_win", "turnover"];

interface PromoBase {
  id: string;
  operator_id: string;
  name: string;
  /** Games whose rounds count (game codes). */
  game_codes: string[];
  currency: string;
  /** Rounds staked below this don't count. */
  min_bet: number;
  starts_at: string;
  ends_at: string;
  status: PromoStatus;
  created_by: string;
  closed_at: string | null;
  version: number;
  created_at: string;
}

export interface Tournament extends PromoBase {
  metric: TournamentMetric;
  /** Prize per rank, rank 1 first. */
  prizes: number[];
}


export interface PrizeDrop extends PromoBase {
  /** Each qualifying round wins with chance 1 / odds. */
  odds: number;
  prizes: Array<{ amount: number; count: number }>;
  prizes_left: number;
  /** Last round ledger seq examined (the drop sweep resumes after it). */
  cursor_seq: number;
}

export type PromoWinStatus = "pending" | "paid" | "failed";

export interface PromoWin {
  id: string;
  operator_id: string;
  promo_type: "tournament" | "prize_drop";
  promo_id: string;
  promo_name: string;
  operator_player_id: string;
  currency: string;
  amount: number;
  rank: number | null;
  score: number | null;
  round_ref: string | null;
  status: PromoWinStatus;
  operator_tx_ref: string | null;
  error_code: string | null;
  attempts: number;
  version: number;
  created_at: string;
  paid_at: string | null;
}

/** Ceilings so one bad request can't create an unbounded liability. */
export const MAX_PRIZES = 500;
export const MAX_PRIZE_AMOUNT = 1_000_000;
export const MAX_GAMES = 50;

export interface PromoInputBase {
  operator_id: string;
  name: string;
  game_codes: string[];
  currency: string;
  min_bet?: number;
  starts_at: string;
  ends_at: string;
  created_by: string;
}
export interface CreateTournamentInput extends PromoInputBase { metric: TournamentMetric; prizes: number[] }
export interface CreatePrizeDropInput extends PromoInputBase { odds: number; prizes: Array<{ amount: number; count: number }> }

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const round2 = (n: number): number => Number(n.toFixed(2));
const isMoney = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0 && n <= MAX_PRIZE_AMOUNT && round2(n) === n;
const iso = (s: string): string | null => (typeof s === "string" && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null);

/** Lifecycle for display, on the server clock. */
export function promoState(p: PromoBase, now: string): "scheduled" | "running" | "ended" | "closed" | "cancelled" {
  if (p.status !== "open") return p.status;
  if (now < p.starts_at) return "scheduled";
  if (now < p.ends_at) return "running";
  return "ended";
}

function base(input: PromoInputBase, now: string, prefix: string): PromoBase {
  if (!input.name?.trim() || input.name.trim().length > 120) throw new Error("PROMO_NAME_INVALID");
  if (!/^[A-Z]{3}$/.test(input.currency?.trim().toUpperCase() ?? "")) throw new Error("PROMO_CURRENCY_INVALID");
  const games = [...new Set((input.game_codes ?? []).map((g) => String(g).trim()).filter(Boolean))];
  if (!games.length || games.length > MAX_GAMES) throw new Error("PROMO_GAMES_INVALID");
  const minBet = input.min_bet ?? 0;
  if (!(Number.isFinite(minBet) && minBet >= 0 && round2(minBet) === minBet)) throw new Error("PROMO_MIN_BET_INVALID");
  const starts = iso(input.starts_at), ends = iso(input.ends_at);
  if (!starts || !ends || ends <= starts || ends <= now) throw new Error("PROMO_WINDOW_INVALID");
  return {
    id: `${prefix}_${randomUUID().slice(0, 12)}`,
    operator_id: input.operator_id,
    name: input.name.trim(),
    game_codes: games,
    currency: input.currency.trim().toUpperCase(),
    min_bet: minBet,
    starts_at: starts,
    ends_at: ends,
    status: "open",
    created_by: input.created_by,
    closed_at: null,
    version: 1,
    created_at: now
  };
}

export class InMemoryPromotionsRepository {
  private readonly tournaments = new Map<string, Tournament>();
  private readonly drops = new Map<string, PrizeDrop>();
  private readonly wins = new Map<string, PromoWin>();

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  hydrate(rows: { tournaments: Tournament[]; drops?: PrizeDrop[]; wins: PromoWin[] }): void {
    for (const t of rows.tournaments) this.tournaments.set(t.id, { ...t, min_bet: Number(t.min_bet), prizes: t.prizes.map(Number) });
    for (const d of rows.drops ?? []) this.drops.set(d.id, { ...d, min_bet: Number(d.min_bet), cursor_seq: Number(d.cursor_seq) });
    for (const w of rows.wins) this.wins.set(w.id, { ...w, amount: Number(w.amount), score: w.score === null ? null : Number(w.score) });
  }

  // ── tournaments ────────────────────────────────────────────────────────────

  createTournament(input: CreateTournamentInput, now = new Date().toISOString()): Tournament {
    if (!TOURNAMENT_METRICS.includes(input.metric)) throw new Error("TOURNAMENT_METRIC_INVALID");
    const prizes = input.prizes ?? [];
    if (!prizes.length || prizes.length > MAX_PRIZES || !prizes.every(isMoney)) throw new Error("PROMO_PRIZES_INVALID");
    const t: Tournament = { ...base(input, now, "trn"), metric: input.metric, prizes: [...prizes] };
    this.tournaments.set(t.id, t);
    this.persistence.save("tournaments", t);
    return clone(t);
  }

  getTournament(id: string): Tournament | null {
    const t = this.tournaments.get(id);
    return t ? clone(t) : null;
  }

  listTournaments(operatorId?: string): Tournament[] {
    return [...this.tournaments.values()].filter((t) => !operatorId || t.operator_id === operatorId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(clone);
  }

  /** Open tournaments whose window has ended (the close job ranks and pays them). */
  dueTournaments(now: string): Tournament[] {
    return [...this.tournaments.values()].filter((t) => t.status === "open" && t.ends_at <= now).map(clone);
  }

  // ── prize drops ────────────────────────────────────────────────────────────

  createPrizeDrop(input: CreatePrizeDropInput, now = new Date().toISOString()): PrizeDrop {
    if (!Number.isInteger(input.odds) || input.odds < 1 || input.odds > 1_000_000) throw new Error("PRIZE_DROP_ODDS_INVALID");
    const prizes = (input.prizes ?? []).map((p) => ({ amount: p?.amount, count: p?.count }));
    const total = prizes.reduce((s, p) => s + (Number.isInteger(p.count) ? p.count : NaN), 0);
    if (!prizes.length || !prizes.every((p) => isMoney(p.amount) && Number.isInteger(p.count) && p.count >= 1) || !(total <= MAX_PRIZES)) {
      throw new Error("PROMO_PRIZES_INVALID");
    }
    // One tier per amount (awardDrop counts what is left by amount).
    const tiers = new Map<number, number>();
    for (const p of prizes as PrizeDrop["prizes"]) tiers.set(p.amount, (tiers.get(p.amount) ?? 0) + p.count);
    const merged = [...tiers].map(([amount, count]) => ({ amount, count })).sort((a, b) => b.amount - a.amount);
    const d: PrizeDrop = { ...base(input, now, "drp"), odds: input.odds, prizes: merged, prizes_left: total, cursor_seq: -1 };
    this.drops.set(d.id, d);
    this.persistence.save("prize_drops", d);
    return clone(d);
  }

  getPrizeDrop(id: string): PrizeDrop | null {
    const d = this.drops.get(id);
    return d ? clone(d) : null;
  }

  listPrizeDrops(operatorId?: string): PrizeDrop[] {
    return [...this.drops.values()].filter((d) => !operatorId || d.operator_id === operatorId).sort((a, b) => b.created_at.localeCompare(a.created_at)).map(clone);
  }

  openPrizeDrops(): PrizeDrop[] {
    return [...this.drops.values()].filter((d) => d.status === "open").map(clone);
  }

  /** Move a drop's sweep cursor forward (never back). */
  advanceDrop(id: string, cursorSeq: number): void {
    const d = this.drops.get(id);
    if (!d || cursorSeq <= d.cursor_seq) return;
    d.cursor_seq = cursorSeq;
    d.version += 1;
    this.persistence.save("prize_drops", d);
  }

  /**
   * Award the next prize of an open drop to a round: synchronous check-and-decrement,
   * so two sweeps can never hand out the same prize. Which prize is random among those
   * left, weighted by how many remain. Null when none are left or the round already won.
   */
  awardDrop(id: string, win: { operator_player_id: string; round_ref: string }, pick: (n: number) => number, now = new Date().toISOString()): PromoWin | null {
    const d = this.drops.get(id);
    if (!d || d.status !== "open" || d.prizes_left < 1) return null;
    if ([...this.wins.values()].some((w) => w.promo_id === id && w.round_ref === win.round_ref)) return null;
    const given = new Map<number, number>();
    for (const w of this.wins.values()) if (w.promo_id === id) given.set(w.amount, (given.get(w.amount) ?? 0) + 1);
    const left = d.prizes.flatMap((p) => Array<number>(Math.max(0, p.count - (given.get(p.amount) ?? 0))).fill(p.amount));
    if (!left.length) return null;
    const amount = left[pick(left.length)];
    d.prizes_left -= 1;
    d.version += 1;
    if (d.prizes_left === 0) { d.status = "closed"; d.closed_at = now; }
    this.persistence.save("prize_drops", d);
    return this.addWin({ operator_id: d.operator_id, promo_type: "prize_drop", promo_id: d.id, promo_name: d.name, operator_player_id: win.operator_player_id, currency: d.currency, amount, rank: null, score: null, round_ref: win.round_ref }, now);
  }

  /** Cancel an open prize drop. Prizes already won stand. */
  cancelPrizeDrop(id: string, now = new Date().toISOString()): PrizeDrop {
    return this.endDrop(id, "cancelled", now);
  }

  /** Close a drop whose window is over. */
  closePrizeDrop(id: string, now = new Date().toISOString()): PrizeDrop {
    return this.endDrop(id, "closed", now);
  }

  private endDrop(id: string, status: "closed" | "cancelled", now: string): PrizeDrop {
    const d = this.drops.get(id);
    if (!d) throw new Error("PROMO_NOT_FOUND");
    if (d.status === "open") {
      d.status = status;
      d.closed_at = now;
      d.version += 1;
      this.persistence.save("prize_drops", d);
    }
    return clone(d);
  }

  /** Cancel an open tournament. Prizes already won stand (they are owed). */
  cancelTournament(id: string, now = new Date().toISOString()): Tournament {
    const t = this.tournaments.get(id);
    if (!t) throw new Error("PROMO_NOT_FOUND");
    if (t.status === "open") {
      t.status = "cancelled";
      t.closed_at = now;
      t.version += 1;
      this.persistence.save("tournaments", t);
    }
    return clone(t);
  }

  /**
   * Close a tournament and record its winners in one synchronous step (the board was
   * ranked by the caller). Returns the wins it created; nothing when already closed.
   */
  closeTournament(id: string, ranked: Array<{ operator_player_id: string; score: number }>, now = new Date().toISOString()): PromoWin[] {
    const t = this.tournaments.get(id);
    if (!t || t.status !== "open") return [];
    t.status = "closed";
    t.closed_at = now;
    t.version += 1;
    this.persistence.save("tournaments", t);
    return t.prizes.slice(0, ranked.length).map((amount, i) =>
      this.addWin({ operator_id: t.operator_id, promo_type: "tournament", promo_id: t.id, promo_name: t.name, operator_player_id: ranked[i].operator_player_id, currency: t.currency, amount, rank: i + 1, score: ranked[i].score, round_ref: null }, now)
    );
  }

  private addWin(w: Omit<PromoWin, "id" | "status" | "operator_tx_ref" | "error_code" | "attempts" | "version" | "created_at" | "paid_at">, now: string): PromoWin {
    const win: PromoWin = { ...w, id: `pwin_${randomUUID().slice(0, 16)}`, status: "pending", operator_tx_ref: null, error_code: null, attempts: 0, version: 1, created_at: now, paid_at: null };
    this.wins.set(win.id, win);
    this.persistence.save("promo_wins", win);
    return clone(win);
  }

  getWin(id: string): PromoWin | null {
    const w = this.wins.get(id);
    return w ? clone(w) : null;
  }

  listWins(filter: { operator_id?: string; operator_player_id?: string; promo_type?: PromoWin["promo_type"]; promo_id?: string; status?: PromoWinStatus; from?: string; to?: string } = {}): PromoWin[] {
    return [...this.wins.values()]
      .filter((w) => (!filter.operator_id || w.operator_id === filter.operator_id) && (!filter.operator_player_id || w.operator_player_id === filter.operator_player_id) &&
        (!filter.promo_type || w.promo_type === filter.promo_type) && (!filter.promo_id || w.promo_id === filter.promo_id) && (!filter.status || w.status === filter.status) &&
        (!filter.from || w.created_at >= filter.from) && (!filter.to || w.created_at <= filter.to))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || (a.rank ?? 0) - (b.rank ?? 0))
      .map(clone);
  }

  /** Wins still to pay: pending, or failed with an unknown outcome (retried under the same key). */
  unpaidWins(): PromoWin[] {
    return [...this.wins.values()].filter((w) => w.status !== "paid").sort((a, b) => a.created_at.localeCompare(b.created_at)).map(clone);
  }

  markPaid(id: string, operatorTxRef: string, now = new Date().toISOString()): void {
    const w = this.wins.get(id);
    if (!w || w.status === "paid") return;
    w.status = "paid"; w.operator_tx_ref = operatorTxRef; w.error_code = null; w.paid_at = now; w.attempts += 1; w.version += 1;
    this.persistence.save("promo_wins", w);
  }

  markFailed(id: string, code: string): void {
    const w = this.wins.get(id);
    if (!w || w.status === "paid") return;
    w.status = "failed"; w.error_code = code.slice(0, 120); w.attempts += 1; w.version += 1;
    this.persistence.save("promo_wins", w);
  }
}
