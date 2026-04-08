# Architecture Decision Record (ADR)

Use this file to log significant project decisions.

## ADR Template

### ADR-XXX: Decision Title

- Date:
- Status: Proposed | Accepted | Deprecated
- Context:
- Decision:
- Consequences:
- Alternatives considered:

---

## ADR-001: Initial Product and Market Scope

- Date: 2026-04-08
- Status: Accepted
- Context:
  - Initial target market is Georgia.
  - Long-term plan is global expansion.
  - Provider list is not finalized yet.
- Decision:
  - Build one provider-ready slot title with compliance-first architecture and certifiable math.
- Consequences:
  - Compliance and certification work starts early.
  - Integration layer must be adapter-based for multiple provider targets.
- Alternatives considered:
  - Build own provider platform first (rejected for slower time-to-market).

## ADR-002: Security Model Baseline

- Date: 2026-04-08
- Status: Accepted
- Context:
  - Objective is maximum practical security.
  - True 100% non-hackable software is not achievable.
- Decision:
  - Use defense-in-depth with server-authoritative outcomes, signed math configs, audit logs, and incident response.
- Consequences:
  - More up-front engineering effort.
  - Better provider and certification readiness.
- Alternatives considered:
  - Client-side RNG/outcome logic (rejected as insecure and non-certification-friendly).

