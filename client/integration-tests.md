# Client Integration Tests v1

## Objective

Validate correctness of client-backend behavior in realistic scenarios.

## Test Cases

1. Session init success
- Expected: balance and bet options render correctly.

2. Spin success no win
- Expected: correct animation, zero win, balance decremented once.

3. Spin success with win
- Expected: win animation, balance incremented correctly, no duplicate credit.

3.1 Tumble highlight timing
- Expected: no next-step win highlight is visible during symbol fall.
- Expected: next-step wins are highlighted only after drop completes.

3.2 Blast intensity scaling
- Expected: low-value symbol wins use visibly smaller blast than premium symbol wins.
- Expected: larger groups (10+ / 12+) feel stronger than 8-9 matches.

3.3 Multiplier label persistence
- Expected: every visible multiplier symbol always shows `Nx` label.
- Expected: multiplier labels stay correct across tumble drops.

3.4 Scatter special effect
- Expected: scatter symbol uses distinct special animation from standard win blast.

3.5 Base-game multiplier lifecycle
- Expected: on paid spin, multiplier affects only that round when both win and multiplier symbols appear.
- Expected: next paid spin starts from `1x` again.

3.6 Bonus persistent multiplier lifecycle
- Expected: bonus multiplier starts at `1x` when free spins begin.
- Expected: multiplier increases only when a winning bonus round also has visible multiplier symbols.
- Expected: increased value persists across remaining free spins and resets to `1x` when bonus ends.

4. Bonus trigger
- Expected: bonus entry flow and free-spin counters correct.

5. Retrigger in bonus
- Expected: free-spin count and multiplier updates correctly.

6. Duplicate spin response handling
- Expected: UI state remains consistent, no duplicate visual payout logic.

7. Network interruption during spin
- Expected: reconnect and recover spin outcome from backend.

8. Invalid session handling
- Expected: user gets recoverable error and re-init path.
