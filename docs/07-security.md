# 07 Security and Integrity

## Goal
Minimize exploit risk and satisfy provider/lab security expectations.

## Security Model

- Zero trust between client and server
- Server-authoritative game outcomes
- Signed configs and strict deployment controls

## Tasks

1. Threat model (`docs/threat-model.md`):
   - Client tampering
   - Replay attacks
   - API abuse
   - Insider config changes
2. API protection:
   - AuthN/AuthZ per integration context
   - Request signing where needed
   - Rate limiting and abuse detection
3. Data integrity:
   - Append-only transaction records
   - Hash-linked spin logs
4. Secrets and key management:
   - Centralized secrets manager
   - Rotation schedules
5. SDLC hardening:
   - Dependency scanning
   - SAST/DAST
   - Mandatory code reviews
6. Incident response:
   - Security alert playbook
   - Key revoke/roll procedures
   - Rollback plan

## Deliverables

- `docs/threat-model.md`
- `docs/security-controls-matrix.md`
- `docs/incident-response.md`

## Exit Criteria

- High-risk threat vectors mitigated and tested.
- No critical unresolved findings.
- Security controls documented for provider/lab review.

## Next

Proceed to [08 Provider Integration](08-provider-integration.md).
