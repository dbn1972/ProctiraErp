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

echo "==> pg_restore ← ${DUMP_FILE}"
pg_restore \
  --dbname="$DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$DECRYPTED"

echo "==> Restore OK: ${DUMP_FILE}"
