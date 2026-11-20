#!/bin/sh
# Database backup for Seller's Setu (roadmap §8: encrypted backups, restore drill).
#
#   BACKUP_DATABASE_URL=postgresql://setu_backup:...@host:5432/setu sh scripts/backup-db.sh
#
# The app's own role CANNOT take a backup: every tenant table forces row-level
# security, so pg_dump stops with "query would be affected by row-level security
# policy". Use a read-only role that bypasses it (create once, as the Postgres admin):
#
#   CREATE ROLE setu_backup LOGIN PASSWORD '<random>' BYPASSRLS;
#   GRANT pg_read_all_data TO setu_backup;
#
# Writes BACKUP_DIR/setu-YYYYMMDD-HHMM.dump (pg_dump custom format) and keeps the
# newest BACKUP_KEEP files (default 14). Copy the folder off the server (S3 / another
# machine); Coolify's own scheduled Postgres backup to S3 is a fine alternative.
set -eu

: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL (a BYPASSRLS read-only role, see the top of this file)}"
DIR="${BACKUP_DIR:-/data/backups}"
KEEP="${BACKUP_KEEP:-14}"
mkdir -p "$DIR"
FILE="$DIR/setu-$(date -u +%Y%m%d-%H%M).dump"

pg_dump --format=custom --no-owner --no-privileges --file="$FILE.part" "$BACKUP_DATABASE_URL"
mv "$FILE.part" "$FILE"
# A dump that pg_restore can't list is no backup.
TABLES=$(pg_restore --list "$FILE" | grep -c "TABLE DATA" || true)
if [ "$TABLES" -lt 50 ]; then
  echo "backup looks wrong: only $TABLES tables in $FILE" >&2
  exit 1
fi
echo "backup ok: $FILE ($(du -h "$FILE" | cut -f1), $TABLES tables)"

# Keep the newest $KEEP.
ls -1t "$DIR"/setu-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do rm -f "$old"; done
