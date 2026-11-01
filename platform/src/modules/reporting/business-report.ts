import type { RoundRecord } from "../ledger/ledger.types";
import type { DateRange } from "./reporting.service";

/**
 * Business reports (Operator Portal + Provider Control Plane "Reports"): one aggregate,
 * grouped by any mix of period, game, player and currency, so the Business Summary
 * (by period), Games Profit Summary (by game) and Member Business Summary (by player)
 * read the same numbers.
 *
 * Money is per currency: no exchange rates are applied, so a row never mixes
 * currencies. Voided rounds are left out (their money was reversed).
 *
 *  - bets_real: stakes actually charged (cash rounds; a feature's own free spins charge 0).
 *  - wins_real: wins on cash rounds and their features.
 *  - free_rounds / free_round_bet / free_round_win: operator-granted free rounds
 *    (campaigns): how many were played, their stake value (the grant's bet, never
 *    charged) and what they paid.
 *  - margin: bets_real - (wins_real + free_round_win): what the casino kept.
 *  - new_players: players whose first round ever falls in the row.
 *  - play_sessions: distinct game sessions with a round in the row.
 */
export const BUSINESS_PERIODS = ["day", "week", "month", "year", "total"] as const;
export type BusinessPeriod = (typeof BUSINESS_PERIODS)[number];

export interface BusinessQuery extends DateRange {
  period?: BusinessPeriod;
  /** Minutes east of UTC that periods are cut in (Tbilisi = 240). */
  tz_offset_min?: number;
  by_game?: boolean;
  by_player?: boolean;
  game_code?: string;
  operator_player_id?: string;
  limit?: number;
}

export interface BusinessRow {
  /** First day of the period (YYYY-MM-DD, in the query's time zone); null for "total". */
  period: string | null;
  game_code: string | null;
  operator_id: string | null;
  operator_player_id: string | null;
  currency: string;
  rounds: number;
  new_players: number;
  play_sessions: number;
  bets_real: number;
  wins_real: number;
  free_rounds: number;
  free_round_bet: number;
  free_round_win: number;
  margin: number;
}

export interface BusinessReport {
  rows: BusinessRow[];
  /** Per currency, over every row (not just the page). */
  totals: BusinessRow[];
  count: number;
  total_rows: number;
}

/** What a round needs from its session (currency and game are recorded there). */
export interface RoundContext {
  currency: string;
  game_code: string;
}

const round2 = (n: number): number => Number(n.toFixed(2));

/** Clamp the time-zone offset to a real one (UTC-12 … UTC+14). */
export function tzOffset(min: unknown): number {
  const n = Math.round(Number(min ?? 0));
  return Number.isFinite(n) ? Math.min(Math.max(n, -720), 840) : 0;
}

/** First day of the period holding `iso`, in the given offset. Weeks start on Monday. */
export function periodStart(iso: string, period: BusinessPeriod, tzMin: number): string | null {
  if (period === "total") return null;
  const d = new Date(Date.parse(iso) + tzMin * 60_000);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  let start: Date;
  if (period === "day") start = new Date(Date.UTC(y, m, day));
  else if (period === "week") start = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7)));
  else if (period === "month") start = new Date(Date.UTC(y, m, 1));
  else start = new Date(Date.UTC(y, 0, 1));
  return start.toISOString().slice(0, 10);
}

export function emptyRow(key: Pick<BusinessRow, "period" | "game_code" | "operator_id" | "operator_player_id" | "currency">): BusinessRow {
  return { ...key, rounds: 0, new_players: 0, play_sessions: 0, bets_real: 0, wins_real: 0, free_rounds: 0, free_round_bet: 0, free_round_win: 0, margin: 0 };
}

