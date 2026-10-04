# CHECKPOINT — 2026-10-05

Where the work stands, the decisions behind it, and what comes next. Branch:
`fix/board-aspect-ratio-and-asset-hardening`.

**Milestone status:** the cinematic client overhaul (§1), Platform Phase 3 (§1b) and
**Phase 4, math certification (§1c)** are complete. The certified build is commit `6d75826`
(engine 1.2.0, rules 3.1.0); the lab report is `qa/rtp-certification-report.md`. Before lab
submission, open items O1–O4 (§5) must be closed. The next phase is the **Demo Casino**
integration (§6, blueprint `docs/16-demo-casino-blueprint.md`).

---

## 1. Client: Vault 20K UI + motion (shipped 2026-10-02)

| Commit | What |
|--------|------|
| `04449d6` | Vault 20K rebrand (Lumina Games), theme tokens + `THEME`, unified `WIN_TIERS`, full-screen big-win overlay (`client/big-win.js`) |
| `e954c54` | Perf: sprite cache stopped rebaking ~421×/s on phones (`SPRITE_BAND`) |
| `0a97ac0` | Symbol motion, cluster spotlight, per-reel landing audio |
| `d87522a` | Pragmatic-style player shell (CSS named-area grid), vector Spin/Buy/Ante, heavy drops |
| `b05c1f6` | Input layer: tap vs hold, Space, modal system (tabs, focus trap, Esc), HUD ticker |
| `6e9b1c9` | Rigid physics + AAA spin lifecycle (instant lock, 500ms autoplay gap, settle guard) |
| `001a3c7` | Scatter pings + live count, reel anticipation, trigger lock-on |
| `25f103b` | 44px touch targets; frame cadence 24→30fps fix + governor threshold fix |
| `ba7ae35` | Art originals moved to `art-src/`, dead UI plates dropped, inspector symbol URL fix |
| `b84f283` | Final motion + UI pass: no shake, `ShardEmitter`, per-symbol independent drops, no wind-up, reel inertia, tumble vacuum + momentum, fast-stop zip, reel mask, top bar removed + ticker state machine |

## 1b. Platform Phase 3: Operator Portal + Free Rounds (shipped 2026-10-03/04)

| Commit | Phase | What |
|--------|-------|------|
| `e46dcf9` | 3A + 3B | Round Inspector deep link `/admin#inspector?round=<ref>` + verification banner; Player Reports (`/admin/v1/reports/players`, `/admin/v1/players/:id/summary`, tenant-scoped, CSV) |
| `ba3c31b` | 3C | Campaign data model (`src/modules/campaigns/campaign.repository.ts`, atomic grant deduction), `0002_campaigns.sql` |
| `46b1249` | 3C | Admin campaign routes, orchestrator free-round path (no debit), `FREE_ROUND_BET` tagging (`0003`), mid-feature `locked_bet` / `locked_ante` (`0004`) |
| `4e413c6` | 3D | HMAC `POST /operator/v1/free-rounds/grant`, `GET /operator/v1/free-rounds/player/:id`; client free-rounds modal + ticker countdown |

## 1c. Phase 4: math certification (shipped 2026-10-04/05)

