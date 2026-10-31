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
#   BACKUP_ALLOW_PLAINTEXT  must be 1 to keep an unencrypted dump when no
#                           recipient is configured (PRC-L383; default refuses)
#   BACKUP_OFFSITE_URI      s3://bucket/prefix/ — push encrypted artifact offsite
#   BACKUP_REQUIRE_OFFSITE  when 1/true, refuse if BACKUP_OFFSITE_URI empty
#   BACKUP_S3_SSE           S3 server-side encryption (AES256 or aws:kms)
#   BACKUP_S3_SSE_KMS_KEY_ID  KMS key when BACKUP_S3_SSE=aws:kms
#   BACKUP_S3_OBJECT_LOCK_MODE  GOVERNANCE|COMPLIANCE (WORM; optional)
#   BACKUP_S3_OBJECT_LOCK_RETAIN_DAYS  retain-until days for Object Lock
#   BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL  (PRC-M624) UTC date (YYYY-MM-DD) up
#                           to which Object Lock uses GOVERNANCE; on/after it the
#                           mode switches to COMPLIANCE. Set to go-live + 30 days
#                           per DECISION_REGISTER ## 41 ("GOVERNANCE for the first
#                           30 days, then COMPLIANCE"). Overrides
#                           BACKUP_S3_OBJECT_LOCK_MODE. A malformed date fails
#                           closed. When unset, BACKUP_S3_OBJECT_LOCK_MODE is used
#                           unchanged.
set -euo pipefail
# Dumps (and any plaintext intermediate) are readable by the owner only.
umask 077

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/scripts/backup-crypto.sh
source "$ROOT/tools/scripts/backup-crypto.sh"

# PRC-M624 — resolve the effective Object Lock mode from a GOVERNANCE->COMPLIANCE
# anchor date (DECISION_REGISTER ## 41: GOVERNANCE for the first 30 days, then
# COMPLIANCE). When BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL is set, exports
# BACKUP_S3_OBJECT_LOCK_MODE=GOVERNANCE while today's UTC date is before it and
# COMPLIANCE on/after it; a malformed anchor fails closed. When the anchor is
# unset, any explicit BACKUP_S3_OBJECT_LOCK_MODE is left unchanged.
resolve_object_lock_mode() {
  local until="${BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL:-}"
  [[ -z "$until" ]] && return 0
  if ! [[ "$until" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "ERROR: BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL must be a UTC date YYYY-MM-DD (got '${until}')" >&2
    exit 1
  fi
  local until_epoch now_epoch
  until_epoch="$(date -u -d "${until}T00:00:00Z" +%s 2>/dev/null \
    || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "${until}T00:00:00Z" +%s 2>/dev/null || true)"
  if [[ -z "$until_epoch" ]]; then
    echo "ERROR: BACKUP_S3_OBJECT_LOCK_GOVERNANCE_UNTIL is not a valid date: '${until}'" >&2
    exit 1
  fi
  now_epoch="$(date -u +%s)"
  if (( now_epoch < until_epoch )); then
    export BACKUP_S3_OBJECT_LOCK_MODE="GOVERNANCE"
  else
    export BACKUP_S3_OBJECT_LOCK_MODE="COMPLIANCE"
  fi
  echo "==> object-lock mode ${BACKUP_S3_OBJECT_LOCK_MODE} (governance-until ${until})" >&2
}

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
       (docs/BACKUP_RESTORE.md §3.5).
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

resolve_object_lock_mode
backup_offsite_sync "$FINAL_OUT"

RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-0}"
if [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]] && (( RETENTION_DAYS > 0 )); then
  PRUNED="$(find "$(dirname "$FINAL_OUT")" -maxdepth 1 -type f \
    \( -name 'proctira-*.dump' -o -name 'proctira-*.dump.age' -o -name 'proctira-*.dump.gpg' \) \
    -mtime +"$RETENTION_DAYS" -print -delete | wc -l | tr -d ' ')"
  echo "==> Retention: removed ${PRUNED} artifact(s) older than ${RETENTION_DAYS} days"
fi
echo "$FINAL_OUT"
