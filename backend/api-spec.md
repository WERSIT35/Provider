# Backend API Specification v1

## Base Principles

- Server-authoritative outcomes
- Idempotent transaction flows
- Signed/validated requests for provider-facing endpoints

## Endpoints

## 1. Session Init

- `POST /api/v1/session/init`
- Request:
  - `player_id`
  - `currency`
  - `locale`
  - `game_id`
- Response:
  - `session_id`
  - `balance`
  - `allowed_bets`
  - `math_config_id`

## 2. Spin Request

- `POST /api/v1/spin`
- Request:
  - `session_id`
  - `spin_id` (client-generated UUID for idempotency)
  - `bet_amount`
- Response:
  - `spin_id`
  - `status`
  - `outcome_payload` (symbols, wins, feature states)
  - `balance_after`

## 3. Session Close

- `POST /api/v1/session/close`
- Request:
  - `session_id`
- Response:
  - `status`

## Error Codes

- `SESSION_NOT_FOUND`
- `INVALID_BET`
- `INSUFFICIENT_FUNDS`
- `DUPLICATE_SPIN_ID`
- `CONFIG_NOT_APPROVED`
- `INTERNAL_ERROR`

## Idempotency Rules

- Same `spin_id` + `session_id` returns the same resolved outcome.
- No duplicate debits/credits on retries.
