# Performance baseline — Step 0

Measured 2026-10-16 on `main` @ `803d3e2`. No product code was changed. Every number below comes from a run; nothing is estimated. Re-run any row with `tools/bench` (`tools/bench/README.md`); the raw results are in `qa/bench/*.json`.

> **Correction (same day).** The first client run used players with no sandbox balance, so every spin was declined (`402 INSUFFICIENT_FUNDS`) and the reels never moved. That made FPS, input delay and memory look far better than they are. The client spin metrics below were re-measured with funded players through `tools/bench/client.mjs`. Load time, bytes and every server number were unaffected.

## Verdict

| Target | Measured | Result |
|---|---|---|
| First spin ≤ 2.5 s on 4G | Playable at **9.4 s** (FCP 4.1 s), Slow-4G + 4× CPU | **FAIL** |
| Initial download ≤ 3 MB | **1.0 MB** before playable · 3.5 MB per session incl. music | PASS (initial) |
| Locked 60 FPS | **15 FPS avg**, 35% of frames > 50 ms (4× CPU) · 18 FPS unthrottled (software rendering, see limits) | **FAIL** |
| Zero memory growth | JS heap **+0.77 MB over 475 spins** after forced GC (≈1.7 KB/spin); DOM nodes and listeners flat | **FAIL** (small) |
| Input response ≤ 100 ms | Tap → spin request **226 ms**; input event p50 **328 ms**, max 1,520 ms (4× CPU) | **FAIL** |
| Spin p99 ≤ 50 ms at 500 players, excl. casino wallet | In-memory **17.8 ms** · Postgres **83.9 ms** · Postgres + wallet calls **294.6 ms** | **FAIL** (prod config) |
| 500 players, no errors | 0 errors in every config (60 s runs) | PASS (short run) |
| No lost/duplicated rounds on kill -9 | **642 acknowledged rounds lost**, **779 casino debits with no round and no refund**, 0 duplicates | **FAIL** |

**4 critical defects found** (below). They outrank every performance target. Plus one player-facing bug: a normal tap sometimes starts **infinite autoplay** (client section).

## Critical defects (fix before any casino traffic)

1. **The production server never calls the casino's wallet.** `src/server.ts` builds the container without `walletFactory`, so it uses `SandboxWallet` (balances held by us). `WebhookWallet` is only wired in tests and `scripts/seed-demo-operator.ts`. A real casino integration would never be debited or credited.
2. **Every restart poisons the write queue.** On boot the signing keyring re-enqueues its key row. The `signing_keys` write-once trigger rejects it, the whole batch rolls back and is re-queued (`persistence.ts` `flush()`), and the server still answers **200**. Reproduced with the real `dist/server.js`: the second boot on the same DB logs `persistence_flush_failed` / `signing key material is write-once` on every request. In the crash test this happened 134 times.
3. **Concurrent flushes deadlock in Postgres.** 3 `deadlock detected` errors were logged in the crash test. Each one rolls back a batch of rounds the player was already shown.
4. **Memory grows forever.** Every round, transaction and audit row stays in memory (no eviction in `memory-repositories.ts`), and `hydrate` reloads the full history on boot. Measured ≈7.5 KB per round. At 500 real players (155 spins/s) that's ≈4 GB per hour, so a 2 GB droplet runs out of memory in under 30 minutes.

## Server

Setup: compiled `dist/`, real Fastify app, `info` JSON logging, Ed25519-signed ledger. The server process is pinned to **1 core** (Node is single-threaded). The load generator, Postgres and mock casino share the other core. Players are launched through the signed operator API and spin with real session tokens. "Real" = 2–4 s think time between spins.

| Config | Players | Spins/s | p50 ms | p95 ms | p99 ms | Max ms | Errors | Server RSS |
|---|---|---|---|---|---|---|---|---|
| In-memory, sandbox wallet | 50 | 15.6 | 3.5 | 7.2 | 11.0 | 29 | 0 | 110 MB |
| | 200 | 62.6 | 2.9 | 6.3 | 14.4 | 38 | 0 | 128 MB |
| | 500 | 155.4 | 2.4 | 7.1 | 17.8 | 47 | 0 | 164 MB |
| Postgres, sandbox wallet | 500 | 154.5 | 13.8 | 52.4 | 83.9 | 151 | 0 | 210 MB |
| Postgres + wallet calls (casino answers in 0 ms) | 50 | 15.6 | 11.4 | 23.5 | 40.3 | 72 | 0 | 143 MB |
| | 200 | 62.0 | 10.9 | 35.4 | 81.3 | 199 | 0 | 212 MB |
| | 500 | 154.5 | 13.4 | 82.5 | 294.6 | 590 | 0 | 336 MB |

**Ceiling (no think time, server core at ~95%):**

| Config | Max spins/s | Bottleneck |
|---|---|---|
| In-memory, sandbox wallet | **1,058** | Node CPU |
| Wallet calls, no DB | **344** | HTTP wallet round-trips on the event loop |
| Postgres, no wallet calls | **322** | DB writes (Node at 65% CPU) |

