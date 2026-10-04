# Client probes (headless Chrome over CDP)

Focused verification scripts for the Vault 20K client's motion, audio and UI. Like the other
`tools/` checks they need **no npm dependencies**: each one serves `client/` on a local port,
launches headless Chrome, and drives the real page over the DevTools Protocol.

```bash
node tools/probes/motion-probe.js            # defaults: this repo, output to a temp dir
node tools/probes/mask-probe.js . ./shots    # [repoRoot] [outDir for screenshots]
```

They print `ok` / `FAIL` lines and end with `PROBE: PASS` or a FAIL banner (exit code 1).
The Chrome path is hard-coded to `C:/Program Files/Google/Chrome/Application/chrome.exe`
(the dev machine); the CI-facing checks are the `npm run test:client` tools instead.

| Probe | What it proves |
|-------|----------------|
| `motion-probe.js` | Spin-out never moves a symbol up; bottom-first release; reel-group curves (ease from rest, lock overshoot, 1–2% squash, no rebound); all 30 symbols land one by one bottom-up on schedule (18ms apart); each landing gets its glint + tick; reel thud on the last symbol; √distance fall times; refill ordering; vacuum lean continuity; 15% tumble momentum; fast-stop zip (≤110ms, left to right, double click, motion blur, no bounce); board never moves; shard pool drains. |
| `mask-probe.js` | Freezes time through an opening drop and diffs board-hidden vs board-shown frames: no symbol pixels above row 0 while waiting or entering (3 viewports). |
| `ticker-probe.js` | Ticker state machine: idle → spin → gold WIN held after round end; tip rotation; flash returns to the current line; screenshots. |
| `audio-probe.js` | One thud per reel left to right on the ~80ms stagger, timed to landings; refills thud only on reels that dropped; fast-stop zip thuds each reel exactly once; turbo stagger. |
| `scatter-probe.js` | Scatter pings + live count, anticipation hold/slow-fall + drone + red lanes, Option B suppression of engineered near-misses, skip during anticipation. |
| `input-probe.js` | Tap vs hold, Space bar, modal tabs/focus trap/Esc, ticker tips from the rules file and the held WIN line. |
| `touch-probe.js` | Real touch events on the controls. |
| `bigwin-wiring-probe.js` | Big-win overlay opens at round end with the right tier. |
| `perf-probe.js` | 4× CPU-throttled phone profile: draw() ms, frame cadence per quality tier, GC share, allocations per round. |
| `hit-target-probe.js` | Every control's 44px hit area. **Known pre-existing failure:** autoplay/turbo at 844×390 and 740×360 (hit area extends past the left screen edge). |

Timer-based checks assert the **scheduled** times; headless timers jitter by ±10ms. The first
`Sound.play` in a headless page builds the AudioContext synchronously, so audio probes warm it
first.
