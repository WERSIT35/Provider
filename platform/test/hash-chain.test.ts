import { describe, it, expect } from "vitest";
import { createHash, randomBytes } from "node:crypto";
import { stableStringify, hashPayload } from "../src/modules/ledger/hash-chain";
import { EngineService } from "../src/modules/engine/engine.service";

/** The original implementation every stored hash was computed with. Never change it. */
function original(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(original).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${original(obj[k])}`).join(",")}}`;
}

describe("stableStringify: the bytes every ledger hash depends on", () => {
  it("golden strings, quirks included (undefined → null, array hole → empty)", () => {
    // eslint-disable-next-line no-sparse-arrays
    const v = { b: [1, , 3], a: undefined, c: { z: -0, y: "é \"" }, d: [undefined, null, NaN], e: new Date(0), f: () => 1 };
    expect(stableStringify(v)).toBe('{"a":null,"b":[1,,3],"c":{"y":"é \\"","z":0},"d":[null,null,null],"e":{},"f":null}');
    // Key order never matters; the hash is SHA-256 of exactly those bytes.
    expect(hashPayload({ x: 1, a: [true, "s"] })).toBe(hashPayload({ a: [true, "s"], x: 1 }));
    expect(hashPayload({ x: 1, a: [true, "s"] })).toBe(createHash("sha256").update('{"a":[true,"s"],"x":1}').digest("hex"));
  });

  it("identical to the original on 300 real engine outcomes", () => {
    const e = new EngineService();
    for (let i = 0; i < 300; i++) {
      const out = e.resolveDeterministic({}, { bet_amount: 1 }, randomBytes(32).toString("hex"));
      expect(stableStringify(out)).toBe(original(out));
    }
  });
});
