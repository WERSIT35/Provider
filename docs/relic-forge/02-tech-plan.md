# Relic Forge — 02. Technical plan

Status: draft for review (2026-10-17). Nothing below is built yet; build starts after approval.
Read with `00-repo-analysis.md` and `01-GDD.md`.

---

## 1. Principles

- **Vault 20K is untouched.** Its engine, rules, manifest and client do not change. Every platform change is
  additive and keeps Vault's outcomes byte-identical.
- **One math implementation per game.** `games/relicforge/engine/*.js` is used by the browser demo, the RGS
  (`vm` context, as today) and the simulator, so parity holds by construction.
- **Pure engine.** Each step is a pure function of (rules, state, input, RNG draws). The only randomness source is
  `crypto.getRandomValues` (seeded by the RGS). No `Date`, no `Math.random`, no globals beyond the namespace.
- **Server decides, client shows.** Offers, special positions, wild positions and the meter all live in the
  outcome. The client sends only bet and pick.

## 2. File layout

```
games/relicforge/
  game.json                 manifest: code relicforge, namespace RelicForge, engine files in order,
                            rules, client, choices: true, presentation defaults (turbo/slam off)
  engine/
    rng.js                  same semantics as client/engine/rng.js, registered on RelicForge.RNG
    rules.js                profile lookup (relicforge / _94 / _92), scalers, tables
    grid.js                 board creation (W×H, variable H for Expand), per-cell weighted draw
    cluster.js              flood-fill cluster detection (orthogonal, Wild-aware)
    cascade.js              remove → gravity → refill; Ember collection
    specials.js             create (size bands), detonate, combo resolution (deterministic order)
    mult.js                 per-step Mult, Line Burst, Chain/Surge modifiers
    forge-meter.js          fill, trigger, reset
    relics.js               relic effects per level, evolutions, Meltdown
    draft.js                offer generation, pick validation, level/evolution transitions
    ev-table.js             equal-EV factor lookup (data in rules)
    spin-engine.js          SpinEngine facade + ENGINE_VERSION ("rf-0.1.0")
    simulator.js            in-engine Monte Carlo contract (used by tools)
  math/rules.json           paytable, symbol weights (base / bonus / Hoard / Cathedral), specials,
                            meter, relic tables, EV factor table, profiles 96/94/92, cap 10000
  client/                   index.html, renderer (canvas 2D, vanilla JS like Vault), juice, audio manifest;
                            copies of notify.js / embed-bridge.js / audio.js (parameterised), not edited in place
  test/*.test.mjs           node:test unit tests (built-in runner, no new deps)
tools/relicforge-sim.js     seeded, sharded Monte Carlo + per-relic / per-state EV report
tools/relicforge-ev.js      builds the equal-EV factor table (backward induction), writes into rules.json
tools/relicforge-replay.js  seed + pre-state (+ picks) → full step-by-step trace (debugging)
docs/relic-forge/sim-reports/
```

## 3. Engine contract

```
SpinEngine.spin({ bet_amount, choice? })        // the same call shape the RGS uses today
  reads  this.session.featureState              // { forge: {spinsLeft, relics, evolutions, pendingOffer,
                                                //   carriedMult, stuckSpecials, relicBonus}, meter }
  returns result = {
    // common core (all games)
    spin_id, bet_amount, bet_charged, total_win, is_free_spin, free_spins_left, free_spins_awarded,
    // relic forge payload
    steps: [{ board, clusters, specials_created, detonations, combos, line_burst, mult, step_win }],
    meter: { before, after, triggered }, scatters, forge: { pick, offer_next, relics, evolution,
    relic_bonus, meltdown }, events, cap_reached
  }
  and sets this.session.featureState = nextState
```

- `choice` is accepted only when `featureState.forge.pendingOffer` exists and must index into it. Otherwise the
  engine throws `INVALID_CHOICE` and the RGS returns 422 before any money moves.
- Every pure module is also exported on its own (`RelicForge.Cluster.find(board)`, …) for unit tests.

## 4. Strict equal-EV drafts (the main math risk)

**Goal:** for every reachable draft state *s* and every option *r* in its offer,
E[rest of bonus | s, pick r] is equal within tolerance. Then every pick policy has the same EV.

**State:**
- The draft-visible state: relic level vector (6 × 0..3), evolution flags, spins left (10..1).
- Carried state, bucketed: carried Mult (≈6 buckets) and stuck specials (0 / 1 / 2+).
- About 2,500 reachable relic configurations before buckets. The tool counts the exact number.

