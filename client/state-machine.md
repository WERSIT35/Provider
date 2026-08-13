# Client Spin Lifecycle

Implemented in `client/main.js` + `client/engine/spin-lock.js`. This is the
authority for GitHub #28: **a round is atomic — the next one cannot start until
the current one completes, and that holds in the bonus exactly as in the base
game.**

## The lock (`client/engine/spin-lock.js`)

Three phases, and the lock covers all of them:

| phase | meaning | a press here |
| --- | --- | --- |
| `idle` | nothing in flight | starts a round |
| `starting` | bet locked, board dropping off, round resolving. Result NOT on screen. | latches a fast-stop |
| `animating` | result committed, reels playing it out | requests a fast-stop |

`tryAcquire()` is synchronous and must be called before any `await`, so a rapid
double-tap cannot slip a second round through the network window.

## Who owns the lock

The lock is held for a whole **run**, not per spin, because four different
callers drive rounds and only one of them is a plain manual spin:

| caller | acquires | releases |
| --- | --- | --- |
| manual `spin()` | itself | after the round *and* any bonus it triggered |
| `startAutoplay()` | itself | when the run ends |
| `buyFreeSpins()` | itself, after the confirm | after the bought round *and* its free spins |
| `autoplayBonus()` | only if nobody else holds it (resumed session) | if it acquired |

Autoplay and free spins do **not** acquire per spin — their driving loop already
serializes them and holds the lock throughout.

## The one gate

`isRoundInFlight()` is the single predicate for "may a round start?". It ORs four
signals, because the callers above do not all own the lock at every instant:

```js
spinLock.isLocked()  || // a manual spin or an autoplay run, incl. its network window
state.roundAnimating || // a round being played out by ANY caller
state.autoplayActive || // base autoplay, between its spins
state.bonusAutoplay     // free-spin autoplay, between its spins
```

Every manual press resolves to exactly one of three outcomes:

- **idle** → start a round.
- **in flight** → `requestFastStop()`: accelerate the round already on screen.
  Never starts, never queues. A press during base autoplay additionally cancels
  the run, but the round on screen still finishes.
- **in flight, base autoplay** → as above, plus `stopAutoplay()`.

So at most two presses are ever needed: one to spin, one to speed it up. This
holds during free spins, a bought feature, and a bonus resumed from a saved
session — the three paths where the guard used to be missing or where the press
was silently swallowed.

## Round flow

```text
idle
 └─ press ─► starting (bet locked → dropOff → resolve)
              └─ result ─► animating (tumbles → payout)
                            ├─ no bonus ─────────────────► idle
                            └─ free spins awarded
                                 └─ bonus autoplay (N free spins, retriggers add more)
                                      └─ bonus total shown ─► idle
```

The lock is released only at the end — the bonus is inside the triggering
round's lifetime, not after it.

## Tests

| what | how |
| --- | --- |
| `npm run test:spin-lock` | models the gate in plain Node — phases, rapid taps, bonus/buy/resume/autoplay ownership |
| `npm run test:spin-e2e` | drives the real client in headless Chrome: hammers the spin button through a base round and a whole bought bonus, asserts `startedManual` never increments |
| `npm run test:layout` | the layout invariants (#25/#26/#27) at nine viewports |
| `npm run test:client` | all three |

`window.__spinLifecycle` exposes `{ phase, inFlight, stats }` for the e2e test.
`stats` counts `startedManual` / `startedAuto` / `blockedPresses`; a leaked press
is otherwise indistinguishable from a legitimate free spin, since retriggers make
the free-spin count move on its own.
