# Platform RNG — certification notes

**Game:** Vault 20K (internal id `bananax`) · **RNG:** `hmac-sha256-ctr/v1` · **Engine:** 1.2.0 · **Date:** 2026-10-05

This document describes the random number generation behind every real-money round the
platform RGS (`platform/`) resolves: where randomness comes from, how seeds are created
and kept, how random bytes become game outcomes, and how any round can be replayed. It
accompanies the RTP reports (`qa/rtp-certification-report*.md`). §8 explains how to produce the
sample for the lab's own battery.

---

## 1. Summary

| Item | Value |
|---|---|
| Generator | HMAC-SHA256 in counter mode, keyed by a per-round seed (`hmac-sha256-ctr/v1`) |
| Seed | 32 bytes from `node:crypto` `randomBytes` (OpenSSL CSPRNG, OS-seeded), fresh for **every** round |
| Seed visibility | stored on the round record after the round resolves; never sent to the player or the game client |
| Draws per round | paid spin median 496 bytes (max observed 1,176); bought feature median 528 bytes (2,000 / 200 rounds measured) |
| Integer mapping | 32-bit rejection sampling (unbiased) |
| Float mapping | 53-bit, uniform on [0, 1) |
| Replay | seed + pre-spin state + engine version + rules hash reproduce the outcome bit for bit, verified against the stored outcome hash |
| Internal battery | 27 / 27 PASS (§7) |

## 2. Where randomness comes from

There is exactly one implementation of the slot math: `client/engine/*.js`. The browser
client, the RGS and the RTP tooling load the same files in the same order. All of the
engine's randomness goes through one function, `globalThis.crypto.getRandomValues`, inside
`client/engine/rng.js`. No engine file uses `Math.random`. `Math.random` appears only in
`ambiance.js`, which draws decorative background particles and has no effect on outcomes.

In the RGS, `platform/src/lib/seeded-rng.ts` installs a wrapper as `globalThis.crypto`
**before** the engine loads (`engine-loader.ts`), so the engine captures the wrapper:

- **Armed** (only inside `withSeed(seed, fn)`): `getRandomValues` fills from the seeded
  stream of §3.
- **Disarmed** (at all other times): it delegates to the real Web Crypto CSPRNG.

When the game runs inside a casino (`/play`), the game client resolves nothing: every
round is resolved on the server, and the client only animates the result it receives.
Visual effects are a pure function of that result and never feed back into it.

## 3. The generator: `hmac-sha256-ctr/v1`

```
block_i = HMAC-SHA256(key = seed (32 bytes), message = uint64_le(i))     i = 0, 1, 2, …
stream  = block_0 || block_1 || block_2 || …                             (32 bytes per block)
```

Bytes are consumed strictly in order, whatever the size of each `getRandomValues` request.
A request that straddles a block boundary continues into the next block. The stream is
therefore a pure function of the seed (`SeededStream` in `seeded-rng.ts`).

**Why this construction.** HMAC-SHA256 is a pseudo-random function: with a secret,
uniformly random key, its outputs on distinct inputs cannot be told apart from random by
any known method. The inputs here are distinct by construction, because the counter never
repeats under a key. The counter is 64-bit (2^64 blocks); a round draws about 15 to 37
blocks. A key (seed) is used for exactly one round.

**Known-answer vector** (also asserted by `platform/test/rng-stream.test.ts` and `npm run rng:stats`):

```
seed     = 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
block_0  = 9f0cd9b94097fe4929918d2b8942b34439574261a35dc50163f06c67d4e48899
block_1  = 3b345d4e3f7a9922d8942f7c4f9c46a36307684beb1c02f98dba9327be8e1617
```

## 4. Seed management

| Property | How it holds |
|---|---|
| **Source** | `generateSeed()` = `randomBytes(32)`, Node's OpenSSL CSPRNG seeded by the operating system. The seeded stream is never used to make a seed. |
| **One per round** | `AuthoritativeResolver.resolve` / `resolveBuy` draws a new seed for each round. Seeds are never reused or derived from one another. Each free spin of a bonus is its own round with its own seed. |
| **Unpredictable when it matters** | The seed is drawn at resolution time, **after** the stake is debited and the bet is fixed. Neither the player, the client nor the operator supplies or influences it. |
| **Recorded** | `rng_seed_hex`, `rng_algo` and `rng_bytes_drawn` are stored on the round, which is in the append-only, hash-chained round ledger (`round-ledger.service.ts`, `hash-chain.ts`). |
| **Disclosure** | Readable only through the Admin API round detail (`GET /admin/v1/rounds/:ref`, permission `rounds.read`, tenant-scoped: an operator sees only its own rounds), and only after the round exists. The Game API (player / client) never returns a seed. Knowing a past seed reveals nothing about any other round, because seeds are independent CSPRNG draws. |

