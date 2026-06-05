# Banana X → iGaming Provider Platform — Master Plan

> Status: Draft v1 · Owner: Platform Architecture · Supersedes ad-hoc notes, extends
> [backend/data-model.md](../backend/data-model.md), [backend/api-spec.md](../backend/api-spec.md),
> [docs/05-backend-platform.md](05-backend-platform.md), [docs/07-security.md](07-security.md),
> [docs/08-provider-integration.md](08-provider-integration.md), [math/rng-design.md](../math/rng-design.md).

## Context

We have a working **server-authoritative slot prototype ("Banana X")**: a Node HTTP backend
([backend/server.js](../backend/server.js)) with `session/init`, `spin`, `buy-free-spins`, and
`simulate` endpoints; a mirrored static client engine ([client/engine/](../client/engine/));
versioned math/RTP configs ([math/game-rules-v2.json](../math/game-rules-v2.json)); and a strong
documentation backbone (data model, threat model, RNG design, QA/certification indexes).

What is **missing** to become a real B2B provider that onboards regulated casino operators:

- **No persistence** — sessions and spin history live in in-memory `Map`s ([server.js:19](../backend/server.js#L19)); a restart loses all money state.
- **No identity/access** — no operator concept, no API credentials, no request signing, no RBAC, no domain/IP allowlists, no CORS.
- **No external wallet** — balance is a local number seeded at 1000; there is no debit/credit/rollback against an operator wallet.
- **No immutable round ledger / audit chain** — the entities are designed in [data-model.md](../backend/data-model.md) but not implemented.
- **Non-reproducible RNG** — `crypto.getRandomValues` is unseeded ([client/engine/rng.js](../client/engine/rng.js)); outcomes cannot be replayed for disputes or certification.
- **No admin surfaces** — no provider super-admin portal, no per-operator portal.

**Intended outcome:** evolve the prototype into a multi-tenant provider platform where we can onboard
operators, assign games, issue signed launch sessions, resolve spins server-side, settle money
idempotently against operator wallets, store every round immutably, and expose self-service admin
portals — all certifiable for regulated markets and safe to run for real money.

**Guiding constraints (non-negotiable):** outcomes are always server-authoritative; the frontend
never determines wins; every money operation is idempotent; round history is immutable; operators
see only their own data; the design assumes many games, many operators, many RTP configs, many
jurisdictions.

---

## 1. Executive Summary

The platform is a **Remote Gaming Server (RGS)** plus a **provider control plane**. It hosts
certified slot games, exposes an integration API to casino operators, and resolves every round on
our servers. Operators keep the player's money (seamless/single-wallet model): for each bet we call
the operator's wallet API to **debit** the stake, resolve the round with a server-authoritative RNG,
then **credit** the win, with **rollback** for failures — all keyed by idempotency so retries never
double-charge.

We must build, in dependency order:

1. **Persistence + immutable round ledger** — Postgres-backed rounds, transactions, audit chain (replaces in-memory Maps).
2. **Server-authoritative seeded RNG** — reproducible spins with stored seed + RNG counter, enabling replay/audit.
3. **Multi-tenancy** — operators, their games, RTP configs, API credentials, domain/IP allowlists.
4. **Signed launch + session flow** — operator mints a signed launch token; we validate it and open a player session bound to one operator+game+currency.
5. **Wallet adapter layer** — a generic interface with per-operator adapters (debit/credit/rollback/balance), idempotent and reconcilable.
6. **Two admin portals** — provider super-admin (manage everything) and operator admin (view own rounds/sessions/transactions/reports/failed settlements).
7. **Security hardening** — HMAC request signing, API-key rotation, RBAC, rate limiting, encryption, anti-tamper on round data.
8. **Reporting & reconciliation** — GGR, RTP, activity, failed settlements, invoices, daily/monthly recon.
9. **Compliance/certification readiness** — RNG/math evidence, reproducible rounds, RG hooks, jurisdiction configs, regulator exports.

The MVP is a **modular monolith** (one deployable Node/TypeScript service with strict internal module
boundaries) on managed Postgres, with a separate admin SPA. Modules are designed so the high-load
ones (spin resolution, wallet) can later be extracted into services without reshaping the data model.

---

## 2. Target Architecture

**Style:** Modular monolith for MVP → extractable services. One API process, one worker process, one
admin SPA. Each "service" below is a **module** with its own folder, public interface, and DB
ownership; nothing reaches into another module's tables directly.

```
                         ┌────────────────────────────────────────────┐
   Operator backend ───► │  API Gateway / Edge                         │
   (server-to-server)    │  TLS · HMAC verify · idempotency · rate     │
                         │  limit · IP allowlist · request log         │
                         └───────────────┬────────────────────────────┘
   Player browser ──────────────────────┤ (launch token, then session token)
   (game client)                        │
                         ┌───────────────▼───────────────┐   ┌──────────────────┐
                         │  Application core (modules)    │   │  Admin API        │
                         │                                │   │  (RBAC, JWT)      │
                         │  Auth/Credential               │   └────────┬─────────┘
                         │  Operator/Client management     │            │
                         │  Game Launch                    │   ┌────────▼─────────┐
                         │  Session                        │   │ Provider Super-   │
                         │  Spin / RNG / Math (RGS core)   │   │ Admin Portal (SPA)│
                         │  Wallet / Transaction           │◄──┤ Operator Admin    │
                         │  Round Ledger (immutable)       │   │ Portal (SPA)      │
                         │  Audit Log (hash chain)         │   └──────────────────┘
                         │  Reporting                      │
                         │  Provider Adapter Layer ────────┼──► Operator Wallet APIs
                         └───────┬─────────────┬───────────┘     (debit/credit/rollback/balance)
                                 │             │
                    ┌────────────▼───┐   ┌─────▼──────────┐   ┌───────────────┐
                    │ PostgreSQL     │   │ Redis          │   │ Queue (BullMQ │
                    │ (system of     │   │ (idempotency,  │   │ on Redis):    │
                    │  record + WORM │   │  rate limit,   │   │ settlement    │
                    │  audit tables) │   │  sessions,     │   │ retries,      │
                    └────────────────┘   │  cache)        │   │ recon, reports│
                                         └────────────────┘   └───────────────┘
                    Monitoring/Alerting (metrics, logs, traces, alerts) spans all of the above.
```

**Module responsibilities**

- **API Gateway / Edge** — single ingress. Terminates TLS, verifies HMAC signatures on operator
  server-to-server calls, enforces idempotency keys, rate limits, IP/domain allowlists, attaches a
  request-id, and writes an `api_request_log` row. Today there is no gateway and no CORS in
  [server.js](../backend/server.js); this is new.
- **Auth/Credential service** — issues and verifies the three credential types: (a) operator API keys
  + HMAC secrets (server-to-server), (b) signed launch tokens (operator→player handoff), (c) admin
  user logins + JWT/session for the portals. Owns key rotation and secret storage references.
- **Client/Operator management** — CRUD for operators, their domains, currencies, status
  (sandbox/live/suspended), assigned games, and per-operator game/RTP configuration.
- **Game Launch service** — validates a launch token, checks the operator owns the game and the
  origin domain is allowlisted, then creates a player session and returns a session token + game
  bootstrap config (rules URL, allowed bets, currency, locale).
- **Session service** — owns player sessions (replaces the in-memory `sessions` Map). Validates
  session tokens on every spin, tracks state (active/expired/closed), free-spins balance, and ties a
  session to exactly one operator+game+player+currency.
- **Spin / RNG / Math service (RGS core)** — the existing math engine
  ([client/engine/spin-engine.js](../client/engine/spin-engine.js) logic, server-side) made
  **server-authoritative and seedable**. Resolves the full round (tumbles, multipliers, free spins),
  records the seed + RNG counter + outcome hash, and never trusts client input beyond bet/session.
- **Wallet / Transaction service** — orchestrates money: debit before resolve, credit after resolve,
  rollback on failure. Writes the transaction ledger, enforces idempotency, and drives retries via
  the queue. Calls operator wallets through the adapter layer.
- **Round Ledger service** — append-only record of every round and every state transition. Immutable
  (no UPDATE/DELETE), hash-linked, the legal system of record for disputes and regulator exports.
- **Audit Log service** — hash-chained audit of sensitive actions (config changes, credential
  rotation, admin actions, manual settlements) per [data-model.md](../backend/data-model.md)
  `AuditRecord`.
- **Admin API** — RBAC-guarded API behind both portals. Strict tenant scoping: operator-admin tokens
  can only ever read rows where `operator_id = token.operator_id`.
- **Client (Operator) Admin Portal** — operator self-service SPA (their rounds, sessions,
  transactions, reports, failed settlements).
- **Provider Super-Admin Portal** — our internal SPA (all operators, games, RTP configs, credentials,
  rounds, audit logs, incidents).
- **Reporting service** — pre-aggregated reports (GGR, RTP, activity, failed tx, settlements,
  invoices) built by scheduled jobs, queryable by both portals within tenant scope.
- **Monitoring/Alerting** — metrics, structured logs, traces, dashboards, alert rules, runbooks
  (extends [backend/runbook.md](../backend/runbook.md)).
- **Provider adapter layer** — normalizes each operator's wallet/session API into our canonical
  interface (per [docs/provider-api-mapping.md](provider-api-mapping.md)). One adapter per operator
  integration; the core never sees operator-specific shapes.

---

## 3. Data Model

PostgreSQL. All money/round tables use strong consistency. Audit and round tables are **append-only
(WORM)** — enforced by DB role permissions (no UPDATE/DELETE grant for the app role) and triggers.
Money amounts are stored as integer **minor units** (e.g. cents/tetri) + currency code, never floats.
Time is UTC `timestamptz`. IDs are UUIDv7 (sortable) unless noted.

> This extends the four entities already in [backend/data-model.md](../backend/data-model.md)
> (`Session`, `Spin`, `LedgerTransaction`, `AuditRecord`) into the full multi-tenant schema.

### 3.1 Tenancy & identity

**operators** — the casino clients.
`id` · `name` · `slug` (unique) · `status` (sandbox|live|suspended) · `default_currency` ·
`timezone` · `commercial_terms_id` · `created_at` · `updated_at`.
Indexes: unique(`slug`), (`status`).

**operator_domains** — allowlisted launch origins.
`id` · `operator_id`→operators · `domain` (e.g. `casino.example.com`) · `environment` (sandbox|prod) ·
`status` (active|disabled) · `created_at`.
Indexes: unique(`operator_id`,`domain`,`environment`). Used by Game Launch to validate `Origin`/launch token.

**operator_api_credentials** — server-to-server keys.
`id` · `operator_id` · `api_key_id` (public, sent in header) · `hmac_secret_ref` (pointer to secret
manager, **never the raw secret**) · `environment` · `status` (active|rotating|revoked) ·
`ip_allowlist` (cidr[]) · `created_at` · `expires_at` · `last_used_at`.
Indexes: unique(`api_key_id`), (`operator_id`,`status`). Retention: keep revoked rows for audit.

**admin_users** — provider staff and operator staff.
`id` · `operator_id` (NULL = provider/internal staff) · `email` (unique) · `password_hash` (argon2) ·
`mfa_secret_ref` · `status` · `last_login_at` · `created_at`.
Indexes: unique(`email`), (`operator_id`).

**roles** / **permissions** / **role_permissions** / **user_roles** — RBAC.
`roles`: `id` · `scope` (provider|operator) · `key` (e.g. `provider_super_admin`,
`operator_admin`, `operator_viewer`, `operator_finance`) · `name`.
`permissions`: `id` · `key` (e.g. `rounds.read`, `credentials.rotate`, `games.assign`,
`reports.read`, `incidents.write`).
Join tables map users→roles and roles→permissions. Operator-scoped roles are always evaluated
together with the row-level `operator_id` filter.

### 3.2 Games & math configs

**games** — catalog.
`id` · `code` (e.g. `bananax`) · `title` · `provider_studio` · `status` (draft|certified|live|retired) ·
`layout` (jsonb: reels/rows/min_match) · `created_at`. Indexes: unique(`code`).

**game_versions** — immutable released builds.
`id` · `game_id` · `semver` · `client_bundle_hash` · `engine_hash` · `rules_schema_version` ·
`status` (draft|candidate|certified|live|retired) · `certified_by` · `certified_at` · `created_at`.
Indexes: unique(`game_id`,`semver`). Append-only once `certified`.

**math_configs** — versioned, signed RTP/math configs (the productization of
[game-rules-v2.json](../math/game-rules-v2.json)).
`id` · `game_id` · `version` · `rtp_profile_key` (e.g. `bananax`, `bananax_94`, `bananax_92`) ·
`theoretical_rtp` · `config_jsonb` (full rules) · `config_hash` (sha256 of canonical JSON) ·
`signature` (provider signing key) · `status` (draft|in_review|approved|active|archived) ·
`approved_by` · `approved_at` · `simulation_report_id` · `created_at`.
Indexes: unique(`game_id`,`version`,`rtp_profile_key`), (`status`). **Append-only after `approved`.**
Retention: permanent (certification evidence).

**simulation_reports** — RTP evidence (productizes [tools/rtp-parity.js](../tools/rtp-parity.js)/
[client/engine/simulator.js](../client/engine/simulator.js) output).
`id` · `math_config_id` · `steps` · `rtp_percent` · `casino_net` · `hit_rate` · `bonus_catch_rate` ·
`max_win_x` · `passed` · `report_jsonb` · `created_at`.

**operator_games** — which operator gets which game + which RTP config (per market).
`id` · `operator_id` · `game_id` · `math_config_id` (the approved RTP profile assigned) ·
`min_bet` / `max_bet` / `allowed_bets` (jsonb; defaults to engine `ALLOWED_BETS`) · `currency` ·
`jurisdiction` · `status` (enabled|disabled) · `created_at`.
Indexes: unique(`operator_id`,`game_id`,`currency`,`jurisdiction`). This row is what Launch reads to
bootstrap a session.

### 3.3 Play & money (system of record)

**player_sessions** — replaces in-memory `sessions` Map.
`id` · `operator_id` · `game_id` · `math_config_id` · `operator_player_id` (operator's player ref,
pseudonymous) · `currency` · `locale` · `launch_token_id` · `status`
(active|expired|closed) · `free_spins_left` · `free_spin_multiplier_carry` · `bonus_round_win` ·
`created_at` · `expires_at` · `closed_at`.
Indexes: (`operator_id`,`created_at`), (`status`,`expires_at`), (`operator_player_id`).
Retention: hot 90 days, then archive; row kept (referenced by rounds).

**rounds** — one row per resolved game round (productizes `Spin` from data-model.md). **Immutable.**
`id` · `round_ref` (operator-visible, unique) · `session_id` · `operator_id` · `game_id` ·
`math_config_id` · `bet_amount` · `bet_charged` · `is_free_spin` · `ante_enabled` ·
`rng_seed_ref` (pointer; seed material stored encrypted) · `rng_algo` · `rng_counter_start` ·
`outcome_jsonb` (matrix, tumble_steps, ways_wins, multipliers — the full server result) ·
`outcome_hash` (sha256 of canonical outcome) · `total_win` · `multiplier_applied` ·
`status` (resolved|settled|void) · `prev_hash` · `chain_hash` · `created_at`.
Indexes: unique(`round_ref`), (`operator_id`,`created_at`), (`session_id`), (`status`),
(`game_id`,`created_at`). **No UPDATE/DELETE grant.** Retention: 5+ years (jurisdiction-driven),
archive cold after 12 months.

**wallet_transactions** — every money movement (productizes `LedgerTransaction`). **Append-only.**
`id` · `operator_id` · `session_id` · `round_id` · `type` (DEBIT|CREDIT|ROLLBACK) · `amount` ·
`currency` · `idempotency_key` (unique) · `operator_tx_ref` (operator's wallet tx id) ·
`status` (pending|confirmed|failed|rolled_back) · `attempt_count` · `request_jsonb` ·
`response_jsonb` · `error_code` · `created_at` · `confirmed_at`.
Indexes: unique(`idempotency_key`), unique(`operator_id`,`operator_tx_ref`) where present,
(`round_id`), (`status`,`created_at`), (`operator_id`,`created_at`).
Retention: same as rounds (financial record).

**rollback_records** — explicit compensation events.
`id` · `original_tx_id`→wallet_transactions · `round_id` · `reason`
(debit_failed|resolve_failed|credit_timeout|manual) · `status` · `idempotency_key` (unique) ·
`created_at`. Indexes: unique(`idempotency_key`), (`round_id`).

### 3.4 Audit, logs, reporting

**audit_records** — hash-chained sensitive-action log (per data-model.md `AuditRecord`).
`id` · `operator_id` (nullable for provider-global) · `actor_type` (admin|system|operator) ·
`actor_id` · `action` (e.g. `math_config.approve`, `credential.rotate`, `operator.suspend`) ·
`target_type` · `target_id` · `payload_hash` · `prev_hash` · `chain_hash` · `created_at`.
**Append-only.** Indexes: (`operator_id`,`created_at`), (`action`). Retention: permanent.

**api_request_logs** — every operator API call (sampled body, full metadata).
`id` · `operator_id` · `api_key_id` · `endpoint` · `method` · `request_id` · `idempotency_key` ·
`ip` · `signature_valid` · `status_code` · `latency_ms` · `error_code` · `created_at`.
Indexes: (`operator_id`,`created_at`), (`request_id`), (`idempotency_key`). Retention: 90 days hot,
then archive; PII minimized.

**reports** / **invoices** — materialized outputs.
`reports`: `id` · `operator_id` · `type` (rounds|ggr|rtp|activity|failed_tx|settlement|recon) ·
`period_start` · `period_end` · `grain` (daily|monthly) · `data_jsonb` · `generated_at`.
`invoices`: `id` · `operator_id` · `period` · `ggr` · `rev_share_percent` · `fee_amount` ·
`currency` · `status` (draft|issued|paid) · `line_items_jsonb` · `issued_at`.

**Relationship summary:** operator 1—* {domains, credentials, admin_users, operator_games,
player_sessions, rounds, wallet_transactions, reports, invoices}; game 1—* {game_versions,
math_configs, operator_games}; math_config 1—* {operator_games, rounds, simulation_reports};
player_session 1—* rounds; round 1—* wallet_transactions; wallet_transaction 1—0..1 rollback_record.

**Indexing principle:** every operator-facing query is prefixed by `operator_id` (composite indexes
lead with it) so tenant isolation is also the fast path.

---

## 4. API Design

Two API surfaces: **Operator API** (`/operator/v1/*`, server-to-server, HMAC-signed) and **Admin API**
(`/admin/v1/*`, JWT + RBAC). Player game client uses a **session-token-scoped** subset
(`/game/v1/*`). Versioned by URL prefix; breaking changes bump the version, additive changes don't.

**Auth**
- Operator API: header `X-Api-Key: <api_key_id>` + `X-Signature: <hmac>` + `X-Timestamp` + `X-Nonce`.
  HMAC-SHA256 over `timestamp + method + path + sha256(body)`; reject if `|now − timestamp| > 30s` or
  nonce seen before (replay guard). IP must be in `operator_api_credentials.ip_allowlist`.
- Game client: `Authorization: Bearer <session_token>` (short-lived JWT bound to session_id +
  operator + game). The client can only call spin/state; it cannot move money or read other sessions.
- Admin API: `Authorization: Bearer <admin_jwt>`; every handler enforces permission + tenant scope.

**Idempotency**
- Every state-changing operator call requires `Idempotency-Key` (also used as the wallet
  `idempotency_key`). First request executes and the response is stored; identical key returns the
  stored response with `Idempotent-Replay: true`. Keys are unique per operator. This formalizes the
  current in-memory `spinHistory` dedupe ([server.js:617-638](../backend/server.js#L617)).

**Error envelope** (all surfaces)
```json
{ "error": { "code": "INSUFFICIENT_FUNDS", "message": "…", "request_id": "…", "retryable": false } }
```
Codes (extends [api-spec.md](../backend/api-spec.md)): `UNAUTHORIZED`, `SIGNATURE_INVALID`,
`TIMESTAMP_SKEW`, `REPLAY_DETECTED`, `DOMAIN_NOT_ALLOWED`, `IP_NOT_ALLOWED`, `OPERATOR_SUSPENDED`,
`LAUNCH_TOKEN_INVALID`, `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `INVALID_BET`, `INSUFFICIENT_FUNDS`,
`DUPLICATE_REQUEST`, `WALLET_TIMEOUT`, `WALLET_DECLINED`, `CONFIG_NOT_APPROVED`, `RATE_LIMITED`,
`INTERNAL_ERROR`. HTTP: 400/401/403/404/409/422/429/5xx as appropriate.

### Key endpoints

**Operator/admin management (Admin API)**
- `POST /admin/v1/operators` → create operator. `POST /admin/v1/operators/{id}/domains`,
  `POST /admin/v1/operators/{id}/credentials` (returns api_key_id once; secret shown once),
  `POST /admin/v1/operators/{id}/games` (assign game + math_config), `POST …/credentials/{id}/rotate`,
  `POST …/operators/{id}/suspend`.

**Game launch (Operator API)** — operator's backend requests a launch URL/token for a player.
```
POST /operator/v1/launch
{ "operator_player_id":"p_8821", "game_code":"bananax", "currency":"GEL",
  "locale":"en", "return_url":"https://casino.example.com/lobby", "origin":"casino.example.com" }
→ 200 { "launch_url":"https://rgs.us/play?lt=<signed_launch_token>", "launch_token_id":"…",
        "expires_at":"…" }
```
We validate operator status, game assignment, and that `origin` ∈ operator_domains. The launch token
is a short-lived signed JWT carrying operator_id, game_id, operator_player_id, currency.

**Session init (Game API)** — game client exchanges the launch token for a session.
```
POST /game/v1/session/init   (Authorization: Bearer <launch_token>)
→ 200 { "session_token":"…", "session_id":"…", "balance":{"amount":125000,"currency":"GEL"},
        "allowed_bets":[20,50,100,200,500,1000,2000,5000,10000,25000,50000],
        "game":{"code":"bananax","rules_url":"…","math_config_version":"…"} }
```
Replaces today's open `POST /api/v1/session/init` ([server.js:1057](../backend/server.js#L1057)).
Balance is fetched from the operator wallet (seamless), not seeded locally.

**Spin (Game API)** — server-authoritative; client sends only intent.
```
POST /game/v1/spin   (Bearer session_token, Idempotency-Key: <uuid>)
{ "bet_amount": 100, "ante_enabled": false }
→ 200 { "round_ref":"r_…", "matrix":[…], "tumble_steps":[…], "ways_wins":[…],
        "total_win": 250, "multiplier_applied": 2.5,
        "balance":{"amount":124900,"currency":"GEL"}, "free_spins_left":0 }
```
Outcome shape preserved from the current engine so the existing client renderer keeps working.
Internally this drives the full round lifecycle (§5).

**Wallet callbacks (Provider→Operator, via adapter)** — not endpoints we expose but calls we make:
`debit(operator_tx_ref, amount, round_ref, idempotency_key)`,
`credit(...)`, `rollback(original_tx_ref, idempotency_key)`, `balance(operator_player_id)`.
Some operators instead **call us** (wallet-initiated); the adapter abstracts both directions.

**Round lookup (Operator + Admin API)**
```
GET /operator/v1/rounds/{round_ref}
→ 200 { round_ref, session_id, bet_amount, total_win, status, created_at,
        transactions:[…], outcome_hash, replayable:true }
GET /operator/v1/rounds?from=…&to=…&player=…&cursor=…   (paged, operator-scoped)
```

**Reporting (Admin API)** — `GET /admin/v1/reports/ggr?period=2026-05&grain=daily`,
`…/reports/rtp`, `…/reports/failed-transactions`, `…/invoices/{period}`. Always tenant-scoped.

**Admin auth** — `POST /admin/v1/auth/login` (email+password+MFA → JWT), `POST …/auth/refresh`,
`POST …/auth/logout`.

**Webhooks (Provider→Operator)** — `round.settled`, `transaction.failed`, `freespins.granted`,
`session.closed`. Signed with the operator's HMAC secret; delivered with retries + exponential
backoff; each carries an `event_id` for operator-side idempotency.

---

## 5. Round Lifecycle

Single source of truth for a spin. Each numbered state is persisted; the round and its transactions
form the immutable audit trail.

1. **Launch** — operator backend calls `POST /operator/v1/launch`; we validate operator/game/domain,
   mint a signed launch token, return the launch URL.
2. **Session validation** — game client calls `session/init` with the launch token; we verify
   signature + expiry + domain, fetch wallet balance, create `player_sessions` row, return a
   session token. (Replaces the in-memory session create.)
3. **Bet request** — client calls `spin` with bet + `Idempotency-Key`. We validate session
   (active/not expired), bet ∈ allowed_bets for that `operator_games` row, and operator not suspended.
   If the idempotency key already resolved → return stored round (no money movement).
4. **Wallet debit** — create `wallet_transactions` (type DEBIT, status pending, idempotency_key) →
   call operator wallet `debit` via adapter. On decline → `INSUFFICIENT_FUNDS`/`WALLET_DECLINED`,
   round never created. On confirmed → mark DEBIT confirmed.
5. **RNG / math resolution** — **only after** a confirmed debit. Draw a server seed (CSPRNG), record
   `rng_seed_ref` + `rng_algo` + `rng_counter_start`, run the seeded engine to produce the full
   outcome (tumbles, multipliers, free spins, max-win cap). Compute `outcome_hash`.
6. **Outcome storage** — insert the immutable `rounds` row (status `resolved`) with `prev_hash`/
   `chain_hash` linking it to the operator's previous round. This is the legal record.
7. **Win credit** — if `total_win > 0`, create `wallet_transactions` (type CREDIT, idempotency_key)
   and call wallet `credit`. Free-spins wins accumulate and settle per the game's bonus rules.
8. **Final settlement** — when debit + credit confirmed, set round `status = settled`; emit
   `round.settled` webhook; return the spin response to the client.
9. **Retry / failure handling** — wallet calls are retried with backoff via the queue, keyed by
   idempotency so retries are safe. Persistent failure on **credit** → round stays `resolved` and
   enters the **failed-settlement** queue (visible to both portals) rather than silently dropping the
   win. Timeouts use a "get status then decide" reconciliation, never a blind re-debit.
10. **Rollback** — if resolution fails *after* a confirmed debit (engine error, credit impossible by
    policy), issue a `rollback` for the debit (compensating tx + `rollback_records`), set round
    `status = void`. Rollbacks are idempotent.
11. **Client-visible round details** — operator can fetch `GET /operator/v1/rounds/{round_ref}` and,
    in the portal, see bet, outcome, transactions, settlement status, and request a deterministic
    **replay** (re-run the engine with the stored seed → must reproduce `outcome_hash`).

**Invariant:** money state changes only inside steps 4/7/10, always through `wallet_transactions`
with an idempotency key; the engine (step 5) is pure given (seed, config, bet).

---

## 6. Security Model

Builds on [docs/threat-model.md](threat-model.md) and
[docs/security-controls-matrix.md](security-controls-matrix.md) (most controls there are currently
TODO).

- **HMAC request signing (operator API)** — `X-Signature = HMAC_SHA256(secret, timestamp + "\n" +
  method + "\n" + path + "\n" + sha256(body))`. Reject on bad signature, >30s skew, or replayed
  nonce. Secret never leaves the secret manager except to compute the HMAC server-side.
- **Signed launch tokens** — short-lived (e.g. 60s) JWTs (EdDSA) carrying operator_id, game_id,
  operator_player_id, currency, origin. Single-use (consumed at session init). Rotate signing keys
  with a published JWKS + `kid`.
- **Session tokens** — short-lived JWT bound to session_id; re-issued on refresh; revocable by
  session close. Cannot perform money or admin actions.
- **API-key management** — per operator, per environment. Create returns the secret **once**; we store
  only a reference + last-4 + hash. Support overlapping `active`+`rotating` keys for zero-downtime
  rotation; auto-expire and alert before `expires_at`.
- **Client secret rotation** — self-service in the operator portal (provider-approved), with a grace
  window where old+new both validate; old key auto-revoked after cutover; every rotation is an
  `audit_records` entry.
- **IP allowlisting** — operator API calls must originate from `ip_allowlist` CIDRs.
- **Domain/origin allowlisting** — launch + game-client requests validated against
  `operator_domains`; `Origin`/`Referer` checked and CORS restricted to those domains (today there is
  no CORS at all).
- **RBAC** — provider scope (`provider_super_admin`, `provider_ops`, `provider_finance`,
  `provider_read_only`) and operator scope (`operator_admin`, `operator_finance`, `operator_viewer`).
  Every admin handler asserts a permission key **and** (for operator scope) `row.operator_id ==
  token.operator_id`. Tenant isolation is enforced in the query layer, not just the UI.
- **Audit logging** — all sensitive actions hash-chained in `audit_records`; chain verified by a
  scheduled job; breaks alert immediately.
- **Rate limiting** — per api_key and per session (token-bucket in Redis); burst + sustained limits;
  `429 RATE_LIMITED` with `Retry-After`. Protects against the unbounded spin loop the current server
  allows.
- **Encryption** — TLS 1.2+ in transit; Postgres encrypted at rest; seed material and secret
  references encrypted with envelope encryption (KMS). PII (operator_player_id mapping) minimized and
  encrypted.
- **Anti-tampering on round data** — append-only tables (no UPDATE/DELETE grant), `outcome_hash`
  per round, `prev_hash`/`chain_hash` linking rounds and audit records, deterministic replay from
  stored seed, and periodic chain-integrity verification. Any mismatch is a Sev-1 incident
  ([incident-response.md](incident-response.md)).

---

## 7. Admin Portal Requirements

Two SPAs sharing a component library and the Admin API; different role sets and tenant scope.

### A. Provider Super-Admin Portal (internal)

- **Dashboard** — platform health, live operators, spins/min, GGR today, failed-settlement count,
  open incidents, RTP drift alerts.
- **Operators** — table (name, status, env, GGR 24h/30d, active sessions). Actions: create, edit,
  suspend/resume, manage domains, manage credentials (issue/rotate/revoke), assign games. Filters:
  status, environment, currency, jurisdiction.
- **Games & versions** — catalog; promote `draft→candidate→certified→live→retired`; view bundle/engine
  hashes; attach certification artifacts.
- **Math/RTP configs** — list per game; create/import config; view simulation report; **approve**
  (state `in_review→approved→active`); diff versions; view signature/hash. Approval is gated and
  audited.
- **Rounds explorer** — global search by round_ref/operator/player/date; round detail with outcome,
  transactions, hashes; **replay** action (verify reproducibility).
- **Transactions & settlements** — global failed-settlement queue; inspect, retry, manual rollback
  (reason required, audited).
- **Audit log** — searchable hash-chained actions; chain-integrity status.
- **Incidents** — create/track incidents, link affected rounds/operators, post-mortems.
- **Reports** — cross-operator GGR/RTP/activity; invoice generation.
- **Permissions:** full platform; finance role limited to money/reports; read-only role for support.

### B. Operator/Client Admin Portal (per operator)

- **Dashboard** — their GGR, RTP (actual vs theoretical), active sessions, spins, top games, failed
  settlements — **only their data**.
- **Rounds** — table (round_ref, player, game, bet, win, status, time). Filters: date range, game,
  player, status, win threshold. Round detail: outcome summary, transactions, settlement status.
  (Outcome shown read-only; replay is provider-side.)
- **Sessions** — list/detail (player, game, start, status, rounds count).
- **Transactions** — debit/credit/rollback ledger with idempotency key + operator_tx_ref; filter by
  type/status/date.
- **Failed settlements** — the operator-visible subset: rounds where credit failed; status, last
  error, retry state; can flag for provider follow-up.
- **Reports** — GGR, RTP, player activity, daily/monthly reconciliation, invoices (download CSV/PDF).
- **Game config (read-mostly)** — assigned games, RTP profile, bet limits, currency; request changes
  (provider-approved).
- **Credentials** — view api_key_id (not secret), rotate secret (grace window), manage IP allowlist
  and launch domains (within provider policy).
- **Permissions:** `operator_admin` (all of the above), `operator_finance` (reports/transactions/
  invoices), `operator_viewer` (read-only rounds/sessions/reports). Every page is hard-scoped to the
  token's `operator_id`.

**Shared UX flows:** global date-range + currency selector; server-side paginated tables (cursor);
CSV export on every table; round_ref deep-links; optimistic-free, confirmation-gated money actions.

---

## 8. Compliance and Certification

Builds on [math/math-spec.md](../math/math-spec.md), [math/rng-design.md](../math/rng-design.md),
[qa/certification-package-index.md](../qa/certification-package-index.md),
[docs/02-legal-compliance.md](02-legal-compliance.md).

- **RNG documentation** — algorithm, entropy source, seeding, reseeding, separation from client;
  test vectors for lab review. **Action required:** replace unseeded `getRandomValues`
  ([rng.js](../client/engine/rng.js)) with a server-authoritative CSPRNG-seeded deterministic stream,
  store seed + counter per round.
- **Math config approval** — every `math_configs` row signed, hashed, and approved before it can be
  assigned; runtime rejects unapproved configs (`CONFIG_NOT_APPROVED`).
- **RTP simulation evidence** — `simulation_reports` (1M+ spins, RTP in band, positive casino_net,
  bonus-catch present) attached to each config; productizes existing tooling. Expand to 10M+ runs
  with variance/tail reporting for cert.
- **Round reproducibility/auditability** — deterministic replay from stored seed reproduces
  `outcome_hash`; immutable rounds + hash chain; available as a regulator/lab export.
- **Responsible gaming hooks** — reality checks, session time/loss limits, self-exclusion respected
  via operator wallet signals; configurable per jurisdiction; surfaced as session-level guards.
- **Jurisdiction-specific configs** — `operator_games.jurisdiction` drives allowed RTP profiles, max
  bet/win, RG defaults, and required disclosures; a jurisdiction registry holds the rules.
- **Logs and retention** — rounds/transactions retained 5+ years (jurisdiction-driven), audit records
  permanent, request logs 90 days; documented retention + archival policy.
- **Regulator exports** — signed, schema-stable exports of rounds/transactions/audit for a period;
  reproducible-round bundles on demand.
- **Certification package checklist** — game rules, math spec, RNG design, simulation reports,
  security controls matrix, threat model, API spec, build/version hashes, config signatures —
  assembled per [certification-package-index.md](../qa/certification-package-index.md).

---

## 9. Wallet Integration Strategy

A canonical **WalletAdapter** interface; one implementation per operator, selected by `operator_id`.
The core only ever speaks the canonical interface (per
[docs/provider-api-mapping.md](provider-api-mapping.md)).

```ts
interface WalletAdapter {
  balance(ctx, { operatorPlayerId, currency }): Promise<{ amount: number; currency: string }>;
  debit(ctx, { idempotencyKey, roundRef, operatorPlayerId, amount, currency })
      : Promise<{ operatorTxRef: string; balanceAfter?: Money; status: 'confirmed' }>;
  credit(ctx, { idempotencyKey, roundRef, operatorPlayerId, amount, currency })
      : Promise<{ operatorTxRef: string; balanceAfter?: Money; status: 'confirmed' }>;
  rollback(ctx, { idempotencyKey, originalOperatorTxRef, roundRef })
      : Promise<{ operatorTxRef: string; status: 'rolled_back' }>;
}
```

- **Idempotency** — every debit/credit/rollback carries our `idempotency_key`; adapters must pass it
  to the operator (or map to the operator's dedupe field) so retries never double-move money.
- **Timeout handling** — bounded timeout (e.g. 3–5s); on timeout we **do not assume failure** — we
  call `balance`/transaction-status to learn the true state before deciding to retry or rollback.
- **Retries** — exponential backoff with jitter via the queue; capped attempts; after cap → failed
  state surfaced in portals, never silent.
- **Failure states** — `pending → confirmed | failed | rolled_back`. Debit failure aborts the round
  (no outcome). Credit failure keeps the round `resolved` and queues settlement. Rollback failure is
  a Sev escalation.
- **Reconciliation** — a scheduled job compares our `wallet_transactions` against operator
  statements/status APIs; mismatches produce reconciliation reports and incidents
  (extends the settlement-mismatch playbook in [backend/runbook.md](../backend/runbook.md)).
- **Wallet-initiated operators** — some operators call **us** (their platform is the orchestrator);
  the adapter layer supports both push and pull directions behind the same canonical model.

---

## 10. Reporting and Reconciliation

Pre-aggregated by scheduled jobs into `reports`; queryable per tenant; CSV/PDF export. Money in minor
units, grouped by currency.

- **Rounds report** — counts, total bet, total win, hold, by game/day.
- **Sessions report** — sessions, avg rounds/session, duration, conversion to bonus.
- **GGR** — `bet − win` per operator/game/currency/day and month (the invoice basis).
- **RTP** — actual vs theoretical per math_config, drift alerting when out of band.
- **Player activity** — per operator_player_id: rounds, bet, win, net, RG flags (tenant-scoped).
- **Failed transactions** — failed/rolled-back tx, error codes, retry outcomes, aging.
- **Settlements** — settled vs outstanding wins, time-to-settle distribution.
- **Client invoices** — monthly GGR × rev-share + fees → `invoices`, issued via portal.
- **Daily/monthly reconciliation** — our ledger vs operator wallet totals; signed recon statement;
  discrepancies open incidents.

---

## 11. Environments and Deployment

- **Environments** — `local` (Docker Compose: Postgres + Redis + app), `sandbox` (operator
  integration/testing, isolated DB + test wallet stubs), `staging` (prod-like, pre-release cert/UAT),
  `production`. Sandbox and prod are fully data-isolated (separate DBs, secrets, keys).
- **Database migrations** — versioned, forward-only migrations (Prisma Migrate) gated in CI; expand→
  migrate→contract pattern for zero-downtime; never destructive on append-only tables.
- **Secret management** — cloud secret manager (AWS Secrets Manager / GCP Secret Manager / Vault);
  no secrets in code or env files; HMAC secrets, signing keys, DB creds, KMS keys referenced by
  pointer; rotation schedules.
- **CI/CD** — lint + typecheck + unit + integration (incl. RTP parity and idempotency tests) on PR;
  build immutable artifact + record `client_bundle_hash`/`engine_hash`; deploy sandbox→staging→prod
  with manual approval gate to prod; DB migration step; smoke tests; one-click rollback artifact
  (extends [docs/release-checklist.md](release-checklist.md)).
- **Backups** — automated Postgres PITR; periodic restore drills; WORM/audit tables backed up and
  integrity-checked; offsite copies.
- **Monitoring** — metrics (spin p95 < 300ms per [runbook.md](../backend/runbook.md), wallet latency,
  error rate, settlement lag, RTP drift), structured JSON logs with request_id correlation, traces;
  dashboards + alert rules (Sev-1 paging) tied to [incident-response.md](incident-response.md).
- **Log aggregation** — centralized (e.g. Loki/ELK/Cloud logging); api_request_logs queryable;
  retention policies per data class.

---

## 12. Development Roadmap

Each phase is shippable and leaves the system in a consistent state. Phases 1–2 are foundational and
should not be skipped.

### Phase 1 — Provider foundation
- **Goals:** TypeScript modular-monolith skeleton, config/env, health, structured logging, request-id,
  CI pipeline. Port the existing engine math into a server module.
- **Deliverables:** repo scaffolding, Docker Compose, CI (lint/typecheck/test), engine module +
  ported RTP-parity test.
- **DB:** none yet (or bootstrap migration tooling).
- **API:** `/health`, internal engine module API.
- **Frontend/admin:** none.
- **Tests:** engine parity vs current client engine; lint/typecheck green.
- **Acceptance:** server resolves a spin in-memory identically to the current engine; CI passes.

### Phase 2 — Persistent DB and round ledger
- **Goals:** Postgres as system of record; immutable rounds + transactions + audit chain; seedable
  server-authoritative RNG with replay.
- **Deliverables:** schema + migrations for sessions/rounds/wallet_transactions/audit_records; seeded
  RNG; deterministic replay endpoint; append-only enforcement.
- **DB:** §3.3/§3.4 core tables.
- **API:** internal round-resolution writes to DB; `GET /…/rounds/{ref}` + replay.
- **Tests:** replay reproduces `outcome_hash`; append-only (UPDATE/DELETE denied); restart preserves
  state.
- **Acceptance:** every spin produces an immutable round + audit link; any round replays exactly.

### Phase 3 — Client management and credentials
- **Goals:** multi-tenancy: operators, domains, API credentials, games, math_configs, operator_games.
- **Deliverables:** operator CRUD, credential issue/rotate, math-config approval workflow, game
  assignment.
- **DB:** §3.1/§3.2 tables.
- **API:** `/admin/v1/operators…`, credential + assignment endpoints.
- **Frontend/admin:** minimal provider admin screens for operators/credentials/games.
- **Tests:** tenant isolation; credential rotation grace window; unapproved config rejected.
- **Acceptance:** can create an operator, assign Banana X with an approved RTP config, mint
  credentials.

### Phase 4 — Launch/session/token flow
- **Goals:** signed launch tokens; session init; session-scoped game API; domain allowlisting + CORS.
- **Deliverables:** `POST /operator/v1/launch`, `POST /game/v1/session/init`, session tokens, origin
  checks.
- **DB:** `player_sessions`, `operator_domains`, launch-token records.
- **API:** launch + session + scoped `spin` (still local balance until Phase 5).
- **Frontend:** game client points at new session/spin endpoints (outcome shape unchanged).
- **Tests:** invalid/expired/replayed launch token rejected; non-allowlisted origin rejected.
- **Acceptance:** operator launches a player who plays a real session end-to-end.

### Phase 5 — Wallet adapter and idempotent transactions
- **Goals:** seamless wallet integration; debit→resolve→credit→rollback; idempotency end-to-end.
- **Deliverables:** WalletAdapter interface + reference adapter + sandbox wallet stub; queue-driven
  retries; failed-settlement queue.
- **DB:** `rollback_records`, transaction status lifecycle, idempotency keys.
- **API:** spin drives wallet calls; `Idempotency-Key` enforced; webhooks `round.settled`,
  `transaction.failed`.
- **Tests:** duplicate spin = one debit; debit-fail aborts; credit-timeout reconciles not double-pays;
  rollback idempotent.
- **Acceptance:** real money flow against the sandbox wallet with zero double-moves under retries.

### Phase 6 — Admin portals
- **Goals:** provider super-admin + operator admin SPAs on the Admin API with RBAC.
- **Deliverables:** dashboards, rounds/sessions/transactions tables, failed settlements, credential
  management, config approval UI.
- **DB:** roles/permissions seed.
- **API:** read/report endpoints + RBAC middleware + tenant scoping.
- **Frontend/admin:** both SPAs (shared component lib).
- **Tests:** operator cannot read another operator's rows (authz tests); permission matrix.
- **Acceptance:** operator self-serves rounds/reports; provider manages everything.

### Phase 7 — Reporting/reconciliation
- **Goals:** aggregated reports, invoices, daily/monthly recon.
- **Deliverables:** scheduled aggregation jobs, GGR/RTP/activity/failed-tx/settlement reports,
  invoice generation, recon vs wallet.
- **DB:** `reports`, `invoices`.
- **API:** reporting endpoints + CSV/PDF export.
- **Frontend/admin:** report pages + exports in both portals.
- **Tests:** report totals reconcile to ledger; recon flags injected discrepancies.
- **Acceptance:** monthly invoice + recon statement generated and matches the ledger.

### Phase 8 — Security hardening
- **Goals:** complete HMAC signing, rate limiting, IP allowlists, encryption, key rotation, chain
  verification, pen-test fixes.
- **Deliverables:** signing middleware, replay/nonce store, rate limiter, KMS envelope encryption,
  scheduled chain-integrity job, secret rotation runbooks.
- **DB:** nonce store (Redis), key metadata.
- **API:** signature + skew + nonce enforced on all operator endpoints.
- **Tests:** tampered/replayed/over-rate requests rejected; chain-break detection; secret rotation
  with no downtime.
- **Acceptance:** security-controls-matrix items move TODO→DONE; external pen-test passes.

### Phase 9 — Certification readiness
- **Goals:** assemble certification package; 10M+ simulation evidence; regulator exports; RG hooks;
  jurisdiction configs.
- **Deliverables:** signed cert package, reproducible-round export, RG limit enforcement, jurisdiction
  registry.
- **DB:** jurisdiction config tables; RG limit fields.
- **API:** regulator export endpoints; RG-aware session guards.
- **Tests:** export schema-stable + reproducible; RG limits enforced; config-per-jurisdiction honored.
- **Acceptance:** lab-ready package; sandbox cert dry-run passes.

### Phase 10 — Production launch
- **Goals:** first live operator in production.
- **Deliverables:** prod environment, on-call, dashboards/alerts, backups + restore drill, go-live
  runbook, first operator onboarded.
- **DB:** prod provisioning, PITR.
- **API:** prod credentials + live wallet adapter.
- **Tests:** prod smoke + settlement validation; failover/restore drill; load test at target TPS.
- **Acceptance:** real-money rounds settle correctly in production with monitoring + rollback ready.

---

## 13. Technical Decisions

Assuming Node.js, the recommended stack:

- **Language:** **TypeScript** (strict). Money + multi-tenant authz code needs compile-time safety;
  the current JS engine ports cleanly and gains type guarantees.
- **Database:** **PostgreSQL**. ACID for wallet/round writes, strong consistency, `jsonb` for
  flexible outcome storage, partial/composite indexes for tenant queries, partitioning for large
  rounds/transactions tables, PITR. The single most important choice for money correctness.
- **ORM/query layer:** **Prisma** for schema/migrations/typed queries, with **raw SQL** for hot paths
  (round insert, reports) and append-only constraints. Prisma's typed client reduces tenant-scope
  bugs; raw SQL where performance/locking matters.
- **Auth:** **HMAC-SHA256** (operator API) + **EdDSA JWT** (launch/session/admin via `jose`),
  **argon2** for admin passwords, **TOTP** MFA. Standard, lab-friendly, no heavy framework lock-in.
- **Admin frontend:** **React + TypeScript + Vite**, component lib (e.g. Mantine/shadcn), TanStack
  Query + Table for server-paginated data. Two apps, shared packages. SPA decoupled from the RGS so
  it can deploy independently.
- **Logging:** **pino** structured JSON with request-id correlation → centralized aggregation.
- **Monitoring:** **OpenTelemetry** traces/metrics → Prometheus/Grafana (or cloud equivalent);
  alerting on the runbook SLOs.
- **Queues:** **BullMQ on Redis** for settlement retries, webhooks, report aggregation, reconciliation.
  Lightweight, Node-native, good enough before needing Kafka.
- **Caching/ephemeral:** **Redis** for idempotency/nonce store, rate-limit buckets, session token
  cache, hot config.
- **Deployment:** **Docker** containers on a managed platform (ECS/Fargate or GKE/Cloud Run) +
  **managed Postgres** (RDS/Cloud SQL) + **managed Redis**; IaC (Terraform); secret manager + KMS.
  Managed services minimize ops burden for a small team while meeting production/regulatory bars.

**Why modular monolith first:** the listed "services" share one transactional boundary (debit→
resolve→credit must be consistent). A monolith with strict module boundaries keeps that simple and
fast for MVP; the data model is already service-ready, so spin/wallet can be extracted later under
load without schema churn.

---

## 14. Risks and Missing Questions

**Architectural** — distributed money consistency across our DB and the operator wallet (mitigate:
idempotency + reconcile-on-timeout, never blind retry); coupling the renderer to outcome shape
(keep `/game/v1/spin` response stable); premature microservices (avoid).

**Compliance** — RNG is currently non-reproducible (**must** fix before cert); jurisdiction rules
(Georgia marked IN_RESEARCH in [compliance-matrix.md](compliance-matrix.md)); near-miss mechanic
([near-miss.js](../client/engine/near-miss.js)) may be disallowed in some markets and needs lab
review; RG features mandatory in regulated markets.

**Financial** — double-credit/double-debit on retries (idempotency is the core control); failed
settlements eroding trust if not surfaced/retried; GGR/invoice disputes without solid recon;
rollback correctness under partial failure.

**Operational** — settlement queue backlog during wallet outages; restore/DR not drilled; alert
fatigue; on-call coverage; migration safety on append-only tables.

**Security** — operator credential compromise (rotation + IP allowlist + anomaly alerts); replay/
tamper (signing + nonce + hash chain); insider misuse (RBAC + immutable audit); secret sprawl.

**Questions to answer before implementation:**
1. Wallet model per operator — seamless (assumed), transfer, or both? Push or pull direction?
2. First target jurisdiction(s) and lab — Georgia only, or MGA/UKGC-class from day one? (drives §8)
3. Currencies and FX — single currency per operator, or multi-currency wallets?
4. Is Banana X the only game at launch, or must the RGS host third-party game engines too?
5. Rev-share/fee model for invoicing (and tax handling)?
6. RG requirements per market (limits, self-exclusion, reality checks) and who owns them (us vs operator)?
7. Data residency/PII rules (where can rounds/player refs be stored)?
8. Expected peak TPS / concurrent sessions (sizing, partitioning, when to extract services)?
9. SLA targets and support hours committed to operators?
10. Retention periods mandated per jurisdiction (drives archival design)?

---

## 15. Implementation Backlog

Prioritized epics → representative stories → key tasks. (P0 = foundational, do first.)

**EPIC A — RGS core & persistence (P0)**
- Story: As the platform, resolve a spin server-side and store it immutably.
  - Port engine to TS server module; add seedable CSPRNG + counter; persist round with
    `outcome_hash` + hash chain; implement replay; enforce append-only (DB grants + tests).

**EPIC B — Multi-tenancy & config (P0)**
- Story: As provider, onboard an operator and assign a game with an approved RTP config.
  - operators/domains/credentials CRUD; math_config import + sign + approve; operator_games
    assignment; reject unapproved config at runtime.

**EPIC C — Launch & session (P0)**
- Story: As an operator, launch a player into a game securely.
  - Signed launch token mint/validate; session init + session token; domain allowlist + CORS;
    session lifecycle/expiry.

**EPIC D — Wallet & settlement (P0)**
- Story: As the platform, move money idempotently with safe failure handling.
  - WalletAdapter interface + sandbox stub + first real adapter; debit/resolve/credit/rollback
    orchestration; idempotency store; queue retries; failed-settlement queue; webhooks.

**EPIC E — Security hardening (P1)**
- HMAC signing + skew + nonce; rate limiting; IP allowlist; KMS encryption; key/secret rotation;
  scheduled chain-integrity verification.

**EPIC F — Admin portals (P1)**
- Admin API + RBAC + tenant scoping; provider super-admin SPA; operator admin SPA; rounds/sessions/
  transactions/failed-settlements; credential + config-approval UIs; authz test suite.

**EPIC G — Reporting & reconciliation (P1)**
- Aggregation jobs; GGR/RTP/activity/failed-tx/settlement reports; invoices; daily/monthly recon vs
  wallet; CSV/PDF export.

**EPIC H — Compliance & certification (P2)**
- 10M+ simulation evidence pipeline; reproducible-round + regulator exports; RG hooks; jurisdiction
  registry; assemble signed cert package.

**EPIC I — Environments, CI/CD, observability (P1, runs alongside)**
- Compose/local; sandbox/staging/prod IaC; migration gates; pino + OTel + dashboards + alerts;
  backups + restore drills; go-live runbook.

---

### Appendix — current → target mapping

| Concern | Today (prototype) | Target |
|---|---|---|
| Sessions | in-memory `Map` ([server.js:19](../backend/server.js#L19)) | `player_sessions` in Postgres, token-scoped |
| Idempotency | per-session `spinHistory` Map | `wallet_transactions.idempotency_key` + Redis nonce |
| Balance | local number seeded 1000 | operator wallet (seamless) via adapter |
| RNG | unseeded `getRandomValues` ([rng.js](../client/engine/rng.js)) | server CSPRNG seed + counter, replayable |
| Rounds | none persisted | immutable `rounds` + hash chain |
| AuthN/Z | none, no CORS | HMAC + signed tokens + RBAC + allowlists |
| Math config | static JSON file | signed/approved `math_configs` entity |
| Admin | none | provider + operator portals |
| Wallet | none | adapter layer + idempotent settlement |
