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
# W1-DATA-10 role bootstrap:
#   When BOOTSTRAP_DATABASE_URL is set, runs tools/scripts/bootstrap-db-roles.sh
#   before the ledger apply so fresh installs do not need hand-written CREATE ROLE.
#   The only manual prerequisite remains a superuser/CREATEROLE bootstrap URL.
#
# Seeds under db/seeds/ are NOT applied here — they are demo/cert data and may
# be destructive. Apply them explicitly (see db/README.md).
#
# G-705: demo seed files inside db/sql (NNNb_*_seed.sql) are applied only when
#        APPLY_SEEDS=1 (CI / local dev). Production must not set it.
# G-718 / W1-DATA-06 COMPLETE: 021a + 021b (create), 068 (VALIDATE), and 076
#        (repair create+validate+assert) apply when APPLY_STRICT_FKS=1.
#        Default ON when CI=true or NODE_ENV=production; local fixtures may set
#        APPLY_STRICT_FKS=0. Gate: tools/scripts/check-strict-tenant-fks.mjs.
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
#
# W1-DATA-17 — session timeouts (online-safe apply):
#   Every psql session sets lock_timeout + statement_timeout before DDL so a
#   blocked ACCESS EXCLUSIVE wait fails the deploy instead of queuing app
#   traffic. Defaults: lock 5s, statement 30min (override via
#   APPLY_SQL_LOCK_TIMEOUT / APPLY_SQL_STATEMENT_TIMEOUT). See
#   tools/scripts/migration-timeouts.sh and docs/audits/DATA_W1_DATA_17_TIMEOUTS.md.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=migration-timeouts.sh
source "$ROOT/tools/scripts/migration-timeouts.sh"
SQL_DIR="${APPLY_SQL_DIR:-$ROOT/db/sql}"
DRY_RUN=0
APPLY_SEEDS="${APPLY_SEEDS:-0}"
# W1-DATA-06 COMPLETE: production/CI default ON; explicit 0/1 always wins.
if [[ -z "${APPLY_STRICT_FKS+x}" ]]; then
  if [[ "${CI:-}" == "true" || "${NODE_ENV:-}" == "production" ]]; then
    APPLY_STRICT_FKS=1
  else
    APPLY_STRICT_FKS=0
  fi
