# CHECKPOINT — 2026-10-09

## Latest (2026-10-09): hosting kit, provider website, open items closed

- **Hosting kit `infra/`** (`infra/README.md`): one server with `docker-compose.prod.yml`
  (platform + Postgres + Caddy HTTPS), `gen-secrets.mjs` (fills `.env.prod`, which is
  git-ignored), `backup.sh`. The plan is free student credit (GitHub Student Pack →
  DigitalOcean droplet), starting in `NODE_ENV=staging`. The platform is **not hosted yet**;
  Vercel serves only the static client.
- **CI:** new job `rtp-parity` (reduced seeded run: 5M base, 500k buys), closing §6.2. New
  job `deploy` (SSH, pinned host key) stays off until the repo variable `DEPLOY_ENABLED=true`.
- **Provider website `website/`** (`website/README.md`): a static B2B site (home + Vault 20K
  game sheet), deployed as a **separate** Vercel project with root directory `website`.
  Contact is by email only. It still has two placeholders to fill: the partners email and
  the GLI report reference.
- **Certification:** the user reports the lab certification is done (2026-10-09), by GLI.
  The GLI report reference is not yet recorded in the repo.
- §5 item 8 fixed: the landscape-phone autoplay/turbo hit areas (`hit-target-probe` PASS).
  Item 10 fixed: `.claude/settings.local.json` is no longer tracked.

---

# CHECKPOINT — 2026-10-08

Where the work stands, the decisions behind it, and what comes next. Everything below is
merged to `main` and live on production (Vercel, `provider-flame.vercel.app`, `c7dee65`).

## 00. Latest (2026-10-07/08): client visual overhaul, closed

**Epic #51** (closed). The first pass (#52–#55, PRs #56–#59) was live but too subtle to see.
Frame-by-frame recordings then showed the real problems: an empty board for ~450ms on every
spin, symbols trickling in, a 1.1s static win hold, ghosting motion blur, and exploded
symbols flashing back. These were rebuilt as #46–#50:

| PR | Issue | What |
|---|---|---|
| #60 | #47 | One `GRAVITY` for every drop (closed form, s = ½gt², fall time ∝ √distance). Reels fall as stacks (`WATERFALL`: 75ms per reel on a spin, 22ms on a tumble). One real bounce (restitution 0.18 = 3.2% of the fall). The spin-out has its own layer (`fx.exit`), so the new board follows right behind the old one (no dead air). Ghost trails removed. |
| #61 | #50 | Exploded cells leave the board (`board.cleared`) when the burst starts; the art is gone by `BLAST_GONE` (45%). No flash-back, no ghosting. |
| #62 | #48 | Win hold 300ms (220ms chained). The refill falls under the shards. `holdReal()` fixes a turbo double-scaling bug (holds had run at 16%). |
| #63 | #46 | Free spins "Remaining: N−1". The Total Multiplier badge starts empty (no "1x") and compounds live. Win stat is 1.5×. |
| #64 | #49 | `VxNotify` (`client/notify.js`): one skeleton for every popup (feature, buy, reality check, info, free rounds, big win, win combine, banner), with skins for assets and audio. `docs/notification-skeleton.md`. |
| #65 | — | Turbo `TURBO_SCALE` 0.45 (~2.2× the pace). |

**Decisions (user, 2026-10-08):** turbo 2.0–2.5×. Restitution stays at 3.2%. No screen shake
and no pre-drop lift, for accessibility and layout stability.

**Tooling:** `tools/probes/motion-record.js` records a real round with a controllable page
clock (exact 60fps). Output: animated WebP (real speed + 4× slow), `--sheet` contact sheets,
`--strip` per-reel frames, `--ref <git ref>` for before/after. `tools/probes/motion-probe.js`
asserts all of the above (gravity, bounce, stacks, no dead air, the #50 handoff for 8/15/25
clusters, pacing, HUD, the popup skeleton).

