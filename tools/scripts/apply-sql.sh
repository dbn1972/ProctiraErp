#!/usr/bin/env bash
# Apply numbered domain SQL under db/sql/ (after Prisma migrate deploy).
# Gap G-002: CI / live setup must apply 001–N so raw-SQL modules hit Postgres.
#
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/apply-sql.sh
#   bash tools/scripts/apply-sql.sh --dry-run
#
# Connection:
#   Prefers DATABASE_URL. If unset, uses libpq defaults (PGHOST/PGPORT/PGUSER/
#   PGPASSWORD/PGDATABASE) with PGDATABASE defaulting to "proctira".
#
# Seeds under db/seeds/ are NOT applied here — they are demo/cert data and may
# be destructive. Apply them explicitly (see db/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$ROOT/db/sql"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: apply-sql.sh [--dry-run] [--help]

Apply all db/sql/[0-9]*.sql files in LC_ALL=C sort order via psql
(-v ON_ERROR_STOP=1). Exits non-zero on first failure.

  --dry-run   List files that would be applied; do not run psql
  --help      Show this help

Environment:
  DATABASE_URL   Full Postgres URL (preferred)
  PGDATABASE     Used when DATABASE_URL is unset (default: proctira)
  PGHOST/PGPORT/PGUSER/PGPASSWORD  Standard libpq vars when URL unset
EOF
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! -d "$SQL_DIR" ]]; then
  echo "error: SQL directory not found: $SQL_DIR" >&2
  exit 1
fi

# Locale C so 006_schema sorts before 006b_seed (en_US.UTF-8 ignores '_').
mapfile -t SQL_FILES < <(
  shopt -s nullglob
  printf '%s\n' "$SQL_DIR"/[0-9]*.sql | LC_ALL=C sort
)

if [[ ${#SQL_FILES[@]} -eq 0 ]]; then
  echo "error: no files matching db/sql/[0-9]*.sql" >&2
  exit 1
fi

echo "==> Domain SQL apply order (${#SQL_FILES[@]} files)"
for f in "${SQL_FILES[@]}"; do
  echo "  - ${f#"$ROOT"/}"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> Dry run only (seeds under db/seeds/ are documented separately; not applied)"
  exit 0
fi

PSQL_ARGS=(-v ON_ERROR_STOP=1)
if [[ -n "${DATABASE_URL:-}" ]]; then
  PSQL_TARGET=("$DATABASE_URL")
else
  export PGDATABASE="${PGDATABASE:-proctira}"
  echo "==> DATABASE_URL unset; using libpq defaults (PGDATABASE=$PGDATABASE)"
  PSQL_TARGET=()
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "error: psql not found on PATH" >&2
  exit 1
fi

for f in "${SQL_FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  echo "==> Applying $rel"
  psql "${PSQL_TARGET[@]}" "${PSQL_ARGS[@]}" -f "$f"
done

echo "==> Domain SQL apply complete"
echo "Note: db/seeds/*.sql (demo/cert data) were not applied. See db/README.md."
