// Clockwork Menagerie engine: unit tests (node:test). DESIGN.md section numbers in the test names.
//   npm run test:clockwork
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
const { build, checkStrips, compactJson } = require(path.join(GAME, "tools", "build-rules.js"));
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
  return sandbox.Clockwork;
}

// Results come from another realm (the vm): copy them into this one before comparing.
const J = (x) => JSON.parse(JSON.stringify(x));
const CODE = { O: "OWL", F: "FOX", H: "HARE", T: "TORTOISE", g: "GEAR", s: "SPRING", n: "NUT", c: "SCREW", w: "WRENCH", K: "KEY", B: "BOX" };
// Boards are written as rows of short codes, row 0 at the top.
const board = (...rows) => rows.map((r) => r.split(" ").map((k) => CODE[k]));
// A filler board where no line pays in either direction.
const DULL = ["g s n c w", "s n c w g", "n c w g s"];
const BET = 20; // 20 lines: a line bet of exactly 1
const pay = (sym, n) => RULES.paytable[sym][n - 3];

/** An engine whose boards come from `queue` (each a matrix); held reels show the wild, as in the engine. */
function rigged(queue, { gameId = "clockwork", free = 0, woundIn = null } = {}) {
  const ns = load();
  const e = new ns.SpinEngine({ rules: RULES });
  e.initSession({ game_id: gameId, balance: 1e9 });
  if (free) { e.session.freeSpinsLeft = free; e.session.featureState = { wound: woundIn || [] }; }
  const q = queue.slice();
  e.land = (strips, held) => {
    const m = q.shift() || board(...DULL);
    const stops = m[0].map((_, c) => (held && held[c] ? null : 0));
    return { stops, matrix: m.map((row) => row.map((x, c) => (stops[c] === null ? "KEY" : x))) };
  };
  return e;
}

test("§3 left to right: three owls on line 1 pay the 3-owl pay in line bets", () => {
  const r = J(rigged([board("g s n c w", "O O O c w", "n c w g s")]).spin({ bet_amount: BET }));
  const w = r.line_wins.filter((x) => x.line === 1);
  assert.equal(w.length, 1);
  assert.deepEqual([w[0].dir, w[0].symbol, w[0].count, w[0].amount], ["ltr", "OWL", 3, pay("OWL", 3)]);
});

test("§3 right to left: three owls ending on reel 5 pay too", () => {
  const r = J(rigged([board("g s n c w", "g s O O O", "n c w g s")]).spin({ bet_amount: BET }));
  const w = r.line_wins.filter((x) => x.line === 1);
  assert.deepEqual(w.map((x) => [x.dir, x.symbol, x.count]), [["rtl", "OWL", 3]]);
});

test("§3 five of a kind pays once, left to right", () => {
  const r = J(rigged([board("g s n c w", "F F F F F", "n c w g s")]).spin({ bet_amount: BET }));
  const w = r.line_wins.filter((x) => x.line === 1);
  assert.deepEqual(w.map((x) => [x.dir, x.count, x.amount]), [["ltr", 5, pay("FOX", 5)]]);
});

test("§3 one line pays both ways through a wild reel; the wild pays nothing on its own", () => {
  const r = J(rigged([board("g s n c w", "O O K g g", "n c w g s")]).spin({ bet_amount: BET }));
  const w = r.boards[0].line_wins.filter((x) => x.line === 1).map((x) => [x.dir, x.symbol, x.count]);
  assert.deepEqual(w.sort(), [["ltr", "OWL", 3], ["rtl", "GEAR", 3]].sort());
});

test("§4 Wound Wild: a key winds its reel for 2 respins; held reels show the wild; one debit", () => {
  const e = rigged([board("g s n c w", "s n K w g", "n c w g s")]);
  const r = J(e.spin({ bet_amount: BET }));
  assert.equal(r.respins, 2);
  assert.deepEqual(r.boards.map((b) => b.wound), [[[2, 2]], [[2, 1]], [[2, 0]]]);
  for (const b of r.boards.slice(1)) {
    assert.equal(b.stops[2], null);
    assert.deepEqual(b.matrix.map((row) => row[2]), ["KEY", "KEY", "KEY"]);
  }
  assert.equal(r.bet_charged, BET);
  assert.equal(r.total_win, Math.round(r.boards.reduce((t, b) => t + b.win, 0) * 100) / 100);
});

test("§4.3 a key landing in a respin winds its reel with a fresh gauge", () => {
  const e = rigged([board("g s n c w", "s K n w g", "n c w g s"), board("g s n c w", "s n c K g", "n c w g s")]);
  const r = J(e.spin({ bet_amount: BET }));
  // reel 2 (index 1): 2 -> 1 -> 0; reel 4 (index 3) wound on respin 1: 2 -> 1 -> 0.
  assert.deepEqual(r.boards.map((b) => b.wound), [[[1, 2]], [[1, 1], [3, 2]], [[1, 0], [3, 1]], [[3, 0]]]);
  assert.equal(r.respins, 3);
});

