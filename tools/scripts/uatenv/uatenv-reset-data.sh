#!/usr/bin/env bash
# Reset UAT application data to the seeded state. Asks for confirmation.
#   1. stop the app services      2. DROP DATABASE proctira WITH (FORCE)
#   3. roles, migrations, seeds   4. Redis FLUSHALL
#   5. empty the MinIO bucket     6. start the apps, health check
# Keycloak (its database and the UAT role users) is kept. Never scheduled.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

REL="$(uatenv_release_dir)"
export UATENV_RELEASE="$REL"
docker inspect "$UATENV_PROJECT-admin-console-1" >/dev/null 2>&1 && export UATENV_WITH_SECONDARY=1
mapfile -t APPS < <(uatenv_apps)

echo "This deletes ALL UAT application data on this host: database 'proctira'," >&2
echo "Redis keys and MinIO objects, then re-seeds the demo tenants." >&2
echo "Keycloak and the UAT role users are kept." >&2
confirm_typed proctira-uatenv "Type 'proctira-uatenv' to reset the data: "

load_env_file "$UATENV_SEC/ops.env"

# A failed step leaves the apps stopped and database proctira partial: say so
# and how to recover instead of exiting silently.
RESET_DONE=0
on_exit() {
  local rc=$?
  [[ "$RESET_DONE" == 1 ]] && return 0
  uatenv_log "RESET FAILED (exit $rc): the app services (${APPS[*]}) are stopped and database proctira may be partial."
  uatenv_log "Recover: fix the cause shown above (logs in $UATENV_RT/logs/), then re-run: bash $0"
  uatenv_log "The reset starts from DROP DATABASE, so a re-run is safe; it ends by starting the apps."
}
trap on_exit EXIT

uatenv_log "stopping app services: ${APPS[*]}"
uatenv_compose stop "${APPS[@]}"

uatenv_log "dropping database proctira"
uatenv_psql "$BOOTSTRAP_DATABASE_URL" -q -c 'DROP DATABASE IF EXISTS proctira WITH (FORCE)'

bash "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-db-bootstrap.sh"
uatenv_migrate "$REL"
bash "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-seed.sh"

uatenv_log "flushing Redis"
uatenv_compose exec -T redis redis-cli FLUSHALL >/dev/null

uatenv_log "emptying the object-storage bucket"
uatenv_compose run --rm --no-deps -T \
  -v "$UATENV_RT/tooling/tools/scripts/uatenv:/uatenv:ro" \
  --entrypoint node api-gateway /uatenv/uatenv-s3.mjs empty

uatenv_log "starting app services"
# shellcheck disable=SC2046
uatenv_compose $(uatenv_profile_args) up -d "${APPS[@]}" proxy
wait_healthy "${APPS[@]}" proxy
bash "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-link-portal-users.sh"
bash "$UATENV_RT/tooling/tools/scripts/uatenv/uatenv-health.sh"
RESET_DONE=1
uatenv_log "reset complete"
