#!/usr/bin/env bash
# UAT seed data, applied as the migrator (proctira, NOSUPERUSER NOBYPASSRLS):
#   - tools/e2e/seed-e2e-tenants.sql       second tenant (e2e-tenant-a) for cross-tenant checks
#   - tools/e2e/seed-e2e-registration.sql  registration-portal fixture tenant (e2e-registration)
#   - db/seeds/006_sunrise_public_school_demo.sql  Sunrise demo tenant (guarded:
#     PGOPTIONS "-c proctira.allow_demo_seed=on" for this connection only)
# Then prints tenant row counts. Idempotent.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

REL="${UATENV_RELEASE:-$(uatenv_release_dir)}"
load_env_file "$UATENV_SEC/ops.env"
REG_TENANT_ID="${UATENV_REGISTRATION_TENANT_ID:-00000000-0000-4000-8000-00000000e001}"
REG_SLUG="${UATENV_REGISTRATION_TENANT_SLUG:-e2e-registration}"
REG_INSTITUTION_ID="${UATENV_REGISTRATION_INSTITUTION_ID:-00000000-0000-4000-8000-00000000e101}"

uatenv_log "seed-e2e-tenants.sql"
uatenv_psql "$MIGRATOR_DATABASE_URL" -q -f "$REL/tools/e2e/seed-e2e-tenants.sql" >/dev/null
uatenv_log "seed-e2e-registration.sql ($REG_SLUG)"
uatenv_psql "$MIGRATOR_DATABASE_URL" -q -v tenant_id="$REG_TENANT_ID" -v slug="$REG_SLUG" \
  -v institution_id="$REG_INSTITUTION_ID" -f "$REL/tools/e2e/seed-e2e-registration.sql" >/dev/null
uatenv_log "006_sunrise_public_school_demo.sql (allow_demo_seed=on for this connection)"
PGOPTIONS='-c proctira.allow_demo_seed=on' \
  uatenv_psql "$MIGRATOR_DATABASE_URL" -q -f "$REL/db/seeds/006_sunrise_public_school_demo.sql" >/dev/null

uatenv_log "seeded tenants"
uatenv_psql "$MIGRATOR_DATABASE_URL" -At <<'SQL'
BEGIN;
SELECT set_config('app.platform_admin', '1', true) \g /dev/null
SELECT t.slug || ' students=' || (SELECT count(*) FROM students s WHERE s.tenant_id = t.id)
       || ' institutions=' || (SELECT count(*) FROM institutions i WHERE i.tenant_id = t.id)
  FROM tenants t
 WHERE t.slug IN ('sunrise-public-school', 'e2e-tenant-a', 'e2e-registration')
 ORDER BY t.slug;
COMMIT;
SQL
