# RUNBOOK — how to run everything

Every runnable command in this repo, what it does, and where to open the result.
There are **two independent stacks**: the **root** (browser client + MVP API) and the
**platform** (the real RGS + control plane, under `platform/`).

- Root scripts need **Node 18+**. Platform needs **Node 20+**.
- Windows/PowerShell is primary; a Bash tool is also available.
- Run root commands from the repo root; run platform commands from `platform/` (`cd platform` first).

---

## 1. Root — browser client + MVP API

The MVP (`backend/server.js`) is a dependency-free Node server with in-memory sessions and its
**own** re-implementation of the slot math (the legacy path — not the shared engine).

| Command | What it does | Access / verify |
|---|---|---|
| `npm start` | Static-serves `client/` on **:3000** (no API). Opens a browser. | http://127.0.0.1:3000 — playable canvas UI, but spins have no server. |
| `npm run start:dev-server` | Runs the MVP API on **:3000** (`PORT=4000 npm run start:dev-server` to change). Serves the client **and** `/api/v1/*`. | Game: http://127.0.0.1:3000 · Health: http://127.0.0.1:3000/api/v1/health |
| `npm run simulate` | Offline Monte-Carlo of the MVP math (`math/simulate.js`). | Prints JSON: `rtp_percent`, `hit_frequency_percent`. |
| `npm run test:api` | Hits every MVP endpoint (`tools/api-test.js`). **Requires the MVP server running** (`start:dev-server`) in another terminal. | Exit 0 = pass. |
| `npm run test:rtp-parity` | Runs the **shared engine** (`client/engine/*`) and asserts measured RTP ≈ profile theoretical. | Prints a PASS/FAIL block; exits non-zero on FAIL. |

**MVP API endpoints** (base `http://127.0.0.1:3000/api/v1`): `session/init`, `spin`,
`buy-free-spins`, `simulate`, `simulate/stream`, `game-rules`, `health`.

**`test:rtp-parity` env vars:** `STEPS`, `BET`, `GAME_ID`, `ANTE=1`, `BONUS_ONLY=1`, `TOLERANCE`.
Example: `STEPS=200000 TOLERANCE=0.5 npm run test:rtp-parity`.

---

## 2. Platform — RGS + control plane (`platform/`)

Fastify + TypeScript. In-memory persistence by default (no DB needed). Default host/port:
**0.0.0.0 : 8080** (override with `PORT` / `HOST` env).

```bash
cd platform
npm install        # first time only
```

| Command | What it does | Access / verify |
|---|---|---|
| `npm run dev` | tsx watch dev server on **:8080**. | See "Where to open" below. |
| `npm run dev:seed` | Dev server **+** seeds a demo operator/spins, seeds the two console logins, and prints a ready `/play?lt=…` URL. | Copy the printed console URLs + logins into a browser. |
| `npm run build` | `tsc` → `dist/`. | Compiles; no runtime. |
| `npm start` | Runs the compiled server (`node dist/server.js`). Needs `npm run build` first. | http://127.0.0.1:8080 |
| `npm run typecheck` | Type-checks, no emit. | Clean = pass. |
| `npm test` | Full vitest suite (`test/*.test.ts`). | All green = pass. |
| `npm run test:watch` | Vitest in watch mode. | Interactive. |
| `npm run e2e` | Full HMAC operator lifecycle: launch → play → spins → reports → round inspector (`scripts/e2e-operator.ts`). | Prints each step; ends with `DONE`. |
| `npm run smoke:rtp` | 100k-spin RTP check of the shared engine. | PASS/FAIL block. |
| `npm run migrate` | Applies `migrations/*.sql`. **Requires `DATABASE_URL`** (see §3). | — |

Run a single test: `npx vitest run test/engine.service.test.ts` (add `-t "name"` to filter).

### Where to open (while `npm run dev` / `dev:seed` is running)

There are **two separate admin consoles** with **separate logins** (username +
password + TOTP authenticator 2FA), for security:

| URL | What |
|---|---|
| http://127.0.0.1:8080/health | Health check |
| http://127.0.0.1:8080/provider | **Provider Control Plane** (our admin: onboarding, all games, disputes, accounts) |
| http://127.0.0.1:8080/admin | **Provider Games · Operator Portal** (the casino admin: their assigned games + data only) |
| http://127.0.0.1:8080/play?lt=… | Player game (launch token from `dev:seed` output or an operator `launch` call) |

`/` redirects to `/provider`. Seeded logins are printed by `dev:seed`: provider
`admin` / `change-me-admin`, and operator `demo-operator` + a one-time password.
On first sign-in each account sets a password (operator only) and enrolls a TOTP
authenticator. Bootstrap creds are configurable via `BOOTSTRAP_ADMIN_USERNAME` /
`BOOTSTRAP_ADMIN_PASSWORD` (see `platform/.env.example`).

**API surfaces:** Operator API `/operator/v1/*` (HMAC-signed over raw bytes) · Game API
`/game/v1/*` (launch/session bearer tokens) · Admin API `/admin/v1/*` (RBAC + tenant-scoped;
`/admin/v1/auth/*` is the login flow, `/admin/v1/admin-accounts` is provider-only account mgmt).
Full click-by-click walkthrough: `platform/GUIDE.md`.

---

## 3. Optional: Postgres persistence (platform)

In-memory is the default and all tests rely on it — you do **not** need this to run anything above.
Setting `DATABASE_URL` turns on durable, memory-first write-through persistence.

```bash
cd platform
docker compose -f docker-compose.yml up -d
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run migrate
DATABASE_URL=postgres://bananax:bananax@127.0.0.1:5432/bananax npm run dev:seed   # idempotent
```

---

## 4. Suggested "run everything" order

```bash
# Root
npm run simulate
npm run test:rtp-parity
npm run start:dev-server        # leave running in terminal A
npm run test:api                # terminal B (needs A up)

# Platform
cd platform && npm install
npm run typecheck
npm test
npm run e2e
npm run smoke:rtp
npm run dev:seed                # then open the printed /play URL + /admin
```

---

## 5. Last full-run status (2026-07-14)

| Suite | Result |
|---|---|
| `simulate` (MVP math) | ✅ RTP 96.52%, hit 30.78% |
| `test:api` | ✅ exit 0 |
| platform `typecheck` | ✅ clean |
| platform `test` | ✅ 68/68 (13 files) |
| platform `e2e` | ✅ full HMAC lifecycle |
| `test:rtp-parity` (shared engine) | ❌ **FAIL** — 95.23% vs 96.38% target (−1.15%, tol ±0.20%) |
| platform `smoke:rtp` (shared engine) | ❌ **FAIL** — 94.63% vs 96.38% target (−1.75%, tol ±1.00%) |

> **Known issue:** the shared engine (`client/engine/*`) pays ~1–1.75% under its profile's
> theoretical RTP — both RTP checks fail. The MVP's separate math (`math/simulate.js`) is fine at
> 96.52%, so the two paths have diverged. The shortfall is isolated to `client/engine/`.
