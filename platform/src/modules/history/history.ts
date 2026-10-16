import type { RoundRecord, AuditRecord, ChainVerification } from "../ledger/ledger.types";
import type { InMemoryRoundRepository } from "../ledger/memory-repositories";
import { contentOf, verifyChainGeneric } from "../ledger/memory-repositories";
import { GENESIS_HASH, hashPayload, chainHash } from "../ledger/hash-chain";
import type { RoundLedgerService, IntegrityReport } from "../ledger/round-ledger.service";
import type { InMemoryTransactionStore, TxRecord } from "../wallet/transaction-store";
import type { InMemoryRoundAdjustmentStore } from "../rounds/round-adjustment.store";
import type { SessionService } from "../session/session.service";
import type { PostgresPersistence } from "../../persistence/persistence";
import type { SignatureStatus, SignatureSummary } from "../../lib/security/signing-keyring";
import {
  ReportingService,
  type DateRange,
  type GgrByDay,
  type PlayerReport,
  type PlayerReportQuery,
  type PlayerReportRow,
  type PlayerSummary,
  type Reconciliation,
  type RoundsSummary,
  type RtpReport
} from "../reporting/reporting.service";

/**
 * Reads over the WHOLE history (reports, single-round views of any age, the integrity
 * sweep), separated from the hot path so memory stays bounded (Phase 2):
 *
 *  - MemoryHistory: in-memory mode (tests, local dev). Every row is in memory, so it
 *    answers from the stores exactly as the platform always did.
 *  - PgHistory: Postgres is the system of record and memory holds only a window.
 *    Reports are SQL aggregates; a view of one round first pulls that round, its
 *    session's rounds, chain neighbours and money moves into the stores' bounded cold
 *    cache (ensureRound), so the existing synchronous services work unchanged; the
 *    integrity sweep streams both ledgers page by page.
 */
export interface PlayerRounds {
  /** Newest first, at most `limit`. */
  rounds: RoundRecord[];
  /** All of the player's rounds (not just the page). */
  total: number;
  /** Every round of the sessions on the page, for bonus-family tags. */
  familyRounds: RoundRecord[];
  /** Session currency by session id (sessions may no longer be in memory). */
  currencies: Record<string, string>;
}

export interface Overview {
  distinct_players: number;
  sessions_total: number;
  sessions_active: number;
  summary: RoundsSummary;
  recent_transactions: TxRecord[];
}

export interface HistoryReads {
  roundsSummary(operatorId?: string, range?: DateRange): Promise<RoundsSummary>;
  rtpReport(operatorId?: string, range?: DateRange): Promise<RtpReport>;
  ggrByDay(operatorId?: string, range?: DateRange): Promise<GgrByDay[]>;
  playerReport(operatorId?: string, query?: PlayerReportQuery): Promise<PlayerReport>;
  playerSummary(operatorId: string, operatorPlayerId: string): Promise<PlayerSummary | null>;
  playerRounds(operatorId: string | undefined, operatorPlayerId: string, limit: number): Promise<PlayerRounds>;
  reconcile(operatorId?: string, range?: DateRange): Promise<Reconciliation>;
  overview(operatorId: string): Promise<Overview>;
  transactionsForRound(roundRef: string): Promise<TxRecord[]>;
  /** Make one round (and what its views read) available to the synchronous services. False = no such round. */
  ensureRound(roundRef: string): Promise<boolean>;
  /** Make a session's reality-check totals complete (all its rounds) before it plays. */
  ensureSessionStats(sessionId: string): Promise<void>;
  /** Both ledgers' chains and signatures, end to end. */
  verifyIntegrity(): Promise<IntegrityReport & { checked_at: string; scope: "full" }>;
  /** Has this idempotency key ever made a round, an intent or a money move? */
  keyUsed(key: string): Promise<boolean>;
}

export class MemoryHistory implements HistoryReads {
  constructor(
    private readonly reporting: ReportingService,
    private readonly ledger: RoundLedgerService,
    private readonly transactions: InMemoryTransactionStore,
    private readonly sessions: SessionService
  ) {}

