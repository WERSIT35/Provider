# Slot Game Program Roadmap

This repository acts as a practical playbook for building a provider-ready slot game.

## How to Use This

1. Start here.
2. Work through phases in order.
3. For each phase, open the linked file and complete its checklist.
4. Do not start a new phase until the current phase exit criteria are met.

## Current Scope Snapshot

- Active profile build: `Banana X`
- Layout: `5x4` symbols-pay-anywhere
- RTP profile modes: `96.38 / 94.40 / 92.38`
- Max win cap: `20000x`
- Visual production: futuristic dark liquid-glass canvas UI

## Important Reality Checks

- "100% non-hackable" is not possible in software.
- Goal is defense-in-depth: audited RNG, secure backend, signed configs, anti-tamper, monitoring, incident response.
- RTP and volatility must be validated with repeated large simulation samples.

## Phase Sequence

1. **Program Setup** -> [01 Program Setup](docs/01-program-setup.md)
2. **Legal/Compliance** -> [02 Legal Compliance](docs/02-legal-compliance.md)
3. **Game Design (Features + Economy)** -> [03 Game Design](docs/03-game-design.md)
4. **Math Model + RNG + RTP** -> [04 Math RNG RTP](docs/04-math-rng-rtp.md)
5. **Backend Platform** -> [05 Backend Platform](docs/05-backend-platform.md)
6. **Frontend Slot Client** -> [06 Frontend Client](docs/06-frontend-client.md)
7. **Security Hardening** -> [07 Security](docs/07-security.md)
8. **Provider Integration Readiness** -> [08 Provider Integration](docs/08-provider-integration.md)
9. **QA + Certification + Labs** -> [09 QA Certification](docs/09-qa-certification.md)
10. **Launch + LiveOps** -> [10 Launch LiveOps](docs/10-launch-liveops.md)
11. **Commercialization** -> [11 Commercial Strategy](docs/11-commercial-strategy.md)
12. **Master Backlog + Delivery Tracking** -> [12 Delivery Backlog](docs/12-delivery-backlog.md)

## Gate-Based Execution

Each phase has:

- Inputs
- Tasks
- Deliverables
- Exit criteria

Move forward only when exit criteria are complete.

## Suggested Initial Scope

- Ship one high-quality slot profile build:
  - `5x4` grid
  - Base game + free spins bonus
  - Profile-driven RTP modes
  - Configurable rule payload with strict runtime validation

## Immediate Next Action

Continue with [03 Game Design](docs/03-game-design.md) and keep docs aligned with runtime behavior after each major change.
