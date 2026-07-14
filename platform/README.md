# Banana X Platform (RGS + control plane)

Provider platform service. Implements the roadmap in
[../docs/provider-platform-plan.md](../docs/provider-platform-plan.md). Built as a modular
monolith (Node + TypeScript + Fastify) so high-load modules (spin/wallet) can be extracted later
without reshaping the data model.

**Non-developer guide:** [GUIDE.md](./GUIDE.md) — start the platform, onboard a casino, look up
any spin by Round ID in the **Round Inspector**.

## Status (backend Phases 1–6 done; 47 tests green)

- **Phase 1 — Foundation:** TS skeleton, validated env (zod), pino logging, request-id,
  `/health` + `/health/ready`, server-side **engine module** reusing `client/engine` math as the
  single source of truth (parity by construction).
- **Phase 2a — Seedable RNG:** a controllable `crypto` wrapper makes spins reproducible; **deterministic
  replay** reproduces the exact `outcome_hash` (the certification gap from the plan, now closed).
- **Phase 2b — Immutable ledger:** append-only, hash-chained rounds + audit records with tamper
  detection; Postgres DDL in `migrations/0001_core.sql`.
- **Phase 3 — Control plane:** operators, launch domains, API credentials (issue/rotate-grace/revoke),
  games, math configs with an **approval gate**, operator↔game assignment, tenant-scoped reads,
  hash-chained audit of every action.
- **Phase 4 — Launch/session:** signed launch tokens + domain allowlist → player sessions bound to one
  operator+game+currency.
- **Phase 5 — Round lifecycle:** generic `WalletAdapter` + sandbox wallet + `RoundOrchestrator`
  implementing plan §5: validate → debit → resolve → record → credit → settle, **idempotent** with
  rollback on resolve-failure and a failed-settlement flag on credit-failure.
- **HTTP API + security (Phase 8 core):** HMAC-signed **Operator API** (`POST /operator/v1/launch`)
  with timestamp-skew + nonce replay guard + per-key rate limiting; **Game API**
  (`POST /game/v1/session/init`, `POST /game/v1/spin` with `Idempotency-Key`,
  `GET /game/v1/rounds/:ref` tenant-scoped) behind session bearer tokens. Verified end-to-end with
  `app.inject` (signed requests, tamper/replay rejection, idempotent spin) and a live boot.
- **Transaction ledger + settlement queue (Phase 5 finish):** every DEBIT/CREDIT/ROLLBACK recorded
  (idempotent), with a real failed-settlement queue when a win credit fails.
- **Reporting + reconciliation (Phase 7):** rounds summary, GGR (+ by day), RTP (actual), failed
  settlements, and ledger-vs-money reconciliation — all tenant-scoped.
- **Admin API (Phase 6 backend):** RBAC (`provider_*` / `operator_*` roles) + hard tenant scoping —
  `GET /admin/v1/operators`, `/rounds`, `/rounds/:roundRef`,
  `/reports/{summary,rtp,ggr,reconciliation}`, `/transactions/failed`. Operator admins are forced
  to their own `operator_id` and get a `404` for cross-tenant rounds (never a leak).
- **Round Inspector (Phase 6 UI):** the centerpiece of the admin portal. Paste any spin's
  `round_ref` and see a TEXT panel (full metadata + per-tumble-step breakdown of every winning
  cluster + multipliers + bonus) AND a VISUAL playback panel that renders the 6×5 grid using the
  real symbol PNGs from `client/assets/symbols/`, with winning-cell glow, multiplier badges,
  scatter markers, free-spin banner, and Prev / ▶ Play / Next step controls.
- **Provisioning portal (Phase 6 UI):** click-through onboarding (operator → domain → credential
  → game → math config → assignment) over the same Admin API used by `scripts/dev-seed.ts`. The
  certification gate (approved configs only) is enforced server-side.
- **Player demo client (`/play`):** minimal HTML client that exchanges a launch token for a
  session, spins, and prominently surfaces the **Round ID** after every spin with a Copy button.

