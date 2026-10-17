import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, board, letters, scriptedRng, floatFor, LETTERS, rules as loadRules, plain } from "./helpers.mjs";

const RF = loadEngine();
const R = loadRules();
const PAYING = [...R.symbols.low, ...R.symbols.premium];
const S = RF.Specials;

/** A board from letter rows, with specials: { "r,c": "RUNE" | "BOMB" | "PRISM" }. */
function withSpecials(rows, specials) {
  const b = board(RF, rows);
  for (const [k, kind] of Object.entries(specials)) {
    const [r, c] = k.split(",").map(Number);
    b[r][c] = { s: kind === "PRISM" ? "PRISM" : b[r][c].s, sp: kind };
  }
  return b;
}
const FILLER = ["CIBSRP", "IBSRPC", "BSRPCI", "SRPCIB", "RPCIBS"];

test("cluster size picks the special: 7-8 Rune, 9-11 Bomb, 12+ Prism", () => {
  const kinds = [5, 6, 7, 8, 9, 11, 12, 30].map((n) => S.kindForSize(R.specials, n));
  assert.deepEqual(kinds, [null, null, "RUNE", "RUNE", "BOMB", "BOMB", "PRISM", "PRISM"]);
});

test("a special lands on an RNG-chosen cell of its cluster, never a Wild; one draw per qualifying cluster", () => {
  const b = board(RF, ["CCWCCC", "CCIBSR", "IBSRPB", "BSRPBI", "SRPBIS"]);
  const clusters = RF.Cluster.findClusters(b, { paying: PAYING, wild: "WILD", min: 5 });
  assert.deepEqual(plain(clusters).map((c) => [c.symbol, c.size]), [["COPPER", 8]]);
  // 7 eligible cells (the Wild is skipped): index 6 of 7 → the last, (1,1).
  const rng = scriptedRng([6.5 / 7]);
  const created = plain(S.createSpecials(b, clusters, R.specials, "WILD", rng));
  assert.deepEqual(created, [{ row: 1, col: 1, kind: "RUNE", symbol: "COPPER" }]);
  assert.equal(rng.left(), 0);
  // A cluster of 5 leaves nothing and draws nothing.
  const five = RF.Cluster.findClusters(board(RF, ["CCCCCI", ...FILLER.slice(1)]), { paying: PAYING, wild: "WILD", min: 5 });
  assert.deepEqual(plain(S.createSpecials(board(RF, ["CCCCCI", ...FILLER.slice(1)]), five, R.specials, "WILD", scriptedRng([]))), []);
});

test("a Prism has no symbol and never clusters", () => {
  const b = S.placeSpecials(board(RF, FILLER), [{ row: 0, col: 0, kind: "PRISM", symbol: "PRISM" }]);
  assert.equal(b[0][0].s, "PRISM");
  assert.deepEqual(plain(RF.Cluster.findClusters(b, { paying: PAYING, wild: "WILD", min: 1 })).filter((c) => c.symbol === "PRISM"), []);
});

test("areas: Rune = row + column, Bomb = 3×3 (clipped at edges)", () => {
  const b = board(RF, FILLER);
  assert.equal(S.area("RUNE", { row: 2, col: 2 }, b, PAYING).length, 6 + 5);
  assert.equal(RF.Round.uniqueCells(S.area("RUNE", { row: 2, col: 2 }, b, PAYING)).length, 10);
  assert.equal(S.area("BOMB", { row: 2, col: 2 }, b, PAYING).length, 9);
  assert.equal(S.area("BOMB", { row: 0, col: 0 }, b, PAYING).length, 4);
});

test("a Prism clears its target: the most common paying symbol, ties to the higher-paying one", () => {
  assert.equal(S.prismTarget(board(RF, ["CCCIII", "BSRPGE", "......", "......", "......"]), PAYING), "IRON");
  assert.equal(S.prismTarget(board(RF, ["GGGCCC", "......", "......", "......", "......"]), PAYING), "GOLD");
  assert.equal(S.prismTarget(board(RF, ["FFFXXX", "......", "......", "......", "......"]), PAYING), null);
  const b = withSpecials(["CCCIIC", "BSRPGE", "......", "......", "......"], { "1,0": "PRISM" });
  assert.deepEqual(plain(S.area("PRISM", { row: 1, col: 0 }, b, PAYING)), [{ row: 1, col: 0 }, { row: 0, col: 0 }, { row: 0, col: 1 }, { row: 0, col: 2 }, { row: 0, col: 5 }]);
});

