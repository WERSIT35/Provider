import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine } from "./helpers.mjs";

const RF = loadEngine();
const pt = RF.Paytable.makePaytable({ paytable: { GOLD: { "5": 1, "6": 2, "7-8": 4, "9-11": 10, "12-14": 25, "15+": 60 } } });

test("a size pays its band", () => {
  const pays = [4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 30].map((n) => pt.clusterPay("GOLD", n));
  assert.deepEqual(pays, [0, 1, 2, 4, 4, 10, 10, 25, 25, 60, 60]);
});

test("unknown symbols pay nothing; malformed bands are refused", () => {
  assert.equal(pt.clusterPay("WILD", 30), 0);
  assert.throws(() => RF.Paytable.makePaytable({ paytable: { GOLD: { "5..6": 1 } } }), /RF_BAD_PAY_BAND/);
});
