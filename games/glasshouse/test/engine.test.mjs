// Glasshouse engine: unit tests (node:test). DESIGN.md section numbers in the test names.
//   npm run test:glasshouse
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const GAME = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { build, checkStrips } = require(path.join(GAME, "tools", "build-rules.js"));
const RULES = JSON.parse(fs.readFileSync(path.join(GAME, "math", "rules.json"), "utf8"));

/** The engine in its own vm context, as the RGS loads it; `seed` makes the stream replayable. */
function load(seed = "t") {
  let ctr = 0;
  const cryptoStub = {
    getRandomValues(view) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      for (let i = 0; i < bytes.length; i += 32) {
        const h = crypto.createHash("sha256").update(`${seed}/${ctr++}`).digest();
        bytes.set(h.subarray(0, Math.min(32, bytes.length - i)), i);
      }
      return view;
    }
  };
  const sandbox = { crypto: cryptoStub, console };
  vm.createContext(sandbox);
  new vm.Script(fs.readFileSync(path.join(GAME, "engine", "engine.js"), "utf8")).runInContext(sandbox);
  return sandbox.Glasshouse;
}

// Results come from another realm (the vm): copy them into this one before comparing.
const J = (x) => JSON.parse(JSON.stringify(x));
const NS = load();
const G = {
  TURN: NS.TURN,
  SpinEngine: NS.SpinEngine,
  trace: (...a) => J(NS.trace(...a)),
  beamsFor: (...a) => J(NS.beamsFor(...a)),
  evaluateWays: (...a) => J(NS.evaluateWays(...a))
};
const X = "CLEAR"; // filler: a clear pane pays nothing
// Boards are written as rows of short codes, row 0 at the top.
const CODE = { L: "LENS", "/": "MIRROR_RISE", "\\": "MIRROR_FALL", R: "ROSE", H: "HUMMINGBIRD", O: "ORCHID", C: "CLEAR", ".": X, a: "PEAR", b: "BAGUETTE", c: "CUSHION", d: "SUNDIAL", e: "HEART", m: "MARQUISE", w: "WATERING_CAN" };
const board = (...rows) => rows.map((r) => r.split(" ").map((k) => CODE[k]));
const cells = (b) => b.path.map(([r, c]) => `${r},${c}`);
const lit = (list) => list.map(([r, c]) => `${r},${c}`);

function engineAt({ freeSpinsLeft = 0, featureState = null, bonusRoundWin = 0 } = {}) {
  const e = new G.SpinEngine({ rules: RULES });
  e.initSession({ balance: 1e9 });
  Object.assign(e.session, { freeSpinsLeft, featureState, bonusRoundWin });
  return e;
}
const resolve = (e, matrix, opts = {}) => J(e.resolve({ stops: [0, 0, 0, 0, 0, 0], matrix }, Object.assign({ bet: 1, isFree: e.session.freeSpinsLeft > 0, isBuy: false, charged: 1 }, opts)));

test("§4.1 mirror table: every direction into both mirrors", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(G.TURN)), {
    MIRROR_RISE: { R: "U", U: "R", D: "L", L: "D" },
    MIRROR_FALL: { R: "D", D: "R", U: "L", L: "U" }
  });
});

test("§4.6 A: a straight beam lights its whole row and exits right", () => {
  const m = board(". . . . . .", "L . . . . .", ". . . . . .", ". . . . . .");
  const b = G.trace(m, 1, null);
  assert.deepEqual(cells(b), ["1,0", "1,1", "1,2", "1,3", "1,4", "1,5"]);
  assert.equal(b.exit, "right");
  assert.equal(b.bends.length, 0);
});

test("§4.6 B: a rising mirror sends the beam up and out of the top", () => {
  const m = board(". . . . . .", "L . . / . .", ". . . . . .", ". . . . . .");
  const b = G.trace(m, 1, null);
  assert.deepEqual(cells(b), ["1,0", "1,1", "1,2", "1,3", "0,3"]);
  assert.equal(b.exit, "top");
  assert.deepEqual(b.bends, [[1, 3, "R", "U"]]);
});

test("§4.6 C: three bends and a crossing (8 distinct cells)", () => {
  const m = board(". . . . . .", "L . \\ . . .", ". . . . . .", ". \\ / . . .");
  const b = G.trace(m, 1, null);
  assert.deepEqual(cells(b), ["1,0", "1,1", "1,2", "2,2", "3,2", "3,1", "2,1", "1,1", "0,1"]);
  assert.equal(new Set(cells(b)).size, 8);
  assert.equal(b.exit, "top");
});

