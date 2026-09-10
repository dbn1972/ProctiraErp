#!/usr/bin/env bash
# G-503 — Restore a pg_dump custom-format backup into DATABASE_URL.
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/pg-restore.sh path/to/backup.dump
set -euo pipefail

DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
DUMP_FILE="${1:?Usage: pg-restore.sh <backup.dump>}"

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "==> pg_restore ← ${DUMP_FILE}"
pg_restore \
  --dbname="$DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-acl \
  "$DUMP_FILE"

echo "==> Restore OK: ${DUMP_FILE}"
