# Secrets in git history — audit and rotation

Scanned 2026-10-16: all 197 commits on every branch, tag and pull-request ref of `WERSIT35/provider`. History was **not** rewritten.

## What was found

| # | Secret | Where | Real risk | Action |
|---|---|---|---|---|
| 1 | Two admin bearer tokens: `dev-admin` (provider_super_admin) and `dev-op-admin` (operator_admin) | `.claude/settings.local.json`, commits `abf751c` → `740996b` (sanitized 2026-07-11) | **Low.** Both **expired 2026-06-05** (`exp` 1780695621). Both are signed with the public default `ADMIN_TOKEN_SECRET` (`dev-admin-secret-change-me`), which staging/production refuse to boot with. | None for these tokens. See #2. |
| 2 | Default token secrets `dev-launch-secret-change-me`, `dev-session-secret-change-me`, `dev-admin-secret-change-me` | `platform/src/config/env.ts` (by design) | **High on any internet-facing server that keeps them.** With them anyone can mint a valid admin, session or launch token. Staging/production already refused them. **`NODE_ENV=sandbox` did not** (fixed in this PR). | Every non-local server sets its own values (`node infra/gen-secrets.mjs`). |
| 3 | Default passwords `change-me-admin` (bootstrap admin) and `demo123` (dev operator admin, demo casino staff) | `env.ts`, `scripts/dev-credentials.ts`, `demo-operator/src/config.ts` | Low. The platform refuses them outside local/test; the demo casino is never deployed. | Never deploy `demo-operator/` with its defaults. |
| 4 | Local paths (`/Users/OTO/...`) | `.claude/settings.local.json` (old commits) | Username only, no credential. | None. |

**Not found anywhere in history:** private keys (PEM), `EXPORT_SIGNING_KEY`, operator API secrets, webhook secrets, `.env` files with real values, and GitHub, AWS, DigitalOcean, OpenAI/Anthropic, Slack or Google keys.

## Fixed in this PR

- `NODE_ENV=sandbox` now refuses to boot with any of the public default secrets in #2 (test in `test/env.test.ts`).

## How to rotate (if a real secret ever leaks)

Run these on the server. Each one is a restart, not a migration.

| Secret | Steps | Effect |
|---|---|---|
| `LAUNCH_TOKEN_SECRET` | New value (`openssl rand -base64 48`) in `infra/.env.prod`, then `docker compose -f infra/docker-compose.prod.yml up -d platform` | Unused launch tokens die. Casinos just launch again. |
| `SESSION_TOKEN_SECRET` | Same | Players mid-session must relaunch. Rounds already settled are safe. |
| `ADMIN_TOKEN_SECRET` | Same | Every admin is logged out. |
| `BOOTSTRAP_ADMIN_PASSWORD` | Change the password in the provider console first, then the env value | Only used for the first seed. |
| `EXPORT_SIGNING_KEY` | New key from `node infra/gen-secrets.mjs`, restart. The old public key stays published as retired | Old exports still verify. Never re-activate a retired key (boot fails by design). |
| Operator API secret | Provider console → operator → credentials → issue new, give it to the casino, then revoke the old one | Zero downtime if both overlap briefly. |
| Webhook secret | Provider console → operator → webhook → regenerate, and the casino updates its verifier at the same time | Wallet calls fail until both sides match, so agree on a time. |
| DB password | `ALTER USER bananax PASSWORD '…'`, update `DATABASE_URL`, restart | — |

After any rotation, check the effect. Old token → `401`, `/health` → `200`, and one full launch → spin → round export.

## Prevention

- `.claude/settings.local.json` is git-ignored (done 2026-07-11). Keep it that way.
- Before every push, run `git diff --cached | grep -E "Bearer |BEGIN .*PRIVATE KEY|_SECRET="`. Better: add `gitleaks` to CI (a Phase 3+ task).
