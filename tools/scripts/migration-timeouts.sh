#!/usr/bin/env bash
# W1-DATA-17 — shared migration session timeouts for libpq / Prisma.
#
# Source from apply-sql.sh and prisma-migrate-deploy.sh. Do not execute alone
# as a migration runner.
#
# Defaults intentionally fail lock waits quickly (avoid queue pile-ups behind
# ACCESS EXCLUSIVE DDL) while allowing longer statement runtimes for VALIDATE /
# CONCURRENTLY work. Override per environment:
#   MIGRATION_LOCK_TIMEOUT / MIGRATION_STATEMENT_TIMEOUT
#   APPLY_SQL_LOCK_TIMEOUT / APPLY_SQL_STATEMENT_TIMEOUT (apply-sql aliases)

# shellcheck disable=SC2034
: "${MIGRATION_LOCK_TIMEOUT:=5s}"
: "${MIGRATION_STATEMENT_TIMEOUT:=30min}"
: "${APPLY_SQL_LOCK_TIMEOUT:=${MIGRATION_LOCK_TIMEOUT}}"
: "${APPLY_SQL_STATEMENT_TIMEOUT:=${MIGRATION_STATEMENT_TIMEOUT}}"

# URL-encode a short options string (spaces → %20). Values are constrained to
# Postgres interval tokens (e.g. 5s, 30min) — no user free text.
_migration_timeout_urlencode_options() {
  local opt="$1"
  printf '%s' "$opt" | sed 's/ /%20/g'
}

# Append libpq `options=-c lock_timeout=… -c statement_timeout=…` to a Postgres
# URL so Prisma's engine (and other non-PGOPTIONS clients) pick up the same
# session GUCs. No-ops on empty URLs. Leaves an existing `options=` alone.
inject_migration_timeout_url() {
  local url="${1:-}"
  if [[ -z "$url" ]]; then
    printf '%s' ""
    return 0
  fi
  if [[ "$url" == *"options="* ]]; then
    printf '%s' "$url"
    return 0
  fi
  local opt encoded
  opt="-c lock_timeout=${APPLY_SQL_LOCK_TIMEOUT} -c statement_timeout=${APPLY_SQL_STATEMENT_TIMEOUT}"
  encoded="$(_migration_timeout_urlencode_options "$opt")"
  if [[ "$url" == *"?"* ]]; then
    printf '%s&options=%s' "$url" "$encoded"
  else
    printf '%s?options=%s' "$url" "$encoded"
  fi
}

# Export PGOPTIONS for libpq clients (psql). Prepends our -c flags; preserves
# any pre-existing PGOPTIONS fragment.
export_migration_timeout_pgoptions() {
  local fragment
  fragment="-c lock_timeout=${APPLY_SQL_LOCK_TIMEOUT} -c statement_timeout=${APPLY_SQL_STATEMENT_TIMEOUT}"
  if [[ -n "${PGOPTIONS:-}" ]]; then
    export PGOPTIONS="${fragment} ${PGOPTIONS}"
  else
    export PGOPTIONS="${fragment}"
  fi
}

emit_migration_timeout_banner() {
  # Use :- (not :=): positional $1 cannot be assigned via ${1:=…}.
  local prefix="${1:-===> W1-DATA-17}"
  echo "${prefix} timeouts: lock_timeout=${APPLY_SQL_LOCK_TIMEOUT} statement_timeout=${APPLY_SQL_STATEMENT_TIMEOUT}"
}
