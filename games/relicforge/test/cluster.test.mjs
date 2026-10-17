import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, board, plain } from "./helpers.mjs";

const RF = loadEngine();
const OPTS = { paying: ["COPPER", "IRON", "BRONZE", "SILVER", "RUBY", "SAPPHIRE", "EMERALD", "GOLD"], wild: "WILD", min: 5 };
const find = (rows) => plain(RF.Cluster.findClusters(board(RF, rows), OPTS));
const summary = (cs) => cs.map((c) => [c.symbol, c.size, c.wilds]);

test("5 orthogonally connected cells make a cluster (an L shape); 4 + a stray do not", () => {
  const c = find(["CIIIII", "CBBBBS", "CRSRSR", "CCSBBS", "BSBSBS"]);
  assert.deepEqual(summary(c), [["COPPER", 5, 0], ["IRON", 5, 0]]);
  assert.deepEqual(c[0].cells, [{ row: 0, col: 0 }, { row: 1, col: 0 }, { row: 2, col: 0 }, { row: 3, col: 0 }, { row: 3, col: 1 }]);
});

test("4 in a row is not a cluster", () => {
  assert.deepEqual(find(["CCCCIB", "IBIBSR", "BSRSIB", "SIBRBS", "RBSIRI"]), []);
});

test("diagonals do not connect", () => {
  assert.deepEqual(summary(find(["CIBSRP", "ICBSRP", "IBCSRP", "IBSCRP", "IBSRCP"])), [["SAPPHIRE", 5, 0]]);
});

test("a Wild bridges two groups into one cluster and counts towards its size", () => {
  assert.deepEqual(summary(find(["CCWCCI", "IBSRBS", "BSRSIB", "SIBRBS", "RBSIRI"])), [["COPPER", 5, 1]]);
});

test("a Wild can complete clusters of two different symbols at once", () => {
  const c = find(["CCWIIS", "CRSBIR", "CSRSIB", "RBSBSR", "SRBRBS"]);
  assert.deepEqual(summary(c), [["COPPER", 5, 1], ["IRON", 5, 1]]);
  assert.ok(c[1].cells.some((p) => p.row === 0 && p.col === 2), "the Wild is in the iron cluster too");
});

test("Wilds alone never pay", () => {
  assert.deepEqual(find(["WWWWWW", "......", "......", "......", "......"]), []);
});

test("one symbol over the whole board is one cluster of 30", () => {
  assert.deepEqual(summary(find(["GGGGGG", "GGGGGG", "GGGGGG", "GGGGGG", "GGGGGG"])), [["GOLD", 30, 0]]);
});

test("empty cells (mid-cascade) break connections", () => {
  assert.deepEqual(find(["CC.CCC", "IBSRBS", "BSRSIB", "SIBRBS", "RBSIRI"]), []);
});

test("Embers and Scatters never cluster", () => {
  assert.deepEqual(find(["FFFFFF", "XXXXXX", "BSRSIB", "SIBRBS", "RBSIRI"]), []);
});

test("clusters come out in a fixed order (first cell, row-major)", () => {
  assert.deepEqual(find(["IIIIIC", "BBBBBC", "SRSRSC", "RSRSRC", "SRSRSC"]).map((x) => x.symbol), ["IRON", "COPPER", "BRONZE"]);
});
