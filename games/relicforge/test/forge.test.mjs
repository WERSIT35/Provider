import { test } from "node:test";
import assert from "node:assert/strict";
import { loadEngine, scriptedRng, floatFor, LETTERS, rules as loadRules, plain, forgeState } from "./helpers.mjs";

const RF = loadEngine();
const R = loadRules();
const { Relics, Draft, EvTable } = RF;
const levels = (over = {}) => Object.assign(plain(Relics.emptyLevels()), over);

function engine(rules, session) {
  const e = new (loadEngine(session.seed || "forge").SpinEngine)({ rules });
  e.session = { gameId: "relicforge", ...session };
  return e;
}

test("an offer is 3 different relics below Lv3, one draw each", () => {
  const rng = scriptedRng([0, 0, 0]);
  assert.deepEqual(plain(Draft.makeOffer(levels(), 3, rng)), ["IGNITE", "CHAIN", "EXPAND"]);
  assert.equal(rng.left(), 0);
  const maxed = levels({ IGNITE: 3, CHAIN: 3, EXPAND: 3 });
  assert.deepEqual(plain(Draft.makeOffer(maxed, 3, scriptedRng([0.99, 0.99, 0.99]))).sort(), ["HOARD", "MAGNET", "SURGE"]);
  assert.throws(() => Draft.makeOffer(levels({ IGNITE: 3, CHAIN: 3, EXPAND: 3, MAGNET: 3 }), 3, scriptedRng([0, 0, 0])), /RF_OFFER_POOL_TOO_SMALL/);
});

test("10 picks can never shrink the pool below 3", () => {
  // Worst case: every pick levels the same few relics to 3; 9 picks max 3 relics.
  const lv = levels({ IGNITE: 3, CHAIN: 3, EXPAND: 3 });
  assert.equal(Relics.RELICS.filter((r) => lv[r] < 3).length, 3);
});

test("a pick levels its relic; a bad index is refused", () => {
  const forge = forgeState({ relics: levels({ CHAIN: 1 }), pending_offer: ["IGNITE", "CHAIN", "EXPAND"] }).forge;
  const p = plain(Draft.applyPick(forge, 1, R, R.ev_table));
  assert.deepEqual([p.relic, p.level, p.levels.CHAIN, p.evolved, p.factor], ["CHAIN", 2, 2, [], 1]);
  assert.throws(() => Draft.applyPick(forge, 3, R, R.ev_table), /INVALID_CHOICE/);
  assert.throws(() => Draft.applyPick(forge, undefined, R, R.ev_table), /INVALID_CHOICE/);
});

test("two maxed partner relics evolve: Inferno, Cathedral, Singularity", () => {
  const evolve = (lv, relic) =>
    plain(Draft.applyPick(forgeState({ relics: levels(lv), pending_offer: [relic, "SURGE", "HOARD"].filter((x, i, a) => a.indexOf(x) === i).concat(["MAGNET"]).slice(0, 3) }).forge, 0, R, R.ev_table)).evolved;
  assert.deepEqual(evolve({ IGNITE: 3, CHAIN: 2 }, "CHAIN"), ["INFERNO"]);
  assert.deepEqual(evolve({ EXPAND: 2, HOARD: 3 }, "EXPAND"), ["CATHEDRAL"]);
  assert.deepEqual(evolve({ MAGNET: 3, SURGE: 2 }, "SURGE"), ["SINGULARITY"]);
  assert.deepEqual(evolve({ IGNITE: 3, CHAIN: 1 }, "CHAIN"), []);
});

test("the pick's Relic bonus factor comes from the equal-EV table, keyed on the state before the pick", () => {
  const forge = forgeState({ relics: levels({ SURGE: 1 }), spins_left: 7, pending_offer: ["IGNITE", "CHAIN", "SURGE"] }).forge;
  const sig = EvTable.signature(forge.relics, forge.evolutions, forge.spins_left);
  assert.equal(sig, "I0C0E0M0H0S1|-|7");
  const table = { factors: { [`${sig}>CHAIN`]: 1.25 }, volatility: { [`${sig}>CHAIN`]: "high" } };
  assert.equal(Draft.applyPick(forge, 1, R, table).factor, 1.25);
  assert.equal(Draft.applyPick(forge, 0, R, table).factor, 1, "not in the table: neutral");
  assert.equal(EvTable.volatility(table, sig, "CHAIN"), "high");
});

