# Animation Guide — Vault 20K (v9)

The motion language of the Vault 20K client: rigid "heavy metal" bodies, light instead of
camera movement, and one gravity for every falling symbol. All tunables are named constants near
the top of `client/main.js`; the renderer is `ReelCanvasRenderer` (canvas, not DOM).

## House rules (non-negotiable)

1. **Presentation only.** The client animates what the engine already resolved; it never feeds
   data back, uses `Math.random()` for visuals only, and never touches `SlotEngine.RNG`.
   `client/engine/` is never edited for presentation work.
2. **No screen or board shake. Ever.** Weight is conveyed by local light (glints, blooms),
   particles and audio. Verified per frame by probes (board box must stay 0px still).
3. **No upward wind-up.** When a spin starts, gravity takes over at once; nothing moves up first.
4. **No jelly.** Symbols are rigid in flight; the only deformation is a short impact squash (≤ 3.5%, scaled by impact speed) that springs back during the landing bounce.
5. **60fps without GC spikes.** Pooled particles (`ShardEmitter`, struct-of-arrays, time-based
   with ≤8ms sub-steps), cached symbol sprites (`SPRITE_BAND`), throttles just below vsync
   multiples (`TIER_PROFILES`).
6. **Reduced motion** (`prefers-reduced-motion`) drops the landing bounce and squash (symbols still fall, and stop dead), breath, idle breathing and punch-ins.

## The spin, symbol by symbol

