# 04 Math, RNG, RTP, and Fairness

## Goal
Produce a certifiable math model and RNG framework.

## Key Principle

Profitability comes from **defined house edge at scale**, not from hidden rigging.

## Tasks

1. Define math spec (`math/math-spec.md`):
   - Paytable
   - Reel strips / symbol weights
   - Feature probabilities
   - RTP decomposition:
     - Base RTP contribution
     - Bonus RTP contribution
2. Define target metrics:
   - RTP: 93.50% to 94.50% for current profile
   - Hit frequency target range
   - Volatility index target
   - Max exposure per spin
   - Profitability gate: repeated 1,000,000-spin validations must return positive casino net for current profile.
3. RNG architecture:
   - Server-authoritative RNG
   - Cryptographically secure PRNG source
   - Seed rotation policy
   - Entropy health checks
4. Simulation framework:
   - Run at least 10M+ spin simulations per config
   - Validate:
     - empirical RTP
     - variance
     - hit frequency
     - max observed tails
5. Fairness and auditability:
   - Immutable spin logs with hash chaining
   - Reproducibility mode for internal audit
6. Model governance:
   - Sign and version math files
   - Separate “approved production math” from experimental math

## Deliverables

- `math/math-spec.md`
- `math/reel-strips-v1.json`
- `math/paytable-v1.json`
- `math/simulation-report-v1.md`
- `math/rng-design.md`

## Exit Criteria

- Simulation results within tolerance of target RTP/volatility.
- RNG and math artifacts versioned and auditable.
- Candidate build ready for backend integration.

## Next

Proceed to [05 Backend Platform](05-backend-platform.md).
