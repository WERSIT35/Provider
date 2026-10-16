import { NullPersistence, type Persistence } from "../../persistence/persistence";

/**
 * Write-ahead record of a round that moves money (migration 0013).
 *
 * The casino's wallet and our ledger can't share a transaction, so a crash between
 * "the casino took the stake" and "the round is committed here" must be recoverable.
 * The orchestrator commits an intent BEFORE the debit ('open'), commits it with the
 * round BEFORE the credit ('committed'), and closes it after ('settled'). Boot-time
 * recovery (src/jobs/round-recovery.ts) finishes or unwinds whatever a crash left open.
 *
 *   open ──▶ committed ──▶ settled
 *     └────▶ voided   (the round never committed: its debit is reversed)
 */
export type RoundIntentStatus = "open" | "committed" | "settled" | "voided";

export interface RoundIntent {
  idempotency_key: string; // the round's request key: debit = `${key}:debit`, credit = `${key}:credit`
  round_ref: string;
  operator_id: string;
  session_id: string;
  operator_player_id: string;
  currency: string;
  /** Set when the round took (or would take) a stake. */
  debit_type: "DEBIT" | "FREE_ROUND_BET" | null;
  debit_amount: number;
  campaign_id: string | null;
  /** Set once the round committed with a win to credit. */
  credit_type: "CREDIT" | "FREE_ROUND_WIN" | null;
  win_amount: number | null;
  game_code: string | null;
  round_type: string | null;
  feature_ref: string | null;
  status: RoundIntentStatus;
  version: number;
  created_at: string;
  updated_at: string;
}

export type OpenIntentInput = Pick<
  RoundIntent,
  "idempotency_key" | "round_ref" | "operator_id" | "session_id" | "operator_player_id" | "currency" | "debit_type" | "debit_amount" | "campaign_id" | "game_code" | "round_type"
>;

export class RoundIntentStore {
  /** Unfinished intents only (open / committed); finished ones live in Postgres. */
  private readonly live = new Map<string, RoundIntent>();

  constructor(private readonly persistence: Persistence = NullPersistence) {}

  /** Boot: load the unfinished intents. */
  hydrate(rows: RoundIntent[]): void {
    for (const r of rows) if (r.status === "open" || r.status === "committed") this.live.set(r.idempotency_key, { ...r });
  }

  get(key: string): RoundIntent | null {
    const r = this.live.get(key);
    return r ? { ...r } : null;
  }

  /** Unfinished intents, oldest first. */
  list(status?: "open" | "committed"): RoundIntent[] {
    return [...this.live.values()].filter((r) => (status ? r.status === status : true)).sort((a, b) => a.created_at.localeCompare(b.created_at)).map((r) => ({ ...r }));
  }

  open(input: OpenIntentInput): RoundIntent {
    const now = new Date().toISOString();
    const intent: RoundIntent = {
      ...input,
      credit_type: null,
      win_amount: null,
      feature_ref: null,
      status: "open",
      version: 1,
      created_at: now,
      updated_at: now
    };
    this.live.set(intent.idempotency_key, intent);
    this.persistence.save("round_intents", intent);
    return { ...intent };
  }

  /**
   * The round is recorded: what is left is crediting `win` (0 = nothing). Creates the
   * intent if the round had no stake (engine free spins): nothing to unwind before
   * this point for those, but a win to credit after it.
   */
  commit(key: string, base: OpenIntentInput, credit: { credit_type: "CREDIT" | "FREE_ROUND_WIN"; win_amount: number; feature_ref: string | null; round_type: string }): void {
    const now = new Date().toISOString();
    const prev = this.live.get(key);
    const intent: RoundIntent = {
      ...(prev ?? { ...base, credit_type: null, win_amount: null, feature_ref: null, status: "open" as const, version: 0, created_at: now, updated_at: now }),
      ...credit,
      status: "committed",
      version: (prev?.version ?? 0) + 1,
      updated_at: now
    };
    this.live.set(key, intent);
    this.persistence.save("round_intents", intent);
  }

  /** Finished: settled (credited or nothing to credit) or voided (never committed). */
  close(key: string, status: "settled" | "voided"): void {
    const prev = this.live.get(key);
    if (!prev) return;
    this.live.delete(key);
    this.persistence.save("round_intents", { ...prev, status, version: prev.version + 1, updated_at: new Date().toISOString() });
  }

  size(): number {
    return this.live.size;
  }
}
