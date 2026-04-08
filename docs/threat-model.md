# Threat Model v1

## Scope

- Slot client
- Backend APIs
- RNG/math config pipeline
- Provider integration edge

## Key Threats

1. Client tampering
- Risk: modified client tries to force favorable outcomes
- Mitigation: server-authoritative outcomes; signed responses; strict validation

2. Replay attack
- Risk: replay old valid spin requests/responses
- Mitigation: nonce + idempotency key + TTL checks

3. Transaction duplication
- Risk: duplicate wallet debit/credit under retries
- Mitigation: idempotent ledger semantics

4. Config tampering
- Risk: unauthorized math/RTP changes
- Mitigation: signed config bundles + approval gates

5. API abuse
- Risk: bot flooding or malformed requests
- Mitigation: rate limiting, schema validation, WAF rules

6. Insider misuse
- Risk: privileged changes without audit
- Mitigation: least privilege, approvals, immutable audit trail

## Residual Risk

- Credential compromise remains possible; monitor and rotate aggressively.
