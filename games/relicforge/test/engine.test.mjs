import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, rules as loadRules, plain } from "./helpers.mjs";

function spinWith(seed, rules = loadRules(), session = {}) {
  const RF = loadEngine(seed);
  const engine = new RF.SpinEngine({ rules });
  engine.session = { gameId: "relicforge", ...session };
  return plain(engine.spin({ bet_amount: 2, spin_id: "s1" }));
}

test("same seed, same round; another seed, another round", () => {
  const a = spinWith("seed-1");
  assert.deepEqual(spinWith("seed-1"), a);
  assert.notDeepEqual(spinWith("seed-2").initial_board, a.initial_board);
});

test("the RGS contract: core fields, money in currency, state carried through", () => {
  const r = spinWith("seed-3", loadRules(), { playerState: { meter: 4 } });
  for (const k of ["spin_id", "is_free_spin", "bet_amount", "bet_charged", "total_win", "free_spins_left", "free_spins_awarded", "feature_state", "player_state"]) {
    assert.ok(k in r, `missing ${k}`);
  }
  assert.equal(r.bet_amount, 2);
  assert.equal(r.bet_charged, 2);
  assert.equal(r.total_win, Math.round(r.win_x * 2 * 100) / 100);
  assert.deepEqual(r.player_state, { meter: 4 });
  assert.equal(r.feature_state, null);
});

test("the max win is capped at 10,000× the bet", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.base)) rules.weights.base[s] = s === "GOLD" ? 1000 : 0.0001;
  for (const s of Object.keys(rules.paytable)) for (const k of Object.keys(rules.paytable[s])) rules.paytable[s][k] = 50000;
  const r = spinWith("seed-4", rules);
  assert.equal(r.cap_reached, true);
  assert.equal(r.win_x, 10000);
  assert.equal(r.total_win, 20000);
});

test("the engine declares its capabilities for the RGS", () => {
  const RF = loadEngine();
  const e = new RF.SpinEngine({ rules: loadRules() });
  assert.deepEqual(
    [e.MAX_WIN_CAP_X, e.SUPPORTS_BUY, e.SUPPORTS_ANTE, e.USES_FEATURE_STATE, e.USES_PLAYER_STATE, e.SUPPORTS_CHOICE],
    [10000, false, false, true, true, true]
  );
  assert.deepEqual(plain(e.getRtpProfile("relicforge_94")).theoretical_percent, 94);
  assert.equal(e.choiceOptions(null), 0);
  assert.equal(e.choiceOptions({ forge: { pending_offer: ["a", "b", "c"] } }), 3);
});
