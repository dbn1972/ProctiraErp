#!/usr/bin/env bash
# Apply numbered domain SQL under db/sql/ (after Prisma migrate deploy).
# Gap G-002: CI / live setup must apply 001–N so raw-SQL modules hit Postgres.
#
# W1-DATA-05 — ledger-safe resume (fail-closed):
#   - Bootstrap schema_migrations before any file apply.
#   - Per file: skip when ledger checksum matches; fail on mismatch;
#     adopt legacy NULL checksum rows without re-applying.
#   - Prefer one transaction per file (psql --single-transaction) so a failed
#     file rolls back and is not recorded. See "Multi-statement limits" below.
#   - Record filename + sha256 in schema_migrations only after successful apply.
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
#
# Multi-statement limits (per-file transaction):
#   psql --single-transaction wraps each file + its ledger INSERT. Statements
#   that cannot run inside a transaction block (notably CREATE INDEX
#   CONCURRENTLY, VACUUM, and some ALTER TYPE … ADD VALUE forms on older
#   Postgres) must either be avoided under db/sql/ or applied with
#   APPLY_SQL_NO_TX=1 (disables -1 for every file — use only when required).
#   Files whose text matches CONCURRENTLY are applied without -1 automatically.
#   Whole-set atomicity across all numbered files is intentionally not
#   attempted; resume safety is the ledger + per-file transactions.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL_DIR="${APPLY_SQL_DIR:-$ROOT/db/sql}"
DRY_RUN=0
APPLY_SEEDS="${APPLY_SEEDS:-0}"
APPLY_STRICT_FKS="${APPLY_STRICT_FKS:-0}"
APPLY_SQL_NO_TX="${APPLY_SQL_NO_TX:-0}"

usage() {
  cat <<'EOF'
Usage: apply-sql.sh [--dry-run] [--help]

Apply all db/sql/[0-9]*.sql files in LC_ALL=C sort order via psql
(-v ON_ERROR_STOP=1). Exits non-zero on first failure.

  --dry-run   List files that would be considered; do not run psql
  --help      Show this help

Environment:
  MIGRATOR_DATABASE_URL  Table-owning / DDL role URL (preferred for apply)
  DATABASE_URL           Used when MIGRATOR_DATABASE_URL is unset
  PGDATABASE             Used when neither URL is set (default: proctira)
  PGHOST/PGPORT/PGUSER/PGPASSWORD  Standard libpq vars when URL unset
  APPLY_SEEDS=1          Also apply db/sql/*b_*_seed.sql demo rows (never in prod)
  APPLY_STRICT_FKS=1     Also apply 021b_tenant_fk_constraints.sql
  APPLY_SQL_DIR          Override SQL directory (tests / fixtures)
  APPLY_SQL_NO_TX=1      Disable per-file --single-transaction for all files

W1-DATA-05 ledger:
  Applied files are recorded in schema_migrations (filename + sha256).
  Re-runs skip unchanged checksums and fail closed on checksum mismatch.
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
    echo ""
  fi
}

file_needs_no_tx() {
  # CREATE INDEX CONCURRENTLY (and similar) cannot run inside a transaction.
  grep -qiE '[[:space:]]CONCURRENTLY[[:space:]]' "$1" 2>/dev/null
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
  echo "error: no files matching ${SQL_DIR#"$ROOT"/}/[0-9]*.sql (or APPLY_SQL_DIR)" >&2
  exit 1
fi

echo "==> Domain SQL apply order (${#SQL_FILES[@]} files) [W1-DATA-05 ledger-safe]"
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

psql_q() {
  psql "${PSQL_TARGET[@]}" "${PSQL_ARGS[@]}" "$@"
}

echo "==> Ensuring schema_migrations ledger exists"
psql_q -q <<'SQL'
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename    TEXT PRIMARY KEY,
  checksum    TEXT,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_by  TEXT NOT NULL DEFAULT current_user
);
SQL

APPLIED=0
LEDGER_SKIPPED=0
ADOPTED=0

for f in "${SQL_FILES[@]}"; do
  rel="${f#"$ROOT"/}"
  name="$(basename "$f")"
  sum="$(file_checksum "$f")"
  if [[ -z "$sum" || "$sum" == "n/a" ]]; then
    echo "error: W1-DATA-05 fail-closed: cannot compute sha256 for $rel (need sha256sum or shasum)" >&2
    exit 1
  fi

  # status: missing | null | <hex>
  status="$(
    psql_q -At -v name="$name" <<'SQL'
SELECT CASE
  WHEN NOT EXISTS (
    SELECT 1 FROM schema_migrations WHERE filename = :'name'
  ) THEN 'missing'
  WHEN (
    SELECT checksum FROM schema_migrations WHERE filename = :'name'
  ) IS NULL THEN 'null'
  ELSE (
    SELECT checksum FROM schema_migrations WHERE filename = :'name'
  )
END;
SQL
  )"

  if [[ "$status" == "$sum" ]]; then
    echo "==> Skip $rel (ledger checksum match)"
    LEDGER_SKIPPED=$((LEDGER_SKIPPED + 1))
    continue
  fi

  if [[ "$status" != "missing" && "$status" != "null" ]]; then
    echo "error: W1-DATA-05 checksum mismatch for $name" >&2
    echo "  ledger: $status" >&2
    echo "  file:   $sum" >&2
    echo "  Refusing to re-apply a drifted migration. Restore the original file or add a new numbered forward migration." >&2
    exit 1
  fi

  if [[ "$status" == "null" ]]; then
    # Legacy self-insert / pre-checksum ledger row: adopt current digest, do not re-apply.
    echo "==> Adopt NULL checksum for $rel → $sum (skip re-apply)"
    psql_q -q -v name="$name" -v sum="$sum" <<'SQL'
UPDATE schema_migrations
SET checksum = :'sum', applied_at = NOW()
WHERE filename = :'name' AND checksum IS NULL;
SQL
    ADOPTED=$((ADOPTED + 1))
    LEDGER_SKIPPED=$((LEDGER_SKIPPED + 1))
    continue
  fi

  use_tx=1
  if [[ "$APPLY_SQL_NO_TX" == "1" ]] || file_needs_no_tx "$f"; then
    use_tx=0
    echo "==> Applying $rel (no single-transaction; CONCURRENTLY or APPLY_SQL_NO_TX=1)"
  else
    echo "==> Applying $rel (per-file transaction)"
  fi

  TX_ARGS=()
  if [[ "$use_tx" -eq 1 ]]; then
    TX_ARGS+=(--single-transaction)
  fi

  # Same psql session: \i the file then record checksum so --single-transaction
  # commits both or neither (when use_tx=1).
  sql_path_escaped="${f//\'/\'\'}"
  psql_q "${TX_ARGS[@]}" -v name="$name" -v sum="$sum" <<SQL
\i '${sql_path_escaped}'
INSERT INTO schema_migrations (filename, checksum)
VALUES (:'name', :'sum')
ON CONFLICT (filename) DO UPDATE
SET checksum = EXCLUDED.checksum, applied_at = NOW();
SQL

  APPLIED=$((APPLIED + 1))
done

echo "==> Domain SQL apply complete (applied=$APPLIED, ledger_skipped=$LEDGER_SKIPPED, null_checksum_adopted=$ADOPTED)"
echo "Note: db/seeds/*.sql (demo/cert data) were not applied. See db/README.md."
