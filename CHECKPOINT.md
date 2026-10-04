# CHECKPOINT — 2026-10-04

Where the work stands, the decisions behind it, and what comes next. Branch:
`fix/board-aspect-ratio-and-asset-hardening`.

**Milestone status:** the cinematic client overhaul (§1) and Platform Phase 3 (§1b: Round
Inspector, Player Reports, Campaign Manager, Free Rounds) are **complete**. The next sprint is
Phase 4, math certification readiness (§6).

---

## 1. What shipped this session (client: Vault 20K UI + motion)

Commits, oldest first:

| Commit | What |
|--------|------|
| `04449d6` | Vault 20K rebrand (Lumina Games), theme tokens + `THEME`, unified `WIN_TIERS`, full-screen big-win overlay (`client/big-win.js`) |
| `e954c54` | Perf: sprite cache stopped rebaking ~421×/s on phones (`SPRITE_BAND`) |
| `0a97ac0` | Symbol motion, cluster spotlight, per-reel landing audio |
| `d87522a` | Pragmatic-style player shell (CSS named-area grid), vector Spin/Buy/Ante, heavy drops |
| `b05c1f6` | Input layer: tap vs hold, Space, modal system (tabs, focus trap, Esc), HUD ticker |
| `6e9b1c9` | Rigid physics + AAA spin lifecycle (instant lock, 500ms autoplay gap, settle guard) |
| `001a3c7` | Scatter pings + live count, reel anticipation, trigger lock-on, Option B suppression |
| `25f103b` | 44px touch targets; frame cadence 24→30fps fix + governor threshold fix |
| `ba7ae35` | Art originals moved to `art-src/`, dead UI plates dropped, inspector symbol URL fix |
| `b84f283` | **Final motion + UI pass:** no shake anywhere, `ShardEmitter` shatter, per-symbol independent drops, no wind-up, reel inertia groups, micro-squash + glints, tumble vacuum + momentum, fast-stop zip, reel mask, **top bar removed + ticker state machine** |

Then (the "checkpoint" commits): platform/demo-operator work + dev 2FA default, docs rewrite,
probes saved into `tools/probes/`, this file.

## 1b. Platform Phase 3 shipped (Operator Portal + Free Rounds)

