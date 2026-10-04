# 16 Demo Casino — Integration Blueprint

Goal: run Vault 20K inside a realistic licensee website end to end — launch, seamless
wallet, casino back-office, and a one-click bridge from a casino round to the provider's
cryptographic verification.

## 1. Starting point (what already exists)

`demo-operator/` is a working casino site ("Lumina Sandbox Casino", Fastify, port 4000):

| Area | Status | Where |
|---|---|---|
| Player register / login (bearer token) | done | `src/http/api.routes.ts`, `player-auth.ts` |
| Lobby + launch (`POST /api/play/:provider/:game` → signed `POST /operator/v1/launch` → `/play?lt=` in an iframe) | done | `api.routes.ts`, `lib/platform-client.ts`, `site.ts` |
| Seamless wallet webhooks: debit / credit / rollback / balance, HMAC-verified over raw bytes, idempotent | done | `src/http/wallet.routes.ts`, `wallet-auth.ts`, `store/player-store.ts` |
| Multi-provider registry | done | `store/provider-store.ts`, `/api/admin/providers` |
| Back-office page (players, transactions, providers) | **unauthenticated** | `/back-office`, `/api/admin/*` |
| Persistence | in-memory (resets on restart) | `store/*` |

Provider side, already shipped:

* Operator Portal `/admin` with username/password login (scrypt + TOTP; TOTP is forced on in
  sandbox/staging/production), roles `operator_admin` / `operator_finance` (may verify rounds)
  and `operator_viewer` (read only).
* Deep link `/admin#inspector?round=<round_ref>` — survives sign-in (`afterSignIn()` re-reads
  the hash) and auto-runs `GET /admin/v1/rounds/:ref/verify`.