## 5. Isolation and concurrency

- A round is resolved **synchronously**: `withSeed` arms the stream, runs `engine.spin` or
  `engine.buyFreeSpins`, and disarms, with no `await` in between. On Node's single thread,
  no other request can draw from the stream while it is armed.
- Nested seeding throws (`no nested seeding`). An exception inside the round disarms
  before it propagates, so the next caller always starts disarmed (both asserted in
  `test/rng-stream.test.ts`).
- `rng_bytes_drawn` is the exact number of seeded bytes the round consumed, so a replay can
  confirm it drew the same amount.

## 6. From bytes to game outcomes (`client/engine/rng.js`)

| Function | Construction | Bias |
|---|---|---|
| `randomInt(n)` | Draw a uint32 `x`. Accept if `x < 2^32 − (2^32 mod n)`, return `x mod n`; else draw again. | None (rejection sampling) |
| `randomFloat()` | Two uint32 draws: `((a >>> 5)·2^26 + (b >>> 6)) / 2^53`. | Uniform on the 2^53 grid in [0, 1) |
| `weightedPick(items, w)` | `r = randomFloat() · Σw`; walk the items, subtracting each weight; return the first item where `r ≤ 0`. | Each item's probability is exact up to the 2^-53 float grid |
| `uuid()` | 16 drawn bytes, RFC 4122 v4 bits | n/a (identifiers, also reproducible) |

The engine uses these for every outcome: symbol choices (`symbols.js`
`weightedRegularSymbol`, weighted by the active RTP profile), multiplier values
(`multipliers.js`), scatter and multiplier placement (`matrix.js`, `randomInt` over rows
and columns), tumble refills (`tumble.js`), and the trigger roll in `crazy-mode.js` (not
offered to players in the RGS). Reel weights and pays are the profile values certified
in the RTP reports.

**Observation, no action taken.** `weightedPick` returns the first item whose running
remainder reaches `r ≤ 0`. If `randomFloat()` returns exactly 0 (probability 2^-53 per
call) and the first item has weight 0, that zero-weight item is returned. No shipped table
puts a zero weight first:
- symbol weights default a missing weight to 1;
- the multiplier table has no zero weights.

So this cannot occur with the certified configuration. Changing it (`r < 0`) would alter
what some seeds resolve to, which requires an `ENGINE_VERSION` bump and a new RTP run. It
is therefore left for the next engine release.

## 7. Internal statistical validation

`npm run rng:stats` (in `platform/`) runs every draw through the production path: CSPRNG
seeds, `withSeed`, and the real `client/engine/rng.js`. Each p-value must lie in
[10^-4, 1 − 10^-4]; the upper bound also rejects a fit that is suspiciously perfect.
`test/rng-stream.test.ts` checks that the statistics agree with published chi-square
critical values, and that the battery **rejects** deliberately broken streams: a
2%-biased byte, extra ones, and an alternating-bit pattern that only the runs test catches.

Run of 2026-10-05 (32 MiB per stream test, 146 s):