| Commit | What |
|--------|------|
| `a4ea4f5` | Engine 1.0.0. Near-miss fabrication removed (`near-miss.js` deleted). Free-spin multiplier **bank** applies only to a winning sequence on which a multiplier landed. 20,000x cap covers the **whole feature round** (trigger spin seeds `bonusRoundWin`); the platform now carries `player_sessions.bonus_round_win` between spins (`0006`) — before this every RGS free spin was capped on its own. Rounds record `engine_version` (`0005`); verification is version-aware. `base_payout_scaler` removed. `tools/rtp-parity.js` rewritten (seeded xoshiro128**, 20 fixed shards, iid samples = paid round incl. bonus, PASS iff \|Δ\| ≤ 3·SE and SE ≤ 0.25%, `MODE=buy`, scaler overrides). |
| `14ff281` | Engine 1.1.0. Scatter chance split by spin type: base **0.020** (natural trigger ~1 in 248), ante **0.02192** (~1 in 182), free spins **0.0086**. Recalibrated scalers (payout / free-spin): 96.38 → **0.9807 / 3.8058**, 94.40 → **0.9605 / 3.7276**, 92.38 → **0.9399 / 3.6478**. Rounds record `rules_hash` (SHA-256 of canonical rules JSON, `0007`); a different engine version **or** rules hash replays as *inconclusive*, never *tampered*. Four tests fixed that assumed spins never trigger the bonus. Parity defaults 30M (4M buy). |
| `6d75826` | Engine 1.2.0, rules **3.1.0**. Scatter tiers are lower bounds (7+ scatters pay the 6+ tier; was 0). Ante declared **96.59%**. Seed/e2e scripts register math config 3.1.0 with `config_hash` = `sha256:` + rules hash. Certification report + raw data in `qa/`. |

**How the gap was actually found:** a 24M-sample side-by-side showed `client/engine/` and
`backend/server.js` statistically identical (95.77% both). There was no engine bug; the scalers
were stale after the earlier multiplier fix, and the old ±0.20% tolerance at 1M spins was half a
standard error. Calibration is linear in the two scalers: measure coefficients at scaler = 1
on seed `calib`, solve per profile, then raise the free-spin scaler ~0.16% for the cap's trim.
Never calibrate on the default seed.

**Certified results (96.38 profile, `qa/rtp-certification-report.md`):**

| Mode | 30M (seed `vault20k`) | Pooled with 200M independent | Declared |
|---|---|---|---|
| Base | 96.535% ± 0.202 | 96.359% ± 0.073 | 96.38 |
| Ante | 96.935% ± 0.201 | 96.698% ± 0.070 | 96.59 |
| Buy (100x) | 96.407% ± 0.026 | — | 96.38 |

Hit frequency 24.18%, bonus 1 in 247 (ante 1 in 183), average bonus 89.5x, volatility index
21.7, cap hit by 52 of 30M buys, each at exactly 20,000.00x, never exceeded.

## 2. Rules the user set (keep them)

- **`client/engine/` is sacred for presentation work.** Visuals are a pure function of the
  payload; `Math.random()` for visuals only; never `SlotEngine.RNG`. Math changes go in the
  engine, mirrored in `backend/server.js`, and **bump `ENGINE_VERSION`** when a seed would
  resolve differently.
- **No screen/board shake, ever.** No upward wind-up. Per-symbol independent drops. No top
  bar; `#psTicker` is the only message line. Zero layout thrash; 60fps without GC spikes.
- Internal ids stay `bananax`. Display name Vault 20K / Lumina Games. Board 6×5.
- **No engineered near-misses** (Option C, done). Every board is RNG-natural.
- **Math rulings (2026-10-04/05):** multiplier bank rule as in §1c; buy feature stays at 100x
  (bonus buffed instead); ante stays 1.25x and triggers ~1.36x the base rate (calibrated to its
  RTP, not 2x); ante RTP is **declared** (96.59%), not tuned down; lower profiles stay
  **94.40 / 92.38**; cap covers the whole round.
- The user reviews code before commits and approves each step; the user names commit messages.

## 3. Platform state worth knowing

- Admin 2FA: `ADMIN_TOTP_REQUIRED` unset = OFF for `NODE_ENV=local|test`, ON elsewhere;
  staging/production refuse to boot with it off. Dev login `admin` / `change-me-admin`.
- Migrations `0001`–`0007` are forward-only; new hash-chained round columns must be
  `omitNull` and only set when present (see `persistence.ts` `TABLES`).
- Round records carry `engine_version`, `rules_hash`, `pre_state.bonus_round_win`.
- `demo-operator/test/e2e.test.ts`: three lines were reconstructed after an accidental
  `git checkout` (2026-10-02); still worth a quick review.

## 4. Status (re-verified 2026-10-05 on `6d75826`)

