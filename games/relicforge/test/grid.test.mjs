import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, scriptedRng, floatFor, plain } from "./helpers.mjs";

const RF = loadEngine();
const table = RF.Grid.makeTable([{ symbol: "A", weight: 1 }, { symbol: "B", weight: 3 }, { symbol: "Z", weight: 0 }]);

test("a table keeps only positive weights, cumulative", () => {
  assert.deepEqual(plain(table), { symbols: ["A", "B"], cumulative: [1, 4], total: 4 });
  assert.throws(() => RF.Grid.makeTable([{ symbol: "A", weight: 0 }]), /RF_EMPTY_SYMBOL_TABLE/);
});

test("drawSymbol maps [0,1) onto the weights, one float per draw", () => {
  const draw = (f) => RF.Grid.drawSymbol(table, scriptedRng([f]));
  assert.equal(draw(0), "A");
  assert.equal(draw(0.2499), "A");
  assert.equal(draw(0.25), "B");
  assert.equal(draw(0.999999), "B");
  assert.equal(draw(floatFor(table, "B")), "B");
});

test("createBoard draws rows × cols cells, row by row from the top", () => {
  const a = floatFor(table, "A");
  const b = floatFor(table, "B");
  const rng = scriptedRng([a, b, b, a, a, b]);
  const board = RF.Grid.createBoard(3, 2, table, rng);
  assert.deepEqual(plain(RF.Grid.symbolsOf(board)), [["A", "B", "B"], ["A", "A", "B"]]);
  assert.equal(rng.left(), 0);
});

test("fromSymbols / symbolsOf round-trip, countSymbol counts", () => {
  const rows = [["A", null], ["B", "A"]];
  const board = RF.Grid.fromSymbols(rows);
  assert.deepEqual(plain(RF.Grid.symbolsOf(board)), rows);
  assert.equal(RF.Grid.countSymbol(board, "A"), 2);
  const copy = RF.Grid.cloneBoard(board);
  copy[0][0].s = "Q";
  assert.equal(board[0][0].s, "A");
});