**Next epic: Production Observability & Regulatory Hardening.** Build on what exists:
- Tracing: W3C `traceparent` client → RGS logs → `wallet_transactions.trace_id` → webhooks
  (§0 #45).
- Signing: Ed25519 signed round export, and the hash-chained round ledger.
- Likely gaps, to confirm against the code: the trace does not reach the round ledger or audit
  rows; there is no OpenTelemetry exporter; individual audit entries are not signed (no
  per-jurisdiction keys or key rotation).

---

# CHECKPOINT — 2026-10-06 (previous)

Where the work stands, the decisions behind it, and what comes next. Everything below is
merged to `main`.

## 0. Latest (2026-10-05/06): merged PRs, newest last

| PR | What |
|---|---|
| #40 | Session resume on reload / relaunch (RGS path), bet restore, mid-feature recovery |
| #41 | `/play` frame-ancestors, the casino postMessage bridge, lost-debit reconciliation |
| #42 | Operator HMAC campaign cancel; RNG certification notes + `rng:dump` / `rng:stats` |
| #43 | Bet / ante restore on BOTH boot paths (standalone client too), award-screen reload |
| #44 | Frameless glass board, symbol-tinted win auras, floating HUD pills; layout-check Chrome launch 60s + retry |
| #45 | **Enterprise expansion** (`feat/enterprise-expansion-and-ci`), below |

**#45, enterprise expansion:**
- **CI.** A new parallel `browser-checks` job runs every real-Chrome check plus the operator
  e2e (`npm run verify:browser`). CI now runs on PRs and on pushes to `main` only (no
  duplicate runs), its path filter covers all of `client/**`, and a newer push cancels the
  older run. All browser checks share `platform/scripts/support/chrome-launch.ts` (60s +
  retry). Probes now clean up their temp Chrome profiles.
- **Jurisdiction profiles** (GUIDE §4d): presets are illustrative; compliance must confirm values.
- **Signed round export** (GUIDE §4e) + offline verifier.
- **Observability** (GUIDE §4f): W3C trace across the client, the RGS, both ledgers and the
  webhooks; a `wallet.tx` log line per money move; Prometheus `/metrics`.
- **Canvas context-loss guard.** Adaptive FPS already existed (tiers + governor).
- **Migrations:** platform 0009 (`operators.regulatory`), 0010
  (`wallet_transactions.trace_id`); casino 4 (`wallet_transactions.trace_id`).
- **New env:** `EXPORT_SIGNING_KEY` (required in staging/production; an Ed25519 PKCS#8 PEM),
  `METRICS_TOKEN` (optional).
- **Known, not fixed:** item 8 (landscape-phone autoplay/turbo hit areas) is still failing
  `hit-target-probe`. It predates the glass UI (verified against the pre-glass client).

**Milestone status:** the cinematic client overhaul (§1), Platform Phase 3 (§1b), **Phase 4,
math certification (§1c)**, the **Demo Casino integration** and the **Campaign Manager UI +
expiry job (§1d)** are complete; the branch is merged to `main`. The certified math build is
commit `6d75826` (engine 1.2.0, rules 3.1.0); the lab report is
`qa/rtp-certification-report.md`. Lab-submission items O1–O4 are closed on branch
`chore/lab-submission-o1-o4` (rules 3.2.0, §5); reports for all three profiles are in `qa/`.

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

## 1d. Demo Casino + Campaign Manager (shipped 2026-10-05)

| Commit | What |
|--------|------|
| `195c58e` | **demo-operator backend.** SQLite via built-in `node:sqlite` (`demo-operator/data/casino.sqlite`, WAL, forward-only migrations; Node ≥ 22.13): players, providers, append-only `wallet_transactions` (minor units, per-provider idempotency, single rollback per debit), `staff_sessions`. Webhooks recorded as WAGER / FREE_ROUND_BET / CREDIT / FREE_ROUND_WIN / ROLLBACK with game, round type and campaign. Staff auth on `/api/admin/*` (config creds, default `casino_admin` / `demo123`; opaque token in an HttpOnly SameSite=Strict cookie, SHA-256 stored; logout revokes; failed-login throttle). `GET /api/admin/rounds` with a provider `verifyUrl`. Fixed leaks (player password hashes, raw provider secrets). **Platform:** wallet webhooks carry `gameCode` + `roundType`. |
| `12c4075` | **Casino back-office UI** (`/back-office`): sign-in view, Spin history (timestamp, player, game, round type, bet, win) with **Verify on Provider** → Operator Portal Round Inspector (new tab, noopener/noreferrer); Players / Transactions / Providers. All values escaped (closed a stored-XSS path via player emails); nonce CSP, `frame-ancestors 'none'`, no-store, no-referrer. `npm run check:back-office` (headless Chrome, 20 checks). |
| `d84ac8f` | **Campaign Manager UI** in `/admin` (and `/provider`): campaign table with server-side state, players drawer, create dialog (bet list locked to the game's allowed bets), grant dialog (duplicates skipped), cancel with confirm; write controls only for `campaigns.write` (from `/admin/v1/me` `permissions`). **Background expiry job** `src/jobs/campaign-expiry.ts`: start-up + interval sweep (`CAMPAIGN_EXPIRY_INTERVAL_MS`, default 60s, 0 = start-up only), flushes its own writes, never stacks. Console `esc()` now escapes quotes (attribute-injection hardening). `npm run check:campaigns` (headless Chrome, 25 checks). |

User decisions for this phase: SQLite for demo-operator; no signed round APIs for now (webhooks
+ the visual deep-link bridge only); two localhost ports (platform :8080, casino :4000).

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

## 4. Status (re-verified 2026-10-05 on `d84ac8f`)

| Check | Result |
|-------|--------|
| `npm run test:client` (spin-lock, layout, spin-e2e) | PASS |
| platform `npm run typecheck` | PASS |
| platform `npx vitest run` | PASS, 28 files / 174 tests |
| platform `npm run check:campaigns` (headless Chrome) | PASS, 25 checks |
| demo-operator `npx vitest run` | PASS, 6 files / 37 tests (incl. e2e against a real platform) |
| demo-operator `npm run check:back-office` (headless Chrome) | PASS, 20 checks |
| platform `npm run e2e` | PASS (incl. cross-tenant 404) |
| `npm run test:rtp-parity` (30M, seeded) | PASS |
| `tools/api-test.js` (MVP) | runs clean; its simulate band check uses 1,000 steps and is noise at this volatility |
| `tools/probes/*` | not re-run since 2026-10-02 |
| `tools/probes/hit-target-probe.js` | FAIL as of 2026-10-02 (autoplay/turbo hit area at 844×390 / 740×360) |

## 5. Open items

**Lab submission (certification report §7) — closed 2026-10-05, rules 3.2.0, engine unchanged (1.2.0):**

- **O1** — ante declared **96.70%**. The new 94/92 ante measurements showed the same gap, larger:
  at ante = base they FAILED the 200M run (z ≈ 3.5), so they are declared from pooled measurement
  too: `bananax_94` ante **94.68%**, `bananax_92` ante **92.60%**.
- **O2** — player Info modal now has Base game + Free Spins paytables with scaled pays for the
  active profile (the old table was admin-only and unscaled); `tools/probes/paytable-probe.js`.
- **O3** — rules copy rewritten (Vault 20K, 6x5, real multiplier/free-spin/cap rules), market list
  and `markets` / `apex_wild_enabled` fields removed; RTP lines show only the active profile.
- **O4** — `qa/rtp-certification-report-94.md` / `-92.md`, generated by `tools/rtp-report.js`.

**Carried over:**

5. ~~No operator-side (HMAC) cancel for free-round campaigns~~ — done on `feat/campaign-cancel-and-rng-docs`:
   `POST /operator/v1/free-rounds/cancel` (GUIDE §4c); `npm run e2e` STEP 8 covers grant → play → cancel (also closes item 7).
6. ~~iframe `postMessage` contract + `frame-ancestors` on `/play`~~ — done on
   `feat/iframe-security-and-reconciliation` (GUIDE §4a; `client/embed-bridge.js`;
   `npm run check:embed`, `demo-operator: npm run check:casino-embed`). Signed round APIs
   were deliberately skipped.
13. ~~Lost-debit reversal~~ — done on the same branch (GUIDE §4b; `DebitReconciler`, job
    `src/jobs/debit-reconciliation.ts`, casino `voided_debits`). A lost debit answer is retried
    in line under its key; one that stays unknown voids the round and rolls back by
    `originalIdempotencyKey` (refund, or tombstone so a late debit is refused).
7. ~~`e2e-operator.ts` does not exercise free rounds~~ — done (STEP 8).
8. Landscape-phone hit areas for autoplay/turbo.
9. Round ID strip sits above the board in `/play` mode only.
10. `.claude/settings.local.json` is tracked although `.gitignore` lists it; never committed —
    consider `git rm --cached`.
11. `backend/server.js` (legacy MVP) still caps each free spin rather than the whole round.
12. `docs/multiplier-rules.md` still describes the old multiplier rule (user scheduled a docs chore).

## 6. Next

The functional epic is done. Remaining work, in the order it unblocks launch:

1. **Lab submission** — O1–O4 closed (§5). Remaining: package the three reports + rules 3.2.0
   for the lab, with `qa/rng-certification-notes.md` and an `npm run rng:dump` sample for the
   lab's RNG battery.
2. **First provider sandbox pass** with the demo casino (backlog 8.3). Regression
   automation in CI (backlog 9.2) is done except the parity run: `release-check` (platform +
   demo-operator tests, `test:client`, audit) and `browser-checks` (every real-Chrome check +
   operator e2e). Still to add: a reduced seeded parity run.
3. **Hardening follow-ups** — all done: framing + postMessage and lost-debit reversal (§5 items
   6, 13), operator HMAC campaign cancel (items 5, 7), and the RNG notes `qa/rng-certification-notes.md`
   (`npm run rng:stats` battery, `npm run rng:dump` lab sample).

## 7. How to resume

```bash
npm run test:client                                   # client gate
npm run test:rtp-parity                               # seeded 30M parity (~40s on 20 threads)
cd platform && npx vitest run && npm run dev:seed     # platform tests; consoles + seeded logins
cd demo-operator && npm run dev                       # demo casino on :4000; back-office at /back-office
cd platform && npm run check:campaigns                # Campaign Manager in real Chrome
cd demo-operator && npm run check:back-office         # casino back-office in real Chrome
cd platform && npm run check:embed                    # framing + postMessage bridge in real Chrome
cd demo-operator && npm run check:casino-embed        # the casino page driving the game in real Chrome
```

After pulling this branch, re-run `npm run dev:seed:demo-operator`: the demo casino's launch
origin is now its real host (`localhost:4000`, plus `127.0.0.1:4000`), since only registered
hosts may frame `/play`.

Read first: `CLAUDE.md` (invariants), `qa/rtp-certification-report.md` (math and open items),
`docs/16-demo-casino-blueprint.md` (demo casino design).
