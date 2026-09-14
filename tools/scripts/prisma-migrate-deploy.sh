#!/usr/bin/env bash
# W1-DATA-17 — Prisma migrate deploy with lock_timeout + statement_timeout.
#
# Prefer this wrapper (wired as @proctira/database prisma:migrate:deploy) over
# bare `prisma migrate deploy` so staging/prod DDL cannot wait forever on locks.
#
# Usage (from repo or via pnpm filter):
#   bash tools/scripts/prisma-migrate-deploy.sh
#   pnpm --filter @proctira/database run prisma:migrate:deploy
#
# Connection:
#   Prefers MIGRATOR_DATABASE_URL (table-owning role), then DATABASE_URL.
#   Injects libpq `options=` for Prisma; also exports PGOPTIONS for any nested
#   libpq tools.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck source=migration-timeouts.sh
source "$ROOT/tools/scripts/migration-timeouts.sh"

DB_PKG="$ROOT/packages/shared/database"
if [[ ! -d "$DB_PKG" ]]; then
  echo "error: database package not found: $DB_PKG" >&2
  exit 1
fi

APPLY_URL="${MIGRATOR_DATABASE_URL:-${DATABASE_URL:-}}"
if [[ -z "$APPLY_URL" ]]; then
  echo "error: set MIGRATOR_DATABASE_URL or DATABASE_URL for prisma migrate deploy" >&2
  exit 1
fi

emit_migration_timeout_banner "==> W1-DATA-17 prisma migrate deploy"
export_migration_timeout_pgoptions

# Prisma's query engine honors URL `options=`, not necessarily PGOPTIONS alone.
export DATABASE_URL
DATABASE_URL="$(inject_migration_timeout_url "$APPLY_URL")"
if [[ -n "${MIGRATOR_DATABASE_URL:-}" ]]; then
  export MIGRATOR_DATABASE_URL
  MIGRATOR_DATABASE_URL="$(inject_migration_timeout_url "$MIGRATOR_DATABASE_URL")"
  echo "==> Using MIGRATOR_DATABASE_URL for Prisma migrate deploy"
fi

cd "$DB_PKG"
if [[ -x "$DB_PKG/node_modules/.bin/prisma" ]]; then
  exec "$DB_PKG/node_modules/.bin/prisma" migrate deploy "$@"
fi
if command -v prisma >/dev/null 2>&1; then
  exec prisma migrate deploy "$@"
fi
# Last resort when filter install laid bins under the workspace root.
if [[ -x "$ROOT/node_modules/.bin/prisma" ]]; then
  exec "$ROOT/node_modules/.bin/prisma" migrate deploy "$@"
fi

echo "error: prisma CLI not found (run pnpm install)" >&2
exit 1
