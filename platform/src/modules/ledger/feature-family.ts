import type { RoundRecord } from "./ledger.types";

/**
 * Bonus families, derived from the round ledger itself (no stored column).
 *
 * Inside a session, engine free spins only ever play inside a feature, and a
 * feature always starts at the round that triggered it. So a family is: the
 * trigger (a non-free-spin round whose outcome awarded free spins) followed by
 * every consecutive free-spin round of the same session, until the session's next
 * non-free-spin round. The family key is the trigger's round_ref — the same value
 * the orchestrator sends to the casino as featureRef on each free spin (both come
 * from the session's feature lock, set on the trigger round).
 *
 * Deriving it from the hash-chained ledger means it is available for every round
 * ever recorded, and adds nothing to the chained payload.
 */
export type FeatureRole = "trigger" | "free_spin";

export interface FeatureMembership {
  /** round_ref of the trigger: the bonus group key (featureRef). */
  feature_ref: string;
  role: FeatureRole;
  /** 0 for the trigger, 1..N for the free spins in play order. */
  index: number;
  /** Free spins in the family (N). */
  free_spins: number;
}

/** Map every round of ONE session that belongs to a bonus family to its membership. */
export function deriveFeatureFamilies(sessionRounds: readonly RoundRecord[]): Map<string, FeatureMembership> {
  const ordered = [...sessionRounds].sort((a, b) => a.seq - b.seq);
  const out = new Map<string, FeatureMembership>();
  let trigger: RoundRecord | null = null;
  let members: RoundRecord[] = [];
  const close = () => {
    if (trigger && members.length) {
      out.set(trigger.round_ref, { feature_ref: trigger.round_ref, role: "trigger", index: 0, free_spins: members.length });
      members.forEach((m, i) =>
        out.set(m.round_ref, { feature_ref: trigger!.round_ref, role: "free_spin", index: i + 1, free_spins: members.length })
      );
    }
    trigger = null;
    members = [];
  };
  for (const r of ordered) {
    if (r.is_free_spin) {
      // A free spin with no trigger in this session (rounds recorded before the
      // ledger existed) has no family key to hang on; it stays ungrouped.
      if (trigger) members.push(r);
      continue;
    }
    close();
    if (Number((r.outcome as { free_spins_awarded?: number } | undefined)?.free_spins_awarded ?? 0) > 0) trigger = r;
  }
  close();
  return out;
}
