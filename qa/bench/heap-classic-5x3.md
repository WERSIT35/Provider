# classic-5x3: heap over 1,000 spins

`BENCH_GAME=classic-5x3 npm run bench:client -- --mode soak --spins 1000 --snapshots <dir>` (turbo, no throttling; heap after a forced GC; snapshots at spins 100 and 999), then `node tools/bench/heap-diff.cjs`.

| spin | 25 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 1000 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| V8 heap MB | 1.17 | 1.2 | 1.23 | 1.24 | 1.24 | 1.24 | 1.25 | 1.26 | 1.27 | 1.27 | 1.3 |
| DOM nodes | 266 | 266 | 269 | 269 | 269 | 269 | 269 | 269 | 269 | 269 | 271 |

```
by category (self size, KB):
  native:blink             1033 ->   1679      646
  code                      321 ->    376       55
  string                    121 ->    136       16
  native:v8-internal        576 ->    589       13
  concatenated string         3 ->     10        7
  object                     19 ->     22        3
  array                     109 ->    111        2
  object shape              147 ->    148        1
  number                      6 ->      6        0
  closure                    69 ->     70        0
  synthetic                   0 ->      0        0
  symbol                      0 ->      0        0
  regexp                      0 ->      0        0

live JS objects: 0.486 MB -> 0.515 MB (6.0%); biggest growth:
     358 objs     7.0 KB  concatenated string:(concatenated string)
     120 objs     5.6 KB  string:stop (pptr:internal:3:4427)     at 
     120 objs     5.2 KB  string:Error: Polling stopped     at T.
     120 objs     2.8 KB  object:Error
       9 objs     2.4 KB  string:(async (poller) => {                     await poller.stop();         
     120 objs     2.3 KB  string::2:34
     119 objs     1.9 KB  array:
       8 objs     0.3 KB  object shape:system / Map
       6 objs     0.2 KB  object shape:system / DescriptorArray
       1 objs     0.1 KB  array:(object elements)
       9 objs     0.1 KB  number:heap number
       5 objs     0.1 KB  object:Object
```

The game keeps no growing structure. The growth is compiled code (V8 tiering) plus puppeteer's own polling leftovers (`Error: Polling stopped`) and console strings; Blink native memory is the DevTools network records. Literal gate (total V8 heap within ±5% over the run): +8.3% from spin 100, so FAIL.
