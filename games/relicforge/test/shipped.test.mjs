import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, shippedRules, plain } from "./helpers.mjs";

// The shipped rules (games/relicforge/math/rules.json), as tuned in phase 7.
const R = shippedRules();
const RF = loadEngine("shipped");

test("three RTP profiles, scalers in order, the 10,000x cap", () => {
  assert.deepEqual(R.rtp_profiles.map((p) => [p.key, p.game_id]), [["96", "relicforge"], ["94", "relicforge_94"], ["92", "relicforge_92"]]);
  const [a, b, c] = R.rtp_profiles;
  assert.ok(a.payout_scaler > b.payout_scaler && b.payout_scaler > c.payout_scaler);
  assert.ok(a.free_spin_payout_scaler > b.free_spin_payout_scaler && b.free_spin_payout_scaler > c.free_spin_payout_scaler);
  assert.equal(R.max_win_cap_multiplier, 10000);
});

test("the equal-EV table covers every draft the Forge can reach, for every relic it can offer", () => {
  const RELICS = RF.Relics.RELICS;
  const seen = new Set();
  let missing = 0;
  let states = 0;
  (function walk(L, n) {
    const id = RELICS.map((r) => L[r]).join("") + n;
    if (seen.has(id)) return;
    seen.add(id);
    states += 1;
    const sig = RF.EvTable.signature(L, [...RF.Relics.newEvolutions(L, [], R)], n);
    assert.ok(R.ev_table.values[sig] > 0, `no value for ${sig}`);
    for (const r of RELICS.filter((x) => L[x] < 3)) {
      const k = R.ev_table.factors[`${sig}>${r}`];
      if (!(k > 0)) missing += 1;
      if (n > 1) walk({ ...L, [r]: L[r] + 1 }, n - 1);
    }
  })(Object.fromEntries(RELICS.map((r) => [r, 0])), R.forge.free_spins);
  assert.equal(states, 2338);
  assert.equal(missing, 0);
});

test("the shipped rules play: a paid spin and a whole Forge", () => {
  const e = new RF.SpinEngine({ rules: R });
  e.session = { gameId: "relicforge", featureState: null, playerState: null };
  const paid = plain(e.spin({ bet_amount: 1 }));
  assert.equal(paid.bet_charged, 1);
  let fs = { forge: { spins_total: 10, spins_left: 10, trigger: "scatter", round_x: 0, relics: plain(RF.Relics.emptyLevels()), evolutions: [], relic_bonus: 1, carried_mult: null, stuck: [], pending_offer: ["IGNITE", "CHAIN", "EXPAND"] } };
  let spins = 0;
  while (fs) {
    e.session = { gameId: "relicforge", featureState: fs, playerState: null };
    const r = plain(e.spin({ bet_amount: 1, choice: 0 }));
    assert.ok(r.relic_bonus > 0 && r.pick.factor > 0);
    fs = r.feature_state;
    spins += 1;
  }
  assert.ok(spins >= 1 && spins <= 10);
});
