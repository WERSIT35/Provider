import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, board, letters, scriptedRng, floatFor, LETTERS, rules as loadRules, plain } from "./helpers.mjs";

const RF = loadEngine();
const R = loadRules();
const M = RF.ForgeMeter;
const RULE = { embers_to_fill: 50 };

test("Embers next to an exploding cluster, or inside a detonation, are collected; diagonals are not", () => {
  const b = board(RF, ["FCCCCC", "IFBSRP", "BSRPBF", "SRPBIS", "RPBISF"]);
  const cluster = [1, 2, 3, 4, 5].map((col) => ({ row: 0, col }));
  // (0,0) touches (0,1); (1,1) touches (0,1); (2,5) and (4,5) touch nothing.
  assert.deepEqual(plain(M.collectEmbers(b, cluster, [], "EMBER")), [{ row: 0, col: 0 }, { row: 1, col: 1 }]);
  assert.deepEqual(plain(M.collectEmbers(b, [], [{ row: 4, col: 5 }], "EMBER")), [{ row: 4, col: 5 }]);
  assert.deepEqual(plain(M.collectEmbers(b, [{ row: 3, col: 4 }], [], "EMBER")), [], "(2,5) and (4,5) are diagonal to (3,4)");
});

test("the meter reads only a sane state, and fills to a trigger that empties it", () => {
  assert.equal(M.read(null, RULE), 0);
  assert.equal(M.read({ embers: -3 }, RULE), 0);
  assert.equal(M.read({ embers: 2.5 }, RULE), 0);
  assert.equal(M.read({ embers: 999 }, RULE), 50);
  assert.deepEqual(plain(M.fill(10, 2, RULE)), { before: 10, collected: 2, after: 12, full: 50, triggered: false });
  assert.deepEqual(plain(M.fill(48, 3, RULE)), { before: 48, collected: 3, after: 0, full: 50, triggered: true });
});

test("Scatters are counted on symbol rows or on boards", () => {
  assert.equal(M.countScatters([["SCATTER", "GOLD"], [null, "SCATTER"]], "SCATTER"), 2);
  assert.equal(M.countScatters(board(RF, ["XX", "XG"]), "SCATTER"), 3);
});

test("in a round, collected Embers leave the board with the cluster", () => {
  const table = RF.Grid.makeTable(Object.entries(R.weights.base).map(([symbol, weight]) => ({ symbol, weight })));
  const ctx = { cols: 6, rows: 5, table, paytable: RF.Paytable.makePaytable(R), paying: [...R.symbols.low, ...R.symbols.premium], wild: "WILD", ember: "EMBER", minCluster: 5, maxSteps: 100, specialBands: R.specials, mult: { start: 1, inc: 1, burst: 2 } };
  const draws = (s) => [...s].map((ch) => floatFor(table, LETTERS[ch]));
  // Five coppers in row 0 (col 0 to 4) with an Ember under (0,2): it is collected.
  const rng = scriptedRng([...draws("CCCCCI" + "IBFRPS" + "BSRPEC" + "SRPECB" + "RPECBS"), ...draws("GEGEGX")]);
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.equal(rng.left(), 0);
  assert.equal(out.embers, 1);
  assert.deepEqual(out.steps[0].embers_collected, [{ row: 1, col: 2 }]);
  // Column 2 lost two cells (copper + Ember): refilled bottom-up, (1,2) then (0,2).
  assert.deepEqual(letters(out.final).slice(0, 2), ["GEEGXI", "IBGRPS"]);
});

function engine(rules, session) {
  const e = new (loadEngine(session.seed || "meter").SpinEngine)({ rules });
  e.session = { gameId: "relicforge", ...session };
  return e;
}

test("a full meter triggers the Forge (10 spins) and empties; the state goes back to the RGS", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.base)) rules.weights.base[s] = s === "GOLD" || s === "EMBER" ? 50 : 0.001;
  const r = plain(engine(rules, { playerState: { embers: 49 } }).spin({ bet_amount: 1 }));
  assert.ok(r.meter.collected >= 1);
  assert.equal(r.meter.triggered, true);
  assert.equal(r.forge_trigger, "meter");
  assert.deepEqual([r.free_spins_awarded, r.free_spins_left], [10, 10]);
  assert.deepEqual(r.player_state, { embers: 0 });
  assert.deepEqual(r.feature_state.forge, { spins_total: 10, spins_left: 10, trigger: "meter", round_x: r.win_x, pending_offer: null });
});

test("3+ Scatters trigger the Forge and leave the meter as it was", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.base)) rules.weights.base[s] = s === "SCATTER" ? 100 : 1;
  const r = plain(engine(rules, { playerState: { embers: 7 } }).spin({ bet_amount: 1 }));
  assert.ok(r.scatters >= 3);
  assert.equal(r.forge_trigger, "scatter");
  assert.equal(r.player_state.embers, 7 + r.meter.collected);
});

test("the Forge plays its spins for free, at the trigger's bet, without moving the meter", () => {
  const rules = loadRules();
  let featureState = { forge: { spins_total: 10, spins_left: 10, trigger: "scatter", round_x: 1.5, pending_offer: null } };
  let roundX = 1.5;
  for (let i = 1; i <= 10; i++) {
    const r = plain(engine(rules, { seed: `fs-${i}`, featureState, playerState: { embers: 12 } }).spin({ bet_amount: 2 }));
    assert.deepEqual([r.is_free_spin, r.bet_charged, r.forge_spin, r.free_spins_left], [true, 0, i, 10 - i]);
    assert.deepEqual(r.player_state, { embers: 12 });
    roundX += r.win_x;
    assert.equal(r.forge_round_x, roundX);
    featureState = r.feature_state;
  }
  assert.equal(featureState, null, "the Forge is over");
});

test("the max win covers the trigger and the whole Forge", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.base)) rules.weights.base[s] = s === "GOLD" ? 1000 : 0.0001;
  for (const s of Object.keys(rules.weights.bonus)) rules.weights.bonus[s] = s === "GOLD" ? 1000 : 0.0001;
  for (const s of Object.keys(rules.paytable)) for (const k of Object.keys(rules.paytable[s])) rules.paytable[s][k] = 50000;
  // A trigger spin at the cap starts no Forge.
  const t = plain(engine(rules, { playerState: { embers: 49 } }).spin({ bet_amount: 1 }));
  assert.deepEqual([t.cap_reached, t.forge_trigger, t.feature_state], [true, null, null]);
  // A Forge spin pays only what is left under the cap, and the Forge ends there.
  const f = plain(engine(rules, { featureState: { forge: { spins_total: 10, spins_left: 6, trigger: "meter", round_x: 9999.5, pending_offer: null } } }).spin({ bet_amount: 1 }));
  assert.deepEqual([f.win_x, f.cap_reached, f.free_spins_left, f.feature_state, f.forge_round_x], [0.5, true, 0, null, 10000]);
});
