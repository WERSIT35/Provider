# Hosting the provider platform (one server)

The platform (RGS + `/provider` + `/admin` + `/play`) runs as **one Docker container**, with
Postgres and Caddy (automatic HTTPS) next to it on the same machine. Vercel only serves the
static client and cannot host this: it is a long-running server with background jobs.

| File | What |
|---|---|
| `docker-compose.prod.yml` | `platform` (built from `platform/Dockerfile`), `postgres` (not exposed), `caddy` (80/443) |
| `Caddyfile` | HTTPS for `RGS_DOMAIN`, proxies to the platform |
| `.env.prod.example` | Every variable the boot guards require (`platform/src/config/env.ts`) |
| `gen-secrets.mjs` | Prints fresh secrets + the Ed25519 export signing key |
| `backup.sh` | Nightly `pg_dump`, keeps 7 days |

Migrations apply automatically on boot. Run **one** platform replica only: the nonce store,
rate limiter, regulatory timers and the read model live in memory (Postgres is write-through).

## Free student hosting

- **GitHub Student Developer Pack** (education.github.com/pack): includes cloud credit
  (DigitalOcean, Azure and others; check the current offers). Recommended: one DigitalOcean
  droplet, Ubuntu LTS, 2 GB RAM (1 GB works but builds are slow).
- **Azure for Students** works the same way with an Ubuntu VM.
- **Domain:** a free student-pack domain (e.g. Namecheap / .TECH offers) or a free DuckDNS
  subdomain. Avoid free web tiers that sleep when idle (e.g. Render free): the campaign-expiry
  and debit-reconciliation jobs would stop, and every wake-up re-hydrates from Postgres.

## First deploy

1. **Create the server** (Ubuntu LTS). Add your SSH key; disable password login.
2. **DNS:** an A record `rgs.<your-domain>` → the server's IP. Wait until it resolves.
3. **On the server:**
   ```bash
   sudo apt update && sudo apt install -y docker.io docker-compose-v2 git ufw
   sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
   sudo git clone https://github.com/WERSIT35/<repo>.git /opt/provider
   cd /opt/provider/infra
   # .env.prod = the template with every secret filled in. No Node on the server? Run
   # `node infra/gen-secrets.mjs > .env.prod` on your PC and copy the file up with scp.
   sudo sh -c 'node gen-secrets.mjs > .env.prod' && sudo chmod 600 .env.prod
   sudo nano .env.prod   # set RGS_DOMAIN
   sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
   ```
4. **Keep a private copy of `.env.prod`** (password manager). Losing `EXPORT_SIGNING_KEY`
   means exports signed before can no longer be checked against the published key.
5. **Check:** `https://rgs.<domain>/health` answers; `docker compose ... logs platform` shows
   `migrations_ready`, `hydrated_from_postgres`, `bootstrap_admin_seeded`.
6. **Sign in** at `https://rgs.<domain>/provider` with `BOOTSTRAP_ADMIN_USERNAME` /
   `BOOTSTRAP_ADMIN_PASSWORD` and enrol TOTP (required outside local/test).
7. **Onboard an operator** (`platform/GUIDE.md`): create it, register its domains (they are
   also the `/play` framing allowlist), assign Vault 20K, give the casino its HMAC credentials.
8. **Backups:** `sudo crontab -e` → `15 3 * * * /opt/provider/infra/backup.sh >> /var/log/rgs-backup.log 2>&1`,
   and copy `/var/backups/rgs` off the server regularly.

## Update / roll back

```bash
cd /opt/provider && sudo git fetch origin main && sudo git checkout origin/main
cd infra && sudo docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build
```
Roll back: `git checkout <previous commit>` and the same `up -d --build`.

**Automatic deploys:** the `deploy` job in `.github/workflows/platform-ci.yml` does the same
after every green push to `main`. Enable it with the repo variable `DEPLOY_ENABLED=true` and
the secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (a dedicated key in the server's
`authorized_keys`; that user in the `docker` group and owning `/opt/provider`) and
`DEPLOY_KNOWN_HOSTS` (`ssh-keyscan -H <host>`, compared once with the server's real
fingerprint). Migrations are
forward-only; a rollback across a migration needs the newer columns to be harmless to the
older code (they are additive by design) or a restore from `backup.sh`.

## Staging → production

Start with `NODE_ENV=staging` (same boot guards as production). Switch to `production` only
after lab certification and a supplier licence (CHECKPOINT.md §6).
