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
| `npm run verify:release` | Platform typecheck/tests/build, demo-operator typecheck/tests, client checks, and production dependency audits. | Main pre-deploy gate. |
| `npm run docker:build:platform` | Builds the production platform container from `platform/Dockerfile`. | Produces `bananax-platform:latest`. |

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
password, plus a TOTP authenticator code outside local development), for security:

| URL | What |
|---|---|
| http://127.0.0.1:8080/health | Health check |
| http://127.0.0.1:8080/provider | **Provider Control Plane** (our admin: onboarding, all games, disputes, accounts) |
| http://127.0.0.1:8080/admin | **Provider Games · Operator Portal** (the casino admin: their assigned games + data only) |
| http://127.0.0.1:8080/play?lt=… | Player game (launch token from `dev:seed` output or an operator `launch` call) |

`/` redirects to `/provider`. Seeded logins are printed by `dev:seed`: provider
`admin` / `change-me-admin`, and operator `demo-operator` + a one-time password.
On first sign-in an operator account sets its own password. Bootstrap creds are
configurable via `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` (see
`platform/.env.example`).

**2FA during development:** `ADMIN_TOTP_REQUIRED` defaults to **off** when `NODE_ENV` is
`local` or `test` (the default), so `npm run dev` and both seed scripts sign you in with
username + password alone. It defaults **on** for `sandbox` / `staging` / `production`, and
staging/production refuse to boot with it off. To exercise the real flow locally (password →
authenticator code, with TOTP enrollment on first sign-in), start with `ADMIN_TOTP_REQUIRED=true`.

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
# Main release gate
npm run verify:release

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

## 5. Production deployment target

Deploy the **platform** as a long-running Node service. The root `backend/server.js` and the
Netlify/Vercel static configs are demo paths only.

```bash
npm run docker:build:platform
```

Required production/staging environment:

```bash
NODE_ENV=production
HOST=0.0.0.0
PORT=8080
DATABASE_URL=postgres://...
LAUNCH_TOKEN_SECRET=<long-random-secret>
SESSION_TOKEN_SECRET=<long-random-secret>
ADMIN_TOKEN_SECRET=<long-random-secret>
BOOTSTRAP_ADMIN_PASSWORD=<strong-temporary-bootstrap-password>
ADMIN_TOTP_REQUIRED=true
```

Production-like boots fail fast if local-only secrets are still configured, if `DATABASE_URL` is
missing, or if admin TOTP is disabled.

---

## 6. Last full-run status (2026-10-02)

| Suite | Result |
|---|---|
| platform `typecheck` / `test` / `build` | PASS, 113/113 tests |
| demo-operator `typecheck` / `test` | PASS, 24/24 tests (incl. the real two-server e2e) |
| root `npm run test:client` (spin-lock, layout-check × 9 viewports, spin-e2e) | PASS |
| `test:rtp-parity` (shared engine, 1M spins) | FAIL, 95.97% vs 96.38% target (-0.41%, tol +/-0.20%) |

`verify:release` and the production dependency audits were last run on 2026-09-18 (PASS); they
were not re-run for this checkpoint.

> **Known issue:** the shared engine (`client/engine/*`) pays ~1–1.75% under its profile's
> theoretical RTP — both RTP checks fail. The MVP's separate math (`math/simulate.js`) is fine at
> 96.52%, so the two paths have diverged. The shortfall is isolated to `client/engine/`.