test("each relic's effect, by level", () => {
  const cfg = (lv, evo = [], meltdown = false) => plain(Relics.configFor(Relics.effective(levels(lv), evo, meltdown), R, 5));
  const none = cfg({});
  assert.deepEqual([none.wilds, none.inc, none.rows, none.stickSpins, none.surge, none.burst, none.wildMult], [0, 1, 5, 0, 0, 2, 1]);
  assert.deepEqual([1, 2, 3].map((l) => cfg({ IGNITE: l }).wilds), [1, 2, 3]);
  assert.deepEqual([1, 2, 3].map((l) => cfg({ CHAIN: l }).inc), [2, 3, 4]);
  assert.deepEqual([1, 2, 3].map((l) => cfg({ EXPAND: l }).rows), [6, 7, 8]);
  assert.deepEqual([1, 2, 3].map((l) => [cfg({ MAGNET: l }).stickSpins, cfg({ MAGNET: l }).runeMin]), [[2, 7], [2, 6], [3, 6]]);
  assert.deepEqual([1, 2, 3].map((l) => cfg({ HOARD: l }).removed.length), [1, 2, 3]);
  assert.deepEqual([1, 2, 3].map((l) => [cfg({ SURGE: l }).carryBonus, cfg({ SURGE: l }).burst]), [[0, 2], [1, 2], [1, 3]]);
  assert.equal(cfg({ IGNITE: 3, CHAIN: 3 }, ["INFERNO"]).wildMult, 2);
  const cathedral = cfg({ EXPAND: 3, HOARD: 3 }, ["CATHEDRAL"]);
  assert.deepEqual([cathedral.rows, cathedral.premiumOnly], [8, true]);
  assert.deepEqual(Object.keys(Relics.weightsFor(cathedral, R)).sort(), ["EMERALD", "GOLD", "RUBY", "SAPPHIRE"]);
  assert.deepEqual(Object.keys(Relics.weightsFor(cfg({ HOARD: 2 }), R)).filter((s) => R.symbols.low.includes(s)), ["BRONZE", "SILVER"]);
  assert.equal(cfg({ MAGNET: 3, SURGE: 3 }, ["SINGULARITY"]).persistAll, true);
});

test("Meltdown fires every relic: owned at their level, the rest at Lv1", () => {
  const eff = plain(Relics.effective(levels({ CHAIN: 3 }), [], true));
  assert.deepEqual(eff.levels, { IGNITE: 1, CHAIN: 3, EXPAND: 1, MAGNET: 1, HOARD: 1, SURGE: 1 });
});

test("Ignite's Wilds land on distinct RNG-chosen cells; under Inferno each Wild in a cluster doubles it", () => {
  const table = RF.Grid.makeTable(Object.entries(R.weights.bonus).map(([symbol, weight]) => ({ symbol, weight })));
  const draws = (s) => [...s].map((ch) => floatFor(table, LETTERS[ch]));
  const ctx = { cols: 6, rows: 5, table, paytable: RF.Paytable.makePaytable(R), paying: [...R.symbols.low, ...R.symbols.premium], wild: "WILD", minCluster: 5, maxSteps: 100, specialBands: R.specials, mult: { start: 1, inc: 1, burst: 2 }, wilds: 2, wildMult: 2 };
  // Coppers at (0,0)-(0,2); Wilds land on cell 3 → (0,3), then cell 3 of the 29 left → (0,4).
  const rng = scriptedRng([...draws("CCCIBS" + "IBSRPE" + "BSRPEG" + "SRPEGB" + "RPEGBS"), 3.5 / 30, 3.5 / 29, ...draws("GEGEG")]);
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.deepEqual(out.wilds_placed, [{ row: 0, col: 3 }, { row: 0, col: 4 }]);
  const c = out.steps[0].clusters[0];
  assert.deepEqual([c.symbol, c.size, c.wilds], ["COPPER", 5, 2]);
  assert.equal(c.pay_x, RF.Paytable.makePaytable(R).clusterPay("COPPER", 5) * 4);
});

test("Magnet's specials come back where they were made, counted from the bottom row", () => {
  const table = RF.Grid.makeTable([{ symbol: "PRISM", weight: 0 }, ...Object.entries(R.weights.bonus).map(([symbol, weight]) => ({ symbol, weight }))]);
  const filler = "CIBSRP".repeat(8).split("");
  const rng = scriptedRng(filler.map((ch) => floatFor(table, LETTERS[ch])));
  const ctx = { cols: 6, rows: 8, table, paytable: RF.Paytable.makePaytable(R), paying: [...R.symbols.low, ...R.symbols.premium], wild: "WILD", minCluster: 50, maxSteps: 0, specialBands: R.specials, stuck: [{ up: 0, col: 2, kind: "BOMB", symbol: "RUBY", spins_left: 1 }] };
  const out = plain(RF.Round.resolveSpin(ctx, rng));
  assert.deepEqual(out.stuck_placed, [{ row: 7, col: 2, kind: "BOMB", symbol: "RUBY" }]);
});

test("a whole Forge: 10 picks, Meltdown last, offers always valid, then it ends", () => {
  let featureState = forgeState();
  let picked = 0;
  for (let i = 1; i <= 10; i++) {
    const offer = featureState.forge.pending_offer;
    assert.equal(new Set(offer).size, 3);
    for (const relic of offer) assert.ok(featureState.forge.relics[relic] < 3, `${relic} offered at Lv3`);
    const r = plain(engine(R, { seed: `forge-${i}`, featureState }).spin({ bet_amount: 1, choice: i % 3 }));
    picked += 1;
    assert.equal(r.forge_spin, i);
    assert.equal(r.meltdown, i === 10);
    assert.equal(Object.values(r.relics).reduce((a, b) => a + b, 0), picked);
    assert.equal(r.relic_bonus, 1, "no equal-EV table yet: neutral factors");
    featureState = r.feature_state;
    if (i < 10) assert.equal(r.offer_next.length, 3);
  }
  assert.equal(featureState, null);
});

