# Backend Runbook v1

## Services

- `api-gateway`
- `session-service`
- `spin-resolver`
- `wallet-adapter`
- `audit-writer`

## Pre-Deploy Checklist

1. Confirm approved `math_config_id`.
2. Confirm environment secrets are present.
3. Run smoke tests in staging.
4. Verify rollback artifact exists.

## Incident Playbook

## Settlement mismatch

1. Freeze affected sessions.
2. Compare ledger debit/credit by `spin_id`.
3. Replay idempotent settlement with locked writes.
4. Publish incident summary.

## Elevated API errors

1. Check gateway and service health.
2. Validate dependency status (DB/cache/provider).
3. Roll back if release correlation is confirmed.

## Recovery Goals

- Spin API p95 latency < 300ms normal load
- Error rate < 0.5%
- RTO target < 30 minutes for severe outage
