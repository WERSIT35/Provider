# Phase 4: heap over 1,000 spins (snapshot evidence)

Bench: `npm run bench:client -- --mode soak --spins 1000 --snapshots <dir>` (turbo, no throttling; heap after a forced GC, every 100 spins; V8 heap snapshots at spins 100 and 999). Diffed with `node tools/bench/heap-diff.cjs spin-100.heapsnapshot spin-999.heapsnapshot` (output below; the snapshots themselves are ~10 MB each and not committed).

## V8 heap (Runtime.getHeapUsage, MB)

| spin | 25 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| MB | 2.33 | 2.73 | 2.91 | 2.99 | 3.04 | 3.1 | 3.15 | 3.22 | 3.26 | 3.29 | 3.29 |
| DOM nodes | 1646 | 1670 | 1667 | 1680 | 1666 | 1671 | 1678 | 1677 | 1666 | 1666 | 1666 |

## What grew between spin 100 and spin 999

```
by category (self size, KB):
  native:blink             3054 ->   4115     1061
  code                     1500 ->   1968      468
  native:v8-internal       1554 ->   1608       55
  string                    181 ->    206       25
  concatenated string         8 ->     20       12
  object                     41 ->     48        6
  object shape              219 ->    225        6
  array                     195 ->    198        3
  number                     43 ->     44        1
  synthetic                   0 ->      0        0
  symbol                      0 ->      0        0
  closure                    86 ->     86        0
  regexp                      0 ->      0        0

live JS objects: 0.792 MB -> 0.847 MB (6.9%); biggest growth:
     612 objs    12.0 KB  concatenated string:(concatenated string)
     203 objs     9.5 KB  string:stop (pptr:internal:3:4427)     at 
     203 objs     8.7 KB  string:Error: Polling stopped     at T.
     203 objs     4.8 KB  object:Error
     203 objs     4.0 KB  string::2:34
     100 objs     3.9 KB  object shape:system / Map
     203 objs     3.2 KB  array:
       9 objs     2.4 KB  string:(async (poller) => {                     await poller.stop();         
      24 objs     1.6 KB  object shape:system / DescriptorArray
      58 objs     1.4 KB  object:Object
      75 objs     0.9 KB  number:heap number
       2 objs     0.4 KB  object shape:system / TransitionArray
```

## Reading it

- **The game's live JS objects are flat.** Of +55 KB, about 30 KB is puppeteer's own polling leftovers (`Error: Polling stopped`, injected by `waitForFunction`) and the rest is the inspector's console strings. No game structure grows; DOM nodes are flat (1,646 to 1,680).
- **Compiled code grows (+468 KB): V8 tiering.** Hot functions are compiled to faster code as they run, and rarer paths (a feature, a big win) get compiled when first hit. This plateaus: +0.9% over the last 200 spins.
- **Blink native memory** (not in the V8 heap figure) grows by DevTools' per-request network records (the bench's instrumentation).
- **The "~2 KB per spin leak"** in docs/perf-baseline.md was mostly the bench itself. Its per-frame log (`window.__bench.frames`, ~40 numbers a spin) lived in the page and was counted as the game's heap, and the inspector kept the client's per-round console line. The bench now moves its log to Node and discards the inspector's console entries before every sample.
