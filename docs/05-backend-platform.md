# 05 Backend Platform

## Goal
Implement secure, provider-compatible game backend services.

## Reference Architecture

- API gateway
- Game session service
- Wallet/bet-win transaction service
- RNG/maths execution service
- Event/logging service
- Admin/config service

## Tasks

1. Define backend contract:
   - Session init
   - Bet request
   - Spin resolve
   - Win settlement
   - Error and rollback flows
2. Implement idempotent wallet flow:
   - Bet debit exactly once
   - Win credit exactly once
   - Retry-safe transaction keys
3. Implement state machine:
   - `INIT -> BET_ACCEPTED -> RESOLVED -> SETTLED`
   - Handle crash-recovery safely
4. Math integration:
   - Load signed math config
   - Reject unapproved math versions
5. Operational features:
   - Structured logs
   - Metrics (latency, error rate, settlement failures)
   - Alerts for anomalies
6. Storage:
   - Session store
   - Transaction ledger
   - Spin outcomes/audit chain

## Deliverables

- Backend API spec (`backend/api-spec.md`)
- Service implementation (`backend/`)
- Data model docs (`backend/data-model.md`)
- Runbook (`backend/runbook.md`)

## Exit Criteria

- End-to-end spin settlement works reliably.
- Idempotency validated in failure scenarios.
- Backend contract stable for frontend and provider adapters.

## Next

Proceed to [06 Frontend Client](06-frontend-client.md).