| Commit | Phase | What |
|--------|-------|------|
| `e46dcf9` | 3A + 3B | Round Inspector first in operator nav, deep link `/admin#inspector?round=<ref>`, verification banner. Player Reports: `playerReport()` / `playerSummary()`, `GET /admin/v1/reports/players`, `GET /admin/v1/players/:id/summary` (`reports.read`, tenant-scoped), console view + CSV. Tests: `player-reports.test.ts` |
| `ba3c31b` | 3C | Campaign data model: `src/modules/campaigns/campaign.repository.ts` (campaigns + per-player grants, atomic spin deduction), `migrations/0002_campaigns.sql`, persistence `TABLES` + hydrate. Tests: `campaign.repository.test.ts` |
| `46b1249` | 3C | Admin routes `src/http/admin-campaigns.routes.ts` (`/admin/v1/campaigns` list/get/create, `/:id/players`, `/:id/cancel`); orchestrator free-round spin path (grant's bet, no debit); wallet tagging `FREE_ROUND_BET` (`0003_free_round_tagging.sql`); session locks `locked_bet` / `locked_ante` (`0004_session_locks.sql`) so bet/ante can't change mid-feature. Tests: `free-rounds.test.ts`, `feature-lock.test.ts` |
| `4e413c6` | 3D | HMAC operator API `POST /operator/v1/free-rounds/grant`, `GET /operator/v1/free-rounds/player/:operatorPlayerId`. Client: mid-session UI lockdown, "You have X Free Rounds" modal, ticker countdown. Tests: `operator-free-rounds.test.ts` |

Engine untouched: operator free rounds do not use `free_spins_left`.

## 2. Rules the user set (keep them)

- **`client/engine/` is sacred.** Presentation never edits it. Visuals are a pure function of the
  payload; `Math.random()` for visuals only; never `SlotEngine.RNG`.
- **No screen/board shake, ever** ("literally hurts the eyes and feels cheap"). Impact = local
  light, particles, audio.
- **No upward wind-up** before drops ("feels unnatural"). Gravity from the press.
- **Per-symbol independence**, not column blocks: bottom-up rat-a-tat landings.
- **No top bar.** `#psTicker` is the only message line; WIN holds until the next spin.
- **Zero layout thrash**; overlays outside the flow; 60fps without GC spikes.
- Internal ids stay `bananax` (game code, RTP keys, storage keys, DB names). Display name only
  changed. demo-operator keeps its folder name; display name "Lumina Sandbox Casino". Board 6×5.
- Near-miss: **Option B** (client suppresses anticipation on engine-fabricated teases). Option C
  (engine switch + lab review) is the user's call.
- The user reviews code before commits and approves each step.

## 3. Platform changes in this checkpoint

- **Admin 2FA off for development.** `ADMIN_TOTP_REQUIRED` (`platform/src/config/env.ts`): unset
  = OFF for `NODE_ENV=local|test`, ON for sandbox/staging/production; explicit value wins;
  staging/production refuse to boot with it off. TOTP code untouched. Verified live:
  `admin` / `change-me-admin` → `provider_super_admin` session.
- The user's own in-progress work committed alongside: production env guards + `env.test.ts`,
  `platform/Dockerfile` + `.dockerignore`, `verify:release` / `audit:prod` / `operator:launch`
  scripts and the CI `release-check` job, Fastify logger API update, demo-operator multi-provider
  admin (`ProviderStore`, `/admin` routes, `/api/play/:provider/:game`,
  `/wallet/:provider/*`), `tools/operator-launch.js`.
- `demo-operator/test/e2e.test.ts`: updated for the multi-provider API and fixed (the
  `ProviderStore` copied the webhook secret before the test set the real one →
  `SIGNATURE_INVALID`). **Note:** three of its lines were reconstructed after an accidental
  `git checkout` of that file; worth a quick review.

## 4. Status (re-verified 2026-10-04)

| Check | Result |
|-------|--------|
| `npm run test:client` (spin-lock, layout, spin-e2e) | PASS |
| platform `npm run typecheck` | PASS |
| platform `npx vitest run` | PASS, 25 files / 161 tests (was 113) |
| `npm run test:rtp-parity` (1M spins) | **FAIL**: 96.14% vs 96.38% (delta -0.24%, tolerance ±0.20%). Same known shared-engine shortfall; engine untouched by Phase 3 |
| demo-operator tests, `tools/probes/*` | not re-run this checkpoint (last PASS 2026-10-02) |
| `tools/probes/hit-target-probe.js` | FAIL as of 2026-10-02 (autoplay/turbo hit area at 844×390 / 740×360) |

## 5. Open items / known issues

1. **RTP shortfall** in `client/engine/`: measured 0.2–1.7% under target across runs. The MVP
   math is fine. Needs a math investigation, and never as part of UI work. **Blocks certification.**
2. **Campaign Manager has no console view.** Campaigns are API-only (`/admin/v1/campaigns*` and
   the HMAC operator routes). The `/admin` and `/provider` consoles have no campaign screen yet.
3. **Free-round expiry is lazy only.** Grants expire when they are read or spun.
   `CampaignRepository.expireDue()` exists but nothing schedules it, so reports can show stale
   "active" grants. There is also no operator-side cancel: operators can only grant and query.
   Cancel exists on the admin API only.
4. `platform/scripts/e2e-operator.ts` does not exercise the free-rounds flow.
5. **Landscape-phone hit areas** for autoplay/turbo (see §4).
6. **Round ID strip** still sits above the board in platform (`/play`) mode only.
7. **Base-game multiplier readout** was removed with the top bar (souls fly to the ticker).
8. `.claude/settings.local.json` is still tracked by git although `.gitignore` lists it (see
   `SECURITY_INCIDENT.md`). Consider `git rm --cached .claude/settings.local.json`.
9. Rules page text still says "BANANA X" / "5 reels x 4 rows". Some seed scripts still title the
   game "Banana X".

## 6. Next: Phase 4, math certification readiness (proposed, not started)

Playbook state (`docs/12-delivery-backlog.md`): everything is DONE except **4. Math** (10M-spin
run, RTP/variance report), **8.** sandbox pass with the first provider, **9.** regression
automation + lab submission, and **10.** KPI dashboard + provider outreach. Every one of those
depends on math the lab can sign off. A lab will not accept an engine that measures 0.24% under
its declared RTP.

**A. Root-cause the RTP gap.** Diff `client/engine/` against the MVP `backend/server.js` (which
hits target) feature by feature: base wins, tumble, multipliers, free-spin trigger and retrigger,
ante, and the engineered near-miss path (see the near-miss memory: 91% of anticipation boards are
fabricated, so a lab may question it too; Option C is the user's call). Fix in `client/engine/`
only, then re-run parity for all three profiles (96.38 / 94.40 / 92.38), plus `ANTE=1` and
`BONUS_ONLY=1`.

**B. 10M-spin validation + report.** RTP with confidence interval, hit rate, volatility index,
win distribution, max-win frequency against the 20000x cap, bonus frequency. Output into
`qa/` as the lab math report. Tick backlog items 4.2 / 4.3.

**C. Regression automation (backlog 9.2).** CI job running platform tests, `test:client`, and a
reduced-step parity run on every PR.

**After Phase 4:** (5) deployment hardening with Postgres on by default in staging (migrations
0001–0004 already forward-only), plus a campaign console view; (6) first provider sandbox pass
using the demo-operator; (7) lab submission.

## 7. How to resume

```bash
npm run test:client                    # client gate
node tools/probes/motion-probe.js      # motion invariants
cd platform && npm run dev:seed        # platform: consoles + seeded logins (2FA off locally)
```

Read first: `CLAUDE.md` (invariants), `docs/animation-guide.md` (motion), `README.md`.