**Method (`tools/relicforge-ev.js`):**
1. For each relic configuration and carried bucket, Monte Carlo a single spin. This gives E[W], the
   distribution of the next carried bucket, and Var[W]. This is the expensive part; it parallelises across
   workers.
2. Backward induction from spin 10 (Meltdown) to spin 1, using the per-spin results. U(s, r) is the expected
   remaining win if *r* is picked, assuming future picks are already equalised.
3. Per state, factor k(s, r) = max_r' U(s, r') / U(s, r). This makes every option equal and keeps every
   k ≥ 1. The bonus's running **Relic bonus** is the product of the chosen k.
4. Re-normalise the whole bonus to its RTP target with `free_spin_payout_scaler` (per profile).
5. The table goes into `rules.json`, so it is covered by `rules_hash` and part of every replay.

**Proof (phase 7 report):**
- **Per-state check:** sample states and simulate each option independently. Require |ΔEV| ≤ max(2% of U,
  3·SE) *(tolerance to confirm)*.
- **Adversarial check:** an oracle policy sees the full state, including exact carried Mult and stuck specials,
  and picks by rollout. Its RTP minus a random-pick RTP must be ≤ 0.10 percentage points *(to confirm)*. The
  same must hold for a worst-pick policy.
- Per-relic EV and variance tables, and the volatility rating per option shown to the player.

**Fallbacks if the table does not converge or is too large:**
- Coarser buckets plus the adversarial bound above.
- Reduce the interaction depth: Meltdown fires at fixed levels independent of picks, and Surge/Singularity carry
  is clamped.

Either changes the design and needs your approval.

## 5. Platform changes (phase 1, additive)

| Change | Where | Vault impact |
|---|---|---|
| `SessionSnapshot.featureState?: unknown`; `buildSessionObject` copies it to `session.featureState` | `engine.service.ts` | None (undefined for Vault). |
| `player_sessions.feature_state jsonb` | `migrations/0015_feature_state.sql`, `TABLES`, hydrate | Column null for Vault. |
| `preState.feature_state`, `preState.meter`, `preState.choice` | `round-orchestrator.ts`, `round-verification.service.ts`, export | Absent for Vault (`omitNull`), so hashes are unchanged. |
| `player_meters (operator_id, operator_player_id, game_code, bet_amount, value, rules_hash, version)` | `migrations/0016_player_meters.sql`, memory + PG store | None. |
| Meter concurrency: optimistic `version` check, `METER_BUSY` 409 for a second concurrent session of the same player, game and bet | orchestrator | None. |
| `choice` on `POST /game/v1/spin` (strict body), passed by `engineInput` only if the manifest has `choices: true` | `game.routes.ts`, `engine.service.ts` | Vault rejects `choice` exactly as it rejects any unknown field today. |
| Result typing: `CoreSpinResult` + per-game payload | `engine.types.ts` | Vault's type stays `CoreSpinResult & VaultPayload`. |
| `/play/g/<code>/` serves `GameRegistry.clientDir(code)` | `play-page.ts` | `/play/` unchanged. |
| `slam_stop_enabled` regulatory flag + per-game presentation defaults from the manifest | `regulatory.ts`, migration if persisted | Vault defaults unchanged. |
| Simulator contract: `ns.Simulator.simulate(engine, opts)` with continuous meter chains | `tools/rtp-parity.js` reads it via `GAME_CODE` | Vault path unchanged. |

**Gate for phase 1 (and every later phase that touches `platform/`):**
- `npm run verify:release` and `npm run verify:browser`.
- `npm run test:rtp-parity` (Vault, CI sizes).
- `npx tsx platform/scripts/engine-isolation-parity.ts --spins 10000000`.
- A new test: a Vault round recorded before the change replays to the same `outcome_hash` after it.

## 6. Phases (each ends with tests green, a commit, a PR and a short report)

