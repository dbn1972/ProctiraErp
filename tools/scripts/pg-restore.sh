#!/usr/bin/env bash
# G-503 / W1-OPS-04 — Restore a pg_dump custom-format backup into DATABASE_URL.
# Accepts plaintext .dump or encrypted .dump.age / .dump.gpg artifacts.
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/pg-restore.sh path/to/backup.dump[.age|.gpg]
# Env (decrypt):
#   BACKUP_AGE_IDENTITY_FILE  path to age identity (private key)
#   BACKUP_AGE_IDENTITY       age identity inline (from secret)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/scripts/backup-crypto.sh
source "$ROOT/tools/scripts/backup-crypto.sh"

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
DUMP_FILE="${1:?Usage: pg-restore.sh <backup.dump[.age|.gpg]>}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

DECRYPTED=""
cleanup() {
  if [[ -n "$DECRYPTED" && "$DECRYPTED" != "$DUMP_FILE" && -f "$DECRYPTED" ]]; then
    rm -f "$DECRYPTED"
  fi
}
trap cleanup EXIT

DECRYPTED="$(backup_decrypt_if_needed "$DUMP_FILE")"

# --- M438: destructive-restore guard ---------------------------------------
# pg_restore --clean DROPs objects in the target DB. Refuse to run unless the
# operator has explicitly confirmed the exact target database name, so a
# mis-set DATABASE_URL cannot wipe the wrong database.
CURRENT_DB="$(psql "$DB_URL" -At -c 'SELECT current_database();' 2>/dev/null || true)"
if [[ -z "$CURRENT_DB" ]]; then
  echo "ERROR: could not connect to target to resolve current_database()" >&2
  exit 1
fi
if [[ "${RESTORE_CONFIRM_DB:-}" != "$CURRENT_DB" ]]; then
  echo "ERROR: refusing destructive --clean restore." >&2
  echo "       Set RESTORE_CONFIRM_DB to the exact target database name to proceed." >&2
  echo "       target current_database() = '${CURRENT_DB}'" >&2
  exit 1
fi

echo "==> pg_restore ← ${DUMP_FILE} (target db: ${CURRENT_DB})"
# --single-transaction + --exit-on-error: all-or-nothing restore that aborts on
# the first error instead of leaving a half-restored database.
pg_restore \
  --dbname="$DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  --single-transaction \
  --exit-on-error \
  "$DECRYPTED"

# Post-restore sanity: the DB must be queryable and have user tables.
TABLE_COUNT="$(psql "$DB_URL" -At -c \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema');" 2>/dev/null || echo 0)"
if [[ "${TABLE_COUNT:-0}" -lt 1 ]]; then
  echo "ERROR: post-restore sanity check failed — no user tables present" >&2
  exit 1
fi

echo "==> Restore OK: ${DUMP_FILE} (${TABLE_COUNT} tables)"