| Section | Test | n | statistic | df | p | result |
|---|---|---:|---:|---:|---:|---|
| A1 stream, per-round seeds (1 KiB/seed) | byte frequency | 33,554,432 | 257.92 | 255 | 0.4371 | PASS |
| A1 | byte × position in HMAC block (32 × 256) | 33,554,432 | 8231.87 | 8160 | 0.2856 | PASS |
| A1 | non-overlapping byte pairs (65 536 bins) | 16,777,216 | 65252.12 | 65535 | 0.7825 | PASS |
| A1 | NIST monobit (SP 800-22 §2.1) | 268,435,456 bits | 0.33 | – | 0.7440 | PASS |
| A1 | NIST runs (SP 800-22 §2.3) | 268,435,456 bits | 134216216 | – | 0.8536 | PASS |
| A2 stream, single seed | byte frequency | 33,554,432 | 216.66 | 255 | 0.9609 | PASS |
| A2 | byte × position in HMAC block (32 × 256) | 33,554,432 | 8020.62 | 8160 | 0.8626 | PASS |
| A2 | non-overlapping byte pairs (65 536 bins) | 16,777,216 | 65450.07 | 65535 | 0.5921 | PASS |
| A2 | NIST monobit | 268,435,456 bits | 0.87 | – | 0.3835 | PASS |
| A2 | NIST runs | 268,435,456 bits | 134208970 | – | 0.2850 | PASS |
| B across seeds | first 16 bits under 1M fresh seeds | 1,000,000 | 65409.84 | 65535 | 0.6346 | PASS |
| C engine mapping | `randomInt(n)` uniformity, n = 2, 3, 5, 6, 7, 10, 13, 30, 100, 1000 | 1,000,000 each | – | n − 1 | 0.045 – 0.829 | PASS (10/10) |
| C | `randomFloat` (1000 bins) | 2,000,000 | 990.56 | 999 | 0.5692 | PASS |
| C | `randomFloat` mean = 0.5 (z-test) | 2,000,000 | −0.83 | – | 0.4055 | PASS |
| C | `randomFloat` within [0, 1) | 2,000,000 | – | – | – | PASS |
| C | `weightedPick`: multiplier table vs its weights | 5,000,000 | 12.85 | 15 | 0.6136 | PASS |
| D determinism | known-answer vector (§3) | – | – | – | – | PASS |
| D | 1000 random seeds replay their stream under different read sizes | – | – | – | – | PASS |

What the sections cover:
- **A2** (one long stream) tests the generator function by itself.
- **A1 and B** test the production shape, a short stream under each fresh seed. B checks
  that different seeds do not produce correlated first draws.
- **"Byte × position"** looks for structure tied to the 32-byte HMAC block boundary.
- **C** tests the mapping, which is where a slot RNG most often goes wrong (modulo bias,
  float truncation).

## 8. Producing the lab sample

```bash
cd platform
npm run rng:dump -- --bytes 1G --out rng.bin                    # production shape: fresh seed per 1 KiB
npm run rng:dump -- --bytes 1G --mode single --out rng1.bin     # one seed, one long stream
npm run rng:dump -- --replay-seeds rng.bin.seeds --bytes 1G --out again.bin   # byte-identical regeneration
```

Each dump writes three files:
- `FILE`: the raw binary stream;
- `FILE.seeds`: the CSPRNG seeds used, 32 bytes each, concatenated;
- `FILE.manifest.json`: the parameters and the SHA-256 of both files.

A replay from the seeds file reproduces the stream exactly (verified: identical SHA-256).
Throughput is about 1.3 MB/s, so 1 GiB takes about 13 minutes.

| Battery | Suggested input |
|---|---|
| Dieharder | `dieharder -a -g 201 -f rng.bin` (file input; supply ≥ 4 GiB to avoid rewinds on the larger tests) |
| NIST SP 800-22 STS | `assess 1000000`, binary file input, 100+ bitstreams (≥ 12.5 MB) |
| TestU01 | Rabbit / Alphabit on the file; Crush / BigCrush need a much larger sample or a direct generator binding |

## 9. Replay and verification

Every round stores the following:
- the seed, `rng_algo` and `rng_bytes_drawn`;
- the pre-spin session state (`pre_state`);
- the `engine_version` and the `rules_hash`;
- the canonical outcome and its `outcome_hash`;
- its link in the round hash chain.

`RoundVerificationService` (Admin API `…/verify`, and the **Verify** button in the Round
Inspector) re-resolves the round from its seed and pre-state on the same code path (spin
or buy), recomputes the hash, and checks the chain. It returns one of three verdicts:

- **legitimate**: both checks pass;
- **tampered**: the outcome or the chain does not match;
- **inconclusive**: the round was resolved by a different engine version or rules
  payload, so it cannot be replayed on the running one. This is why any engine change
  that alters what a seed resolves to must bump `ENGINE_VERSION`.

## 10. Out of scope

- `backend/server.js` (the legacy MVP API) has its own math and RNG and is not a real-money
  path.
- The standalone client without a launch token (demo play) resolves locally with the
  browser's unseeded `crypto.getRandomValues`. It moves no money and records no rounds.
- The operator's wallet, which holds funds and records money moves, is outside the RNG
  boundary.
