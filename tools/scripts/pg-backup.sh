#!/usr/bin/env bash
# G-503 / W1-OPS-04 — Logical PostgreSQL backup (pg_dump custom format).
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/pg-backup.sh [output.dump]
# Env:
#   BACKUP_DIR              where timestamped dumps go (default .backups/)
#   BACKUP_RETENTION_DAYS   when set (>0), prune proctira-* artifacts older
#                           than N days from BACKUP_DIR after a successful dump
#   BACKUP_AGE_RECIPIENT    age public key — encrypt dump at rest (.dump.age)
#   BACKUP_GPG_RECIPIENT    gpg recipient — encrypt dump at rest (.dump.gpg)
#   BACKUP_ENCRYPT          when 1/true, require encryption keys (fail closed)
#   BACKUP_OFFSITE_URI      s3://bucket/prefix/ — push encrypted artifact offsite
#   BACKUP_S3_SSE           S3 server-side encryption (AES256 or aws:kms)
#   BACKUP_S3_SSE_KMS_KEY_ID  KMS key when BACKUP_S3_SSE=aws:kms
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/scripts/backup-crypto.sh
source "$ROOT/tools/scripts/backup-crypto.sh"

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
echo "==> Dump OK (${BYTES} bytes): ${OUT}"

FINAL_OUT="$(backup_encrypt_if_configured "$OUT")"
if [[ "$FINAL_OUT" != "$OUT" ]]; then
  BYTES="$(wc -c < "$FINAL_OUT" | tr -d ' ')"
  echo "==> Encrypted artifact (${BYTES} bytes): ${FINAL_OUT}"
fi

backup_offsite_sync "$FINAL_OUT"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-0}"
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS > 0 )); then
  PRUNED="$(find "$(dirname "$FINAL_OUT")" -maxdepth 1 -type f \
    \( -name 'proctira-*.dump' -o -name 'proctira-*.dump.age' -o -name 'proctira-*.dump.gpg' \) \
    -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
  echo "==> Retention: removed ${PRUNED} artifact(s) older than ${RETENTION_DAYS} days"
fi
echo "$FINAL_OUT"