export function finishRows(rows: BusinessRow[], limit?: number): BusinessReport {
  for (const r of rows) {
    r.bets_real = round2(r.bets_real); r.wins_real = round2(r.wins_real);
    r.free_round_bet = round2(r.free_round_bet); r.free_round_win = round2(r.free_round_win);
    r.margin = round2(r.bets_real - r.wins_real - r.free_round_win);
  }
  rows.sort((a, b) =>
    (b.period ?? "").localeCompare(a.period ?? "") ||
    (a.currency.localeCompare(b.currency)) ||
    (a.operator_player_id || a.game_code ? b.bets_real - a.bets_real : 0) ||
    (a.game_code ?? "").localeCompare(b.game_code ?? "") ||
    (a.operator_player_id ?? "").localeCompare(b.operator_player_id ?? "")
  );
  const totals = new Map<string, BusinessRow>();
  for (const r of rows) {
    const t = totals.get(r.currency) ?? emptyRow({ period: null, game_code: null, operator_id: null, operator_player_id: null, currency: r.currency });
    for (const k of ["rounds", "new_players", "play_sessions", "bets_real", "wins_real", "free_rounds", "free_round_bet", "free_round_win"] as const) t[k] += r[k];
    totals.set(r.currency, t);
  }
  const totalRows = [...totals.values()];
  for (const t of totalRows) {
    t.bets_real = round2(t.bets_real); t.wins_real = round2(t.wins_real);
    t.free_round_bet = round2(t.free_round_bet); t.free_round_win = round2(t.free_round_win);
    t.margin = round2(t.bets_real - t.wins_real - t.free_round_win);
  }
  totalRows.sort((a, b) => a.currency.localeCompare(b.currency));
  const max = Math.min(Math.max(1, Math.floor(limit ?? 500)), 5000);
  const page = rows.slice(0, max);
  return { rows: page, totals: totalRows, count: page.length, total_rows: rows.length };
}

/**
 * In-memory form (tests, local dev). `all` = every round of the scope (first rounds
 * need the whole history); `voided` = refs whose latest adjustment voids them.
 * Play sessions and new players are counted per row, so a row's total is the sum of
 * its rows only when rows don't overlap (they never do: each round is in one row).
 */
export function aggregateBusiness(all: RoundRecord[], voided: Set<string>, ctx: (r: RoundRecord) => RoundContext, q: BusinessQuery): BusinessReport {
  const period = q.period ?? "day";
  const tz = tzOffset(q.tz_offset_min);
  const firstRound = new Map<string, string>();
  for (const r of all) {
    const k = r.operator_id + "\u0000" + r.operator_player_id;
    const f = firstRound.get(k);
    if (!f || r.created_at < f) firstRound.set(k, r.created_at);
  }
  const rows = new Map<string, BusinessRow>();
  const sessions = new Map<string, Set<string>>();
  const counted = new Map<string, Set<string>>();
  for (const r of all) {
    if (voided.has(r.round_ref)) continue;
    if (q.from && r.created_at < q.from) continue;
    if (q.to && r.created_at > q.to) continue;
    if (q.operator_player_id && r.operator_player_id !== q.operator_player_id) continue;
    const c = ctx(r);
    if (q.game_code && c.game_code !== q.game_code) continue;
    const key = {
      period: periodStart(r.created_at, period, tz),
      game_code: q.by_game ? c.game_code : null,
      operator_id: q.by_player ? r.operator_id : null,
      operator_player_id: q.by_player ? r.operator_player_id : null,
      currency: c.currency
    };
    const id = [key.period, key.game_code, key.operator_id, key.operator_player_id, key.currency].join("\u0000");
    const row = rows.get(id) ?? emptyRow(key);
    rows.set(id, row);
    row.rounds += 1;
    if (r.campaign_id) {
      row.free_rounds += 1;
      row.free_round_bet += r.bet_amount;
      row.free_round_win += r.total_win;
    } else {
      row.bets_real += r.bet_charged;
      row.wins_real += r.total_win;
    }
    const s = sessions.get(id) ?? new Set<string>();
    s.add(r.session_id); sessions.set(id, s);
    row.play_sessions = s.size;
    const pk = r.operator_id + "\u0000" + r.operator_player_id;
    if (firstRound.get(pk) === r.created_at) {
      const n = counted.get(id) ?? new Set<string>();
      if (!n.has(pk)) { n.add(pk); row.new_players += 1; }
      counted.set(id, n);
    }
  }
  return finishRows([...rows.values()], q.limit);
}