  async roundsSummary(op?: string, range: DateRange = {}) { return this.reporting.roundsSummary(op, range); }
  async rtpReport(op?: string, range: DateRange = {}) { return this.reporting.rtpReport(op, range); }
  async ggrByDay(op?: string, range: DateRange = {}) { return this.reporting.ggrByDay(op, range); }
  async playerReport(op?: string, q: PlayerReportQuery = {}) { return this.reporting.playerReport(op, q); }
  async playerSummary(op: string, player: string) { return this.reporting.playerSummary(op, player); }
  async reconcile(op?: string, range: DateRange = {}) { return this.reporting.reconcile(op, range); }
  async transactionsForRound(ref: string) { return this.reporting.transactionsForRound(ref); }
  async ensureRound(ref: string) { return this.ledger.getRound(ref) !== null; }
  async ensureSessionStats() { /* memory mode holds every round */ }
  async keyUsed(key: string) {
    return this.ledger.getRound(`r_${key}`) !== null || this.transactions.getByKey(`${key}:debit`) !== null;
  }

  async playerRounds(op: string | undefined, player: string, limit: number): Promise<PlayerRounds> {
    const all = this.reporting.listRoundsByPlayer(op, player);
    const currencies: Record<string, string> = {};
    for (const r of all) {
      const c = this.sessions.tryGet(r.session_id)?.currency;
      if (c) currencies[r.session_id] = c;
    }
    return { rounds: all.slice(0, limit), total: all.length, familyRounds: all, currencies };
  }

  async overview(op: string): Promise<Overview> {
    const rounds = this.reporting.listRounds(op);
    const sessions = this.sessions.listByOperator(op);
    return {
      distinct_players: new Set(rounds.map((r) => r.operator_player_id)).size,
      sessions_total: sessions.length,
      sessions_active: sessions.filter((s) => s.status === "active").length,
      summary: this.reporting.roundsSummary(op),
      recent_transactions: this.transactions.list({ operator_id: op }).sort((a, b) => b.seq - a.seq).slice(0, 20)
    };
  }

  async verifyIntegrity() {
    return { ...this.ledger.verifyIntegrity(), checked_at: new Date().toISOString(), scope: "full" as const };
  }
}

const round2 = (n: unknown): number => Number(Number(n ?? 0).toFixed(2));
const BET_TYPES = ["DEBIT", "FREE_ROUND_BET"];
const WIN_TYPES = ["CREDIT", "FREE_ROUND_WIN"];

export class PgHistory implements HistoryReads {
  /** Last full sweep, reused by per-round verification (chainOk). */
  private lastSweep: (IntegrityReport & { checked_at: string; scope: "full" }) | null = null;
  private sweeping: Promise<IntegrityReport & { checked_at: string; scope: "full" }> | null = null;

  constructor(
    private readonly db: PostgresPersistence,
    private readonly rounds: InMemoryRoundRepository,
    private readonly transactions: InMemoryTransactionStore,
    private readonly adjustments: InMemoryRoundAdjustmentStore,
    private readonly verifier?: { verifyLedger(table: "rounds" | "audit_records", row: { seq: number; chain_hash: string; signature?: string | null; signing_key_id?: string | null }): SignatureStatus }
  ) {}

  /** SQL for the rounds that count financially (voided ones excluded), with its params. */
  private financial(op: string | undefined, range: DateRange, extra = ""): { sql: string; params: unknown[] } {
    const params: unknown[] = [];
    const conds: string[] = [];
    if (op) { params.push(op); conds.push(`r.operator_id = $${params.length}`); }
    if (range.from) { params.push(range.from); conds.push(`r.created_at >= $${params.length}::timestamptz`); }
    if (range.to) { params.push(range.to); conds.push(`r.created_at <= $${params.length}::timestamptz`); }
    // A round is voided when its LATEST adjustment says so (a later one may un-void it).
    // Uncorrelated (evaluated once per query, adjustments are few), not once per round.
    conds.push(`r.round_ref NOT IN (SELECT v.round_ref FROM (SELECT DISTINCT ON (a.round_ref) a.round_ref, a.effective_status FROM round_adjustments a ORDER BY a.round_ref, a.seq DESC) v WHERE v.effective_status = 'void')`);
    if (extra) conds.push(extra);
    return { sql: `FROM rounds r WHERE ${conds.join(" AND ")}`, params };
  }

