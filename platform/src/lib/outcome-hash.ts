import { createHash } from "node:crypto";

/**
 * Deterministic hash of a spin outcome for the immutable round ledger.
 *
 * We hash the *game outcome*, not volatile identifiers. `spin_id` and per-multiplier
 * `id`s are generated fresh each run (the engine's multiplier nonce is process-global),
 * so they differ between an original resolve and a replay even though the actual symbols,
 * positions, wins and totals are identical. Stripping them lets a seeded replay reproduce
 * the exact same hash — the property certification/auditing relies on.
 */

const VOLATILE_KEYS = new Set(["id", "spin_id"]);

function stripVolatile(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (VOLATILE_KEYS.has(key)) continue;
      out[key] = stripVolatile((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Canonical projection used for hashing (volatile ids removed). */
export function canonicalOutcome(result: unknown): unknown {
  return stripVolatile(result);
}

export function outcomeHash(result: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalOutcome(result))).digest("hex");
}
