import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, scriptedRng, floatFor, LETTERS, rules as loadRules, plain } from "./helpers.mjs";

const RF = loadEngine();
const R = loadRules();
const BASE = { start: 1, inc: 1, burst: 2 };

function sequence(bursts, rule = BASE) {
  let m = null;
  return bursts.map((b) => (m = RF.Mult.stepMult(m, b ? [0] : [], rule)));
}

test("Mult: ×1 on the first evaluation, +1 per cascade step", () => {
  assert.deepEqual(sequence([false, false, false, false]), [1, 2, 3, 4]);
});

test("a Line Burst doubles the running Mult from that step on", () => {
  assert.deepEqual(sequence([false, true, false, true]), [1, 4, 5, 12]);
  assert.deepEqual(sequence([true]), [2]);
});

test("the rule's numbers drive it (Chain: +2 per step; Surge: a carried start; ×3 bursts)", () => {
  assert.deepEqual(sequence([false, false, true], { start: 1, inc: 2, burst: 2 }), [1, 3, 10]);
  assert.deepEqual(sequence([false, true], { start: 7, inc: 1, burst: 3 }), [7, 24]);
});

test("an optional ceiling bounds the Mult (off by default)", () => {
  assert.deepEqual(sequence([true, true, true, true], { start: 1, inc: 1, burst: 2, max: 20 }), [2, 6, 14, 20]);
  assert.deepEqual(sequence([true, true, true, true]), [2, 6, 14, 30]);
});

test("fullRows: only rows with every cell cleared, once each", () => {
  const cells = (row, cols) => cols.map((col) => ({ row, col }));
  assert.deepEqual(plain(RF.Mult.fullRows([...cells(0, [0, 1, 2, 3, 4, 5]), ...cells(2, [0, 1, 2, 3, 4])], 5, 6)), [0]);
  assert.deepEqual(plain(RF.Mult.fullRows([...cells(4, [0, 1, 2, 3, 4, 5]), ...cells(1, [0, 1, 2, 3, 4, 5])], 5, 6)), [1, 4]);
  assert.deepEqual(plain(RF.Mult.fullRows([], 5, 6)), []);
});

test("in a round: a full-row cluster is a Line Burst; Mult resets every spin", () => {
  const table = RF.Grid.makeTable(Object.entries(R.weights.base).map(([symbol, weight]) => ({ symbol, weight })));
  const ctx = { cols: 6, rows: 5, table, paytable: RF.Paytable.makePaytable(R), paying: [...R.symbols.low, ...R.symbols.premium], wild: "WILD", minCluster: 5, maxSteps: 100, specialBands: R.specials, mult: BASE };
  const draws = (s) => [...s].map((ch) => floatFor(table, LETTERS[ch]));
  // Row 0: six irons (a cluster of 6, no special) → a Line Burst at ×1 → ×2.
  const spin = () => scriptedRng([...draws("IIIIII" + "CBSRPE" + "BSRPEC" + "SRPECB" + "RPECBS"), ...draws("GEGEGE")]);
  const a = plain(RF.Round.resolveSpin(ctx, spin()));
  assert.deepEqual(a.steps.map((s) => [s.base_x, s.mult, s.line_burst, s.step_x]), [[0.2, 2, [0], 0.4]]);
  assert.equal(a.final_mult, 2);
  // The next spin starts from ×1 again (the base game never carries Mult).
  const b = plain(RF.Round.resolveSpin(ctx, spin()));
  assert.equal(b.steps[0].mult, 2);
});
