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

## Completed Milestones (2026-10-04 – 2026-10-05)

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
- **Demo Casino integration: complete (2026-10-05, commits `195c58e`, `12c4075`).**
  `demo-operator/` on SQLite with an append-only webhook ledger, staff-authenticated
  back-office with Spin history and a **Verify on Provider** deep link into the Operator
  Portal Round Inspector; wallet webhooks carry `gameCode` + `roundType`.
- **Campaign Manager UI + expiry job: complete (2026-10-05, commit `d84ac8f`).** Operator
  Portal create / grant / cancel with bets locked to allowed bets and role-aware controls;
  background sweep expires lapsed free-round grants.

Details, verification results and open items: [CHECKPOINT.md](CHECKPOINT.md).

## Completed Milestones (2026-10-09)

- **Production readiness of the code:** hosting kit (`infra/`), CI (`rtp-parity`, gated
  `deploy`), security hardening (findings F1–F8, 57 abuse tests), trace id on the ledgers,
  signing keyring with rotation and per-row signed ledgers, and the B2B provider website.
  Lab certification and provider licences are held (user). Details: [CHECKPOINT.md](CHECKPOINT.md).

## Next steps to the first casino

Each step has an owner and a "done when". Steps 1–2 unblock everything else; steps 6–7
(casino paperwork) can run in parallel from today.

| # | Step | Owner | Done when |
|---|---|---|---|
| 1 | **Server.** Claim the GitHub Student Pack; create a DigitalOcean droplet (Ubuntu LTS, 2 GB, SSH key only); DNS `rgs.<domain>` (+ `casino.<domain>` for staging) → droplet. | User | `ssh` works; DNS resolves |
| 2 | **Deploy staging.** Follow `infra/README.md`: server baseline (ufw 22/80/443, fail2ban, unattended upgrades, no root SSH), `gen-secrets.mjs`, `docker compose up` with `NODE_ENV=staging`. First real build of the image and first run of migrations 0001–0012 on Postgres. Add the demo casino as a `staging` compose service, off-site backups (B2/R2) + a restore script, UptimeRobot on `/health`, alerts on `rgs_engine_integrity_violations_total` > 0 and pending reversals. Turn on CI `deploy`. | Claude (+ user for accounts) | `https://rgs.<domain>/health` OK; boot log shows migrations + hydration; a backup restored to a fresh DB with both chains and signatures verifying |
| 3 | **Staging tests.** `npm run e2e` and the embed checks against the hosted URLs; real phones (iOS Safari, Android Chrome); load test 30 → 60 players for 15 min (p95 spin < 300 ms, no 5xx, CPU < 50%); restart mid-session; the casino down during a debit; casino vs RGS ledgers reconcile per round. | Claude | All pass; results in `qa/` |
| 4 | **Pentest (Phase 3B).** Docker Desktop on; local prod-like stack: OWASP ZAP (authenticated), Burp, nuclei, ffuf, sqlmap, admin console attacks, trivy, gitleaks; nmap + testssl.sh against staging. | Claude (+ user's machine) | No open Critical/High in `qa/security/findings-register.md` |
| 5 | **Publish the website.** Fill `partners@example.com` and `[GLI REFERENCE NO.]`; Vercel project with root `website`; optional domain. | User → Claude | Site live with real contact and certificate reference |
| 6 | **Casino paperwork.** Contract (revenue share, SLA, payment terms, liability, GDPR; `docs/commercial-terms-template.md`); the casino's due-diligence pack (licences, GLI certificates for their markets, RTP variants, rules, findings register, incident response). Decide the SLA (modest: one server) and who handles support out of hours. | User | Signed contract |
| 7 | **Casino integration.** Their operator account, HMAC credentials, allowed domains; they build the wallet webhooks + embed `/play`; joint sandbox certification (spins, buy, free rounds, lost-debit rollback, signed export); set their RTP variant, currencies, bets, jurisdiction profile. | Casino + Claude | Sandbox run signed off by both |
| 8 | **Go live.** `NODE_ENV=production`, rotate every staging secret (new `EXPORT_SIGNING_KEY`), remove the staging services, production credentials; watch 24–48 h with a rollback plan (`docs/release-checklist.md`). | Claude + user | First real-money rounds settle and reconcile |

**After launch:** OpenTelemetry export (epic Issue #4); an external pentest before real
money at scale; multi-server (Redis for the nonce store, rate limiter and timers; managed
Postgres) when a casino needs a higher SLA; per-jurisdiction signing keys if a regulator
asks; new games on the same engine and platform.
