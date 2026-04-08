# QA Test Cases v1

## Functional Cases

1. Valid session starts and returns expected metadata.
2. Valid spin debits balance and resolves result.
3. Win spin credits correct payout.
4. Scatter triggers free spins correctly.
5. Free spin retrigger applies correct increment.
6. Multiplier applies only in allowed states.
7. Game rules info displays correctly.

## Integrity Cases

1. Duplicate `spin_id` does not double-settle.
2. Interrupted request retries resolve idempotently.
3. Invalid bet amount rejected without state corruption.
4. Stale session rejected safely.

## Client Resilience Cases

1. Network drop during spin recovers correctly.
2. App refresh during bonus restores state.
3. Slow API response does not unlock duplicate spin action.
