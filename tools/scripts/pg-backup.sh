#!/usr/bin/env bash
# G-503 — Logical PostgreSQL backup (pg_dump custom format).
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/pg-backup.sh [output.dump]
# Env:
#   BACKUP_DIR              where timestamped dumps go (default .backups/)
#   BACKUP_RETENTION_DAYS   when set (>0), prune proctira-*.dump older than N
#                           days from BACKUP_DIR after a successful dump (G-707)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$BACKUP_DIR/proctira-${TIMESTAMP}.dump}"

mkdir -p "$(dirname "$OUT")"

# G-710 FORCEs row-level security on every tenant table, so pg_dump as the
# ordinary app role either errors ("query would be affected by row-level
# security policy") or, with --enable-row-security, silently dumps only the
# rows visible to an unbound session — i.e. nothing. Refuse to run unless the
# connected role can bypass RLS (BYPASSRLS or superuser).
CAN_BYPASS="$(psql "$DB_URL" -At -v ON_ERROR_STOP=1 -c \
  "SELECT (rolsuper OR rolbypassrls)::text FROM pg_roles WHERE rolname = current_user")"
if [[ "$CAN_BYPASS" != "true" ]]; then
  cat >&2 <<MSG
ERROR: backup role '$(psql "$DB_URL" -At -c "SELECT current_user")' cannot bypass row-level security.
       A logical backup taken by this role would be incomplete. Use a dedicated
       backup role, e.g.:
         CREATE ROLE proctira_backup LOGIN PASSWORD '...' BYPASSRLS;
         GRANT pg_read_all_data TO proctira_backup;
       and point BACKUP_DATABASE_URL / dr.databaseUrlSecretKey at it
       (docs/BACKUP_RESTORE.md §3.3).
MSG
  exit 2
fi

echo "==> pg_dump → ${OUT}"
pg_dump \
  --dbname="$DB_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --file="$OUT"

BYTES="$(wc -c < "$OUT" | tr -d ' ')"
if [[ "$BYTES" -lt 1024 ]]; then
  echo "ERROR: dump is suspiciously small (${BYTES} bytes)" >&2
  exit 1
fi
echo "==> Backup OK (${BYTES} bytes): ${OUT}"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-0}"
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS > 0 )); then
  PRUNED="$(find "$(dirname "$OUT")" -maxdepth 1 -name 'proctira-*.dump' -type f \
    -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
  echo "==> Retention: removed ${PRUNED} dump(s) older than ${RETENTION_DAYS} days"
fi
echo "$OUT"
