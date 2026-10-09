# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A server-authoritative slot game (**Vault 20K** by Lumina Games, `6x5`, symbols-pay-anywhere, profile-driven RTP; formerly "Banana X" — the internal ids stay `bananax` on purpose: game code, RTP profile keys, storage keys, DB names) plus a provider platform (RGS + operator control plane). It contains **two distinct backends** and **one shared math engine** — understanding which is which is the key to working here.

## The single source of truth for slot math

`client/engine/*.js` is the ONLY implementation of the slot math. The files are browser IIFEs that register onto `globalThis.SlotEngine` and **must be loaded in a fixed order** (`rng, config, symbols, multipliers, matrix, payouts, tumble, crazy-mode, session-store, spin-engine, simulator`).

Three consumers load these exact same files, in this exact order, so results are provably identical ("parity"):
- The **browser client** (`client/index.html` → `client/main.js` = canvas renderer + UI).
- The **platform RGS** — `platform/src/lib/engine-loader.ts` reads the JS files and executes them in Node.
- **`tools/rtp-parity.js`** — seeded, sharded Monte Carlo over the engine (one sample = a paid round incl. its whole bonus, or one bonus buy); passes when |measured − target| ≤ Z·SE and SE ≤ MAX_SE.

When changing math, change it in `client/engine/`, then run `npm run test:rtp-parity`. If you add/remove/reorder an engine file, update the `ENGINE_FILES` array in **both** `tools/rtp-parity.js` and `platform/src/lib/engine-loader.ts`.

> Exception: `backend/server.js` (the MVP, below) does NOT use the shared engine — it re-implements the math directly from the rules JSON. Treat it as a separate, legacy path.

## The browser client (presentation rules)