  async roundsSummary(op?: string, range: DateRange = {}): Promise<RoundsSummary> {
    const f = this.financial(op, range);
    const r = (await this.db.query(`SELECT count(*)::bigint AS n, coalesce(sum(r.bet_charged),0) AS bet, coalesce(sum(r.total_win),0) AS win ${f.sql}`, f.params)).rows[0];
    const total_bet = round2(r.bet), total_win = round2(r.win), ggr = round2(total_bet - total_win);
    return { rounds: Number(r.n), total_bet, total_win, ggr, hold_percent: total_bet > 0 ? round2((ggr / total_bet) * 100) : 0 };
  }

  async rtpReport(op?: string, range: DateRange = {}): Promise<RtpReport> {
    const s = await this.roundsSummary(op, range);
    return { rounds: s.rounds, total_bet: s.total_bet, total_win: s.total_win, actual_rtp_percent: s.total_bet > 0 ? round2((s.total_win / s.total_bet) * 100) : 0 };
  }

  async ggrByDay(op?: string, range: DateRange = {}): Promise<GgrByDay[]> {
    const f = this.financial(op, range);
    const rows = (await this.db.query(
      `SELECT to_char(r.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date, count(*)::bigint AS n, sum(r.bet_charged) AS bet, sum(r.total_win) AS win ${f.sql} GROUP BY 1 ORDER BY 1`,
      f.params
    )).rows;
    return rows.map((r) => {
      const total_bet = round2(r.bet), total_win = round2(r.win);
      return { date: String(r.date), rounds: Number(r.n), total_bet, total_win, ggr: round2(total_bet - total_win) };
    });
  }

  async playerReport(op?: string, q: PlayerReportQuery = {}): Promise<PlayerReport> {
    const f = this.financial(op, q, q.game_id ? `r.game_id = $GAME` : "");
    let sql = f.sql;
    const params = [...f.params];
    if (q.game_id) { params.push(q.game_id); sql = sql.replace("$GAME", `$${params.length}`); }
    const rows = (await this.db.query(
      `SELECT r.operator_id, r.operator_player_id, count(*)::bigint AS rounds, count(*) FILTER (WHERE r.is_free_spin)::bigint AS free_spin_rounds,
              sum(r.bet_charged) AS bet, sum(r.total_win) AS win, max(r.total_win) AS biggest,
              min(r.created_at) AS first_seen, max(r.created_at) AS last_seen
       ${sql} GROUP BY r.operator_id, r.operator_player_id`,
      params
    )).rows;
    const players = rows.map((r) => finishRow({
      operator_id: String(r.operator_id), operator_player_id: String(r.operator_player_id), rounds: Number(r.rounds),
      free_spin_rounds: Number(r.free_spin_rounds), total_bet: round2(r.bet), total_win: round2(r.win), ggr: 0, rtp_percent: 0,
      biggest_win: Number(r.biggest ?? 0), first_seen: String(r.first_seen), last_seen: String(r.last_seen)
    }));
    const sort = q.sort ?? "total_bet";
    players.sort((a, b) => {
      const d = sort === "last_seen" ? b.last_seen.localeCompare(a.last_seen) : b[sort] - a[sort];
      return d !== 0 ? d : a.operator_player_id.localeCompare(b.operator_player_id);
    });
    const limit = Math.min(Math.max(1, Math.floor(q.limit ?? 100)), 1000);
    const page = players.slice(0, limit);
    return { players: page, count: page.length, total_players: players.length };
  }

