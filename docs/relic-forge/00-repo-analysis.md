# Relic Forge — 00. Repo analysis

Status: draft for review (2026-10-17). Scope: how Vault 20K is built, what a second game can reuse, and
what has to change so Relic Forge can ship without touching Vault 20K's math or behaviour.

Read with: `CLAUDE.md` (repo rules), `01-GDD.md`, `02-tech-plan.md`.

---

## 1. Map of the repo

| Area | Where | Notes |
|---|---|---|
| Slot math (single source of truth) | `client/engine/*.js` | Browser IIFEs on `globalThis.SlotEngine`, fixed load order: `rng, config, symbols, multipliers, matrix, payouts, tumble, crazy-mode, session-store, spin-engine, simulator`. `ENGINE_VERSION` lives in `spin-engine.js`. |
| Game manifest | `games/bananax/game.json` | Engine dir + file order + namespace + rules + client folder. Read by the RGS and `tools/rtp-parity.js` (`GAME_CODE`). |
| Rules / paytable / RTP profiles | `math/game-rules-v2.json` (canonical) + `client/math/game-rules-v2.json` (served copy) | Profiles 96.38 / 94.40 / 92.38 (`bananax`, `bananax_94`, `bananax_92`), `payout_scaler` + `free_spin_payout_scaler`, `max_win_cap_multiplier`. |
| RNG | `client/engine/rng.js` → `crypto.getRandomValues` | Rejection-sampled `randomInt`, 53-bit `randomFloat`, `weightedPick`. On the server `crypto` is the seeded controller from `platform/src/lib/seeded-rng.ts` (`withSeed`), so every round is replayable from its seed. |
| Board generation | `client/engine/matrix.js` | Each cell is an independent weighted draw (no reel strips). Scatter / multiplier chances first, then `weightedRegularSymbol`. |
| Cascades | `client/engine/tumble.js` | Remove winners, gravity per column, refill from the top with the same per-cell draw. |
| Round logic, cap, free spins | `client/engine/spin-engine.js` | `evaluateSpinRound`, `spin`, `buyFreeSpins`. The max-win cap covers trigger + whole feature (`FREE_SPINS_ENDED_BY_MAX_WIN_CAP`). |
| Simulator | `client/engine/simulator.js`, `tools/rtp-parity.js`, `tools/rtp-report.js` | Seeded, 20 fixed shards, Z·SE pass rule; lab-style report in `qa/rtp-certification-report*.md`. |
| RGS (real backend) | `platform/` (Fastify + TS) | Engine loader, game registry, orchestrator, wallet, ledger, regulatory, exports, admin consoles. |
| Engine loading | `platform/src/lib/engine-loader.ts` | Each game in its own `vm` context (`DONT_CONTEXTIFY`, no eval, globals = seeded `crypto`, `console`, timers). |
| Multi-game routing | `platform/src/modules/games/game-registry.ts` | `engineFor(session.game_code)` incl. RTP-variant ids; unknown code → `GAME_ENGINE_NOT_FOUND` / `GAME_NOT_FOUND`. Proven by `test/game-registry.test.ts` (fixture game `echo-test`). |
| Engine facade | `platform/src/modules/engine/engine.service.ts` | `engineInput` allow-list, `SessionSnapshot` → `buildSessionObject`, `resolveDeterministic(Buy)`, `maxWinMultiplier`, `supportsBuy/Ante`. |
| Round flow | `platform/src/modules/rounds/round-orchestrator.ts` | Regulatory gate → feature lock → intent → debit (`DebitReconciler`) → resolve → record (hash chain, signed row) → apply → credit. `preState` is stored for replay. |
| Replay / audit | `rng/authoritative-resolver.ts`, `rounds/round-verification.service.ts`, `rounds/round-export.service.ts` | Seed + `seed_sha256` + `stream_sha256`, `outcome_hash`, `engine_version`, `rules_hash`, Ed25519-signed export. |
| Regulatory | `platform/src/modules/regulatory/regulatory.ts` | Per-operator profile: `min_round_ms`, reality check, `autoplay_enabled`, `max_autoplay_spins`, `turbo_enabled`, `buy_feature_enabled`. |
| Persistence | `platform/src/persistence/*`, `migrations/0001…0014` | Memory-first write-through to Postgres; tests never need a DB. New fields = new forward-only migration + `TABLES` + hydrate. |
| Client (presentation) | `client/main.js` (~365 KB, canvas renderer + DOM shell), `client/big-win.js`, `client/notify.js` (VxNotify), `client/embed-bridge.js`, `client/audio/audio.js` | Strict presentation invariants in `CLAUDE.md` (no shake, no idle motion, displayed pays = paid pays…). |
| `/play` page | `platform/src/http/play-page.ts` | Serves **only** Vault 20K's `client/` at `/play/`. |
| Legacy MVP | `backend/server.js` | Re-implements Vault math; not used by the platform. |
| Tests / gates | `platform/test/*.test.ts` (vitest), `tools/*.js` + `tools/probes/*` (real Chrome via CDP), `.github/workflows/platform-ci.yml` | `verify:release`, `verify:browser`, `test:rtp-parity`, `engine-isolation-parity`. No unit-test runner for `client/engine/` itself (the math is gated by rtp-parity). |
| Deploy | `vercel.json` (publishes `client/` as a static SPA, no API), `website/` (separate Vercel project), `infra/` (Docker + Caddy + Postgres, not hosted yet) | The public demo resolves spins in the browser. |

## 2. How a spin flows today (RGS mode)

1. Casino signs `POST /operator/v1/launch` (session carries `game_code`) → player opens `/play?lt=…`.
2. `POST /game/v1/spin` → orchestrator: regulatory `beforeRound`, feature lock if `free_spins_left > 0`, intent,
   debit.
