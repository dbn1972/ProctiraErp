#!/usr/bin/env bash
# Tear the UAT stack down. Manual only: nothing schedules or calls this script.
#   uatenv-teardown.sh             stop and remove the proctira-uatenv containers
#                                  (volumes, images, secrets and backups are kept)
#   uatenv-teardown.sh --volumes   also delete the proctira-uatenv_* volumes
#                                  (second confirmation; all UAT data is lost)
# The nightly backup timer is disabled in both cases.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

DELETE_VOLUMES=0
case "${1:-}" in
  --volumes) DELETE_VOLUMES=1 ;;
  '') ;;
  *) uatenv_die "usage: uatenv-teardown.sh [--volumes]" ;;
esac

export UATENV_RELEASE
UATENV_RELEASE="$(uatenv_release_dir)"
echo "This stops and removes every $UATENV_PROJECT container on this host." >&2
confirm_typed proctira-uatenv "Type 'proctira-uatenv' to tear down: "
DOWN_ARGS=(--remove-orphans)
if ((DELETE_VOLUMES)); then
  echo "The $UATENV_PROJECT volumes (Postgres, Keycloak, Redis, RabbitMQ, Kafka, MinIO) will be deleted." >&2
  confirm_typed delete-volumes "Type 'delete-volumes' to delete them: "
  DOWN_ARGS+=(--volumes)
fi

uatenv_compose --profile secondary down "${DOWN_ARGS[@]}"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user disable --now proctira-uatenv-backup.timer 2>/dev/null || true
uatenv_log "teardown complete (volumes $( ((DELETE_VOLUMES)) && echo deleted || echo kept))"