fi
APPLY_SQL_NO_TX="${APPLY_SQL_NO_TX:-0}"
BOOTSTRAP_SCRIPT="$ROOT/tools/scripts/bootstrap-db-roles.sh"

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
  BOOTSTRAP_DATABASE_URL Superuser URL — when set, runs bootstrap-db-roles.sh first
  APPLY_SEEDS=1          Also apply db/sql/*b_*_seed.sql demo rows (never in prod)
  APPLY_STRICT_FKS=1     Apply 021a/021b create, 068 VALIDATE, 076 repair (prod/CI default)
  APPLY_STRICT_FKS=0     Skip strict tenant FK files (local unit fixtures only)
  APPLY_SQL_DIR          Override SQL directory (tests / fixtures)
  APPLY_SQL_NO_TX=1      Disable per-file --single-transaction for all files
  APPLY_SQL_LOCK_TIMEOUT     Session lock_timeout (default: 5s / MIGRATION_LOCK_TIMEOUT)
  APPLY_SQL_STATEMENT_TIMEOUT Session statement_timeout (default: 30min)

W1-DATA-05 ledger:
  Applied files are recorded in schema_migrations (filename + sha256).
  Re-runs skip unchanged checksums and fail closed on checksum mismatch.

W1-DATA-10 bootstrap:
  See db/bootstrap/README.md and tools/scripts/bootstrap-db-roles.sh.

W1-DATA-17 timeouts:
  Every psql session SETs lock_timeout + statement_timeout before DDL.
  On lock_timeout / lock_not_available, re-run this script after blockers
  release — the failed file is not ledger-recorded (per-file transaction).

W1-DATA-11 privileges:
  After numbered SQL, runs apply-runtime-table-privileges.sh to sync
  proctira_app grants from db/runtime-table-privileges.json (no table
  DEFAULT PRIVILEGES blanket).
EOF
}

is_seed_file() {
  [[ "$(basename "$1")" =~ ^[0-9]+b_.*_seed\.sql$ ]]
}

is_strict_fk_file() {
  local base
  base="$(basename "$1")"
  # Create (021a/021b), VALIDATE (068), and repair (076) share the same gate so
  # 068 cannot be ledger-recorded as a no-op when create was skipped.
  case "$base" in
    021a_strict_fk_prerequisite_tenants.sql|\
    021b_tenant_fk_constraints.sql|\
    068_validate_tenant_fk_constraints.sql|\
    082_repair_strict_tenant_fk_validate.sql)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
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
  if [[ -n "${BOOTSTRAP_DATABASE_URL:-}" ]]; then
    echo "==> Would run W1-DATA-10 bootstrap-db-roles.sh (BOOTSTRAP_DATABASE_URL set)"
  fi
  emit_migration_timeout_banner "==> W1-DATA-17 (dry-run would set)"
  echo "==> Would sync W1-DATA-11 runtime table privileges (apply-runtime-table-privileges.sh)"
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

emit_migration_timeout_banner
# Also export PGOPTIONS so any nested libpq helpers inherit the same bounds.
export_migration_timeout_pgoptions

# W1-DATA-17: prepend SET lock_timeout / statement_timeout on every session.
# stdin (heredoc from callers) is concatenated after the SETs so --single-
# transaction still wraps timeouts + file + ledger INSERT together.
psql_q() {
  {
    printf "SET lock_timeout TO '%s';\n" "${APPLY_SQL_LOCK_TIMEOUT}"
    printf "SET statement_timeout TO '%s';\n" "${APPLY_SQL_STATEMENT_TIMEOUT}"
    cat
  } | psql "${PSQL_TARGET[@]}" "${PSQL_ARGS[@]}" "$@"
}

# W1-DATA-10: create migrator + runtime roles before ledger apply when asked.
maybe_bootstrap_roles() {
  if [[ -z "${BOOTSTRAP_DATABASE_URL:-}" ]]; then
    return 0
  fi
  if [[ ! -x "$BOOTSTRAP_SCRIPT" && ! -f "$BOOTSTRAP_SCRIPT" ]]; then
    echo "error: bootstrap script missing: $BOOTSTRAP_SCRIPT" >&2
    exit 1
  fi
  echo "==> W1-DATA-10: BOOTSTRAP_DATABASE_URL set — running bootstrap-db-roles.sh"
  # shellcheck disable=SC2086
  bash "$BOOTSTRAP_SCRIPT"
}

maybe_bootstrap_roles

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
  # -q suppresses SET tags from the W1-DATA-17 timeout preamble on stdout.
  status="$(
    psql_q -Atq -v name="$name" <<'SQL'
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
  # Tolerate incidental whitespace from psql wrappers.
  status="$(printf '%s' "$status" | tr -d '\r' | awk 'NF{p=$0} END{print p}')"

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
  if ! psql_q "${TX_ARGS[@]}" -v name="$name" -v sum="$sum" <<SQL
\i '${sql_path_escaped}'
INSERT INTO schema_migrations (filename, checksum)
VALUES (:'name', :'sum')
ON CONFLICT (filename) DO UPDATE
SET checksum = EXCLUDED.checksum, applied_at = NOW();
SQL
  then
    echo "error: W1-DATA-17 apply failed for $rel" >&2
    echo "  If psql reported lock_not_available / canceling statement due to lock_timeout:" >&2
    echo "  wait for the blocking session to end (or schedule a maintenance window), then" >&2
    echo "  re-run this script. Ledger-safe resume: $name was not recorded in schema_migrations." >&2
    echo "  Drill: node tools/scripts/migration-lock-recovery-drill.mjs" >&2
    exit 1
  fi

  APPLIED=$((APPLIED + 1))
done

echo "==> Domain SQL apply complete (applied=$APPLIED, ledger_skipped=$LEDGER_SKIPPED, null_checksum_adopted=$ADOPTED)"

# W1-DATA-11 COMPLETE: classify proctira_app privileges from
# db/runtime-table-privileges.json (no blanket TABLE DEFAULT PRIVILEGES).
PRIV_SYNC="$ROOT/tools/scripts/apply-runtime-table-privileges.sh"
if [[ ! -f "$PRIV_SYNC" ]]; then
  echo "error: missing privilege sync script: $PRIV_SYNC" >&2
  exit 1
fi
# Preserve migrator URL for the sync (same connection posture as numbered SQL).
if [[ -n "${APPLY_DATABASE_URL}" ]]; then
  MIGRATOR_DATABASE_URL="${MIGRATOR_DATABASE_URL:-$APPLY_DATABASE_URL}" \
    bash "$PRIV_SYNC"
else
  bash "$PRIV_SYNC"
fi

echo "Note: db/seeds/*.sql (demo/cert data) were not applied. See db/README.md."