test("adjacent specials fuse: every combo's area", () => {
  const det = (specials) => plain(S.detonateAll(withSpecials(FILLER, specials), PAYING));
  const rr = det({ "2,2": "RUNE", "2,3": "RUNE" });
  assert.deepEqual([rr.events.length, rr.events[0].kind, rr.cleared.length], [1, "RUNE_RUNE", 6 + 5 + 5 - 2]);
  const rb = det({ "2,2": "BOMB", "2,3": "RUNE" });
  assert.deepEqual([rb.events[0].kind, rb.cleared.length], ["RUNE_BOMB", 3 * 6 + 3 * 5 - 9]);
  const bb = det({ "2,2": "BOMB", "2,3": "BOMB" });
  assert.deepEqual([bb.events[0].kind, bb.cleared.length], ["BOMB_BOMB", 25]);
  const pp = det({ "2,2": "PRISM", "3,2": "PRISM" });
  assert.deepEqual([pp.events[0].kind, pp.cleared.length], ["PRISM_PRISM", 30]);
});

test("Prism + Rune: every cell of the Prism's target fires as a Rune", () => {
  // The Prism sits next to a Rune; its target is whatever symbol is most common.
  const rows = ["GCIBSR", "IBSGRP", "BSRPCG", "SRPCIB", "RPCIBS"];
  const b = withSpecials(rows, { "4,0": "PRISM", "4,1": "RUNE" });
  const target = S.prismTarget(b, PAYING);
  const golds = [];
  b.forEach((line, r) => line.forEach((cell, c) => cell && cell.s === target && golds.push({ row: r, col: c })));
  const expected = RF.Round.uniqueCells([{ row: 4, col: 0 }, { row: 4, col: 1 }, ...golds.flatMap((g) => S.area("RUNE", g, b, PAYING))]);
  const out = plain(S.detonateAll(b, PAYING));
  assert.equal(out.events[0].kind, "PRISM_RUNE");
  assert.deepEqual(out.cleared, plain(expected));
});

test("three in a row: the first two fuse (row-major), the third fires alone", () => {
  const out = plain(S.detonateAll(withSpecials(FILLER, { "2,1": "RUNE", "2,2": "RUNE", "2,3": "BOMB" }), PAYING));
  assert.deepEqual(out.events.map((e) => [e.kind, e.at]), [
    ["RUNE_RUNE", [{ row: 2, col: 1 }, { row: 2, col: 2 }]],
    ["BOMB", [{ row: 2, col: 3 }]]
  ]);
});

test("cleared cells pay as clusters per symbol (5+), never twice", () => {
  const b = board(RF, ["CCCCCC", "IBSRPB", "BSRPBI", "SRPBIS", "RPBISR"]);
  const pt = RF.Paytable.makePaytable(R);
  const row0 = [0, 1, 2, 3, 4, 5].map((col) => ({ row: 0, col }));
  assert.deepEqual(plain(S.collect(b, row0, [], PAYING, 5, pt)), [{ symbol: "COPPER", count: 6, pay_x: pt.clusterPay("COPPER", 6) }]);
  assert.deepEqual(plain(S.collect(b, row0, row0.slice(0, 2), PAYING, 5, pt)), [], "4 left after the already-paid ones");
});

test("in a round: a cluster of 7 leaves a Rune, which detonates on the next step", () => {
  const table = RF.Grid.makeTable(Object.entries(R.weights.base).map(([symbol, weight]) => ({ symbol, weight })));
  const ctx = { cols: 6, rows: 5, table, paytable: RF.Paytable.makePaytable(R), paying: PAYING, wild: "WILD", minCluster: 5, maxSteps: 100, specialBands: R.specials };
  const draws = (s) => [...s].map((ch) => floatFor(table, LETTERS[ch]));
  const initial = "CCCCCC" + "CIBSRP" + "IBSRPB" + "BSRPBI" + "SRPBIS";
  const rng = scriptedRng([
    ...draws(initial),
    3.5 / 7, // the Rune's cell: index 3 of the 7 copper cells → (0,3)
    ...draws("GEGEGE"), // refill: (1,0), (0,0), (0,1), (0,2), (0,4), (0,5)
    ...draws("FXFXFXFXFX") // the Rune's row + column, refilled with non-paying symbols
  ]);
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.equal(rng.left(), 0);
  assert.equal(out.steps.length, 2);
  assert.deepEqual(out.steps[0].specials_created, [{ row: 0, col: 3, kind: "RUNE", symbol: "COPPER" }]);
  assert.deepEqual(letters(out.steps[0].board), ["EGECGE", "GIBSRP", "IBSRPB", "BSRPBI", "SRPBIS"]);
  assert.deepEqual(out.steps[0].specials, [{ row: 0, col: 3, kind: "RUNE", symbol: "COPPER" }]);
  assert.deepEqual(out.steps[1].clusters, []);
  assert.deepEqual(out.steps[1].detonations.map((d) => [d.kind, d.cells.length]), [["RUNE", 10]]);
  assert.deepEqual(out.steps[1].specials, []);
  // Step 1 clears row 0 (a Line Burst): ×1 doubled to ×2. Step 2 (the Rune clears row 0
  // again): (2 + 1) × 2 = ×6, on a base of 0.
  assert.deepEqual(out.steps.map((s) => [s.mult, s.line_burst]), [[2, [0]], [6, [0]]]);
  assert.equal(out.total_x, RF.Paytable.makePaytable(R).clusterPay("COPPER", 7) * 2);
});