| Check | Result |
|-------|--------|
| `npm run test:client` (spin-lock, layout, spin-e2e) | PASS |
| platform `npm run typecheck` | PASS |
| platform `npx vitest run` | PASS, 27 files / 170 tests (stress-run 30× clean) |
| platform `npm run e2e` | PASS (incl. cross-tenant 404) |
| `npm run test:rtp-parity` (30M, seeded) | PASS |
| `tools/api-test.js` (MVP) | runs clean; its simulate band check uses 1,000 steps and is noise at this volatility |
| demo-operator tests, `tools/probes/*` | not re-run since 2026-10-02 |
| `tools/probes/hit-target-probe.js` | FAIL as of 2026-10-02 (autoplay/turbo hit area at 844×390 / 740×360) |

## 5. Open items

**Before lab submission (from the certification report §7):**

- **O1 — Ante declaration trails the math.** The 7+ scatter fix raised ante to 96.70% ± 0.07
  pooled; the declaration is 96.59%. Passes, but declare **96.70%** to match.
- **O2 — In-game paytable shows unscaled pays (lab blocker).** It shows raw values while paid
  spins pay ×0.9807 and free spins ×3.8058; displayed pays must equal actual pays.
- **O3 — Player rules copy is stale (lab blocker).** Still "BANANA X", "5 reels x 4 rows",
  "Apex Wild", and a "Live markets" list (UK, Malta, Ontario…) the game is not certified in.
- **O4 — Other profiles.** `bananax_94` / `bananax_92` need their own 30M reports and ante
  declarations.

**Carried over:**

5. Campaign Manager has no console view (API only).
6. Free-round expiry is lazy (`expireDue()` never scheduled); no operator-side cancel.
7. `platform/scripts/e2e-operator.ts` does not exercise free rounds.
8. Landscape-phone hit areas for autoplay/turbo.
9. Round ID strip sits above the board in `/play` mode only.
10. `.claude/settings.local.json` is tracked although `.gitignore` lists it; never committed —
    consider `git rm --cached`.
11. `backend/server.js` (legacy MVP) still caps each free spin rather than the whole round.
12. `docs/multiplier-rules.md` still describes the old multiplier rule (user scheduled a docs chore).

## 6. Next: Demo Casino integration

Blueprint: [`docs/16-demo-casino-blueprint.md`](docs/16-demo-casino-blueprint.md).
`demo-operator/` already does HMAC launch into the `/play` iframe and signed, idempotent wallet
webhooks, so this phase is hardening and wiring:

1. **Staff login on the back-office** — `/api/admin/*` is currently unauthenticated. (Start here.)
2. **Webhook enrichment** — signed `gameCode`, `roundType`, `featureRef` so the casino can
   group a bonus with its free spins.
3. **Player + spin history** from the casino's own ledger (joined on `roundRef`), CSV export.
4. **"Verify on provider"** per round → `/admin#inspector?round=<ref>`; staff sign in with
   provider-issued `operator_admin` / `operator_finance` accounts (viewer cannot verify); the
   deep link survives sign-in and runs the verification.
5. **Iframe `postMessage` contract + `frame-ancestors`** from registered operator domains
   (today any site can embed `/play`).
6. Failure-path e2e (insufficient funds, credit retry, rollback).
7. Optional signed round APIs (`GET /operator/v1/rounds/:ref`, `/verification`).

**Decisions pending (user):** demo-casino persistence (in-memory vs SQLite/Postgres); ship the
optional signed round APIs now or later; hosting topology (one host / two ports vs two hostnames).

## 7. How to resume

```bash
npm run test:client                                   # client gate
npm run test:rtp-parity                               # seeded 30M parity (~40s on 20 threads)
cd platform && npx vitest run && npm run dev:seed     # platform tests; consoles + seeded logins
cd demo-operator && npm run dev                       # demo casino on :4000 (PLATFORM_URL=http://127.0.0.1:8080)
```

Read first: `CLAUDE.md` (invariants), `qa/rtp-certification-report.md` (math),
`docs/16-demo-casino-blueprint.md` (next phase).