`client/main.js` = `ReelCanvasRenderer` (canvas) + DOM UI shell; `client/big-win.js` = full-screen big-win overlay. Invariants the user set — keep them:
- **Never edit `client/engine/` for presentation work.** Visuals are a pure function of the payload; the renderer never feeds data back; `Math.random()` for visuals only, never `SlotEngine.RNG`.
- **No screen/board shake, ever** (impact = local light, pooled particles, audio). **No upward wind-up** before drops. **No idle motion:** a resting board is perfectly still (no float/bob/wobble). Symbols never vanish mid-fall: multipliers fall as themselves (no decoy), and the loop stays at its busy cadence until a drop's `endAt` (its last landing). A burst's fade applies only to symbols on `board.cleared` (a refill landing during the burst never blinks). **Multiplier strike (`STRIKE`):** no tell. The board lands full (a new multiplier falls as a cluster-safe stand-in, `pickStandIn`, at the normal speed), then lightning strikes the cell and it turns into the multiplier under the flash. Rigid in flight; the only deformation is a short impact squash (≤3.5%, by impact speed).
- **Zero layout thrash:** no state change may move/resize the board; overlays sit outside the flow. **No top bar** — `#psTicker` (deck) is the single message line (`ticker` state machine: idle tips / spin line / gold "WIN: amount" held until next spin / `flash()`). Value elements (#lastWin, #balance…) live in a never-rendered `.hud-state` holder.
- **One gravity, reels fall as stacks (#47):** `GRAVITY` (closed-form s = ½gt² from rest; a drop's duration = a full 5-row fall; one real bounce with restitution e, impact at 1/(1+2e)), `WATERFALL` (reels released whole, 100ms apart on a spin, 40ms on a tumble; calmer pace, turbo `TURBO_SCALE` 0.6), `cellFallMs` (√distance + bounce), the spin-out on its own layer (`fx.exit` / `drawExitBoard`, so the new board follows right behind the old: no empty board), `REEL_MASK` (in-flight symbols clipped to the grid), `TUMBLE_MOMENTUM` (no tumble vacuum: neighbours never lean or shake before a refill; it releases at `BLAST_GONE`), `FAST_ZIP` fast-stop: a Stop slams only the SPIN board (born zipping if pressed during the spin-out); during tumbles it cuts the hold/burst short, but a refill is never zipped or pre-placed — it falls under gravity at ≥ turbo pace (`_stopHits`); the Stop is spent when that board lands (`EXIT_FAST` for the old board). Review motion with `tools/probes/motion-record.js` (deterministic 60fps capture → animated WebP, contact sheets, per-reel frame strips). Docs: `docs/animation-guide.md`, `docs/spin-animation-spec.md`, `docs/styling-guide.md`.
- **Audio (`client/audio/audio.js`, moved out of `client/engine/`):** real sound files from `client/assets/audio/manifest.json` (built by `tools/build-audio.js` from CC0 originals in `art-src/audio/`; every source has a row in `client/assets/audio/LICENSES.md`, CC0 only), recordings only (no synth voices, no oscillators), fetched and decoded at page load so the first spin is voiced; nothing plays before the first gesture (it would queue and burst late). One AudioContext for the whole client (main.js has none), buses sfx/ui/music/ambience → master → limiter, variations rotate with jitter, reel stops pan by column, music moods base/freeSpins/bigWin crossfade and duck under wins. Game code calls `Sound.play(event, opts)`; events → sound keys live in `EVENTS`. Verify with `node tools/probes/sound-probe.js` and `node tools/build-audio.js --check`.
- **Every popup goes through `VxNotify` (`client/notify.js`, #49):** feature screen, buy confirm, reality check, info modal, free-rounds notice, big win (tracked), win combine (built on demand), ticker banner. One lifecycle (open → resolves with the close reason), modal keyboard/focus rules, `data-vx-slot` / `data-vx-close` markup, `VxNotify.skin()` for assets + audio. Never hand-roll a new overlay; register it. `docs/notification-skeleton.md`.
- The spin lock is per-RUN; `isRoundInFlight()` is the single gate; `SPIN_SETTLE_GUARD_MS` turns a late press into a skip, not a paid spin.
- 60fps without GC spikes: `ShardEmitter` pool (time-based, ≤8ms sub-steps), sprite cache band, `TIER_PROFILES` throttles just below vsync multiples (governor threshold `max(30, maxFrameMs*1.25)`).
- **Displayed pays = paid pays (lab requirement).** The player paytable and RTP lines in the Info modal are generated from `symbol_payout_display` × the active profile's `payout_scaler` / `free_spin_payout_scaler`, rounded as the engine rounds (`paytableRows()` / `renderPlayerPaytable()` in `main.js`). Never hard-code pays or RTP in the client; `tools/probes/paytable-probe.js` checks it.
- **Canvas context loss:** `installContextLossGuard` pauses the loop on `contextlost`. On `contextrestored` it drops the sprite and stage caches, redraws, and (in platform mode, when idle) re-reads the session from the RGS. Adaptive quality is the existing `TIER_PROFILES` + FPS governor (`fxCeil`, DPR caps, throttles); don't build a second one.
- Verify every client change with `npm run test:client` (needs Chrome); a change to boot, restore or embedding also with `npm run verify:browser`. CI (`.github/workflows/platform-ci.yml`) runs both, as the parallel jobs `release-check` and `browser-checks`, on every PR and on main. The real-Chrome checks launch through `platform/scripts/support/chrome-launch.ts` (60s port wait, one retry); `tools/layout-check.js` has its own copy of the same logic. Motion is verified with headless CDP probes (see `CHECKPOINT.md`).

## Game rules config

`game-rules-v2.json` drives layout, symbols, RTP profiles, and features. It exists in **two locations** that must be kept in sync: `math/game-rules-v2.json` (canonical) and `client/math/game-rules-v2.json` (served copy). Both `backend/server.js` and the platform engine-loader **prefer the `client/math/` copy** when it exists. Related config: `math/paytable-v1.json`, `math/reel-strips-v1.json`.

## The two backends

**1. MVP server — `backend/server.js`** (plain Node `http`, no deps, in-memory sessions). Serves the static client and `/api/v1/*` (`session/init`, `spin`, `buy-free-spins`, `simulate`, `simulate/stream`, `game-rules`, `health`). This is what `tools/api-test.js` targets. Self-contained math re-implementation.

**2. Platform — `platform/`** (Fastify + TypeScript; the real provider stack). This is the RGS + control plane:
- `src/app.ts` — HTTP composition root; registers health, static assets, admin console, `/play` page, operator API, game API, admin API.
- `src/container.ts` — domain composition root. All persistence is **in-memory** (`memory-repositories.ts`, `sandbox-wallet.ts`, `transaction-store.ts`), designed to be swapped for Postgres/real adapters without touching call sites (`migrations/0001_core.sql` … `0008_*.sql` exist for that).
- **Operator API** (`src/http/operator.routes.ts`) is HMAC-signed over exact request bytes (`src/lib/security/hmac.ts`, `nonce-store.ts`, `rate-limiter.ts`); the raw body is preserved in `app.ts` for signature verification. **Game API** (`game.routes.ts`) is session-scoped via launch tokens.
- `round-orchestrator.ts` ties engine resolution + wallet + ledger together; `round-ledger.service.ts` + `hash-chain.ts` provide an immutable, hash-chained audit trail. `authoritative-resolver.ts` + `seeded-rng.ts` give deterministic, replayable spins.
- Flow: casino signs `POST /operator/v1/launch` → gets a launch token → player opens `/play?lt=<token>`. See `platform/GUIDE.md` for the click-by-click operator walkthrough and `platform/scripts/e2e-operator.ts` for a working end-to-end example.
- **Embedding (GUIDE §4a):** operator domains are bare `host[:port]` (`normalizeDomain`, `INVALID_DOMAIN`) and double as the framing allowlist: `/play` HTML gets `CSP frame-ancestors <the launching operator's hosts>` (signature-checked, expiry-ignored launch token; else `'none'`). Casino ↔ game lifecycle messages go through `client/embed-bridge.js` (protocol `vault20k.embed` v1; the allowlist arrives as session `embed.allowed_hosts`; never `targetOrigin "*"`; no money over postMessage). Proven in Chrome by `npm run check:embed`.
- **Jurisdiction profiles (GUIDE §4d):** `src/modules/regulatory/regulatory.ts`. Each operator has a profile, `operators.regulatory` jsonb (migration 0009), set via `PUT /admin/v1/operators/:id/regulatory`; the presets are illustrative, not legal advice. The orchestrator calls `beforeRound` before anything is consumed or debited. It enforces `min_round_ms` (`SPIN_TOO_FAST` 429; not on a feature's free spins), the reality check (`REALITY_CHECK_REQUIRED` 409 with session stats, until `POST /game/v1/reality-check/ack`) and `buy_feature_enabled` (`FEATURE_BUY_DISABLED` 403). The client hides autoplay/turbo/buy in place (`.is-reg-off`), paces from the RGS *answer* (never from the send), and shows the reality-check dialog (`realityCheck` / `exitRequested` to the casino). Runtime timers live in memory.
- **Signed round export (GUIDE §4e):** `GET /operator/v1/rounds/:ref/export` (`round-export.service.ts`) returns an Ed25519-signed (canonical JSON) bundle: round, rng (seed, `seed_sha256`, `stream_sha256` of the bytes drawn), outcome, the replay verdict, the chain link, wallet moves and adjustments. Keys are at `/.well-known/round-export-keys`; the verifier is `scripts/verify-round-export.ts`. `EXPORT_SIGNING_KEY` is required in staging/production. The bundle carries the *replayed* result: `outcome_hash` depends on the engine's key order, and Postgres jsonb reorders keys.
- **Signing keyring + signed ledger rows (GUIDE §4e):** `src/lib/security/signing-keyring.ts`, `container.signingKeyring`. One active key (`EXPORT_SIGNING_KEY`, optional `EXPORT_SIGNING_KEY_EXPIRES_AT`, staging/production refuse to boot past it) plus every retired key's public half in `signing_keys` (migration 0012; private keys never stored; a DB trigger makes key material write-once and rows permanent). **Rotation = a new `EXPORT_SIGNING_KEY` + restart**: `hydrate` retires the previous active key; re-activating a retired key fails boot (`SIGNING_KEY_RETIRED`). Every `rounds` / `audit_records` row gets `signature` + `signing_key_id` over `vault20k.ledger.v1|<table>|<seq>|<chain_hash>` at append time. Both are OUTSIDE the hashed payload (`CHAIN_FIELDS` in `memory-repositories.ts`) and `omitNull`. A bad or unknown-key signature makes the Round Inspector verdict **tampered** (it catches a full rewrite with recomputed hashes, which the chain alone can't); `/admin/v1/integrity` reports `signatures`; pre-0012 rows are `unsigned` (note only).
- **Observability (GUIDE §4f):** W3C `traceparent` (`src/lib/trace-context.ts`, AsyncLocalStorage; built in `childLoggerFactory` so every request log line has `trace_id`) → `wallet_transactions.trace_id` (migration 0010) and `rounds.trace_id` / `audit_records.trace_id` (0011; set on append from the current trace, only when there is one, `omitNull`, inside the hash chain; also in the signed round export) → webhook `traceparent` → casino `trace_id` (casino migration 4). The client starts one trace per round. One `wallet.tx` JSON log line per money move. Prometheus metrics at `/metrics` (`src/lib/metrics.ts`, hand-rolled; `METRICS_TOKEN`).
- **Lost debits (GUIDE §4b):** every round debit goes through `DebitReconciler` (`src/modules/wallet/debit-reconciler.ts`): it retries in line under the same key, and an outcome that stays unknown records `DEBIT_OUTCOME_UNKNOWN`, voids the round (`DEBIT_UNCONFIRMED` 502; a retry gets `ROUND_VOIDED` 409) and rolls back by `originalIdempotencyKey`. Unacknowledged reversals queue (`listPendingReversals`, `/admin/v1/transactions/pending-reversals`) for the `src/jobs/debit-reconciliation.ts` sweep (`DEBIT_RECONCILE_INTERVAL_MS`). Only `WalletDeclinedError` counts as a definite "not applied" (`isOutcomeUnknown`).
- **Admin consoles:** `/provider` (Provider Control Plane, our admin) and `/admin` (Operator Portal, the casino's admin), shared shell `/console/app.js` served from `src/http/admin-assets.ts` (views: `admin-console-views.ts`, sections: `admin-console-sections.ts`). Login: `src/http/admin-auth.routes.ts` (scrypt password + RFC 6238 TOTP, hand-rolled). **2FA switch `ADMIN_TOTP_REQUIRED`** (`src/config/env.ts`): unset = OFF for `NODE_ENV=local|test` (development), ON for sandbox/staging/production; explicit value wins; staging/production refuse to boot with it off. Don't delete the TOTP code — it is the production path.
- **Operator Portal / Phase 3 (done):** Round Inspector deep links (`/admin#inspector?round=<ref>`), Player Reports (`/admin/v1/reports/players`, `/admin/v1/players/:id/summary`, tenant-scoped), and **Free Rounds / Campaign Manager**: `src/modules/campaigns/campaign.repository.ts` (campaigns + per-player grants, atomic spin deduction), admin routes `src/http/admin-campaigns.routes.ts` (`/admin/v1/campaigns*`), HMAC operator routes `POST /operator/v1/free-rounds/grant`, `POST /operator/v1/free-rounds/cancel` (whole campaign, or one player with `operator_player_id`; idempotent, `already_cancelled`) + `GET /operator/v1/free-rounds/player/:operatorPlayerId`; `npm run e2e` walks grant → play → cancel and exits non-zero on any failed step. `round-orchestrator.ts` plays a free round at the grant's bet with no debit; wallet transactions are tagged `FREE_ROUND_BET`; `player_sessions.locked_bet` / `locked_ante` freeze bet + ante mid-feature. Operator-granted free rounds must NOT reuse the engine's `free_spins_left` (that is the scatter-triggered bonus feature and would change RTP). Current status and next phase: `CHECKPOINT.md`.
- **Campaign Manager UI (done):** `Campaigns` view in both consoles — logic in `src/http/admin-console-campaigns.ts` (spliced into `/console/app.js` via a *function* replacement in `admin-assets.ts`; a string replacement would interpret `$&` / `$'` in the inserted code). Campaign summaries carry `game_code` + a server-computed `state`; `/admin/v1/me` returns effective `permissions` (UI hides write controls without `campaigns.write`). The shell's `esc()` escapes quotes — always use it for values interpolated into HTML, including attributes. **Expiry job** `src/jobs/campaign-expiry.ts` starts on the app's `onReady` (start-up sweep + `CAMPAIGN_EXPIRY_INTERVAL_MS`, default 60s, 0 = start-up only) and flushes its own writes because it runs outside a request.

## The demo casino (`demo-operator/`)

A licensee website that integrates the platform over the wire (Fastify, port 4000; platform on 8080).
- **Persistence:** SQLite via the built-in `node:sqlite` (Node ≥ 22.13), loaded with `process.getBuiltinModule("node:sqlite")` because Vite/vitest can't resolve the `node:sqlite` import. File `demo-operator/data/casino.sqlite` (`DB_PATH`; git-ignored), WAL, forward-only migrations in `src/db/database.ts` (`PRAGMA user_version`). Tests use `:memory:`.
- **Wallet ledger:** the signed webhooks (`/wallet/:providerId/{debit,credit,rollback,balance}`) write an **append-only** `wallet_transactions` table (UPDATE/DELETE blocked by triggers): integer minor units, idempotency unique per provider, one rollback per debit (amount + currency from the original). `tx_type` = WAGER / FREE_ROUND_BET / CREDIT / FREE_ROUND_WIN / ROLLBACK; `game_code` + `round_type` come from the webhook body. Free spins credit without a debit — never assume N spins = N debits (tests included). A rollback may name the debit only by `originalIdempotencyKey`; if the casino never got that debit it records the key in the append-only `voided_debits` table (migration 3) and later refuses it with `409 TRANSACTION_VOIDED`. **Bonus grouping:** every engine free-spin move carries `featureRef` = the trigger round's `round_ref` (platform: `player_sessions.locked_feature_ref`, part of the feature lock); the casino stores it as `feature_ref` (migration 2) and the back-office groups a bonus as trigger + rows with its ref. A free spin that wins nothing sends no webhook. Failure paths (decline, lost debit/credit responses, rollback, bonus grouping) are proven over real HTTP in `test/e2e-failure-paths.test.ts` (harness `test/support/stack.ts` injects lost responses).
- **Back-office** `/back-office` (`src/http/back-office-page.ts`): staff session = opaque token in an HttpOnly SameSite=Strict cookie, only its SHA-256 stored (`src/auth/staff-auth.ts`; creds `CASINO_STAFF_USERNAME` / `CASINO_STAFF_PASSWORD`, default `casino_admin` / `demo123`). Every `/api/admin/*` route is guarded; player responses never include password hashes; provider secrets are masked. The page is served with a per-response nonce CSP — no inline handlers or style attributes; escape every API value. **Verify on Provider** links to `<PROVIDER_PORTAL_URL or the provider's platformUrl>/admin#inspector?round=<ref>`.

## Commands

### Root (client + MVP)
```bash
npm start                 # static-serve client/ on :3000 (no API)
npm run start:dev-server  # run backend/server.js MVP API on :3000 (PORT env to change)
npm run simulate          # math/simulate.js
npm run test:api          # tools/api-test.js — requires the MVP server running
npm run test:rtp-parity   # validate client engine RTP vs. theoretical
npm run test:client       # spin-lock + layout-check (9 viewports) + spin-e2e, real Chrome via CDP
npm run verify:release    # CI job release-check: platform + demo-operator typecheck/test, test:client, audit:prod
npm run verify:browser    # CI job browser-checks: check:resume/embed/inspector/campaigns, e2e, check:back-office/casino-embed
GAME_ID=bananax_94 node tools/rtp-report.js > qa/rtp-certification-report-94.md  # lab report from qa/data/rtp-certification/<game_id>-*.json
node tools/probes/paytable-probe.js  # displayed pays = paid pays, all profiles/bets (needs Chrome)
```
`rtp-parity` env: `STEPS` (default 30M, 4M for `MODE=buy`), `MODE=base|buy` (`BONUS_ONLY=1` = buy), `ANTE=1`, `GAME_ID`, `SEED`, `Z` (default 3), `MAX_SE` (default 0.25%), `SHARDS` (fixed 20, keeps results machine-independent), `WORKERS`, `BET`, `JSON=1`, and `PAYOUT_SCALER` / `FREE_SPIN_PAYOUT_SCALER` overrides for calibration. Exits non-zero on FAIL. Every engine change that alters what a seed resolves to must bump `ENGINE_VERSION` in `client/engine/spin-engine.js` (it is recorded on every platform round for replay verification).

### Platform (`cd platform` first; Node 20+)
```bash
npm install
npm run dev        # tsx watch on :8080
npm run dev:seed   # dev server + seed a demo operator, spins, and print admin tokens + a /play URL
npm run build      # tsc → dist/
npm start          # node dist/server.js
npm run typecheck  # tsc (no emit) via tsconfig.typecheck.json
npm test           # vitest run (test/*.test.ts)
npm run test:watch # vitest watch
npm run e2e        # scripts/e2e-operator.ts (full HMAC operator lifecycle)
npm run smoke:rtp  # scripts/rtp-smoke.ts
npm run check:campaigns  # Campaign Manager in real headless Chrome (needs Chrome)
npm run check:embed      # /play framing + casino postMessage bridge in real Chrome (needs Chrome)
npm run rng:stats        # internal RNG battery (~2.5 min; qa/rng-certification-notes.md §7)
npm run rng:dump -- --bytes 1G --out rng.bin  # raw stream + seeds + manifest for Dieharder / NIST STS
npm run migrate    # apply migrations/*.sql (needs DATABASE_URL)
```
Run a single platform test: `npx vitest run test/engine.service.test.ts` (or add `-t "test name"`).

### Optional Postgres persistence (`platform/`)
State is **in-memory by default** (all tests rely on this — never require a DB to run them). Setting `DATABASE_URL` turns on durable persistence via a **memory-first write-through** design (`src/persistence/`): the in-memory stores stay the read source of truth, hydrate from Postgres on boot (`hydrate.ts`), and enqueue an upsert on every mutation that an `onSend` hook (`app.ts`) flushes per request. So the whole codebase stays synchronous — do NOT convert services to async for the DB. Money is `numeric(14,2)` (decimals, matching the engine). The schema is `migrations/0001_core.sql` plus forward-only `0002_campaigns.sql` … `0008_session_feature_ref.sql` (campaigns, free-round tagging, session locks, round `engine_version`, session `bonus_round_win`, round `rules_hash`, session `locked_feature_ref`; app-aligned, append-only WORM triggers on the ledgers); the runner is `src/db/migrate.ts`. Bring it up:
```bash
docker compose -f docker-compose.yml up -d
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run migrate
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run dev:seed   # idempotent: reuses the demo operator if already seeded
```
When adding a persisted field/table: update the entity, add a new forward-only `migrations/NNNN_*.sql` (don't edit an applied one), the `TABLES` registry in `src/persistence/persistence.ts`, and the relevant store's `save*`/`hydrate` calls.

### Demo casino (`cd demo-operator` first; Node 22.13+)
```bash
npm run dev                # :4000 — first run "npm run dev:seed:demo-operator" in platform/ (writes demo-operator/.env)
npx vitest run             # unit + e2e against an in-process platform
npm run check:back-office  # back-office in real headless Chrome (needs Chrome)
npm run check:casino-embed  # casino page framing + driving the game in real Chrome (needs Chrome)
```

## Deployment

Static-client hosting only (`netlify.toml`, `vercel.json`): both publish `client/` as a SPA with a catch-all rewrite to `index.html`. These deploy the front end **without** an API backend.

## Environment notes

- Windows + PowerShell is the primary shell; a Bash tool is also available for POSIX scripts.
- Node 18+ for root scripts; Node 20+ for the platform.
- `docs/` is a phased program playbook (01–15 + specs); `ROADMAP.md` indexes it. `qa/` holds the certification package, test plans, and screenshots.