| # | Phase | Deliverable | Tests / evidence |
|---|---|---|---|
| 1 | Shared skeleton (platform generalisation) | §5 | Vault gates above; new platform tests for feature state, choice validation, meter store and `/play/g/`. |
| 2 | Grid, clusters, cascades | `grid`, `cluster`, `cascade`, minimal `spin-engine` | node:test: hand-built boards (L-shapes, Wild bridges, 30-cell clusters, empty), gravity invariants, refill counts; golden seed traces. |
| 3 | Specials + combos | `specials.js` | Every size band; every combo pair; chain order determinism; Prism target tie-breaks. |
| 4 | Mult + Line Burst | `mult.js` | Step Mult sequence; Burst stacking; reset per spin. |
| 5 | Forge meter | `forge-meter.js` + RGS wiring | Fill and trigger; persistence across sessions and bet levels; reset on `rules_hash` change; concurrency; replay. |
| 6 | Relics, draft, evolutions, Meltdown | `relics`, `draft`, `ev-table` | Offer validity (always ≥ 3 options); level caps; each evolution; Meltdown; invalid pick → 422; full-bonus replay with picks. |
| 7 | Monte Carlo + tuning | `relicforge-sim`, `relicforge-ev`, reports | 10M+ base spins (continuous meter chains, 20 seeded shards) and 1M+ bonuses per profile. Reports: RTP and split, hit frequency, bonus frequency (scatter / meter), volatility index (SD per spin), cap hits, per-relic EV and variance, per-state equal-EV check, adversarial-policy bound. Iterate until targets hold; save to `docs/relic-forge/sim-reports/`. |
| 8 | Client + juice + sound hooks | `games/relicforge/client/` | Probes in the `tools/probes` style: layout (375 → 4K), celebration gating (a seeded round below the bet shows no celebration), paytable (displayed = paid), reduced motion (no shake), performance. |
| 9 | Demo deploy | Static build assembling `client/` (unchanged at `/`) + Relic Forge at `/relic-forge/`; `vercel.json` build step | A file-hash diff proves Vault's served files are identical; the demo is visibly labelled. |

## 7. Test strategy

- **Unit (node:test):** every pure function in phases 2–6, with hand-built boards and fixed RNG stubs.
- **Golden traces:** `tools/relicforge-replay.js` output for ~20 seeds, committed. Any change to a trace requires
  an `ENGINE_VERSION` bump (the Vault rule, applied here too).
- **Platform (vitest):** isolation (Relic Forge next to Vault and `echo-test`), choice validation, meter
  persistence and races, cap, replay and export of a full bonus.
- **Statistical:** the phase-7 reports and a reduced CI job (e.g. 5M base + 200k bonuses) beside Vault's
  `rtp-parity`.
- **Browser:** the phase-8 probes, added to `test:client` once stable.

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Equal-EV table cost and convergence (carried state) | Phase 6/7 slip; equality only approximate | Bucketed carried state, adversarial bound, the fallbacks in §4. |
| Hitting 28% hit frequency, the 55/45 split and 1/180 together with cluster pays, specials and the meter | Many tuning rounds | Tune in order: weights → hit frequency → base RTP → meter fill → bonus scalers; automate a sweep. |
| Cathedral (8 rows, 4 premiums) and Singularity can push wins toward the cap | Cap-hit frequency too high | Set a cap-hit target (open question 4), tune its relic bonus factor, report cap hits per path. |
| Persistent meter liability and advantage play | Operator questions; dormant value | Per-bet storage, disclosure, `rules_hash` reset policy, operator-visible meter report. |
| Two sessions for one player share a meter | Double spend of a meter trigger | Version check plus `METER_BUSY`. |
| Client scope (new renderer) | Phase 8 is the largest | Reuse patterns, not Vault's 365 KB file; probes from day one. |
| Vercel build step changes Vault's deploy | Vault demo regression | Hash-diff gate in phase 9. |

## 9. Open questions (blocking before phase 2 unless noted)

1. **A1 — special-cleared cells pay as clusters per type (5+)?** Or specials only reshape the board?
2. **A3 — Meltdown fires unowned relics at Lv1**, or owned relics only?
3. **A4 — Line Burst doubles the running Mult from that step on**, or only that step's pay?
4. **Max-win frequency target:** for example, the 10,000× cap hit at most once in 5M spins?
5. **Equal-EV tolerances:** per state |ΔEV| ≤ max(2% of U, 3·SE), and adversarial-policy RTP gain
   ≤ 0.10 pp. OK?
6. **A5 — no feature buy and no ante** for Relic Forge? (A buy needs its own RTP and its own EV analysis.)
7. **A6 — bet levels as Vault's** (0.20 … 500)? (Not blocking until phase 5.)
8. **Art and audio:** CC0 sourcing through the existing `art-src` / `build-audio` pipeline? (Not blocking until
   phase 8.)
