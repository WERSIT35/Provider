# Glasshouse: RGS integration and crash recovery (Stage 2)

Run 2026-10-18 in a Linux cloud container, local Postgres 16, engine `gh-1.0.0`.

## Crash safety (kill -9 under load)

```
BENCH_GAME=glasshouse BENCH_DATABASE_URL=postgres://…/vault20k_bench node tools/bench/chaos.mjs --players 500
```

500 players spinning against the casino (webhook) wallet; the platform was killed with `kill -9` three times mid-load, restarted, and the debit reconciler swept; then the mock casino's own ledger was compared with ours.

| Check | Result |
|---|---|
| Acknowledged rounds | 63,547 (63,737 in the database) |
| Lost acknowledged rounds | **0** |
| Casino debits with no round and no rollback | **0** |
| Double-debited / double-credited rounds | **0 / 0** |
| Duplicate round refs or acknowledgements | **0** |
| Casino replays answered | 47 |
| Client network errors (during the kills) | 12,971 |
| Verdict | **PASS** |

## The feature state survived every crash

```
BENCH_DATABASE_URL=postgres://…/vault20k_bench node games/glasshouse/tools/feature-continuity.mjs
```

For every free spin in the run, the lit panes and their remaining spins it started from (`pre_state.feature_state`) must equal what the session's previous round ended with (`outcome_jsonb.feature_state`).

| Check | Result |
|---|---|
| Features triggered | 295 |
| Free spins | 2,852 |
| Free spins that started with lit panes carried over | 648 |
| Free spins whose starting state differed from the previous round's end | **0** |
| Verdict | **PASS** |

## Platform tests

- `platform/test/glasshouse.test.ts` (6 tests): rounds through the real orchestrator with beams in the payload and every round verified as legitimate; the 100× buy (charge, exactly 3 roses, feature state); lit panes carried between free spins with the bet locked and a mid-feature reload resuming the same state; seeded replay of a free spin from its pre-state; ante refused and a second buy refused inside the feature before any money moves; the 5,000× cap; the 95 / 94 variants; all four games registered side by side.
- Full platform suite: 386 passed, 5 skipped (the Postgres ones), typecheck clean; the 2 Postgres files (`bounded-memory`, `history-pg`) with `TEST_DATABASE_URL`: 14 passed.

The shared `qa/bench/chaos.json` (Vault 20K's published result) was left unchanged; the Glasshouse figures are recorded here.
