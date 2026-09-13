#!/usr/bin/env bash
# Apply numbered domain SQL under db/sql/ (after Prisma migrate deploy).
# Gap G-002: CI / live setup must apply 001–N so raw-SQL modules hit Postgres.
#
# Usage:
#   DATABASE_URL=postgresql://... bash tools/scripts/apply-sql.sh
#   bash tools/scripts/apply-sql.sh --dry-run
#
# Connection:
#   Prefers MIGRATOR_DATABASE_URL (table-owning role for DDL), then DATABASE_URL.
#   If unset, uses libpq defaults (PGHOST/PGPORT/PGUSER/PGPASSWORD/PGDATABASE)
#   with PGDATABASE defaulting to "proctira".
#
# Seeds under db/seeds/ are NOT applied here — they are demo/cert data and may
# be destructive. Apply them explicitly (see db/README.md).
#
# G-705: demo seed files inside db/sql (NNNb_*_seed.sql) are applied only when
#        APPLY_SEEDS=1 (CI / local dev). Production must not set it.
# G-718: 021b_tenant_fk_constraints.sql is applied only when APPLY_STRICT_FKS=1.
#        Every applied file is recorded in schema_migrations (filename+sha256).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="$ROOT/db/sql"
DRY_RUN=0
APPLY_SEEDS="${APPLY_SEEDS:-0}"
APPLY_STRICT_FKS="${APPLY_STRICT_FKS:-0}"

usage() {
  cat <<'EOF'
Usage: apply-sql.sh [--dry-run] [--help]

Apply all db/sql/[0-9]*.sql files in LC_ALL=C sort order via psql
(-v ON_ERROR_STOP=1). Exits non-zero on first failure.

  --dry-run   List files that would be applied; do not run psql
  --help      Show this help

Environment:
  MIGRATOR_DATABASE_URL  Table-owning / DDL role URL (preferred for apply)
  DATABASE_URL           Used when MIGRATOR_DATABASE_URL is unset
  PGDATABASE             Used when neither URL is set (default: proctira)
  PGHOST/PGPORT/PGUSER/PGPASSWORD  Standard libpq vars when URL unset
  APPLY_SEEDS=1          Also apply db/sql/*b_*_seed.sql demo rows (never in prod)
  APPLY_STRICT_FKS=1     Also apply 021b_tenant_fk_constraints.sql
EOF
}

is_seed_file() {
  [[ "$(basename "$1")" =~ ^[0-9]+b_.*_seed\.sql$ ]]
}

is_strict_fk_file() {
  [[ "$(basename "$1")" == "021b_tenant_fk_constraints.sql" ]]
}

file_checksum() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "n/a"
  fi
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
mapfile -t ALL_SQL_FILES < <(
  shopt -s nullglob
  printf '%s\n' "$SQL_DIR"/[0-9]*.sql | LC_ALL=C sort
)

SQL_FILES=()
SKIPPED=()
for f in "${ALL_SQL_FILES[@]}"; do
  if is_seed_file "$f" && [[ "$APPLY_SEEDS" != "1" ]]; then
    SKIPPED+=("${f#"$ROOT"/} (seed; set APPLY_SEEDS=1)")
    continue
  fi
  if is_strict_fk_file "$f" && [[ "$APPLY_STRICT_FKS" != "1" ]]; then
    SKIPPED+=("${f#"$ROOT"/} (strict FKs; set APPLY_STRICT_FKS=1)")
    continue
  fi
  SQL_FILES+=("$f")
done

if [[ ${#SQL_FILES[@]} -eq 0 ]]; then
  echo "error: no files matching db/sql/[0-9]*.sql" >&2
  exit 1
fi

echo "==> Domain SQL apply order (${#SQL_FILES[@]} files)"
for f in "${SQL_FILES[@]}"; do
  echo "  - ${f#"$ROOT"/}"
done
if [[ ${#SKIPPED[@]} -gt 0 ]]; then
  echo "==> Skipped (${#SKIPPED[@]})"
  for s in "${SKIPPED[@]}"; do
    echo "  - $s"
  done
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "==> Dry run only (seeds under db/seeds/ are documented separately; not applied)"
  exit 0
fi

PSQL_ARGS=(-v ON_ERROR_STOP=1)
# W1-DATA-01: DDL must run as the table owner (migrator), not the runtime app role.
APPLY_DATABASE_URL="${MIGRATOR_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -n "${APPLY_DATABASE_URL}" ]]; then
  PSQL_TARGET=("$APPLY_DATABASE_URL")
  if [[ -n "${MIGRATOR_DATABASE_URL:-}" ]]; then
    echo "==> Using MIGRATOR_DATABASE_URL for domain SQL apply"
  fi
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

# G-718: record every applied file in the ledger (021 creates the table; the
# loop above has already run it by this point).
echo "==> Recording ${#SQL_FILES[@]} files in schema_migrations"
for f in "${SQL_FILES[@]}"; do
  name="$(basename "$f")"
  sum="$(file_checksum "$f")"
  psql "${PSQL_TARGET[@]}" "${PSQL_ARGS[@]}" -q \
    -v name="$name" -v sum="$sum" <<'SQL'
INSERT INTO schema_migrations (filename, checksum)
VALUES (:'name', :'sum')
ON CONFLICT (filename) DO UPDATE SET checksum = EXCLUDED.checksum, applied_at = NOW();
SQL
done

echo "==> Domain SQL apply complete"
echo "Note: db/seeds/*.sql (demo/cert data) were not applied. See db/README.md."
