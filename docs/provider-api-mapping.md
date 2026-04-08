# Provider API Mapping v1

## Purpose

Map internal game API to provider-specific schemas.

## Canonical Internal Calls

- `session/init`
- `spin`
- `session/close`

## Mapping Template

| Internal Field | Provider Field | Transform | Notes |
|---|---|---|---|
| `session_id` | `token` | direct |  |
| `spin_id` | `transaction_id` | direct | idempotency critical |
| `bet_amount` | `stake` | currency conversion if needed |  |
| `win_amount` | `payout` | direct |  |
| `balance_after` | `balance` | direct |  |

## Adapter Rules

1. Keep canonical internal model stable.
2. Apply provider-specific adapters at edge layer only.
3. Normalize provider errors into internal error catalog.
