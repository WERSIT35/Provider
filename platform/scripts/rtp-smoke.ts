/**
 * Lightweight RTP smoke test for the server-side engine module. Confirms the
 * ported engine produces RTP within tolerance of the configured target. This is
 * a fast sanity check (default 100k spins) — the certification-grade 1M+ run is
 * the repo-root `npm run test:rtp-parity`.
 *
 * Usage: STEPS=100000 BET=1 GAME_ID=bananax TOLERANCE=1.0 npm run smoke:rtp
 */
import { EngineService } from "../src/modules/engine/engine.service";

const steps = Number(process.env.STEPS ?? 100_000);
const betAmount = Number(process.env.BET ?? 1);
const anteEnabled = process.env.ANTE === "1";
const bonusOnly = process.env.BONUS_ONLY === "1";
const tolerancePct = Number(process.env.TOLERANCE ?? 1.0);

const svc = new EngineService();
const gameId = process.env.GAME_ID ?? svc.getRtpProfile().game_id;
const profile = svc.getRtpProfile(gameId);
const target = Number(profile.theoretical_percent ?? 0);

console.log(`RTP smoke: ${steps.toLocaleString()} spins on '${gameId}' (bet ${betAmount}, ante=${anteEnabled})`);
const t0 = Date.now();
const report = svc.simulate({ steps, betAmount, anteEnabled, bonusOnly, gameId }) as {
  current?: { rtp_percent?: number; hit_frequency_percent?: number; max_win_x?: number };
};
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

const actual = Number(report.current?.rtp_percent ?? 0);
const delta = actual - target;
const passed = Math.abs(delta) <= tolerancePct;

console.log(`  target RTP : ${target.toFixed(2)}%`);
console.log(`  engine RTP : ${actual.toFixed(2)}% (delta ${delta >= 0 ? "+" : ""}${delta.toFixed(2)}%)`);
console.log(`  tolerance  : ±${tolerancePct.toFixed(2)}%`);
console.log(`  hit rate   : ${Number(report.current?.hit_frequency_percent ?? 0).toFixed(2)}%`);
console.log(`  max win x  : ${Number(report.current?.max_win_x ?? 0).toFixed(2)}x`);
console.log(`  elapsed    : ${elapsed}s`);
console.log(`  result     : ${passed ? "PASS" : "FAIL"}`);

process.exit(passed ? 0 : 1);
