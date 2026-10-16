# Bench suite

Reproducible measurements behind `docs/perf-baseline.md`. Every phase's before/after table comes from these scripts. Each one writes JSON to `qa/bench/<name>.json` (latest) and `qa/bench/runs/` (history, git-ignored).

Build the platform first: `npm --prefix platform run build`. The suite runs the real `platform/dist` app.

| Command | What it measures | Needs |
|---|---|---|
| `npm run bench:load -- --players 500 --duration 60` | Spin latency p50/p95/p99, spins/s, errors, server RSS/CPU for N real players (signed launch → session → spin loop, 2–4 s think time) | — |
| `npm run bench:load -- --matrix` | The full server table from the baseline (sandbox wallet, casino wallet calls, Postgres, ceilings) | Postgres rows: `BENCH_DATABASE_URL` |
| `npm run bench:chaos` | Crash safety: kill -9 x3 under load, restart, then compare the mock casino's ledger with ours. **Exits 1** on any lost acknowledged round, unrefunded debit or duplicate | `BENCH_DATABASE_URL` |
| `npm run bench:client -- --mode mobile` | `/play` on Slow-4G + 4x CPU: time to playable, bytes, FPS, input delay, long tasks | Chrome |
| `npm run bench:client -- --mode soak --spins 1000` | Heap and DOM growth over many spins (forced GC before each sample) | Chrome |
| `npm run bench:micro` | Engine resolve and ledger-row signature cost per call | — |
| `npm run bench:boot -- --seed 1000000` | Fill the bench DB with N real rounds (signed launch → spin, chained and signed), then time restarts: spawn → listening, plus one spin. **Exits 1** if a boot takes ≥ 10 s | `BENCH_DATABASE_URL` |
| `npm run bench:boot` | Time restarts against what the bench DB holds (run it from another branch for a before/after on the same data) | `BENCH_DATABASE_URL` |
| `npm run bench:load -- --players 500 --duration 7200 --wallet webhook --pg` | Soak: RSS per minute and a verdict (last 10 min vs minutes 10–20, flat within ±10%) | `BENCH_DATABASE_URL`; `BENCH_MEM_CGROUP` for a real cap |

## Options

`load.mjs`: `--players`, `--duration` (s), `--think-min` / `--think-max` (ms; `0` = no think time, finds the ceiling), `--wallet sandbox|webhook`, `--pg`.
`chaos.mjs`: `--players` (200), `--kills` (3), `--interval` (s between kills, 18), `--settle` (s for the reconciler, 45).
`client.mjs`: `--mode mobile|soak`, `--spins`, `--pause` (ms before each tap, 300).

## Environment

| Variable | Meaning |
|---|---|
| `BENCH_DATABASE_URL` | Postgres for `--pg` and chaos. **The suite drops and recreates its `public` schema**, so the database name must contain `bench`, e.g. `postgres://bananax:bananax@127.0.0.1:5432/vault20k_bench` (create it once in the `platform/docker-compose.yml` Postgres) |
| `CHROME_PATH` | Chrome/Chromium binary if not in a standard place |
| `CHROME_ARGS` | Extra Chrome flags, space-separated |
| `BENCH_HEADLESS=shell` | When `CHROME_PATH` is a `chrome-headless-shell` build |
| `BENCH_MEM_CGROUP` | Linux cgroup v1 memory group the server joins, e.g. `/sys/fs/cgroup/memory/benchsrv` with `memory.limit_in_bytes` = 2 GB set beforehand: a real 2 GB box |
| `BENCH_PIN=1` | Linux only. Fixed topology: **core 0 = the platform alone; core 1 = load generator, mock casino and a local Postgres**. Every published table uses it, so runs compare like for like |

## Rules for honest numbers

- Players are funded before they spin (sandbox wallet: every bench player gets a balance). A declined spin never animates, so it would fake great FPS and memory numbers.
- The mock casino answers in 0 ms. Wallet latency measured through it is **the platform's own** cost, not the casino's.
- The load generator runs on the same machine. On 2 cores, pin with `BENCH_PIN=1` or the generator steals the server's CPU.
- Headless Chrome on a server CPU renders in software. Client FPS and input numbers compare runs on the **same machine**. They are not phone numbers.