test("§4.6 D / §4.4: two lenses fire top to bottom and share the board", () => {
  const m = board("L . . \\ . .", ". . . . . .", "L . . . . .", ". . . . . .");
  const { beams, litGrid } = G.beamsFor(RULES, m, null);
  assert.equal(beams.length, 2);
  assert.deepEqual(beams[0].lens, [0, 0]);
  assert.deepEqual(cells(beams[0]), ["0,0", "0,1", "0,2", "0,3", "1,3", "2,3", "3,3"]);
  assert.deepEqual(cells(beams[1]), ["2,0", "2,1", "2,2", "2,3", "2,4", "2,5"]);
  assert.equal(litGrid[2][3], true); // the crossing cell, lit once
});

test("§4.3 no beam can loop: 300k random mirror boards, the guard never fires", () => {
  const syms = ["MIRROR_RISE", "MIRROR_FALL", X, X];
  for (let n = 0; n < 300000; n++) {
    const m = [0, 1, 2, 3].map(() => [0, 1, 2, 3, 4, 5].map((c) => (c === 0 ? X : syms[(Math.random() * 4) | 0])));
    const row = (Math.random() * 4) | 0;
    m[row][0] = "LENS";
    const b = G.trace(m, row, null);
    assert.ok(b.path.length <= 24 * 2);
  }
});

test("§3.3 ways: counts per reel multiply; 3 reels pay the 3-reel pay", () => {
  // Orchid on reels 1-3: 1 x 2 x 1 = 2 ways at 1.75x.
  const m = board("O . O . . .", ". O . . . .", ". O . . . .", ". . . . . .");
  const wild = m.map((row) => row.map(() => false));
  const wins = G.evaluateWays(RULES, m.map((r) => r.map((x) => (x === X ? "CLEAR" : x))), wild, 1);
  assert.equal(wins.length, 1);
  assert.equal(wins[0].symbol, "ORCHID");
  assert.equal(wins[0].reels, 3);
  assert.equal(wins[0].ways, 2);
  assert.equal(wins[0].amount, 3.5);
});

test("§3.3 a way made only of wild panes pays as Hummingbird, never as every symbol", () => {
  const m = [0, 1, 2, 3].map(() => new Array(6).fill("CLEAR"));
  const wild = m.map((row, r) => row.map((x, c) => r === 0 && c < 3)); // one wild pane on reels 1-3
  const wins = G.evaluateWays(RULES, m, wild, 1);
  assert.deepEqual(wins.map((w) => [w.symbol, w.ways, w.amount]), [["HUMMINGBIRD", 1, RULES.paytable.HUMMINGBIRD[0]]]);
});

test("§4.5 the Sun Lens is never wild; a lit Glass Rose stays a scatter", () => {
  const e = engineAt();
  const m = board(". . . . . .", "L O R O O .", ". . . . . .", ". . . . . .");
  const r = resolve(e, m);
  assert.ok(!lit(r.wilds).includes("1,0"), "lens cell not wild");
  assert.ok(!lit(r.wilds).includes("1,2"), "rose cell not wild");
  assert.ok(lit(r.lit).includes("1,2"), "the rose cell is still on the beam");
  assert.ok(lit(r.wilds).includes("1,1") && lit(r.wilds).includes("1,5"));
});

test("§5 free spins: lit panes stay wild for sticky_spins more spins, then fade", () => {
  const ttl = RULES.free_spins.sticky_spins;
  assert.equal(ttl, 2);
  const e = engineAt({ freeSpinsLeft: 10, featureState: { sticky: [], ttl: [] } });
  const plain = board(". . . . . .", ". . . . . .", ". . . . . .", ". . . . . .");
  const r1 = resolve(e, board(". . . . . .", "L . . / . .", ". . . . . .", ". . . . . ."));
  assert.deepEqual(lit(r1.feature_state.sticky), ["0,3", "1,1", "1,2", "1,3"]); // the lens itself never stays lit
  assert.deepEqual(r1.feature_state.ttl, [2, 2, 2, 2]);
  const r2 = resolve(e, plain);
  assert.deepEqual(lit(r2.wilds), ["0,3", "1,1", "1,2", "1,3"]);
  assert.deepEqual(r2.feature_state.ttl, [1, 1, 1, 1]);
  const r3 = resolve(e, plain);
  assert.equal(r3.wilds.length, 4);
  assert.deepEqual(r3.feature_state.sticky, []);
  const r4 = resolve(e, plain);
  assert.equal(r4.wilds.length, 0);
  assert.equal(r4.free_spins_left, 6);
});

