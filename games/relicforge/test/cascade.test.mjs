import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, board, letters, scriptedRng, floatFor, plain } from "./helpers.mjs";

const RF = loadEngine();

test("removeCells empties cells without touching the input board", () => {
  const b = board(RF, ["CI", "BS"]);
  const next = RF.Cascade.removeCells(b, [{ row: 0, col: 1 }]);
  assert.deepEqual(letters(RF.Grid.symbolsOf(next)), ["C.", "BS"]);
  assert.deepEqual(letters(RF.Grid.symbolsOf(b)), ["CI", "BS"]);
});

test("gravity drops each column's cells straight down, in order, and reports the moves", () => {
  const b = board(RF, ["CI.", ".B.", "S.R", "..."]);
  const { board: next, moves } = RF.Cascade.applyGravity(b);
  assert.deepEqual(letters(RF.Grid.symbolsOf(next)), ["...", "...", "CI.", "SBR"]);
  assert.deepEqual(plain(moves), [
    { from: { row: 2, col: 0 }, to: { row: 3, col: 0 } },
    { from: { row: 0, col: 0 }, to: { row: 2, col: 0 } },
    { from: { row: 1, col: 1 }, to: { row: 3, col: 1 } },
    { from: { row: 0, col: 1 }, to: { row: 2, col: 1 } },
    { from: { row: 2, col: 2 }, to: { row: 3, col: 2 } }
  ]);
});

test("refill draws every empty cell: columns left to right, each from its lowest gap up", () => {
  const table = RF.Grid.makeTable([{ symbol: "GOLD", weight: 1 }, { symbol: "RUBY", weight: 1 }, { symbol: "IRON", weight: 1 }]);
  const g = floatFor(table, "GOLD");
  const r = floatFor(table, "RUBY");
  const i = floatFor(table, "IRON");
  const rng = scriptedRng([g, r, i]);
  const { board: next, drops } = RF.Cascade.refill(board(RF, ["..C", ".BC", "SBC"]), table, rng);
  assert.deepEqual(letters(RF.Grid.symbolsOf(next)), ["RIC", "GBC", "SBC"]);
  assert.deepEqual(plain(drops), [{ row: 1, col: 0, s: "GOLD" }, { row: 0, col: 0, s: "RUBY" }, { row: 0, col: 1, s: "IRON" }]);
  assert.equal(rng.left(), 0, "exactly one draw per empty cell");
});
