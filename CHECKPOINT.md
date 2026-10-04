# CHECKPOINT — 2026-10-02

Where the work stands, the decisions behind it, and what comes next. Written at the end of the
long client-overhaul session so nothing is lost. Branch: `fix/board-aspect-ratio-and-asset-hardening`.

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

## 4. Status (2026-10-02)

| Check | Result |
|-------|--------|
| `npm run test:client` | PASS |
| platform typecheck / 113 tests / build | PASS |
| demo-operator typecheck / 24 tests | PASS |
| `tools/probes/*` (motion, mask, ticker, audio, scatter, input, touch, big-win, perf) | PASS |
| `npm run test:rtp-parity` | FAIL 95.97% vs 96.38% (known shared-engine shortfall, engine untouched) |
| `tools/probes/hit-target-probe.js` | FAIL (pre-existing: autoplay/turbo hit area past the left edge at 844×390 / 740×360) |

## 5. Open items / known issues

1. **RTP shortfall** in `client/engine/` (~0.4–1.7% under target across runs); the MVP math is
   fine. Needs a math investigation; never touch it as part of UI work.
2. **Landscape-phone hit areas** for autoplay/turbo (see above).
3. **Round ID strip** still sits above the board in platform (`/play`) mode only; could move into
   the deck if the user wants the top completely clear.
4. **Base-game multiplier readout** was removed with the top bar (souls now fly to the ticker).
5. `.claude/settings.local.json` is still tracked by git although `.gitignore` lists it (see
   `SECURITY_INCIDENT.md`); its local changes are never committed. Consider
   `git rm --cached .claude/settings.local.json`.
6. Rules pages text in the rules file still says "BANANA X" / "5 reels x 4 rows" (needs a copy
   pass); some seed scripts still title the game "Banana X".

## 6. Next: Operator Portal features (Phase 3, planned, not started)

Existing map: routes `platform/src/http/admin.routes.ts` (`/admin/v1/*`), RBAC sets in
`src/modules/admin/admin-auth.ts`, reporting in `src/modules/reporting/reporting.service.ts`,
operator console nav in `src/http/operator-console.ts`, view JS in `admin-console-views.ts`,
HTML in `admin-console-sections.ts`, shared shell `/console/app.js` in `admin-assets.ts`.

**A. Round Inspector (exists, make it prominent):** first in the operator nav; deep link
`/admin#inspector?round=<ref>`; verification verdict up top. No backend change.

**B. Player Reports (read-only):** `playerReport()` / `playerSummary()` in the reporting service
(rounds, turnover, wins, GGR, RTP, last seen; voided rounds excluded) →
`GET /admin/v1/reports/players?from&to&game&sort&limit` and
`GET /admin/v1/players/:id/summary` (`reports.read`, tenant-scoped). Console "Player Reports" view
with CSV export, rows linking to the inspector.

**C. Free Rounds / Campaign Manager (money path, last):** must **not** reuse the engine's
`free_spins_left` (that is the scatter-triggered bonus feature; reusing it would change RTP).
New `src/modules/bonus/` (campaign: game, fixed bet, spins, expiry; grants per player ID with
remaining count; consume/expire/cancel), persisted via the write-through pattern
(`migrations/0001_core.sql` + `TABLES` registry). Admin routes in a new
`src/http/admin-bonus.routes.ts` (`bonuses.read` / `bonuses.write`); matching HMAC operator
routes `POST /operator/v1/free-rounds` (+ status, cancel). Spin path: `round-orchestrator.ts`
plays a granted round at the grant's bet with no debit, credits wins tagged
`funding: "free_round"` + campaign ref; `RoundRecord` gains `funding` / `grant_id`
(additive, hash chain intact); session init returns `free_rounds`. Client follow-up: ticker spin
line "FREE ROUND · N LEFT", bet locked. Verify with `test:rtp-parity` before/after.

**Order:** A + B → C data model + operator routes + wallet tagging (with tests) → orchestrator
spin path + client display.

## 7. How to resume

```bash
npm run test:client                    # client gate
node tools/probes/motion-probe.js      # motion invariants
cd platform && npm run dev:seed        # platform: consoles + seeded logins (2FA off locally)
```

Read first: `CLAUDE.md` (invariants), `docs/animation-guide.md` (motion), `README.md`.
