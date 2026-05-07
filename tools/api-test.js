// End-to-end test of the demo-slot API.
// Walks the full lifecycle a casino aggregator would use:
//   health → game-rules → session.init → spin (10x) → buy-free-spins → simulate
// Run with the server running on :3000 (npm start).
//
//   node tools/api-test.js
//   BASE=http://localhost:4000 node tools/api-test.js   (override base)
//   BETS=20 GAME_ID=provider-slot-v2 node tools/api-test.js

const BASE = process.env.BASE || "http://localhost:3000";
const SPINS = Number(process.env.BETS || 10);
const GAME_ID = process.env.GAME_ID || "provider-slot-v2";

const fmt = (v) => Number(v || 0).toFixed(2);
const log = (...a) => console.log(...a);
const sep = (label) => log(`\n=== ${label} ===`);

async function api(path, { method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${typeof json === "string" ? json : JSON.stringify(json)}`);
  }
  return json;
}

(async () => {
  sep("Health");
  const health = await api("/api/v1/health");
  log(health);

  sep("Game rules");
  const rules = await api(`/api/v1/game-rules?game_id=${encodeURIComponent(GAME_ID)}`);
  log({
    game_id: rules.active_game_id,
    slug: rules.active_slug,
    rtp_percent: rules.rtp?.theoretical_percent,
    features: Object.keys(rules.features || {}),
    allowed_bets: rules.bets || rules.allowed_bets
  });

  sep("Session init");
  const session = await api("/api/v1/session/init", {
    method: "POST",
    body: {
      player_id: `tester-${Date.now()}`,
      currency: "USD",
      locale: "en-US",
      game_id: GAME_ID
    }
  });
  log({
    session_id: session.session_id,
    balance: session.balance,
    allowed_bets: session.allowed_bets,
    rtp_profile: session.rtp_profile?.theoretical_percent
  });
  const sid = session.session_id;
  const bet = (session.allowed_bets || [1])[0];

  sep(`Spin ×${SPINS} @ bet ${bet}`);
  let totalWagered = 0;
  let totalWon = 0;
  let bigWins = 0;
  let bonusTriggers = 0;
  for (let i = 0; i < SPINS; i += 1) {
    const out = await api("/api/v1/spin", {
      method: "POST",
      body: {
        session_id: sid,
        spin_id: `spin-${Date.now()}-${i}`,
        bet_amount: bet,
        ante_enabled: false
      }
    });
    totalWagered += Number(out.bet_charged || bet);
    totalWon += Number(out.total_win || 0);
    const winX = bet > 0 ? Number(out.total_win || 0) / bet : 0;
    if (winX >= 50) bigWins += 1;
    if (Number(out.free_spins_awarded || 0) > 0) bonusTriggers += 1;
    const wins = (out.ways_wins || []).map((w) => `${w.symbol}×${w.count}`).join(",");
    log(`#${String(i + 1).padStart(3)} bet=${fmt(bet)} win=${fmt(out.total_win)} multi=${out.multiplier_applied}x bal=${fmt(out.balance_after)} ${wins ? `wins=[${wins}]` : ""}${out.free_spins_awarded ? ` BONUS+${out.free_spins_awarded}` : ""}`);
  }
  log(`\ntotals: wagered=${fmt(totalWagered)} won=${fmt(totalWon)} session_rtp=${((totalWon / totalWagered) * 100).toFixed(2)}% big_wins=${bigWins} bonus_triggers=${bonusTriggers}`);

  sep("Buy free spins (if enabled)");
  try {
    const buy = await api("/api/v1/buy-free-spins", {
      method: "POST",
      body: { session_id: sid, bet_amount: bet }
    });
    log({
      cost: buy.cost,
      free_spins_awarded: buy.free_spins_awarded,
      balance_after: buy.balance_after
    });
  } catch (e) {
    log(`buy-free-spins: ${e.message}`);
  }

  sep("Simulate (1k spins, batched)");
  try {
    const sim = await api("/api/v1/simulate", {
      method: "POST",
      body: { game_id: GAME_ID, steps: 1000, bet_amount: bet }
    });
    // Pretty-print the most relevant fields from the simulation comparison.
    log(sim);
  } catch (e) {
    log(`simulate: ${e.message}`);
  }

  sep("Done");
})().catch((err) => {
  console.error("\nFAILED:", err.message);
  process.exit(1);
});