test("an evolution changes the spin: Inferno's doubled Wilds", () => {
  const fs = forgeState({ relics: levels({ IGNITE: 3, CHAIN: 2 }), pending_offer: ["CHAIN", "MAGNET", "SURGE"], spins_left: 5 });
  const r = plain(engine(R, { featureState: fs }).spin({ bet_amount: 1, choice: 0 }));
  assert.deepEqual(r.evolved, ["INFERNO"]);
  assert.deepEqual([r.config.wildMult, r.config.wilds, r.config.inc], [2, 3, 4]);
  assert.equal(r.wilds_placed.length, 3);
  assert.deepEqual(r.feature_state.forge.evolutions, ["INFERNO"]);
});

test("Surge carries the Mult the last spin ended on into the next spin", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.bonus)) rules.weights.bonus[s] = s === "GOLD" ? 6 : 1;
  // Tiny pays: these boards make huge cascades, and the max win would end the Forge.
  for (const s of Object.keys(rules.paytable)) for (const k of Object.keys(rules.paytable[s])) rules.paytable[s][k] = 0.001;
  const fs = forgeState({ relics: levels({ SURGE: 1 }), carried_mult: 5, pending_offer: ["IGNITE", "CHAIN", "EXPAND"] });
  const r = plain(engine(rules, { featureState: fs }).spin({ bet_amount: 1, choice: 2 }));
  assert.ok(r.steps.length > 0);
  assert.ok([5, 10].includes(r.steps[0].mult), `first step at the carried ×5 (×10 on a Line Burst), got ${r.steps[0].mult}`);
  assert.equal(r.feature_state.forge.carried_mult, r.steps[r.steps.length - 1].mult);
  // Without Surge the Mult starts at ×1 again.
  const plainSpin = plain(engine(rules, { featureState: forgeState({ carried_mult: 5 }) }).spin({ bet_amount: 1, choice: 0 }));
  assert.ok([1, 2].includes(plainSpin.steps[0].mult));
  assert.equal(plainSpin.feature_state.forge.carried_mult, null);
});

test("Magnet keeps a spin's specials for the next spins", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.bonus)) rules.weights.bonus[s] = s === "GOLD" ? 10 : 1;
  // Tiny pays: these boards make huge cascades, and the max win would end the Forge.
  for (const s of Object.keys(rules.paytable)) for (const k of Object.keys(rules.paytable[s])) rules.paytable[s][k] = 0.001;
  const fs = forgeState({ relics: levels({ MAGNET: 1 }), pending_offer: ["IGNITE", "CHAIN", "EXPAND"] });
  const r = plain(engine(rules, { featureState: fs }).spin({ bet_amount: 1, choice: 1 }));
  const made = r.steps.reduce((n, s) => n + s.specials_created.length, 0);
  assert.ok(made > 0, "a gold-heavy board makes specials");
  const stuck = r.feature_state.forge.stuck;
  assert.equal(stuck.length, Math.min(made, rules.forge.max_stuck_specials));
  assert.ok(stuck.every((s) => s.spins_left === 2));
  const next = plain(engine(rules, { seed: "next", featureState: r.feature_state }).spin({ bet_amount: 1, choice: 0 }));
  assert.equal(next.stuck_placed.length, stuck.length);
});

test("the Relic bonus multiplies Forge pays and compounds pick by pick", () => {
  const rules = loadRules();
  for (const s of Object.keys(rules.weights.bonus)) rules.weights.bonus[s] = s === "GOLD" ? 50 : 1;
  const fs = forgeState({ relic_bonus: 1.5, pending_offer: ["IGNITE", "CHAIN", "EXPAND"] });
  const sig = EvTable.signature(fs.forge.relics, [], 10);
  rules.ev_table = { factors: { [`${sig}>CHAIN`]: 2 } };
  const with2 = plain(engine(rules, { seed: "bonus", featureState: fs }).spin({ bet_amount: 1, choice: 1 }));
  assert.equal(with2.relic_bonus, 3);
  const total = with2.steps.reduce((x, s) => x + s.step_x, 0);
  assert.equal(with2.win_x, Math.min(total * 3, 10000));
});

test("the engine refuses a pick that is not in the offer", () => {
  assert.throws(() => engine(R, { featureState: forgeState() }).spin({ bet_amount: 1, choice: 3 }), /INVALID_CHOICE/);
  assert.throws(() => engine(R, { featureState: forgeState() }).spin({ bet_amount: 1 }), /INVALID_CHOICE/);
});