  async playerSummary(op: string, player: string): Promise<PlayerSummary | null> {
    const all = (await this.db.query(
      `SELECT count(*)::bigint AS n, min(created_at) AS first_seen, max(created_at) AS last_seen, count(DISTINCT game_id)::bigint AS games
         FROM rounds WHERE operator_id = $1 AND operator_player_id = $2`,
      [op, player]
    )).rows[0];
    if (!Number(all.n)) return null;
    const f = this.financial(op, {}, `r.operator_player_id = $PLAYER`);
    const params = [...f.params, player];
    const sql = f.sql.replace("$PLAYER", `$${params.length}`);
    const fin = (await this.db.query(
      `SELECT count(*)::bigint AS n, count(*) FILTER (WHERE r.is_free_spin)::bigint AS fs, coalesce(sum(r.bet_charged),0) AS bet,
              coalesce(sum(r.total_win),0) AS win, coalesce(max(r.total_win),0) AS biggest ${sql}`,
      params
    )).rows[0];
    const row = finishRow({
      operator_id: op, operator_player_id: player, rounds: Number(fin.n), free_spin_rounds: Number(fin.fs),
      total_bet: round2(fin.bet), total_win: round2(fin.win), ggr: 0, rtp_percent: 0, biggest_win: Number(fin.biggest),
      first_seen: String(all.first_seen), last_seen: String(all.last_seen)
    });
    return { ...row, voided_rounds: Number(all.n) - Number(fin.n), games_played: Number(all.games) };
  }

  async playerRounds(op: string | undefined, player: string, limit: number): Promise<PlayerRounds> {
    const where = op ? "operator_id = $1 AND operator_player_id = $2" : "operator_player_id = $1";
    const params = op ? [op, player] : [player];
    const page = (await this.db.loadRows("rounds", { where, params, newestFirst: true, limit })) as unknown as RoundRecord[];
    const total = Number((await this.db.query(`SELECT count(*)::bigint AS n FROM rounds WHERE ${where}`, params)).rows[0].n);
    const sessionIds = [...new Set(page.map((r) => r.session_id))];
    const familyRounds = sessionIds.length
      ? ((await this.db.loadRows("rounds", { where: "session_id = ANY($1)", params: [sessionIds] })) as unknown as RoundRecord[])
      : [];
    const currencies: Record<string, string> = {};
    if (sessionIds.length) {
      for (const s of (await this.db.query("SELECT id, currency FROM player_sessions WHERE id = ANY($1)", [sessionIds])).rows) currencies[String(s.id)] = String(s.currency);
    }
    const rounds = page.slice().reverse(); // newest first (loadRows returns oldest first)
    rounds.sort((a, b) => b.created_at.localeCompare(a.created_at) || b.seq - a.seq);
    return { rounds, total, familyRounds, currencies };
  }

  async reconcile(op?: string, range: DateRange = {}): Promise<Reconciliation> {
    const f = this.financial(op, range);
    const r = (await this.db.query(`SELECT coalesce(sum(r.bet_charged),0) AS bet, coalesce(sum(r.total_win),0) AS win ${f.sql}`, f.params)).rows[0];
    const rounds_total_bet = round2(r.bet), rounds_total_win = round2(r.win);
    const opCond = op ? "AND operator_id = $1" : "";
    const p = op ? [op] : [];
    const t = (await this.db.query(
      `SELECT
         coalesce(sum(amount) FILTER (WHERE type = ANY('{${BET_TYPES.join(",")}}') AND status = 'confirmed'),0) AS debits,
         coalesce(sum(amount) FILTER (WHERE type = ANY('{${WIN_TYPES.join(",")}}') AND status = 'confirmed'),0) AS credits,
         coalesce(sum(amount) FILTER (WHERE type = 'ADJUSTMENT' AND status = 'confirmed'),0) AS clawbacks
       FROM wallet_transactions WHERE true ${opCond}`,
      p
    )).rows[0];
    // Only rollbacks of CONFIRMED debits net against the debits (as ReportingService).
    const rb = (await this.db.query(
      `SELECT coalesce(sum(t.amount),0) AS rollbacks FROM wallet_transactions t
        WHERE t.type = 'ROLLBACK' AND t.status = 'rolled_back' ${op ? "AND t.operator_id = $1" : ""}
          AND EXISTS (SELECT 1 FROM wallet_transactions d WHERE d.round_ref = t.round_ref AND d.type = ANY('{${BET_TYPES.join(",")}}') AND d.status = 'confirmed')`,
      p
    )).rows[0];
    const tx_debits = round2(t.debits), tx_rollbacks = round2(rb.rollbacks);
    const tx_credits = round2(round2(t.credits) - round2(t.clawbacks));
    const bet_vs_debit_diff = round2(rounds_total_bet - (tx_debits - tx_rollbacks));
    const win_vs_credit_diff = round2(rounds_total_win - tx_credits);
    return {
      ok: Math.abs(bet_vs_debit_diff) < 0.01 && win_vs_credit_diff > -0.01,
      rounds_total_bet, rounds_total_win, tx_debits, tx_credits, tx_rollbacks, bet_vs_debit_diff, win_vs_credit_diff
    };
  }

