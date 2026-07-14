# Banana X — Slot Game & Provider Platform

A server-authoritative slot game (**Banana X** — 5×4, symbols-pay-anywhere, profile-driven RTP)
**plus** a full provider platform (RGS + operator control plane) built around it.

The repository contains **two distinct backends** and **one shared math engine**. Understanding
which is which is the key to working here:

- a lightweight **MVP server** that serves the browser game and a simple `/api/v1/*`, and
- a production-shaped **platform** (Fastify + TypeScript) — the real RGS + control plane, with a
  server-to-server operator API, launch-token player sessions, an immutable hash-chained ledger,
  and two separate admin consoles behind real logins (password + TOTP 2FA).

Both consumers — and the browser client — load the **exact same engine files in the exact same
order**, so their spin results are provably identical ("parity").

---

## Table of contents

- [The mental model: two backends, one engine](#the-mental-model-two-backends-one-engine)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [The shared slot engine](#the-shared-slot-engine)
- [Game rules & math config](#game-rules--math-config)
- [Backend 1 — the MVP server](#backend-1--the-mvp-server)
- [Backend 2 — the platform (RGS + control plane)](#backend-2--the-platform-rgs--control-plane)
  - [The two admin consoles + login](#the-two-admin-consoles--login)
  - [APIs](#platform-apis)
  - [Optional Postgres persistence](#optional-postgres-persistence)
- [Commands reference](#commands-reference)
- [Deployment](#deployment)
- [Testing & verification](#testing--verification)
- [Security notes](#security-notes)
- [Documentation](#documentation)

---

## The mental model: two backends, one engine

```
                 ┌─────────────────────────────────────────────┐
                 │        client/engine/*.js  (THE math)        │
                 │  browser IIFEs on globalThis.SlotEngine,     │
                 │  loaded in a FIXED order → identical results │
                 └───────────────┬───────────────┬─────────────┘
        loads the same files ┌───┘               └───┐ loads the same files
                             ▼                        ▼
   ┌─────────────────────────────────┐   ┌──────────────────────────────────────┐
   │ Browser client                  │   │ Platform RGS (Node)                  │
   │ client/index.html + main.js     │   │ platform/src/lib/engine-loader.ts    │
   │ (canvas renderer + UI)          │   │ executes the JS in Node              │
   └─────────────────────────────────┘   └──────────────────────────────────────┘
                             ▲                        ▲
                             └──── tools/rtp-parity.js (asserts measured
                                   RTP ≈ the profile's theoretical RTP)

   Separate, legacy path:  backend/server.js re-implements the math from JSON
                           (does NOT use the shared engine).
```

- **`client/engine/*.js` is the ONLY real implementation of the slot math.** When you change math,
  change it there, then run `npm run test:rtp-parity`.
- The **platform** and **`tools/rtp-parity.js`** read those same files and run them in Node.
- **`backend/server.js`** (the MVP) is a separate, self-contained re-implementation of the math
  from the rules JSON — treat it as a legacy path.

---

## Repository layout

| Path | What it is |
|------|-----------|
| `client/` | Browser game: `index.html` + `main.js` (canvas renderer + UI), `styles.css`, `assets/`. |
| `client/engine/` | **The shared slot math** (browser IIFEs; the single source of truth). |
| `client/math/` | Served copy of the rules JSON (preferred by the backends when present). |
| `backend/server.js` | **MVP server** — dependency-free Node `http`, in-memory sessions, `/api/v1/*`. |
| `math/` | Canonical rules JSON (`game-rules-v2.json`, `paytable-v1.json`, `reel-strips-v1.json`) + `simulate.js`. |
| `platform/` | **The provider platform** — Fastify + TypeScript RGS + control plane (see below). |
| `tools/` | `rtp-parity.js` (engine RTP validation) and `api-test.js` (hits the MVP API). |
| `docs/` | Phased program playbook (01–15 + specs, GDD, ADR, compliance…). Indexed by `ROADMAP.md`. |
| `qa/` | Certification package, test plans, screenshots. |
| `RUNBOOK.md` | How to run **everything** (every command + where to open it). |
| `CLAUDE.md` | Working guide for this repo (architecture invariants). |

---

## Quick start

**Requirements:** Node 18+ for the root scripts; Node 20+ for the platform. Windows/PowerShell is
the primary shell; a Bash tool is also available.

### Play the game against the MVP server

```bash
npm install          # (root has no runtime deps, but installs dev tooling if any)
npm run start:dev-server
# open http://localhost:3000   (game at /, API at /api/v1/*)
```

`npm start` alone static-serves `client/` on `:3000` **without** an API.

### Run the full platform (RGS + both admin consoles)

```bash
cd platform
npm install
npm run dev:seed
# then open the two consoles printed in the terminal:
#   http://127.0.0.1:8080/provider   → Provider Control Plane (our admin)
#   http://127.0.0.1:8080/admin      → Provider Games · Operator Portal (the casino's admin)
```

`dev:seed` also seeds logins, plays 50 spins, and prints a player launch URL. See
[the two admin consoles](#the-two-admin-consoles--login) for the sign-in flow.

---

## The shared slot engine

`client/engine/*.js` are browser IIFEs that register onto `globalThis.SlotEngine` and **must load
in a fixed order**:

```
rng, config, symbols, multipliers, matrix, payouts, tumble,
near-miss, crazy-mode, session-store, spin-engine, simulator
```

(The client also loads presentation-only modules — `audio.js`, `ambiance.js` — that the backends
ignore.) Three consumers load these exact files in this exact order so results are identical:

1. the browser client (`client/index.html` → `client/main.js`),
2. the platform RGS (`platform/src/lib/engine-loader.ts`), and
3. `tools/rtp-parity.js`.

> If you add / remove / reorder an engine file, update the `ENGINE_FILES` array in **both**
> `tools/rtp-parity.js` **and** `platform/src/lib/engine-loader.ts`.

**Active game profile (Banana X):**

- Layout `5×4`, symbols pay anywhere (minimum **8** matches), **High** volatility, max win cap
  **20000×** bet.
- RTP modes: `bananax` **96.38%**, `bananax_94` **94.40%**, `bananax_92` **92.38%**.
- Server-authoritative RNG, tumble/cascade flow, free spins + retriggers, multiplier progression.

---

## Game rules & math config

`game-rules-v2.json` drives layout, symbols, RTP profiles, and features. It exists in **two
locations that must be kept in sync**:

- `math/game-rules-v2.json` — canonical
- `client/math/game-rules-v2.json` — served copy

Both `backend/server.js` and the platform engine-loader **prefer the `client/math/` copy** when it
exists. Related config: `math/paytable-v1.json`, `math/reel-strips-v1.json`.

---

## Backend 1 — the MVP server

`backend/server.js` — plain Node `http`, **no dependencies**, in-memory sessions. It serves the
static client and a simple API, and **re-implements the math directly from the rules JSON** (it does
NOT use the shared engine). This is what `tools/api-test.js` targets.

**Endpoints** (base `http://localhost:3000/api/v1`):

- `POST /session/init` · `POST /spin` · `POST /buy-free-spins`
- `POST /simulate` · `GET /simulate/stream` (SSE)
- `GET /game-rules` · `GET /health`

Simulate example: `POST /api/v1/simulate` with `{ "steps": 1000000, "bet_amount": 1, "game_id": "bananax" }`,
or stream via `GET /api/v1/simulate/stream?steps=1000000&bet_amount=1&game_id=bananax`.

---

## Backend 2 — the platform (RGS + control plane)

`platform/` is the real provider stack (Fastify + TypeScript). Composition roots:

- `src/app.ts` — HTTP composition root: registers health, static assets, the shared console
  assets, the two consoles, the `/play` page, and the operator / game / admin APIs.
- `src/container.ts` — domain composition root. All persistence is **in-memory by default**
  (`memory-repositories.ts`, `sandbox-wallet.ts`, `transaction-store.ts`), designed to swap for
  Postgres without touching call sites.
- `round-orchestrator.ts` ties engine resolution + wallet + ledger together;
  `round-ledger.service.ts` + `hash-chain.ts` provide an **immutable, hash-chained audit trail**;
  `authoritative-resolver.ts` + `seeded-rng.ts` give **deterministic, replayable** spins.

**Player launch flow:** a casino signs `POST /operator/v1/launch` → gets a launch token → the
player opens `/play?lt=<token>`. See `platform/GUIDE.md` for the click-by-click walkthrough and
`platform/scripts/e2e-operator.ts` for a working end-to-end example.

### The two admin consoles + login

For security, the provider's admin and the casino-client's admin are **two separate consoles with
separate logins** (not one page toggled by a pasted token):

| Console | URL | Who / what |
|---------|-----|-----------|
| **Provider Control Plane** | `/provider` | **Our** admin: onboarding, all games + math configs, disputes (approve/reject), reports, round inspector, and **admin-account management**. |
| **Provider Games · Operator Portal** | `/admin` | The **casino** admin: only their **assigned games** + their own rounds, reports, players, round inspector, and raising disputes. Multi-game, provider-neutral branding. |

`/` redirects to `/provider`. Both consoles share one served shell (`/console/app.css` +
`/console/app.js`).

**Authentication — username + password + TOTP authenticator (2FA):**

- Passwords are hashed with **scrypt**; 2FA is **RFC 6238 TOTP** — both hand-rolled on `node:crypto`
  (no external deps): `src/lib/security/password.ts`, `src/lib/security/totp.ts`.
- Login flow (`src/http/admin-auth.routes.ts`, `/admin/v1/auth/*`): **password → authenticator
  code → session token**. First sign-in forces a password set (operator accounts) + authenticator
  enrollment. The issued bearer token is the same one the Admin API already verifies.
- Accounts live in `src/modules/admin/admin-account.ts` (`admin_accounts` store). A **bootstrap
  provider super-admin** is seeded from `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD`;
  provider admins then create operator-admin accounts in-console (provider-only
  `/admin/v1/admin-accounts`). RBAC roles: `provider_*` and `operator_*`
  (`src/modules/admin/admin-auth.ts`).
- `dev:seed` prints the seeded logins: provider `admin` / `change-me-admin`, and operator
  `demo-operator` + a one-time password.

### Platform APIs

- **Operator API** `/operator/v1/*` — server-to-server, **HMAC-signed over the exact request bytes**
  (`src/lib/security/hmac.ts`, `nonce-store.ts`, `rate-limiter.ts`; the raw body is preserved in
  `app.ts` for signature verification).
- **Game API** `/game/v1/*` — session-scoped via launch/session bearer tokens.
- **Admin API** `/admin/v1/*` — RBAC + tenant-scoped. Includes `/auth/*` (login), rounds
  `/verify` `/transactions` `/void` `/settle`, `/disputes` (+approve/reject), `/players/:id/rounds`,
  `/operator-games` (+`/status` toggle), operators `/status` + credential revoke/rotate, and
  provider-only `/admin-accounts`.

### Optional Postgres persistence

State is **in-memory by default** (all tests rely on this — a DB is never required to run them).
Setting `DATABASE_URL` turns on durable persistence via a **memory-first write-through** design
(`src/persistence/`): the in-memory stores stay the read source of truth, hydrate from Postgres on
boot (`hydrate.ts`), and enqueue an upsert on every mutation that an `onSend` hook flushes per
request — so the whole codebase stays **synchronous** (do NOT convert services to async for the DB).
Money is `numeric(14,2)`. Schema: `migrations/0001_core.sql` (append-only WORM triggers on the
ledgers); runner: `src/db/migrate.ts`.

```bash
docker compose -f docker-compose.yml up -d
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run migrate
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run dev:seed   # idempotent
```

---

## Commands reference

### Root (client + MVP) — Node 18+

```bash
npm start                 # static-serve client/ on :3000 (no API)
npm run start:dev-server  # run backend/server.js MVP API on :3000 (PORT env to change)
npm run simulate          # math/simulate.js (MVP math Monte-Carlo)
npm run test:api          # tools/api-test.js — requires the MVP server running
npm run test:rtp-parity   # validate the shared engine's RTP vs. theoretical
```

`rtp-parity` honors env vars: `STEPS`, `BET`, `GAME_ID`, `ANTE=1`, `BONUS_ONLY=1`, `TOLERANCE`.
Exits non-zero on FAIL.

### Platform (`cd platform` first) — Node 20+

```bash
npm run dev        # tsx watch on :8080
npm run dev:seed   # dev server + seed a demo operator/spins + the two console logins + a /play URL
npm run build      # tsc → dist/
npm start          # node dist/server.js
npm run typecheck  # tsc (no emit)
npm test           # vitest run (test/*.test.ts)
npm run e2e        # scripts/e2e-operator.ts (full HMAC operator lifecycle)
npm run smoke:rtp  # scripts/rtp-smoke.ts (engine RTP smoke)
npm run migrate    # apply migrations/*.sql (needs DATABASE_URL)
```

Run a single platform test: `npx vitest run test/engine.service.test.ts` (add `-t "name"` to filter).

> A complete "run everything + where to open it" guide lives in [`RUNBOOK.md`](./RUNBOOK.md).

---

## Deployment

`netlify.toml` and `vercel.json` publish **`client/`** as a SPA with a catch-all rewrite to
`index.html`. These deploy the **front end only, without an API backend**. The platform is a
long-running Node service (deploy separately; optional Postgres for durability).

---

## Testing & verification

- **Engine RTP parity** — `npm run test:rtp-parity` (root) and `npm run smoke:rtp` (platform) run
  the shared engine and assert measured RTP is within tolerance of the profile's theoretical RTP.
  This is the most important correctness gate when touching math.
- **MVP API** — `npm run test:api` (needs `start:dev-server` running).
- **Platform** — `npm test` (vitest), `npm run typecheck`, `npm run e2e` (full HMAC operator
  lifecycle).

> **Known issue:** the shared engine currently measures ~1–1.75% **under** its profile's theoretical
> RTP, so `test:rtp-parity` and `smoke:rtp` FAIL. The MVP's separate math (`math/simulate.js`) is
> fine (~96.52%), so the two paths have diverged; the shortfall is isolated to `client/engine/`.

---

## Security notes

- The provider admin and the operator (client) admin are **separate consoles with separate
  logins**; real auth is **username + password (scrypt) + TOTP 2FA**, and the backend enforces RBAC
  + tenant scoping on every Admin API route regardless of the console.
- The Operator API is HMAC-signed over exact request bytes with nonce + skew + rate limiting.
- The round ledger is **immutable and hash-chained**; void/settle never edit a round — they append
  a compensating adjustment + wallet transaction + audit record.
- See `SECURITY_INCIDENT.md` for a documented API-token exposure incident and recovery steps, and
  `docs/07-security.md` / `docs/incident-response.md` for the broader posture.

---

## Documentation

- [`RUNBOOK.md`](./RUNBOOK.md) — run everything, and where to open each thing.
- [`platform/GUIDE.md`](./platform/GUIDE.md) — operator's click-by-click walkthrough (login,
  onboarding, launch, inspector).
- [`platform/README.md`](./platform/README.md) — platform-specific detail.
- [`ROADMAP.md`](./ROADMAP.md) — index into the phased program playbook in `docs/` (01–15 + specs,
  GDD, ADR, compliance matrix, integration kit, and more).
- [`CLAUDE.md`](./CLAUDE.md) — architecture invariants and how to work in this repo.
