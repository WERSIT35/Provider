#!/bin/sh
# Nightly Postgres dump, keeps 7 days. Install on the server with:
#   crontab -e   →   15 3 * * * /opt/provider/infra/backup.sh >> /var/log/rgs-backup.log 2>&1
# Copy the dumps off the server too (a backup on the same disk is not a backup).
set -eu
cd "$(dirname "$0")"
DIR="${BACKUP_DIR:-/var/backups/rgs}"
mkdir -p "$DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
docker compose -f docker-compose.prod.yml --env-file .env.prod exec -T postgres \
  pg_dump -U bananax -d bananax --format=custom > "$DIR/bananax-$STAMP.dump"
find "$DIR" -name 'bananax-*.dump' -mtime +7 -delete
echo "backup ok: $DIR/bananax-$STAMP.dump"
