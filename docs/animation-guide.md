# Animation Guide — Vault 20K (v9)

The motion language of the Vault 20K client: rigid "heavy metal" bodies, light instead of
camera movement, and every symbol moving on its own clock. All tunables are named constants near
the top of `client/main.js`; the renderer is `ReelCanvasRenderer` (canvas, not DOM).

## House rules (non-negotiable)

1. **Presentation only.** The client animates what the engine already resolved; it never feeds
   data back, uses `Math.random()` for visuals only, and never touches `SlotEngine.RNG`.
   `client/engine/` is never edited for presentation work.
2. **No screen or board shake. Ever.** Weight is conveyed by local light (glints, blooms),
   particles and audio. Verified per frame by probes (board box must stay 0px still).
3. **No upward wind-up.** When a spin starts, gravity takes over at once; nothing moves up first.
4. **No jelly.** Deformation is at most a 1–2% contact squash that never rebounds past 1.
5. **60fps without GC spikes.** Pooled particles (`ShardEmitter`, struct-of-arrays, time-based
   with ≤8ms sub-steps), cached symbol sprites (`SPRITE_BAND`), throttles just below vsync
   multiples (`TIER_PROFILES`).
6. **Reduced motion** (`prefers-reduced-motion`) drops squash, breath, motion blur, the lock spring (symbols lock hard on contact) and punch-ins.

## The spin, symbol by symbol

| Phase | What happens | Constants |
|-------|--------------|-----------|
| Spin-out | The old board falls out at once, purely downward: bottom symbol of each reel first, reels left to right at half the drop-in stagger. Each symbol launches at its reel group's speed. | `WATERFALL.exitScale`, `REEL_INERTIA[].exitV0` |
| Drop-in | Reels release left → right 80ms apart; inside a reel the **bottom** symbol drops first and each one above follows 18ms later, so symbols land one by one (a "rat-a-tat"). Every symbol has its own release, its own fall time (√distance) and its own physics: it falls from rest under constant acceleration (s = (t/contact)²) and is still accelerating when it hits its slot. | `WATERFALL`, `FALL_SCALE_MIN`, `dropTravel` |
| Reel groups | Reels 1–2 *heavy* (full fall, loosest spring, overshoot ≤ 6% of a row), 3–4 *tension* (10% quicker, stiffer, ≤ 4%), 5–6 *snap* (18% quicker, stiff and well damped: a ≤ 1.5% gear detent). Each group has its own `friction` (share of impact speed the slot absorbs), `tension` (Ω) and `damping` (ζ). `inertiaLag()` delays lighter reels so landings stay on an even beat. | `REEL_INERTIA` |
| Landing | While falling a symbol stretches with its speed (up to 2% at impact, volume-preserving). On contact: a squash planted on the floor (up to 1–2%, scaled by impact speed: a one-row refill gets ~45%) and a damped-spring lock (y = A·e^(−ζΩu)·sin(Ω_d·u)·(1 − u³), A from the impact speed after friction, capped at `maxOver`): it passes its slot by a few pixels, springs back by a fraction of that, and rests exactly in its slot when the fall time ends; a steel hairline + a laser glint sweeping across the symbol's floor seam, and a short metallic tick whose pitch climbs up the reel. The reel's `reel_stop` thud accents its **last** symbol. | `REEL_INERTIA`, `dropTravel`, `landingGlints`, `landingTicks` |
| Motion blur | Any symbol moving faster than 6px per frame (spin-out, drop-in, zip) draws two fading ghosts back along its path, one frame of travel apart (capped at 35% of the symbol), their opacity rising with speed. One ghost on the low tier. A slow or locked symbol is drawn sharp. | `MOTION_BLUR`, `cellVelocity`, `motionBlur` |
| Mask | Symbols in flight are clipped to the grid: they appear exactly as they cross into row 0 and vanish at the bottom edge. New symbols wait fully above the mask. | `REEL_MASK` |
| Win | The caught cluster holds and breathes (spotlight dims the rest), then **shatters**: each symbol swells 14% as it fades (a pop, never a squash), cell flare, gem/gold/steel fragments and sparks burst from the cluster centre. A cluster of 8+ also sends a shockwave from its centre: a thin ring whose front lights each symbol it passes (light only, nothing moves), plus pooled dust puffs radiating from the cluster's rim (≤ 256 alive). | `MOTION`, `SHATTER`, `CLUSTER_BLAST` |
| Tumble | For 30ms the neighbours lean into the cleared cells (symbols above dip, same-row neighbours lean sideways), then the refill drops. Each tumble in a chain is 15% faster (floor 50%). | `VACUUM`, `TUMBLE_MOMENTUM` |
| Multiplier BANG | A landing multiplier: thud, local bloom (~2 cells), spotlight flash. No board movement. | `spawnHeavyImpact` |
| Scatters | Each landing scatter pings (rising pitch) with a laser reticle; on a near trigger the remaining reels hold and fall slower with a drone and red lanes (anticipation). Every board is RNG-natural (the engine fabricates no near-misses), so anticipation always reflects a real chance. | `ANTICIPATION`, `findAnticipation` |
| Fast-stop | A skip zips every airborne reel into place left to right by 110ms (with the same velocity motion blur), then a double click. Reels already landed never thud twice. | `FAST_ZIP` |
| Big win | ≥10× opens the full-screen overlay (`client/big-win.js`): VAULT CRACKED (10×), LASER BREACH (25×), MOTHERLODE (50×), MAX WIN. Tap skips the count, tap again dismisses. | `WIN_TIERS` |

## Pacing

- `ANIMATION_TIMING` holds the base budgets (drop-in 520ms, tumble drop 380ms, explode 380ms,
  first catch hold 1100ms, chained 700ms). Turbo scales every animated duration to 40%.
- Autoplay waits a fixed `AUTOPLAY_GAP_MS` (500ms, not turbo-scaled) between rounds.
- A manual press within `SPIN_SETTLE_GUARD_MS` (250ms) of a round settling is treated as a late
  skip, not a new paid spin.

## Verifying motion changes

`npm run test:client` (spin-lock, layout-check, spin-e2e) must pass. Motion itself is checked
with headless-Chrome CDP probes that freeze time and render frames (curve sampling, landing
order, mask leaks, board stillness); see `CHECKPOINT.md` for where they live.

## Source of truth

`client/main.js` (renderer + constants), `client/big-win.js` (overlay), `client/styles.css`.
