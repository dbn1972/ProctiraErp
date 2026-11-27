#!/usr/bin/env bash
# UAT-only detail records for the Sunrise demo tenant (UATENV-D17):
#   tools/scripts/uatenv/uatenv-detail-records.sql, applied as the migrator
#   (proctira, NOSUPERUSER NOBYPASSRLS) with the guard
#   PGOPTIONS "-c proctira.allow_uat_seed=on" for this connection only.
# Needs the Sunrise demo seed (uatenv-seed.sh). Idempotent; never a production seed.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"
load_env_file "$UATENV_SEC/ops.env"
uatenv_log "uatenv-detail-records.sql (allow_uat_seed=on for this connection)"
PGOPTIONS='-c proctira.allow_uat_seed=on' \
  uatenv_psql "$MIGRATOR_DATABASE_URL" -q -f "$(dirname "${BASH_SOURCE[0]}")/uatenv-detail-records.sql"
