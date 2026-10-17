import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, scriptedRng, floatFor, LETTERS, letters, rules as loadRules, plain } from "./helpers.mjs";

const RF = loadEngine();
const R = loadRules();
const PAYING = [...R.symbols.low, ...R.symbols.premium];
const table = RF.Grid.makeTable(Object.entries(R.weights.base).map(([symbol, weight]) => ({ symbol, weight })));
const ctx = { cols: 6, rows: 5, table, paytable: RF.Paytable.makePaytable(R), paying: PAYING, wild: "WILD", minCluster: 5, maxSteps: 100 };
const draws = (s) => [...s].map((ch) => floatFor(table, LETTERS[ch]));

test("a spin pays its clusters, explodes them, drops and refills until no cluster is left", () => {
  // Initial board, drawn row by row; then the refill of row 0's five empty cells.
  const initial = "CCCCCI" + "IBSRBS" + "BSRSIB" + "SIBRBS" + "RBSIRI";
  const rng = scriptedRng([...draws(initial), ...draws("RPEGS")]);
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.equal(rng.left(), 0);
  assert.deepEqual(letters(out.initial), ["CCCCCI", "IBSRBS", "BSRSIB", "SIBRBS", "RBSIRI"]);
  assert.equal(out.steps.length, 1);
  assert.deepEqual(out.steps[0].clusters.map((c) => [c.symbol, c.size, c.pay_x]), [["COPPER", 5, 0.1]]);
  assert.deepEqual(letters(out.final)[0], "RPEGSI");
  assert.equal(out.total_x, 0.1);
  assert.equal(out.truncated, false);
});

test("a cascade that forms a new cluster pays again (two steps)", () => {
  // Row 0 copper explodes; the refill brings 5 golds in row 0.
  const initial = "CCCCCI" + "IBSRBS" + "BSRSIB" + "SIBRBS" + "RBSIRI";
  const rng = scriptedRng([...draws(initial), ...draws("GGGGG"), ...draws("RPESR")]);
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.deepEqual(out.steps.map((s) => s.clusters.map((c) => c.symbol)), [["COPPER"], ["GOLD"]]);
  assert.equal(out.total_x, 0.1 + 1);
  assert.equal(rng.left(), 0);
});

test("no win: no steps, no extra draws", () => {
  const rng = scriptedRng(draws("CIBSRP" + "IBSRPC" + "BSRPCI" + "SRPCIB" + "RPCIBS"));
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.deepEqual(out.steps, []);
  assert.equal(out.total_x, 0);
  assert.deepEqual(out.final, out.initial);
});
