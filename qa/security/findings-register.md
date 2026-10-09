# Security findings register

Production plan, Phase 3C. Every finding has a severity, a fix and a regression test that
fails if it ever comes back. **Launch is blocked by any open Critical or High.**
Severity: Critical (money can be taken or outcomes changed at will), High (money or
integrity at risk under realistic conditions), Medium (data exposure or a weakened
control), Low (hardening).

Automated suite: `platform/test/security/abuse.test.ts` (runs in `npm test`, so in CI
`release-check`).

| ID | Sev | Found | Finding | Fix | Regression test | Status |
|---|---|---|---|---|---|---|
| F1 | **High** | 2026-10-09 | **Concurrent rounds on one session.** With realistic wallet latency, two buys (or a buy and a spin) sent together both read the session before either settled. Both were paid, and both saw "no feature running", which also bypassed the feature lock (frozen bet and ante inside a bonus). | `RoundOrchestrator.exclusive()`: one round at a time per session; a second request gets `SESSION_BUSY` (409) before any money moves. | "one round at a time per session" (25 ms wallet latency) | Fixed |
| F2 | **High** | 2026-10-09 | **Idempotency keys were global and reusable.** The client's key names the round (`r_<key>`) and the casino wallet keys (`<key>:debit`). Another session could replay a key and read that player's round and balance. A key reused after a restart, or after a rolled-back round, sent a new debit that the casino would answer with the old one (a round with no charge). | `claimKey()`: a key is single-use platform-wide and tied to its session; reuse is refused (`IDEMPOTENCY_KEY_CONFLICT` 409) before any debit. Buy got the same in-flight guard as spin. | "idempotency keys are single-use and tied to their session" | Fixed |
| F3 | Medium | 2026-10-09 | **Internal errors leaked to the caller as 400s.** Any non-domain exception (engine, DB) was returned with its raw message as the error code. | `sendDomainError`: only `UPPER_SNAKE` domain codes are shown; anything else, plus `ENGINE_INTEGRITY` / `DUPLICATE_ROUND_REF`, is a bare 500 `INTERNAL_ERROR`, with the detail kept in the server log. | "fails closed …" (asserts a bare 500 with no detail) | Fixed |
| F4 | Medium | 2026-10-09 | **Prototype-poisoning bodies were accepted.** The custom JSON parser (kept for HMAC raw bytes) skipped Fastify's built-in protection. | `safeJsonParse` refuses `__proto__` and `constructor.prototype` keys (400). | "refuses prototype-poisoning bodies" | Fixed |
| F5 | Medium | 2026-10-09 | **Admin consoles could be framed** (clickjacking): no `frame-ancestors` / `X-Frame-Options` on `/provider` and `/admin`. | `installSecurityHeaders`: HTML without its own CSP gets `frame-ancestors 'none'` and `X-Frame-Options: DENY`; also nosniff, a referrer policy and HSTS everywhere, and `no-store` on JSON. | "security headers" | Fixed |
| F6 | Low (defense in depth) | 2026-10-09 | **Engine dev inputs reachable by type.** The shared engine honors `force_multiplier_value`, `force_free_spin_trigger` and `crazyMode` (4.5x pays). Requests could not reach them, but the platform's `SpinInput` declared the force field and the snapshot carried `crazyMode`. | `engineInput()` allow-list at the engine boundary; `crazyMode` / `forceMultiplierValue` pinned off; the field was removed from the types. Fail-closed guard `assertPayable()`: crazy mode, a bet or ante mismatch, or a win outside [0, cap] voids the round (rollback) and increments `rgs_engine_integrity_violations_total`. | "outcome tampering never reaches the engine", "statistical guard" | Fixed |
| F7 | Low | 2026-10-09 | **Loose request bodies.** Unknown fields were ignored, `ante_enabled: "false"` counted as true, no body limit, no format check on `Idempotency-Key`. | Strict bodies (`src/http/validation.ts`) on the game and operator routes (unknown field → 422); a 64 KB body limit; keys must be 1–128 chars of `[A-Za-z0-9._:-]`. | "bet abuse" | Fixed |
| F8 | Low | 2026-10-09 | **Dev controls on a real-money page.** `?admin=1` showed the simulator and the "Go Crazy" toggle under `/play`. The RGS ignored them. | `client/main.js`: no admin mode on a platform launch (`?lt=` or `/play/`). | `npm run verify:browser` (embed / casino-embed) | Fixed |

## Still to run (Phase 3B, tools on a local prod-like stack)
OWASP ZAP (full active scan, authenticated), Burp Suite (manual tampering), nuclei, ffuf,
sqlmap, admin console attacks (brute force, TOTP bypass, stored XSS, CSRF, escalation from
operator to provider), trivy, gitleaks, `npm audit --omit=dev`; then nmap and testssl.sh
against the hosted staging. Record the results here.