test("§5.1 three music boxes on one board pay and award 8 free spins (after the respins)", () => {
  const r = J(rigged([board("B s n c w", "s B c w g", "n c w g B")]).spin({ bet_amount: BET }));
  assert.equal(r.scatter.count, 3);
  assert.equal(r.free_spins_awarded, RULES.free_spins.awards[0]);
  assert.equal(r.free_spins_left, RULES.free_spins.awards[0]);
  assert.deepEqual(r.feature_state, { wound: [] });
  assert.equal(r.boards[0].scatter.amount, RULES.scatter.pays[0] * BET);
});

test("§5.2 free spins: a wound reel stays, its multiplier grows each spin up to the max", () => {
  const e = rigged([board("O s n c w", "O n K w g", "n c w g s")], { free: 10 });
  let r = J(e.spin({ bet_amount: BET }));
  assert.deepEqual(r.feature_state.wound, [[2, 1]]);
  for (let k = 2; k <= RULES.free_spins.max_mult + 2; k++) {
    r = J(e.spin({ bet_amount: BET }));
    assert.deepEqual(r.feature_state.wound, [[2, Math.min(RULES.free_spins.max_mult, k)]]);
  }
});

test("§5.2 a line's multiplier is the sum of the wound reels in its winning run", () => {
  const e = rigged([board("g s n c w", "O O O c w", "n c w g s")], { free: 5, woundIn: [[1, 2], [3, 1]] });
  const r = J(e.spin({ bet_amount: BET }));
  // reels 2 (x3 after +1) and 4 (x2 after +1) are wound; the owls run reels 1-3 (via the wild reel 2), reaching reel 4 too.
  const w = r.line_wins.find((x) => x.line === 1 && x.dir === "ltr");
  assert.equal(w.symbol, "OWL");
  assert.equal(w.count, 4);
  assert.equal(w.mult, 3 + 2);
  assert.equal(w.amount, pay("OWL", 4) * 5);
});

test("§5.1 in the feature, three boxes add 4 spins", () => {
  const e = rigged([board("B s n c w", "s B c w g", "n c w g B")], { free: 3 });
  const r = J(e.spin({ bet_amount: BET }));
  assert.equal(r.free_spins_awarded, RULES.free_spins.retrigger);
  assert.equal(r.free_spins_left, 3 - 1 + RULES.free_spins.retrigger);
});

test("§1 max win: the cap covers the whole feature; the spin that crosses it pays up to it and ends the feature", () => {
  // Every reel 2-4 wound at x5, owls everywhere: 9,750x on this one spin, on top of 5,000x already won.
  const e = rigged([board("O O O O O", "O O O O O", "O O O O O")], { free: 3, woundIn: [[1, 5], [2, 5], [3, 5]] });
  e.session.bonusRoundWin = 5000 * BET;
  const r = J(e.spin({ bet_amount: BET }));
  assert.equal(r.total_win, (RULES.max_win_x - 5000) * BET);
  assert.equal(r.bonus_round_win, RULES.max_win_x * BET);
  assert.equal(r.free_spins_left, 0);
  assert.ok(r.events.some((x) => x.type === "FREE_SPINS_ENDED_BY_MAX_WIN_CAP"));
});

test("§6 buy: costs 100x, lands exactly 3 boxes, no respins, starts the feature; refused mid-feature", () => {
  const ns = load("buy");
  const e = new ns.SpinEngine({ rules: RULES });
  e.initSession({ game_id: "clockwork", balance: 1e9 });
  for (let i = 0; i < 20; i++) {
    e.session.freeSpinsLeft = 0; e.session.featureState = null;
    const r = J(e.buyFreeSpins({ bet_amount: 1 }));
    assert.equal(r.bet_charged, RULES.buy.cost_x);
    assert.equal(r.boards[0].scatter.count, 3);
    assert.equal(r.respins, 0);
    assert.equal(r.free_spins_left, RULES.free_spins.awards[0]);
  }
  assert.throws(() => e.buyFreeSpins({ bet_amount: 1 }), /FEATURE_IN_PROGRESS/);
});

test("spin input checks: unknown bet and ante are refused", () => {
  const e = rigged([]);
  assert.throws(() => e.spin({ bet_amount: 3 }), /INVALID_BET/);
  assert.throws(() => e.spin({ bet_amount: 1, ante_enabled: true }), /ANTE_NOT_AVAILABLE/);
});

test("§8 replay: the same seed and pre-state reproduce the round exactly", () => {
  const run = () => {
    const ns = load("replay");
    const e = new ns.SpinEngine({ rules: RULES });
    e.initSession({ game_id: "clockwork", balance: 1000 });
    const out = [];
    for (let i = 0; i < 300; i++) out.push(J(e.spin({ bet_amount: 1, spin_id: `s${i}` })));
    return out;
  };
  assert.deepEqual(run(), run());
});

test("§2 strips: every shipped strip set obeys the key and box rules", () => {
  for (const [k, set] of Object.entries(RULES.strip_sets)) assert.deepEqual([...checkStrips(set.base), ...checkStrips(set.free)], [], k);
});

test("rules.json is exactly what build-rules.js builds (never hand-edited)", () => {
  const built = build();
  for (const p of built.rtp_profiles) {
    const o = RULES.rtp_profiles.find((x) => x.game_id === p.game_id);
    p.theoretical_percent = o.theoretical_percent; p.buy_free_spins_percent = o.buy_free_spins_percent;
  }
  assert.equal(compactJson(built), compactJson(RULES));
});