### Remaining (need a live DB or external integration)

- **Postgres swap:** replace the in-memory repos/wallet with implementations of the same interfaces
  against `migrations/0001_core.sql` (+ a migration runner). A `docker-compose.yml` for Postgres
  is included; the schema already has the `outcome_jsonb` column the inspector reads.
- **Real wallet adapter:** implement `WalletAdapter` against a specific operator's wallet API
  (idempotency contract documented in the interface).
- **Certification (Phase 9):** depends on the RTP re-tune (committed math currently ~88% vs 96.38%
  target) and the target jurisdiction.

## Layout

```text
src/
  config/env.ts             validated environment (zod)
  lib/logger.ts             pino logger factory
  lib/engine-loader.ts      loads client/engine/*.js into Node (one source of math truth)
  lib/seeded-rng.ts         controllable crypto wrapper → reproducible spins
  lib/outcome-hash.ts       canonical outcome hashing (volatile ids stripped)
  lib/tokens.ts             HMAC-signed launch/session tokens
  modules/engine/           typed EngineService facade (+ deterministic resolve)
  modules/rng/              AuthoritativeResolver (seed → outcome + replay verify)
  modules/ledger/           hash chain + append-only round/audit repos + ledger service
  modules/management/       operators/domains/credentials/games/configs/assignment
  modules/session/          launch token + session service
  modules/wallet/           WalletAdapter interface + SandboxWallet
  modules/rounds/           RoundOrchestrator (the §5 money loop)
  modules/health/           liveness/readiness routes
  app.ts / server.ts        Fastify composition root + entrypoint
migrations/0001_core.sql    Postgres schema (WORM ledger, tenancy, money)
scripts/rtp-smoke.ts        fast RTP sanity check against the ported engine
test/                       vitest (health, engine, seeded RNG, ledger, management, lifecycle)
```

## Develop

```bash
cd platform
npm install
npm run typecheck     # tsc --noEmit (src + test + scripts)
npm test              # vitest: health + engine invariants
npm run dev           # boot with hot reload; GET http://localhost:8080/health
npm run smoke:rtp     # STEPS=100000 BET=1 GAME_ID=bananax TOLERANCE=1.0
npm run build         # tsc -> dist/
```

The engine + rules are resolved from the repo's existing `client/engine` and
`client/math/game-rules-v2.json`; override with `ENGINE_DIR` / `ENGINE_RULES_PATH`.

### One-command run (two consoles + Round Inspector + player demo)

```bash
npm run dev:seed
```

This provisions a demo operator, plays 50 spins, seeds the two console logins, prints a sample
`round_ref` to paste into the Round Inspector, and prints a launch URL for the player demo. There
are **two separate admin consoles** with **separate logins** (username + password + TOTP 2FA):

- **`http://127.0.0.1:8080/provider`** — the **Provider Control Plane** (our admin: Dashboard,
  Onboarding, all games, Disputes, Reports, Round Inspector, Admin Accounts). Seeded login
  `admin` / `change-me-admin`.
- **`http://127.0.0.1:8080/admin`** — the **Provider Games · Operator Portal** (the casino admin:
  only their assigned games + data). Seeded login `demo-operator` + the printed one-time password.
- Each account sets a password (operator) and enrolls a TOTP authenticator on first sign-in.
- The player launch URL printed in the terminal — opens `/play?lt=…`, the minimal player demo
  that shows the **Round ID** after each spin.

For the full click-by-click walkthrough see [GUIDE.md](./GUIDE.md). If port 8080 is already in
use, set `PORT=8090 npm run dev:seed`.

## Notes / next phases

- The in-memory session map in `EngineService` is **Phase 1 only**; Phase 2 introduces a seedable
  server-authoritative RNG (deterministic replay) and Postgres-backed immutable rounds/transactions
  /audit chain. The existing engine's unseeded RNG is not reproducible — addressed in Phase 2.
