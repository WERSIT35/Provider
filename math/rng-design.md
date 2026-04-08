# RNG Design v1

## Security Goal

Use cryptographically secure, server-authoritative randomness for all outcome decisions.

## Architecture

1. Entropy source:
- OS CSPRNG

2. PRNG layer:
- Deterministic stream per session using secure seed material
- Seed derived from entropy + server secret + monotonic nonce

3. Outcome generation:
- Generate reel stop indices
- Generate feature trigger checks
- Persist RNG metadata needed for audit (not raw secrets)

## Controls

- Seed material never exposed to client.
- Seed rotation at defined intervals.
- Strict separation between RNG service and client-facing layers.
- Config version hash included in spin record.

## Auditability

- Each spin log includes:
  - `spin_id`
  - `session_id`
  - `math_config_id`
  - `rng_stream_counter`
  - `result_hash`

## Failure Handling

- If RNG subsystem health check fails:
  - Reject new spins
  - Trigger critical alert
  - Enter safe degraded mode

## Certification Notes

- Keep implementation details and test vectors available for lab review.
- Maintain reproducible internal test mode with fixed seed in non-production only.