  async overview(op: string): Promise<Overview> {
    const players = (await this.db.query("SELECT count(DISTINCT operator_player_id)::bigint AS n FROM rounds WHERE operator_id = $1", [op])).rows[0];
    const sessions = (await this.db.query(
      "SELECT count(*)::bigint AS total, count(*) FILTER (WHERE status = 'active')::bigint AS active FROM player_sessions WHERE operator_id = $1",
      [op]
    )).rows[0];
    const recent = (await this.db.loadRows("wallet_transactions", { where: "operator_id = $1", params: [op], newestFirst: true, limit: 20 })) as unknown as TxRecord[];
    return {
      distinct_players: Number(players.n),
      sessions_total: Number(sessions.total),
      sessions_active: Number(sessions.active),
      summary: await this.roundsSummary(op),
      recent_transactions: recent.reverse()
    };
  }

  async transactionsForRound(ref: string): Promise<TxRecord[]> {
    return (await this.db.loadRows("wallet_transactions", { where: "round_ref = $1", params: [ref] })) as unknown as TxRecord[];
  }

  private readonly statsLoading = new Map<string, Promise<void>>();

  /**
   * After a restart a session's totals miss its rounds older than the window. Its first
   * request loads them (one index-only aggregate), shared by concurrent requests and
   * before any round of the session starts, so no uncommitted round is overwritten.
   */
  ensureSessionStats(sessionId: string): Promise<void> {
    if (!this.rounds.statsArePending(sessionId)) return Promise.resolve();
    let p = this.statsLoading.get(sessionId);
    if (!p) {
      p = this.db
        .query("SELECT count(*)::bigint AS rounds, coalesce(sum(bet_charged),0) AS wagered, coalesce(sum(total_win),0) AS won FROM rounds WHERE session_id = $1", [sessionId])
        .then((r) => {
          const row = r.rows[0] as { rounds: string; wagered: string; won: string };
          this.rounds.seedSessionStats([{ session_id: sessionId, rounds: Number(row.rounds), wagered: Number(row.wagered), won: Number(row.won) }]);
        })
        .finally(() => this.statsLoading.delete(sessionId));
      this.statsLoading.set(sessionId, p);
    }
    return p;
  }

  async ensureRound(ref: string): Promise<boolean> {
    let round = this.rounds.getByRef(ref);
    if (!round) {
      const found = (await this.db.loadRows("rounds", { where: "round_ref = $1", params: [ref] })) as unknown as RoundRecord[];
      if (!found.length) return false;
      round = found[0];
      // The session's rounds (bonus family), and the chain neighbours (local chain check).
      const session = (await this.db.loadRows("rounds", { where: "session_id = $1", params: [round.session_id], newestFirst: true, limit: 2_000 })) as unknown as RoundRecord[];
      const neighbours = (await this.db.loadRows("rounds", { where: "seq BETWEEN $1 AND $2", params: [round.seq - 1, round.seq + 1] })) as unknown as RoundRecord[];
      this.rounds.addCold([...session, ...neighbours, round]);
    }
    if (!this.transactions.list({ round_ref: ref }).length) {
      this.transactions.addCold((await this.db.loadRows("wallet_transactions", { where: "round_ref = $1", params: [ref] })) as unknown as TxRecord[]);
    }
    return true;
  }

  /**
   * The chain around ONE round (Round Inspector, exports): its payload hash, its link to
   * the previous row and the next row's link to it, plus the verdict of the last full
   * sweep. Re-walking every row on each inspector open would cost O(history).
   */
  async roundChain(ref: string): Promise<ChainVerification> {
    if (!(await this.ensureRound(ref))) return { ok: false, length: 0, brokenAtSeq: -1, reason: "round_not_found" };
    return this.roundChainHeld(ref);
  }

