# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A server-authoritative slot game ("Banana X", `5x4`, symbols-pay-anywhere, profile-driven RTP) plus a provider platform (RGS + operator control plane). It contains **two distinct backends** and **one shared math engine** — understanding which is which is the key to working here.

## The single source of truth for slot math

`client/engine/*.js` is the ONLY implementation of the slot math. The files are browser IIFEs that register onto `globalThis.SlotEngine` and **must be loaded in a fixed order** (`rng, config, symbols, multipliers, matrix, payouts, tumble, near-miss, crazy-mode, session-store, spin-engine, simulator`).

Three consumers load these exact same files, in this exact order, so results are provably identical ("parity"):
- The **browser client** (`client/index.html` → `client/main.js` = canvas renderer + UI).
- The **platform RGS** — `platform/src/lib/engine-loader.ts` reads the JS files and executes them in Node.
- **`tools/rtp-parity.js`** — runs the engine's simulator and asserts measured RTP is within tolerance of the profile's theoretical RTP.

When changing math, change it in `client/engine/`, then run `npm run test:rtp-parity`. If you add/remove/reorder an engine file, update the `ENGINE_FILES` array in **both** `tools/rtp-parity.js` and `platform/src/lib/engine-loader.ts`.

> Exception: `backend/server.js` (the MVP, below) does NOT use the shared engine — it re-implements the math directly from the rules JSON. Treat it as a separate, legacy path.

## Game rules config

`game-rules-v2.json` drives layout, symbols, RTP profiles, and features. It exists in **two locations** that must be kept in sync: `math/game-rules-v2.json` (canonical) and `client/math/game-rules-v2.json` (served copy). Both `backend/server.js` and the platform engine-loader **prefer the `client/math/` copy** when it exists. Related config: `math/paytable-v1.json`, `math/reel-strips-v1.json`.

## The two backends

**1. MVP server — `backend/server.js`** (plain Node `http`, no deps, in-memory sessions). Serves the static client and `/api/v1/*` (`session/init`, `spin`, `buy-free-spins`, `simulate`, `simulate/stream`, `game-rules`, `health`). This is what `tools/api-test.js` targets. Self-contained math re-implementation.

**2. Platform — `platform/`** (Fastify + TypeScript; the real provider stack). This is the RGS + control plane:
- `src/app.ts` — HTTP composition root; registers health, static assets, admin console, `/play` page, operator API, game API, admin API.
- `src/container.ts` — domain composition root. All persistence is **in-memory** (`memory-repositories.ts`, `sandbox-wallet.ts`, `transaction-store.ts`), designed to be swapped for Postgres/real adapters without touching call sites (`migrations/0001_core.sql` exists for that).
- **Operator API** (`src/http/operator.routes.ts`) is HMAC-signed over exact request bytes (`src/lib/security/hmac.ts`, `nonce-store.ts`, `rate-limiter.ts`); the raw body is preserved in `app.ts` for signature verification. **Game API** (`game.routes.ts`) is session-scoped via launch tokens.
- `round-orchestrator.ts` ties engine resolution + wallet + ledger together; `round-ledger.service.ts` + `hash-chain.ts` provide an immutable, hash-chained audit trail. `authoritative-resolver.ts` + `seeded-rng.ts` give deterministic, replayable spins.
- Flow: casino signs `POST /operator/v1/launch` → gets a launch token → player opens `/play?lt=<token>`. See `platform/GUIDE.md` for the click-by-click operator walkthrough and `platform/scripts/e2e-operator.ts` for a working end-to-end example.

## Commands

### Root (client + MVP)
```bash
npm start                 # static-serve client/ on :3000 (no API)
npm run start:dev-server  # run backend/server.js MVP API on :3000 (PORT env to change)
npm run simulate          # math/simulate.js
npm run test:api          # tools/api-test.js — requires the MVP server running
npm run test:rtp-parity   # validate client engine RTP vs. theoretical
```
`rtp-parity` honors env vars: `STEPS`, `BET`, `GAME_ID`, `ANTE=1`, `BONUS_ONLY=1`, `TOLERANCE`. Exits non-zero on FAIL.

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
npm run migrate    # apply migrations/*.sql (needs DATABASE_URL)
```
Run a single platform test: `npx vitest run test/engine.service.test.ts` (or add `-t "test name"`).

### Optional Postgres persistence (`platform/`)
State is **in-memory by default** (all tests rely on this — never require a DB to run them). Setting `DATABASE_URL` turns on durable persistence via a **memory-first write-through** design (`src/persistence/`): the in-memory stores stay the read source of truth, hydrate from Postgres on boot (`hydrate.ts`), and enqueue an upsert on every mutation that an `onSend` hook (`app.ts`) flushes per request. So the whole codebase stays synchronous — do NOT convert services to async for the DB. Money is `numeric(14,2)` (decimals, matching the engine). The schema is `migrations/0001_core.sql` (app-aligned, append-only WORM triggers on the ledgers); the runner is `src/db/migrate.ts`. Bring it up:
```bash
docker compose -f docker-compose.yml up -d
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run migrate
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run dev:seed   # idempotent: reuses the demo operator if already seeded
```
When adding a persisted field/table: update the entity, `migrations/0001_core.sql`, the `TABLES` registry in `src/persistence/persistence.ts`, and the relevant store's `save*`/`hydrate` calls.

## Deployment

Static-client hosting only (`netlify.toml`, `vercel.json`): both publish `client/` as a SPA with a catch-all rewrite to `index.html`. These deploy the front end **without** an API backend.

## Environment notes

- Windows + PowerShell is the primary shell; a Bash tool is also available for POSIX scripts.
- Node 18+ for root scripts; Node 20+ for the platform.
- `docs/` is a phased program playbook (01–15 + specs); `ROADMAP.md` indexes it. `qa/` holds the certification package, test plans, and screenshots.
