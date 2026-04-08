# Security Baseline

## Security Objective

Achieve provider-grade and certification-ready security posture using defense-in-depth.

## Baseline Controls

1. Source Control
- Protected main branch
- Pull-request-only merges
- Minimum one reviewer approval

2. Secrets Management
- No secrets in source code
- Use environment variables and secret manager
- Rotate secrets on schedule and after incidents

3. Build and Dependency Security
- Dependency vulnerability scanning enabled
- Block known critical vulnerabilities from release
- Pin critical dependency versions

4. Runtime Security
- Server-authoritative spin outcomes
- Request validation and rate limiting
- Idempotent transaction processing for wallet operations

5. Integrity and Auditability
- Append-only transaction logs
- Hash-linked spin records
- Immutable release build versioning

6. Incident Readiness
- Incident severity levels and response plan
- Credential revoke/rotate playbook
- Rollback plan per release

## Phase 1 Security Deliverables

- Threat model file in Phase 7
- Security controls matrix in Phase 7
- Incident response runbook in Phase 7
