#!/usr/bin/env bash
# G-503 — Logical PostgreSQL backup (pg_dump custom format).
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/pg-backup.sh [output.dump]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_URL="${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/.backups}"
TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="${1:-$BACKUP_DIR/proctira-${TIMESTAMP}.dump}"

mkdir -p "$(dirname "$OUT")"

echo "==> pg_dump → ${OUT}"
pg_dump \
  --dbname="$DB_URL" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --file="$OUT"

BYTES="$(wc -c < "$OUT" | tr -d ' ')"
echo "==> Backup OK (${BYTES} bytes): ${OUT}"
echo "$OUT"
