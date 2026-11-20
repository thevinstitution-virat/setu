#!/bin/sh
# Restore drill: proves a backup can be brought back (roadmap §8). Run it monthly
# and before go-live. Restores a dump into an EMPTY scratch database and compares
# row counts of the main tables with the live database.
#
#   RESTORE_ADMIN_URL=postgresql://postgres:...@host:5432/postgres \
#   BACKUP_DATABASE_URL=postgresql://setu_backup:...@host:5432/setu \
#   sh scripts/restore-drill.sh /data/backups/setu-20261121-0030.dump
#
# RESTORE_ADMIN_URL is the Postgres admin (superuser) on the maintenance database:
# it creates and drops the scratch database "setu_restore_drill". Never point it at
# the live database name. BACKUP_DATABASE_URL (the backup role) is read for the
# live counts. Counts can differ by what happened since the dump was taken.
set -eu

DUMP="${1:?Give the .dump file to restore}"
: "${RESTORE_ADMIN_URL:?Set RESTORE_ADMIN_URL (Postgres admin, maintenance database)}"
: "${BACKUP_DATABASE_URL:?Set BACKUP_DATABASE_URL (to read live counts)}"
SCRATCH="setu_restore_drill"
SCRATCH_URL=$(echo "$RESTORE_ADMIN_URL" | sed -E "s#/[^/?]+(\?|$)#/$SCRATCH\1#")

psql "$RESTORE_ADMIN_URL" -v ON_ERROR_STOP=1 -qc "DROP DATABASE IF EXISTS $SCRATCH" -c "CREATE DATABASE $SCRATCH"
START=$(date +%s)
pg_restore --no-owner --no-privileges --exit-on-error --dbname="$SCRATCH_URL" "$DUMP"
echo "restored in $(( $(date +%s) - START )) s"

COUNTS='select (select count(*) from "Tenant") tenants, (select count(*) from "User") users,
  (select count(*) from "RetailerProfile") shops, (select count(*) from "Order") orders,
  (select count(*) from "Payment") payments, (select count(*) from "LedgerLine") ledger,
  (select count(*) from "Invoice") invoices, (select count(*) from "_prisma_migrations") migrations'
echo "restored: $(psql "$SCRATCH_URL" -tAc "$COUNTS")"
echo "live:     $(psql "$BACKUP_DATABASE_URL" -tAc "$COUNTS")"
echo "          (tenants|users|shops|orders|payments|ledger|invoices|migrations)"

psql "$RESTORE_ADMIN_URL" -qc "DROP DATABASE $SCRATCH"
echo "drill done; scratch database dropped"
