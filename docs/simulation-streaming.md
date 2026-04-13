# Simulation Streaming Notes

## Endpoint

- Stream: `GET /api/v1/simulate/stream`
- Fallback: `POST /api/v1/simulate`

## Live Progress Contract

Progress events must include:

- `progress_percent`
- `steps_completed`
- `steps_total`
- live RTP / net / hit-rate / big-win counters

## Frontend Requirements

1. Update progress bar width from `progress_percent`.
2. Update label with percentage and completed steps.
3. Update all live metric cards from payload fields.
4. On complete, render final summary report.

## Reliability Rules

- If stream is unavailable or stalled, fallback API can finish simulation.
- UI update path should be exception-safe; one bad field should not terminate stream.

## Current Tuning

- Backend stream chunk size: `1000` steps.
- Backend stream pacing: `setTimeout(..., 8)` between chunks for visible incremental updates.