* Verification verdicts: legitimate / tampered / inconclusive, using seed + pre-state replay,
  `engine_version`, `rules_hash`, and the hash-chained round ledger. Tenant-isolated (another
  casino's round returns 404).

So this phase is mostly **hardening and wiring**, not a rewrite.

## 2. Target architecture

```
 Player browser                          Casino staff browser
   │  casino site (:4000)                  │  casino back-office (:4000/back-office, staff login)
   │  └─ <iframe src=RGS /play?lt=…>       │      │ round row → "Verify on provider" (new tab)
   ▼                                       ▼      ▼
 demo-operator (casino)  ──HMAC launch──▶  platform RGS (:8080)  ◀── Operator Portal /admin
   ▲  wallet store / staff auth            │  round orchestrator, seeded RNG, ledger
   └──────── signed wallet webhooks ◀──────┘  (debit / credit / rollback / balance)
```

Trust boundaries: player ↔ casino (casino session), casino ↔ RGS (HMAC both directions),
staff ↔ provider portal (provider credentials + TOTP). The casino never receives provider
admin credentials, and the provider never sees casino passwords.

## 3. Workstreams

### WS1 — Game launch and seamless wallet (hardening)

1. **Iframe contract.** Define a `postMessage` protocol between `/play` and the host page:
   `vault20k:ready`, `vault20k:balance {amount,currency}`, `vault20k:round-complete {roundRef}`,
   `vault20k:error {code}`, host → game `casino:close`. Validate `event.origin` on both sides
   against configured origins.
2. **Framing policy.** `/play` currently sends no `frame-ancestors`; add
   `Content-Security-Policy: frame-ancestors <operator registered domains>` built from the
   operator's domain allow-list (`mgmt.addDomain`) so only licensed sites can embed the game.
3. **Webhook enrichment (additive, signed).** Add `gameCode`, `roundType`
   (`paid | free_spin | buy | free_round`) and `featureRef` (the round that triggered the bonus)
   to debit/credit bodies, so the casino can group a bonus and its free spins without calling
   the provider. Free spins send credits without a debit by design; the casino must accept that.
4. **Failure paths.** Insufficient funds (`402` → in-game message), credit retry +
   rollback on debit failure, idempotent replays, wallet timeout budget. Extend
   `demo-operator/test/e2e.test.ts` to cover each.
5. **Persistence (optional for demo, required for a pilot).** Swap `PlayerStore` to SQLite or
   Postgres so balances and history survive restarts.

### WS2 — Casino back-office

1. **Staff authentication first.** Today `/api/admin/*` is open to anyone. Add staff accounts
   (scrypt passwords, session tokens, roles `support`, `finance`, `admin`), a login page, and a
   `preHandler` on every `/api/admin/*` route. Seed one admin from env on first boot.
2. **Player search and detail.** Players list (email, balance, created, last activity) →
   player page with balance history and **spin history**.
3. **Spin history = the casino's own ledger.** Build rounds from wallet transactions joined
   on `roundRef`: bet (debit), win (credit), net, time, round type, and bonus grouping via
   `featureRef` (WS1.3). Filters (date range, min win, bonus only), pagination, CSV export.
   This is the casino's legal record; it must not depend on provider availability.
4. **Optional enrichment.** A signed operator endpoint on the RGS,
   `GET /operator/v1/rounds/:roundRef` (HMAC like `/launch`), returning the round summary
   (bet, total win, multiplier, scatter count, free spins awarded, engine version) for the
   detail drawer.

### WS3 — Win-validation bridge

1. **Link.** Each round row gets **Verify on provider** →
   `${PROVIDER_PORTAL_URL}/admin#inspector?round=<roundRef>` in a new tab
   (`rel="noopener noreferrer"`). Provider portal URL comes from the provider registry entry.
2. **Access.** The provider issues each casino named Operator Portal accounts
   (`operator_admin` for the casino's risk lead, `operator_finance` for finance staff;
   `operator_viewer` cannot verify). Staff sign in with their provider username/password
   (+ TOTP outside local); the deep link then opens the round and runs the verification.
3. **What staff see.** Verdict banner (legitimate / tampered / inconclusive) with reasons,
   seed and RNG algorithm, engine version and rules hash, chain position, recomputed vs stored
   outcome hash, and the full board-by-board outcome. A round from another casino returns 404.
4. **Optional quick badge.** A signed `GET /operator/v1/rounds/:roundRef/verification`
   returning `{verdict, outcome_ok, chain_ok, engine_version, rules_hash}` lets the back-office
   show a verdict badge inline; the portal remains the place to inspect the evidence.
5. **Later (not v1): single sign-on.** A short-lived, single-use signed link from the
   back-office into the portal would remove the second login, but it moves the trust boundary;
   keep explicit provider credentials for the pilot.

## 4. Delivery plan

| Step | Scope | Exit criteria |
|---|---|---|
| 1 | WS2.1 staff auth on back-office | `/api/admin/*` returns 401 without a staff session; tests |
| 2 | WS1.3 webhook enrichment (platform + casino) | bodies carry `gameCode/roundType/featureRef`; HMAC tests updated |
| 3 | WS2.2–2.3 player + spin history views | a bonus shows as one group with its free spins; CSV export |
| 4 | WS3.1–3.3 verify link + provider accounts | casino staff click → sign in → verdict "legitimate" on a real round |
| 5 | WS1.1–1.2 postMessage + frame-ancestors | game only embeds on registered domains; balance updates in host page |
| 6 | WS1.4 failure-path e2e | insufficient funds, credit retry, rollback all green |
| 7 | WS2.4 / WS3.4 optional signed round APIs | inline verdict badge in back-office |

Run both apps locally: `cd platform && npm run dev:seed` (prints operator credentials) and
`cd demo-operator && npm run dev` (port 4000, `PLATFORM_URL=http://127.0.0.1:8080`).

## 5. Open decisions

1. Persistence for the demo casino: in-memory (demo) or SQLite/Postgres (pilot)?
2. Ship the optional signed round APIs (WS2.4 / WS3.4) in this phase or the next?
3. Hosting: same machine on two ports, or two hostnames so CSP and cookies behave as in production?
