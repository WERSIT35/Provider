/**
 * Strict request bodies for the money-facing APIs (game + operator).
 *
 * A body must be a plain JSON object holding ONLY the route's known fields, each of the
 * right type. Unknown fields are refused (422) instead of ignored. The engine behind the
 * RGS still understands dev inputs (forced multipliers, crazy mode), so a request that
 * tries to name one, by accident or on purpose, is a client bug or a probe, and the
 * answer is a clear refusal that also shows up in the logs.
 */

export type BodyCheck<T> = { ok: true; body: T } | { ok: false; message: string };

type FieldType = "string" | "boolean" | "bet" | "index";
type Shape = Record<string, { type: FieldType; required?: boolean }>;

/** A stake: a finite, positive number (the session's allowed_bets decide the rest). */
export function isStake(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/**
 * An Idempotency-Key: 1–128 chars of [A-Za-z0-9._:-]. It becomes the round ref and the
 * casino's wallet keys, so nothing else (spaces, control chars, slashes) may get in.
 */
export function isIdempotencyKey(v: unknown): v is string {
  return typeof v === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(v);
}

export function checkBody<T>(raw: unknown, shape: Shape): BodyCheck<T> {
  const body = raw ?? {};
  if (typeof body !== "object" || Array.isArray(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const obj = body as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => !Object.prototype.hasOwnProperty.call(shape, k));
  if (unknown.length) return { ok: false, message: `unknown field(s): ${unknown.join(", ")}` };
  for (const [key, spec] of Object.entries(shape)) {
    const v = obj[key];
    if (v === undefined) {
      if (spec.required) return { ok: false, message: `${key} required` };
      continue;
    }
    if (spec.type === "bet" && !isStake(v)) return { ok: false, message: `${key} must be a positive finite number` };
    if (spec.type === "boolean" && typeof v !== "boolean") return { ok: false, message: `${key} must be a boolean` };
    if (spec.type === "index" && (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 63)) return { ok: false, message: `${key} must be an integer 0-63` };
    if (spec.type === "string" && (typeof v !== "string" || v.length > 256)) return { ok: false, message: `${key} must be a string (max 256)` };
  }
  return { ok: true, body: obj as T };
}

// choice: a pick from the pending offer (stateful games; the orchestrator checks it against the offer).
export const SPIN_BODY: Shape = { bet_amount: { type: "bet", required: true }, ante_enabled: { type: "boolean" }, choice: { type: "index" } };
export const BUY_BODY: Shape = { bet_amount: { type: "bet", required: true } };
export const LAUNCH_BODY: Shape = {
  game_code: { type: "string", required: true },
  operator_player_id: { type: "string", required: true },
  currency: { type: "string", required: true },
  origin: { type: "string", required: true }
};
export const GRANT_BODY: Shape = { campaign_id: { type: "string", required: true }, operator_player_id: { type: "string", required: true } };
export const CANCEL_BODY: Shape = { campaign_id: { type: "string", required: true }, operator_player_id: { type: "string" } };