**Spin path cost (microbenchmarks, 1 core):** engine resolve **0.19 ms**, ledger signature **0.046 ms** per row. The engine isn't the problem. HTTP wallet calls and DB writes are.

**Chaos test:** 200 players with 0.2–0.6 s think time, Postgres + wallet calls, kill -9 three times 20 s apart, restart, 45 s for the debit reconciler, then a comparison of the casino's ledger with ours.

| Check | Result |
|---|---|
| Rounds shown to players (HTTP 200) | 14,267 |
| Of those, missing from our DB | **642** |
| Casino debits with no round and no rollback | **779** |
| Duplicate round refs / double debits / double credits | 0 / 0 / 0 |

## Client

Setup: the real `/play` page with a signed launch token and a **funded** player. Phone viewport is 412×823 @1.75x. "Mobile" = Lighthouse Slow-4G values (562.5 ms latency, 1.47 Mbps down) plus 4× CPU slowdown, 20 manual spins. "Soak" = no throttling, turbo on, 500 manual spins. Cache disabled, 300 ms human pause before each tap. The client picked its `perf-low perf-handheld` quality tier in both.

| Metric | Mobile (Slow 4G, 4× CPU) | Soak (unthrottled) |
|---|---|---|
| First contentful paint | 3.8 s | 0.2 s |
| Playable (`app-ready`) | **9.4 s** | 0.5 s |
| Downloaded before playable | 1.0 MB, 47 requests | 1.0 MB |
| Downloaded per session | 3.5 MB (2.6 MB is music) | 4.8 MB (music + free-spins assets) |
| Tap → spin request sent | 226 ms | 194 ms |
| Input event duration p50 / max | 328 / 1,520 ms | 280 / 1,464 ms |
| Avg FPS during play | 14.9 | 17.6 |
| Frames > 50 ms | 35.5% | 30.1% |
| Long tasks | 37, max 172 ms | 15, max 329 ms |
| Round time p50 (tap → board settled) | 2.4 s | 1.2 s (turbo) |

**Memory soak (500 spins, forced GC before each sample):** heap 2.73 MB at spin 25, then 2.95 → 3.03 → 3.10 → 3.15 → 3.50 MB at 100/200/300/400/500. DOM nodes held at ~1,660 and listeners at 85. It's a slow, steady leak in JS objects, not in DOM.

**A tap can start infinite autoplay.** The spin button decides "hold = autoplay" with a 400 ms `setTimeout` (`SPIN_HOLD_MS`, `client/main.js`). When the main thread is busy for a long frame between finger-down and finger-up, the timer fires first and a normal tap becomes endless turbo autoplay. Seen on **8 of 500 taps (1.6%)** in the soak. On a weak phone it's worse. Players would see the game spinning their money on its own.

**Where the bytes go:** `main.js` 348 KB, `styles.css` 122 KB, symbols 268 KB, fonts 76 KB. Then, right after boot, the music: `free_spins.ogg` 754 KB, `base.ogg` 684 KB, `big_win.ogg` 316 KB, all fetched and decoded eagerly even though most sessions never reach free spins or a big win. JS+CSS is 608 KB raw / 184 KB gzipped. Production Caddy gzips (`encode gzip`), the platform alone does not, so the text sizes above are worst case.

**Also seen:** a press within 250 ms after a round settles is dropped silently (`SPIN_SETTLE_GUARD_MS`). This is intended, but a fast player taps and nothing happens.

## Limits of this baseline (read before quoting numbers)

- **Hardware:** 2 vCPU / 8 GB cloud VM, not a DigitalOcean droplet. RAM was not capped at 2 GB, so the memory figures are growth rates, not OOM points.
- **Network:** loopback. Real wallet calls add the casino's own latency on top.
- **Mobile:** headless Chromium 153 with **software rendering** (SwiftShader) on a server CPU. Even unthrottled it renders far slower than a phone GPU would, so the absolute FPS and input numbers are pessimistic. They're a same-machine baseline: Phase 4 re-runs the identical probe and must beat them.
- **Not measured yet:** the Lighthouse score (CDP throttling was used with Lighthouse's values instead), FPS during a forced big win (no way to force one on `/play`), and 1,000-spin memory (500 run).
- The harness is committed in `tools/bench/` (Phase 0), so every row can be re-run.

## Priority order for Step 1

1. Wire `WebhookWallet` in `server.ts` and fix the restart write-poison (don't re-enqueue an existing key; drop or quarantine rows the DB rejects instead of re-queuing them forever).
2. Make an acknowledged round durable: commit before responding, one writer per session (no cross-request deadlocks), and have the reconciler roll back any casino debit with no round.
3. Bound memory: keep only open sessions/rounds in memory, read history from Postgres, and stop hydrating all of history on boot.
4. Then latency: wallet calls with keep-alive pooling and a timeout budget, batched DB writes. Re-run the 500-player table.
5. Client: decide tap vs hold from the input events' own timestamps (not a timer), lazy-load music by game state, stream `base.ogg` only, split `main.js`, find the per-spin heap leak, and cut main-thread work on tap.
