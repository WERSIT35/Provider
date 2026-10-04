# Slot Game Program Roadmap

This repository acts as a practical playbook for building a provider-ready slot game.

## How to Use This

1. Start here.
2. Work through phases in order.
3. For each phase, open the linked file and complete its checklist.
4. Do not start a new phase until the current phase exit criteria are met.

## Current Scope Snapshot

- Active profile build: **Vault 20K** by Lumina Games (internal game code / profile ids: `bananax`)
- Layout: `6x5` symbols-pay-anywhere (minimum 8 matches)
- RTP profile modes: `96.38 / 94.40 / 92.38`
- Max win cap: `20000x`
- Visual production: cinematic noir-heist canvas UI (vault steel, tungsten light, security laser,
  vault gold), per-symbol independent drops, no screen shake, single ticker message line

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
  - `6x5` grid
  - Base game + free spins bonus
  - Profile-driven RTP modes
  - Configurable rule payload with strict runtime validation

## Completed Milestones (2026-10-04)

- **Cinematic client overhaul (Vault 20K): complete.** Lumina Games rebrand, Pragmatic-style
  CSS-grid shell, top bar removed + ticker state machine, per-symbol rigid-body drops (no jelly,
  no shake, no wind-up), reel anticipation + Web Audio drone, big-win overlay, free-round UI lockdown.
- **Platform Phase 3: complete.** 3A Round Inspector deep linking + verification banner;
  3B Player Reports (tenant-isolated); 3C Campaign Manager data model, atomic grant deduction,
  `FREE_ROUND_BET` wallet tagging, mid-feature `locked_bet` / `locked_ante`; 3D HMAC operator
  free-rounds API + client "You have X Free Rounds" modal and ticker countdown.

- **Phase 4, math certification: complete (2026-10-05, commit `6d75826`).** Engine 1.2.0,
  rules 3.1.0; no engineered near-misses; multiplier-bank rule; whole-round 20,000x cap
  (enforced on the RGS); bonus 1 in ~248; recalibrated scalers for all three profiles; rounds
  record `engine_version` + `rules_hash`; seeded statistical parity test. Lab report:
  [qa/rtp-certification-report.md](qa/rtp-certification-report.md) — base 96.36%, buy 96.41%,
  ante 96.70% (pooled). Open before submission: O1–O4 in CHECKPOINT.md §5.

Details, verification results and open items: [CHECKPOINT.md](CHECKPOINT.md).

## Immediate Next Action

**Demo Casino integration** — [16 Demo Casino Blueprint](docs/16-demo-casino-blueprint.md):
staff login on the casino back-office first, then webhook enrichment, spin history, and the
"Verify on provider" bridge into the Operator Portal. In parallel, close the certification
report's open items O1–O4 before lab submission. Keep docs aligned with runtime behavior after
each major change.
