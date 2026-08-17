#!/usr/bin/env bash
# scripts/backup.sh — dnevni pg_dump sa zadržavanjem 7 kopija (Faza 6, 6.8).
#
# Pokreće se cron-om na Hetzneru (worker host), a kopije se šalju OFF-SITE
# (npr. rclone na drugi prostor). Bez off-site kopije ovo je samo zaštita od
# greške, ne od požara.
#
# Potrebno:
#   DATABASE_URL  — Supabase connection string (pg_dump čita samo, nikad ne piše)
#   BACKUP_DIR    — gde stoje kopije (podrazumevano: /var/backups/sajtoskop)
#
# Primer crontab (svakog dana u 02:30 po Beogradu; Supabase PITR je prava
# zaštita, ovo je do nje):
#   30 1 * * *  DATABASE_URL='postgresql://...' /root/sajtoskop/scripts/backup.sh
set -euo pipefail

: "${DATABASE_URL:?DATABASE_URL nije postavljen}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/sajtoskop}"
RETENTION=7

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="$BACKUP_DIR/sajtoskop-$STAMP.sql.gz"

# pg_dump je read-only i ne dira bazu. `--no-owner` da se dump može vratiti i u
# drugi projekat; `--no-privileges` jer Supabase role ne postoje lokalno.
pg_dump --no-owner --no-privileges --no-comments "$DATABASE_URL" | gzip > "$OUT"

# Zadrži poslednjih 7 kopija, obriši starije.
ls -1t "$BACKUP_DIR"/sajtoskop-*.sql.gz 2>/dev/null | tail -n +$((RETENTION + 1)) | xargs -r rm -f

echo "backup: $OUT ($(du -h "$OUT" | cut -f1))"
echo "off-site: pošalji $OUT rclone-om na drugi prostor (npr. rclone copy $OUT remote:backups/)"