test("§5 a lit pane ignores what lands under it: no mirror, no lens, no rose", () => {
  const e = engineAt({ freeSpinsLeft: 5, featureState: { sticky: [[1, 0], [1, 3], [0, 0]], ttl: [2, 2, 2] } });
  const r = resolve(e, board("R . . . . .", "L . . / . .", ". . . . . .", ". . . . . ."));
  assert.equal(r.beams.length, 0, "a lens under a lit pane does not fire");
  assert.equal(r.scatter.count, 0, "a rose under a lit pane is not counted");
  const e2 = engineAt({ freeSpinsLeft: 5, featureState: { sticky: [[2, 3]], ttl: [2] } });
  const r2 = resolve(e2, board(". . . . . .", ". . . . . .", "L . . / . .", ". . . . . ."));
  assert.equal(r2.beams[0].exit, "right", "the beam passes straight through a lit pane, even over a mirror");
});

test("§7 max win: a full board of lit panes is capped at 5,000x and ends the feature", () => {
  const all = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) all.push([r, c]);
  const e = engineAt({ freeSpinsLeft: 8, featureState: { sticky: all, ttl: all.map(() => 2) }, bonusRoundWin: 100 });
  const r = resolve(e, board(". . . . . .", ". . . . . .", ". . . . . .", ". . . . . ."));
  assert.equal(r.total_win, 4900);
  assert.equal(r.bonus_round_win, 5000);
  assert.equal(r.free_spins_left, 0);
  assert.equal(r.feature_state, null);
  assert.equal(r.events[0].type, "FREE_SPINS_ENDED_BY_MAX_WIN_CAP");
});

test("§5 triggers: 3 roses award 10 in the base game, add 5 in the feature", () => {
  const roses = board("R . . . . .", ". . R . . .", ". . . . R .", ". . . . . .");
  const base = resolve(engineAt(), roses);
  assert.equal(base.free_spins_left, 10);
  assert.deepEqual(base.feature_state, { sticky: [], ttl: [] });
  assert.equal(base.scatter.amount, RULES.scatter.pays[0]);
  const fs2 = resolve(engineAt({ freeSpinsLeft: 3, featureState: { sticky: [], ttl: [] } }), roses);
  assert.equal(fs2.free_spins_left, 7);
  assert.equal(fs2.events.find((x) => x.type === "FREE_SPINS_RETRIGGERED").awarded, 5);
});

test("§6 buy: costs 100x, lands exactly 3 roses, starts 10 free spins; refused mid-feature", () => {
  const e = engineAt();
  const r = J(e.buyFreeSpins({ bet_amount: 2 }));
  assert.equal(r.bet_charged, 200);
  assert.equal(r.scatter.count, 3);
  assert.equal(r.free_spins_left, 10);
  assert.ok(r.is_buy);
  assert.throws(() => e.buyFreeSpins({ bet_amount: 2 }), /FEATURE_IN_PROGRESS/);
});

test("spin input checks: unknown bet and ante are refused", () => {
  const e = engineAt();
  assert.throws(() => e.spin({ bet_amount: 0.3 }), /INVALID_BET/);
  assert.throws(() => e.spin({ bet_amount: 1, ante_enabled: true }), /ANTE_NOT_AVAILABLE/);
});

test("§8 replay: the same seed and pre-state reproduce the round exactly", () => {
  const run = () => {
    const ns = load("replay-seed");
    const e = new ns.SpinEngine({ rules: RULES });
    e.initSession({ balance: 1000 });
    const out = [];
    for (let i = 0; i < 300; i++) out.push(e.spin({ bet_amount: 1, spin_id: `s${i}` }));
    return JSON.stringify(out);
  };
  assert.equal(run(), run());
});

test("§2.1 strips: every shipped strip set obeys the spacing rules", () => {
  for (const [k, set] of Object.entries(RULES.strip_sets)) {
    assert.deepEqual(checkStrips(set.base), [], `${k} base`);
    assert.deepEqual(checkStrips(set.free), [], `${k} free`);
  }
});

test("rules.json is exactly what build-rules.js builds (never hand-edited)", () => {
  const built = build();
  const shipped = JSON.parse(JSON.stringify(RULES));
  for (const p of [...built.rtp_profiles, ...shipped.rtp_profiles]) { delete p.theoretical_percent; delete p.buy_free_spins_percent; }
  assert.deepEqual(shipped, JSON.parse(JSON.stringify(built)));
});
