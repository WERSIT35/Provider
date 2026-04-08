# Slot Game Program Roadmap

This repository now works as a **playbook** for building a provider-ready slot game.

## How to Use This

1. Start here.
2. Work through phases in order.
3. For each phase, open the linked file and complete its checklist.
4. Do not start a new phase until the current phase has exit criteria met.

## Current Assumptions (From You)

- Initial target market: **Georgia**
- Later target: **Global expansion**
- Provider target list: **TBD** (could include building your own distribution path later)
- Visual production: handled by your artist partner (use placeholders now)
- Budget: not fixed yet
- Priority: strong game features, strong security, provider-ready quality

## Important Reality Checks

- “100% non-hackable” is not possible in software.
- Goal is **defense-in-depth**: audited RNG, secure backend, signed configs, anti-tamper, monitoring, incident response.
- “9 lose / 1 win” is a rough intuition, not a production math spec.
- We must define exact RTP, hit frequency, volatility, max win, bonus frequency in a certified math model.

## Phase Sequence

1. **Program Setup** -> [01 Program Setup](docs/01-program-setup.md)
2. **Legal/Compliance (Georgia first)** -> [02 Legal Compliance](docs/02-legal-compliance.md)
3. **Game Design (Features + Economy)** -> [03 Game Design](docs/03-game-design.md)
4. **Math Model + RNG + RTP** -> [04 Math RNG RTP](docs/04-math-rng-rtp.md)
5. **Backend Platform** -> [05 Backend Platform](docs/05-backend-platform.md)
6. **Frontend Slot Client** -> [06 Frontend Client](docs/06-frontend-client.md)
7. **Security Hardening** -> [07 Security](docs/07-security.md)
8. **Provider Integration Readiness** -> [08 Provider Integration](docs/08-provider-integration.md)
9. **QA + Certification + Labs** -> [09 QA Certification](docs/09-qa-certification.md)
10. **Launch + LiveOps** -> [10 launch LiveOps](docs/10-launch-liveops.md)
11. **Commercialization (Providers / Own distribution)** -> [11 Commercial Strategy](docs/11-commercial-strategy.md)
12. **Master Backlog + Delivery Tracking** -> [12 Delivery Backlog](docs/12-delivery-backlog.md)

## Gate-Based Execution

Each phase has:

- Inputs
- Tasks
- Deliverables
- Exit criteria

Move forward only when exit criteria are complete.

## Suggested Initial Scope

- Build one high-quality video slot:
  - 5x3 reel set
  - Base game + one bonus game
  - 96.00% RTP version first
  - Configurable RTP profiles later (as legally allowed)
- Ship with placeholders for art/audio first, then skin with final assets.

## Suggested Timeline (No Budget Constraint Yet)

- Phase 1-4 (Design + math + compliance prep): 3-6 weeks
- Phase 5-7 (Build core platform + client + security): 6-10 weeks
- Phase 8-9 (Integration + QA + certification): 4-8 weeks
- Phase 10-11 (Launch + commercial onboarding): 2-6 weeks

Total: **~15-30 weeks** depending on team size and certification cycle.

## Immediate Next Action

Start with [01 Program Setup](docs/01-program-setup.md).  
After finishing it, continue to [02 Legal Compliance](docs/02-legal-compliance.md).