3. `AuthoritativeResolver.resolve(snapshotFor(session), input)` draws a fresh seed, runs the game's engine under
   `withSeed`, hashes the canonical outcome.
4. Ledger records the round with `preState` (`free_spins_left`, `free_spin_multiplier_carry`, `bonus_round_win`,
   ante, mode), `engine_version`, `rules_hash`; the session is updated from the result (`applyResult`); win is
   credited.
5. The client animates the returned payload; it never feeds data back and never uses the engine RNG for visuals.

## 3. Reusable vs Vault-specific

**Reusable as-is (game-agnostic already):**
- Engine isolation + manifest + registry (Phase 6). A new game is a new `games/<code>/` folder.
- `rng.js` semantics (pure function of `crypto`), seeded resolve, replay, outcome hash, signed export.
- Wallet, debit reconciliation, round intents and recovery, idempotency, feature lock (`locked_*`), free rounds /
  campaigns, reporting, Round Inspector, regulatory gate, max-win `assertPayable`.
- Client infrastructure patterns: VxNotify, embed bridge, audio bus architecture, probes, motion recorder.
- Simulation methodology: seeded sharded Monte Carlo, Z·SE gate, report format.

**Vault-specific (must be generalised before a second, stateful game can run on the RGS):**
1. `SessionSnapshot` / `buildSessionObject` / `snapshotFor` / `preState` know only Vault's state
   (`freeSpinsLeft`, `freeSpinPersistentMultiplier`, `bonusRoundWin`, ante).
2. `engine.types.ts` `SpinResult` / `TumbleStep` require Vault fields (`ways_wins`, `multipliers`, `matrix` 6x5).
3. `engineInput` allow-list has no way to carry a **player choice** (Relic Forge's draft pick).
4. No storage for state that outlives a session (the **Forge meter** is per player, per bet level).
5. `play-page.ts` serves only `client/`. The registry's `clientDir()` and the `/play/g/<code>/` path are documented
   in a comment but **not routed** yet.
6. Regulatory has `turbo_enabled` (default `true`) but no slam-stop flag and no per-game default.
7. `vercel.json` publishes only `client/`.
8. `tools/rtp-parity.js` builds a Vault-shaped session; a stateful game needs its own simulator contract.

## 4. Proposal: add Relic Forge without touching Vault 20K

**Principle:** Vault 20K's engine files, rules, manifest and client do not move or change. Every platform change
is additive and keeps Vault's outcomes byte-identical (gate: `engine-isolation-parity --spins 10000000`,
`test:rtp-parity`, `verify:release`, `verify:browser`).

- **Per-game module:** `games/relicforge/` holds its own engine IIFEs (namespace `RelicForge`), rules JSON,
  client and unit tests. Shared code is *copied in deliberately* only where the copy is tiny and stable
  (`rng.js` semantics); no cross-game imports in the math, so one game's change can never move the other's RTP.
- **Platform generalisation ("shared skeleton", phase 1):**
  - `SessionSnapshot.featureState` (opaque JSON per game) + `player_sessions.feature_state` (migration) +
    `preState.feature_state`. Vault never sets it, so its hashes and replays are unchanged.
  - `player_meters` store (memory + Postgres) keyed by operator, player, game, bet; its value goes into the
    snapshot and `preState`, so replays stay exact.
  - Optional `choice` on `POST /game/v1/spin`, passed through `engineInput` only for games that declare
    choices, validated by the engine against the server-stored offer, recorded on the round.
  - Per-game result typing: a common core (`total_win`, `is_free_spin`, `free_spins_left`, `bet_amount`) +
    a game payload.
  - `/play/g/<code>/` routing via `GameRegistry.clientDir()`.
  - Regulatory: add `slam_stop_enabled`; per-game defaults in the manifest (`presentation.turbo_default`,
    `slam_stop_default`) so Relic Forge is off unless the market profile *and* configuration enable it.
- **Deploy:** a small static build step assembles the Vercel output (`client/` unchanged at `/`, Relic Forge at
  `/relic-forge/`), verified by diffing Vault's served files before/after.

## 5. Things the spec assumes that are not true of the repo

| Spec says | Repo reality | Proposal |
|---|---|---|
| "Certified RNG" | No lab certificate exists; nothing may claim one (`CHECKPOINT.md`). | Wording: "server-side RGS RNG, designed for GLI-11-style certification". |
| "Deployed alongside Vault 20K (Vercel)" | Vercel serves the static client only; the demo resolves in the browser. RGS not hosted. | Demo resolves in-browser and is labelled **Demo**; the RGS path (`/play/g/relicforge/`) is the authoritative one, proven locally and in CI. (User decision 2026-10-17.) |
| Screen shake (Meltdown, combo counter) | Vault rule: no screen/board shake, ever. | Relic Forge only: board-level shake + combo-counter shake, never the page layout; off under `prefers-reduced-motion`; Settings toggle. Vault unchanged. (User decision 2026-10-17.) |
| Turbo / slam-stop off by default | Vault ships both on (`TURBO_SCALE`, `FAST_ZIP`); `turbo_enabled` defaults `true`. | Per-game default off + new `slam_stop_enabled` flag; Vault defaults unchanged. |
| "Skeleton extraction" | Multi-game already exists (Phase 6). | Phase 1 = the generalisation in §4, not a file move. |
| Unit-tested pure engine | No unit runner for engine IIFEs today. | `node --test` (built-in, no deps) for `games/relicforge/test/`, wired into `verify:release`. |
| — | `backend/server.js` MVP has its own Vault math. | Relic Forge is not added to the legacy MVP. |
