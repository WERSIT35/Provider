# Closing the client gates (Oct 17)

Bench: `tools/bench/client.mjs` on this machine (2 cores, Chromium 153, software GPU). Load = `--mode mobile` (Slow 4G 562 ms / 1.47 Mbps + 4× CPU). Main (`1075284`) and this branch were run **interleaved**, 3 times each, same box, same minute.

## Vault 20K load (target: playable ≤ 2.5 s)

| Run | main: playable | main: FCP | branch: playable | branch: FCP |
|---|---|---|---|---|
| 1 | 4,348 ms | 3,864 ms | 3,378 ms | 2,804 ms |
| 2 | 4,224 ms | 3,720 ms | 3,316 ms | 2,784 ms |
| 3 | 4,347 ms | 3,944 ms | 3,380 ms | 2,980 ms |
| **median** | **4,347 ms** | **3,864 ms** | **3,378 ms (−22%)** | **2,804 ms (−27%)** |

Bytes before playable: 329 → 272 KB, requests 20 → 20.

| Change | Before | After |
|---|---|---|
| Casino's `/play?lt=` URL | 302 to `/play/` (one 562 ms round trip) | served directly, with a real `<base href="/play/">` so the preload scanner resolves the same URLs |
| Fonts (Inter + Oswald) | 47.6 + 28.2 KB, all weights, Latin | 27.4 + 19.0 KB: weights 400–900 / 400–700, the characters the game shows |
| `styles.css` | 30.6 KB (brotli) | 16.1 KB: minified once per edit by the server (esbuild, no syntax lowering) |
| Phone backdrop | 42.2 KB, 768 px | 28.5 KB, 640 px (`sm/Background.webp`, same media query as the phone symbols) |

**Still not met:** 3.4 s vs 2.5 s. What's left is mostly bytes (272 KB at 1.47 Mbps ≈ 1.5 s) and two round trips before the first byte. The next steps are the ones in the program report: lighter board art before the first spin, and the session folded into the HTML.

First-tap-to-request in these runs swung between 1.8 s and 19 s on **both** main and the branch (the box was also building another project), so it isn't compared here.

A first attempt served `/play` without the redirect but relied on the page's own `<base>` script. The preload scanner reads the HTML before scripts run, so 15 preloads went to `/assets/…` (404) and everything loaded twice: 4.6 s vs main's 4.27 s. Caught by this bench, fixed by the server-sent `<base>`, guarded in `test/play-games.test.ts`.

## Heap over 1,300 spins (target: no growth)

`--mode soak --spins 1300 --warmup 300` (turbo, unthrottled, forced GC before each sample). The soak now takes a V8 heap snapshot at the warm-up spin and the last one and splits it by kind.

| | Spin 300 | Spin 1299 | Growth |
|---|---|---|---|
| Game objects (objects, arrays, strings, closures) | 528 KB | 529 KB | **+0.2%** |
| Compiled code | 1,629 KB | 1,847 KB | +218 KB |
| Total V8 heap (`Runtime.getHeapUsage`) | 2.90 MB | 3.15 MB | +8.6% (from spin 25: +34%) |
| DOM nodes / listeners | 1,783 / 88 | 1,789 / 88 | flat |

Total heap per 100 spins: 2.90 → 2.93 → 2.98 → 3.04 → 3.08 → 3.12 → 3.11 → 3.13 → 3.15 → 3.13 → 3.15 MB: the last 500 spins add 0.07 MB.

**Verdict:** the game's own memory is flat. All the remaining growth is code V8 compiles as more paths get hot, and it levels off. Read literally (total heap ±5%), the gate still fails at +8.6%.

Other bench fixes: every in-page read now goes through `Runtime.evaluate` with fixed source text (it was `page.evaluate` / `waitForFunction`, whose poller left objects in the page; see `heap-phase4.md`).

The full soak JSON of this run was overwritten by a later bench run before it was committed. The numbers above are copied from that run's printed summary.