  /** Synchronous form for rows already held (call ensureRound first). */
  roundChainHeld(ref: string): ChainVerification {
    const round = this.rounds.getByRef(ref);
    if (!round) return { ok: false, length: 0, brokenAtSeq: -1, reason: "round_not_found" };
    const near = this.rounds.list().filter((r) => r.seq >= round.seq - 1 && r.seq <= round.seq + 1).sort((a, b) => a.seq - b.seq);
    const start = near[0].seq === 0 ? GENESIS_HASH : near[0].prev_hash;
    const local = verifyChainGeneric(near, start);
    if (!local.ok) return local;
    if (this.lastSweep && !this.lastSweep.rounds.ok) return this.lastSweep.rounds;
    return { ok: true, length: this.rounds.size() };
  }

  /** The last completed full sweep, if any (per-round checks reuse its verdict). */
  lastIntegrity() {
    return this.lastSweep;
  }

  async verifyIntegrity() {
    // One sweep at a time; concurrent callers share it.
    if (!this.sweeping) {
      this.sweeping = this.sweep().finally(() => { this.sweeping = null; });
    }
    return this.sweeping;
  }

  private async sweep() {
    const [rounds, audit] = await Promise.all([this.sweepTable("rounds"), this.sweepTable("audit_records")]);
    const report: IntegrityReport & { checked_at: string; scope: "full" } = {
      rounds: rounds.chain, audit: audit.chain, checked_at: new Date().toISOString(), scope: "full",
      ...(this.verifier ? { signatures: { rounds: rounds.sigs, audit: audit.sigs } } : {})
    };
    this.lastSweep = report;
    return report;
  }

  /** Stream one ledger in seq order, page by page (bounded memory), checking every link and signature. */
  private async sweepTable(table: "rounds" | "audit_records"): Promise<{ chain: ChainVerification; sigs: SignatureSummary }> {
    const PAGE = 2_000;
    let prev = GENESIS_HASH;
    let next = 0;
    let length = 0;
    let chain: ChainVerification | null = null;
    const sigs: SignatureSummary = { ok: true, checked: 0, valid: 0, unsigned: 0, invalid: 0, unknown_key: 0, first_bad_seq: null };
    for (;;) {
      const page = (await this.db.loadRows(table, { where: "seq >= $1", params: [next], limit: PAGE })) as unknown as Array<RoundRecord | AuditRecord>;
      if (!page.length) break;
      for (const row of page) {
        length += 1;
        if (!chain) {
          const payload = hashPayload(contentOf(row as unknown as Record<string, unknown>));
          if (row.seq !== next) chain = { ok: false, length, brokenAtSeq: row.seq, reason: "seq_gap" };
          else if (payload !== row.payload_hash) chain = { ok: false, length, brokenAtSeq: row.seq, reason: "payload_hash_mismatch" };
          else if (row.prev_hash !== prev) chain = { ok: false, length, brokenAtSeq: row.seq, reason: "prev_hash_mismatch" };
          else if (chainHash(prev, payload) !== row.chain_hash) chain = { ok: false, length, brokenAtSeq: row.seq, reason: "chain_hash_mismatch" };
        }
        prev = row.chain_hash;
        next = row.seq + 1;
        if (this.verifier) {
          const status = this.verifier.verifyLedger(table, row);
          sigs.checked += 1;
          sigs[status] += 1;
          if ((status === "invalid" || status === "unknown_key") && sigs.first_bad_seq === null) {
            sigs.first_bad_seq = row.seq;
            sigs.ok = false;
          }
        }
      }
      if (page.length < PAGE) break;
    }
    return { chain: chain ? { ...chain, length } : { ok: true, length }, sigs };
  }

  async keyUsed(key: string): Promise<boolean> {
    const r = await this.db.query(
      `SELECT 1 FROM round_intents WHERE idempotency_key = $1
       UNION ALL SELECT 1 FROM rounds WHERE round_ref = $2
       UNION ALL SELECT 1 FROM wallet_transactions WHERE idempotency_key = $3
       LIMIT 1`,
      [key, `r_${key}`, `${key}:debit`]
    );
    return r.rows.length > 0;
  }
}

function finishRow(row: PlayerReportRow): PlayerReportRow {
  const ggr = round2(row.total_bet - row.total_win);
  return { ...row, ggr, rtp_percent: row.total_bet > 0 ? round2((row.total_win / row.total_bet) * 100) : 0 };
}
