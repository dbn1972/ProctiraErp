#!/usr/bin/env bash
# First install of the ProctiraERP UAT environment on this host.
#
#   uatenv-deploy.sh --sha <sha> [--with-secondary] [--stage <stage>]
#
# Stages (default: all, in this order):
#   prepare   install runtime/tooling, generate secrets (never replaced), extract
#             the release with git archive, host pnpm install, render nginx + realm
#   build     build the images one at a time from the Release Dockerfiles
#   data      datastores up; roles (bootstrap-db-roles.sh); production migrations
#             (run-target-database-migrations.sh + runtime gates); seeds; bucket
#   keycloak  Keycloak up; realm deltas; UAT role users; direct-grant check
#   apps      gateway, workers, web, portals and proxy up; portal users linked
#             to Sunrise records (uatenv-link-portal-users.sh); health; state file
#   ops       backup gpg key + nightly systemd user timer
# Later deploys of a new commit use uatenv-redeploy.sh.
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

SHA=''
STAGE=all
while [[ $# -gt 0 ]]; do
  case "$1" in
    --sha) SHA="${2:?--sha needs a commit}"; shift 2 ;;
    --with-secondary) export UATENV_WITH_SECONDARY=1; shift ;;
    --stage) STAGE="${2:?--stage needs a value}"; shift 2 ;;
    *) uatenv_die "unknown argument: $1" ;;
  esac
done
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || uatenv_die "--sha must be a full 40-character commit id"
case "$STAGE" in all | prepare | build | data | keycloak | apps | ops) ;; *) uatenv_die "unknown stage: $STAGE" ;; esac

uatenv_require_tools
umask 077
mkdir -p "$UATENV_RT"/{releases,logs,state,generated/nginx} "$UATENV_BACKUPS" "$UATENV_EVIDENCE" "$UATENV_SEC"
chmod 700 "$UATENV_SEC" "$UATENV_BACKUPS"
chmod 755 "$UATENV_RT" "$UATENV_RT/generated" "$UATENV_RT/generated/nginx"
umask 022
REL="$UATENV_RT/releases/$SHA"
export UATENV_RELEASE="$REL"
TOOLS="$UATENV_RT/tooling/tools/scripts/uatenv"
mapfile -t APPS < <(uatenv_apps)

run_stage() { [[ "$STAGE" == all || "$STAGE" == "$1" ]]; }

if run_stage prepare; then
  uatenv_install_tooling "${UATENV_TOOLING_REF:-}"
  bash "$TOOLS/uatenv-secrets.sh"
  uatenv_extract_release "$SHA"
  [[ -e "$UATENV_RT/current" ]] || ln -sfn "releases/$SHA" "$UATENV_RT/current"
  uatenv_pnpm_install "$REL"
  uatenv_render_configs "$REL"
fi

if run_stage build; then
  uatenv_build_images "$REL" "${APPS[@]}"
  uatenv_patch_prisma_openssl "$REL" "${APPS[@]}"
fi

if run_stage data; then
  assert_ports_free
  uatenv_guard
  uatenv_compose up -d "${UATENV_DATASTORES[@]}"
  wait_healthy "${UATENV_DATASTORES[@]}"
  bash "$TOOLS/uatenv-db-bootstrap.sh"
  uatenv_migrate "$REL"
  bash "$TOOLS/uatenv-seed.sh"
  uatenv_compose run --rm --no-deps -T \
    -v "$TOOLS:/uatenv:ro" --entrypoint node api-gateway /uatenv/uatenv-s3.mjs ensure
fi

if run_stage keycloak; then
  uatenv_guard
  uatenv_compose up -d keycloak
  wait_healthy keycloak
  bash "$TOOLS/uatenv-keycloak.sh"
  bash "$TOOLS/uatenv-keycloak.sh" --verify
fi

if run_stage apps; then
  uatenv_guard
  # shellcheck disable=SC2046
  uatenv_compose $(uatenv_profile_args) up -d "${APPS[@]}" proxy
  uatenv_reload_proxy
  wait_healthy "${APPS[@]}" proxy
  bash "$TOOLS/uatenv-link-portal-users.sh"
  ln -sfn "releases/$SHA" "$UATENV_RT/current"
  uatenv_write_state "$SHA" "proxy ${UATENV_DATASTORES[*]} keycloak ${APPS[*]}"
  bash "$TOOLS/uatenv-health.sh" --json "$UATENV_EVIDENCE/services-$(date -u +%Y%m%dT%H%M%SZ).json"
fi

if run_stage ops; then
  bash "$TOOLS/uatenv-backup.sh" --init-key
  bash "$TOOLS/uatenv-install-timer.sh"
fi
uatenv_log "deploy stage '$STAGE' complete for $SHA"