| Phase | What happens | Constants |
|-------|--------------|-----------|
| Spin-out | The old board falls out of the bottom on its own layer (`fx.exit`), reel by reel 75ms apart, each reel as one stack under gravity from rest: nothing moves up first. The round's result is requested at the press, and the new board's reel k is released 75ms·k after it arrives, straight behind the old reel k: the two fall together like one continuous strip, so the board is never empty between spins. A fast-stop runs the old board's fall 6× faster. | `dropOff`, `drawExitBoard`, `WATERFALL.spinColMs`, `EXIT_FAST` |
| Drop-in | **One gravity** for every drop: a drop's duration is the time a full-reel (5-row) fall takes (360ms), g = 2·rows / duration², so a fall of d rows takes duration·√(d / rows) and covers s = ½·g·t² from rest. A reel's symbols are released together, so symbols that fall as far travel and land together: on a spin each reel lands as one stack; on a tumble the shorter falls (lower symbols) land first. Tumble refills release reels 22ms apart. | `GRAVITY`, `WATERFALL`, `dropTravel`, `cellFallMs` |
| Landing bounce | A real collision: the symbol hits its slot at v = g·t and rebounds at e·v (restitution e = 0.18), rising e²·d (3.2% of its fall: ~17% of a row after a full-reel drop, ~3% after a one-row refill) and falling back in 2e·t under the same gravity, then it rests exactly in its slot. Impact comes at 1/(1 + 2e) of a symbol's motion for every fall, so thuds, glints and reveals are timed to it. | `GRAVITY.restitution`, `REEL_PROFILE` |
| Landing | On impact: a squash planted on the floor (3.5% for a full-reel fall, scaled by impact speed ∝ √distance), springing back over the first 45% of the bounce; a steel hairline + a laser glint across the floor seams of the symbols that landed, and one metallic tick and the reel's `reel_stop` thud per stack. No motion blur or ghost trails. | `GRAVITY.squash`, `MOTION.squashRelax`, `landingGlints`, `landingTicks` |
| Mask | Symbols in flight are clipped to the grid: they appear exactly as they cross into row 0 and vanish at the bottom edge. New symbols wait fully above the mask. | `REEL_MASK` |
| Idle | While the board rests every symbol breathes 0–1.5px **above** its slot over a 3s sine, each on its own random phase. A spin settles it straight down in 90ms (never a lift before the drop); it eases back in over 700ms once idle. | `IDLE_BREATH`, `MOTION.idleFloat`, `breathOffset`, `isIdle` |
| Win | The caught cluster holds and breathes. **Win focus:** over 250ms everything outside it steps back to 60% opacity and the backdrop darkens, and stays so through the blast until the refill (or the next spin) brings the board back up over 260ms. Then it **shatters**: each symbol swells 14% as it fades (a pop, never a squash), cell flare, gem/gold/steel fragments and sparks burst from the cluster centre. A cluster of 8+ also sends a shockwave from its centre: a thin ring whose front lights each symbol it passes (light only, nothing moves), plus pooled dust puffs radiating from the cluster's rim (≤ 256 alive). | `MOTION`, `FOCUS`, `SHATTER`, `CLUSTER_BLAST` |
| Tumble | For 30ms the neighbours lean into the cleared cells (symbols above dip, same-row neighbours lean sideways), then the refill drops. Each tumble in a chain is 15% faster (floor 50%). | `VACUUM`, `TUMBLE_MOMENTUM` |
| Multiplier BANG | A landing multiplier: thud, local bloom (~2 cells), spotlight flash. No board movement. | `spawnHeavyImpact` |
| Multiplier flight | A caught multiplier detaches and flies to the HUD (bonus Total Multiplier badge, else the ticker) on a cubic Bézier: it rises off the board, then is drawn in from above. Position follows arc length with d = t² (from rest, ever faster: magnetism). A pooled glow trail (≤ 512 particles, one canvas, additive) is laid along the path per pixel travelled; sparks ring the HUD on arrival and the value pops (scale + glow) in the soul layer. The HUD only glows, never moves. In the bonus the Total Multiplier badge starts **empty** (no "1x": laid out but invisible) and fades in with the first catch, compounding at once as each soul lands (carry + this spin). | `SOUL_FLIGHT`, `soulPath`, `SoulTrails`, `setBadgeMultiplier` |
| Scatters | Each landing scatter pings (rising pitch) with a laser reticle; on a near trigger the remaining reels hold and fall slower with a drone and red lanes (anticipation). Every board is RNG-natural (the engine fabricates no near-misses), so anticipation always reflects a real chance. | `ANTICIPATION`, `findAnticipation` |
| Fast-stop | A skip zips every airborne reel into place left to right by 110ms, then a double click. The old board, if still falling out, falls 6× faster. Reels already landed never thud twice. | `FAST_ZIP`, `EXIT_FAST` |
| Big win | ≥10× opens the full-screen overlay (`client/big-win.js`): VAULT CRACKED (10×), LASER BREACH (25×), MOTHERLODE (50×), MAX WIN. Tap skips the count, tap again dismisses. | `WIN_TIERS` |

## Pacing

- `ANIMATION_TIMING` holds the base budgets (spin-out, drop-in and tumble drop all 360ms: one gravity; explode 380ms,
  first catch hold 300ms, chained 220ms). The burst's lead-in is `PACING` (charge 0/80/150ms by strength, great-win sweep 6ms per symbol); the refill falls as soon as the burst's symbols are gone (`BLAST_GONE`), under the flying shards. A multiplier on the opening board gets a 120ms beat before its catch, and a drop settles on its last landing or last reveal-pop, whichever is later. Turbo (`TURBO_SCALE` 0.77) scales every animated duration and hold: about 1.3× the pace, still readable. A renderer method that turbo-scales its own duration waits it with `holdReal` (animationSleep would scale it twice).
- Autoplay waits a fixed `AUTOPLAY_GAP_MS` (500ms, not turbo-scaled) between rounds.
- A manual press within `SPIN_SETTLE_GUARD_MS` (250ms) of a round settling is treated as a late
  skip, not a new paid spin.

## Verifying motion changes

`npm run test:client` (spin-lock, layout-check, spin-e2e) must pass. Motion itself is checked
with headless-Chrome CDP probes that freeze time and render frames (curve sampling, landing
order, mask leaks, board stillness); see `CHECKPOINT.md` for where they live.

## Source of truth

`client/main.js` (renderer + constants), `client/big-win.js` (overlay), `client/styles.css`.
