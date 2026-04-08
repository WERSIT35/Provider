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
