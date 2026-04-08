# Backend Data Model v1

## Core Entities

## 1. Session

- `session_id` (PK)
- `player_id`
- `game_id`
- `currency`
- `status` (`ACTIVE`, `CLOSED`)
- `created_at`
- `closed_at`

## 2. Spin

- `spin_id` (PK)
- `session_id` (FK)
- `bet_amount`
- `win_amount`
- `math_config_id`
- `rng_counter`
- `outcome_hash`
- `resolved_at`

## 3. LedgerTransaction

- `tx_id` (PK)
- `session_id` (FK)
- `spin_id` (FK, nullable)
- `type` (`DEBIT`, `CREDIT`, `ROLLBACK`)
- `amount`
- `idempotency_key`
- `status`
- `created_at`

## 4. AuditRecord

- `audit_id` (PK)
- `record_type`
- `record_payload_hash`
- `prev_hash`
- `chain_hash`
- `created_at`

## Storage Notes

- Use strong consistency for wallet and settlement writes.
- Audit chain should be append-only.
