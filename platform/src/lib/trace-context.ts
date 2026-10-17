import { AsyncLocalStorage } from "node:async_hooks";
import { randomFillSync } from "node:crypto";

/**
 * W3C Trace Context (https://www.w3.org/TR/trace-context/) for correlating one player
 * action across the game client, the RGS, the casino's wallet webhooks and both
 * money ledgers.
 *
 *   traceparent: 00-<trace-id 32 hex>-<parent-id 16 hex>-<flags 2 hex>
 *
 * The RGS continues an incoming trace (the client starts one per round) or starts
 * its own, gives each request its own span, echoes `traceparent` on the response,
 * and forwards a child span to the casino's wallet webhooks. The current trace lives
 * in AsyncLocalStorage, so deep code (the wallet adapter, the transaction store)
 * reads it without it being threaded through every call.
 */
export interface TraceContext {
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  sampled: boolean;
}

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
const store = new AsyncLocalStorage<TraceContext>();

// Ids come from a pooled CSPRNG buffer (one randomFillSync per 4 KB, not one
// randomBytes allocation per id): every request and every outbound call needs them.
const POOL = Buffer.alloc(4096);
let poolPos = POOL.length;
function randomHex(bytes: number): string {
  if (poolPos + bytes > POOL.length) {
    randomFillSync(POOL);
    poolPos = 0;
  }
  const hex = POOL.toString("hex", poolPos, poolPos + bytes);
  poolPos += bytes;
  return hex;
}
const ZERO_TRACE = "0".repeat(32);
const ZERO_SPAN = "0".repeat(16);
export const newTraceId = (): string => {
  let id: string;
  do id = randomHex(16);
  while (id === ZERO_TRACE);
  return id;
};
export const newSpanId = (): string => {
  let id: string;
  do id = randomHex(8);
  while (id === ZERO_SPAN);
  return id;
};

/** Parse a traceparent header; null if absent or invalid (all-zero ids are invalid). */
export function parseTraceparent(header: unknown): { traceId: string; spanId: string; sampled: boolean } | null {
  if (typeof header !== "string") return null;
  const m = TRACEPARENT.exec(header.trim().toLowerCase());
  if (!m || /^0+$/.test(m[1]) || /^0+$/.test(m[2])) return null;
  return { traceId: m[1], spanId: m[2], sampled: (parseInt(m[3], 16) & 1) === 1 };
}

export function formatTraceparent(traceId: string, spanId: string, sampled = true): string {
  return `00-${traceId}-${spanId}-${sampled ? "01" : "00"}`;
}

/** Continue the incoming trace (new span) or start a new one. */
export function contextFrom(header: unknown): TraceContext {
  const parent = parseTraceparent(header);
  return {
    traceId: parent?.traceId ?? newTraceId(),
    spanId: newSpanId(),
    parentSpanId: parent?.spanId ?? null,
    sampled: parent?.sampled ?? true
  };
}

/** Make `ctx` the current trace for the rest of this async execution. */
export function enterTrace(ctx: TraceContext): void {
  store.enterWith(ctx);
}

export function runWithTrace<T>(ctx: TraceContext, fn: () => T): T {
  return store.run(ctx, fn);
}

export function currentTrace(): TraceContext | undefined {
  return store.getStore();
}

/** traceparent for an outbound call made inside the current trace (a child span). */
export function outboundTraceparent(): string | undefined {
  const ctx = store.getStore();
  return ctx ? formatTraceparent(ctx.traceId, newSpanId(), ctx.sampled) : undefined;
}
