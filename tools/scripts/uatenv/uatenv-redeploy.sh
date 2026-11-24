#!/usr/bin/env bash
# Redeploy the UAT stack to another commit.
#
#   uatenv-redeploy.sh <sha> [--with-secondary] [--tooling-ref <git ref>]
#
#   1. the commit must exist and its `CI` push run on main must be green
#      (gh run list); UATENV_SKIP_CI_CHECK=1 overrides and is logged
#   2. git archive the commit into runtime/releases/<sha>; host pnpm install
#   3. build the images one at a time (guarded)
#   4. pre-migration backup, then production migrations as the migrator
#   5. recreate the services on the new images; wait for health
#   6. on failure, bring the previous release back up (schema changes are
#      forward-only: the previous images must tolerate the new schema)
#   7. update runtime/current + state/deployed.json; keep the current and
#      previous releases and images, prune older ones
# --tooling-ref reinstalls runtime/tooling from a git ref (e.g. origin/main).
set -euo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

SHA="${1:-}"
shift || true
TOOLING_REF=''
while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-secondary) export UATENV_WITH_SECONDARY=1; shift ;;
    --tooling-ref) TOOLING_REF="${2:?--tooling-ref needs a ref}"; shift 2 ;;
    *) uatenv_die "unknown argument: $1" ;;
  esac
done
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || uatenv_die "usage: uatenv-redeploy.sh <40-char sha> [--with-secondary] [--tooling-ref <ref>]"
uatenv_require_tools
git -C "$UATENV_GIT_DIR" cat-file -e "$SHA^{commit}" 2>/dev/null || uatenv_die "commit $SHA not found (git fetch first)"
# Keep secondary apps if they are already deployed.
docker inspect "$UATENV_PROJECT-admin-console-1" >/dev/null 2>&1 && export UATENV_WITH_SECONDARY=1

if [[ "${UATENV_SKIP_CI_CHECK:-0}" == "1" ]]; then
  uatenv_log "WARNING: UATENV_SKIP_CI_CHECK=1 - CI status of $SHA not checked"
else
  command -v gh >/dev/null 2>&1 || uatenv_die "gh is required for the CI check (or set UATENV_SKIP_CI_CHECK=1)"
  CI_ROW="$(gh run list --commit "$SHA" --branch main --workflow CI --event push --json conclusion,url --limit 1 \
    -q '.[0] | (.conclusion + " " + .url)' 2>/dev/null || true)"
  [[ "$CI_ROW" == success* ]] || uatenv_die "CI push run for $SHA on main is not green (${CI_ROW:-none}); refusing"
  export UATENV_CI_URL="${CI_ROW#success }"
  uatenv_log "CI green: $UATENV_CI_URL"
fi

PREV_REL=''
[[ -L "$UATENV_RT/current" ]] && PREV_REL="$(readlink -f "$UATENV_RT/current")"
REL="$UATENV_RT/releases/$SHA"
TOOLS="$UATENV_RT/tooling/tools/scripts/uatenv"
mapfile -t APPS < <(uatenv_apps)

[[ -n "$TOOLING_REF" ]] && uatenv_install_tooling "$TOOLING_REF"
bash "$TOOLS/uatenv-secrets.sh"
uatenv_extract_release "$SHA"
uatenv_pnpm_install "$REL"
uatenv_render_configs "$REL"
uatenv_build_images "$REL" "${APPS[@]}"
uatenv_patch_prisma_openssl "$REL" "${APPS[@]}"

if [[ -n "$PREV_REL" ]]; then
  uatenv_log "pre-migration backup"
  bash "$TOOLS/uatenv-backup.sh"
fi
uatenv_migrate "$REL"

DEPLOYED=0
rollback() {
  [[ "$DEPLOYED" == 1 ]] && return 0
  [[ -n "$PREV_REL" && "$PREV_REL" != "$REL" ]] || return 0
  uatenv_log "deploy of $SHA failed; bringing $(basename "$PREV_REL") back up"
  uatenv_render_configs "$PREV_REL"
  # shellcheck disable=SC2046
  UATENV_RELEASE="$PREV_REL" uatenv_compose $(uatenv_profile_args) up -d "${APPS[@]}" proxy || true
  UATENV_RELEASE="$PREV_REL" uatenv_reload_proxy || true
}
trap 'rollback' EXIT

export UATENV_RELEASE="$REL"
uatenv_guard
# shellcheck disable=SC2046
uatenv_compose $(uatenv_profile_args) up -d --remove-orphans "${UATENV_DATASTORES[@]}" keycloak "${APPS[@]}" proxy
uatenv_reload_proxy
wait_healthy "${UATENV_DATASTORES[@]}" keycloak "${APPS[@]}" proxy
bash "$TOOLS/uatenv-keycloak.sh"
DEPLOYED=1
trap - EXIT

ln -sfn "releases/$SHA" "$UATENV_RT/current"
uatenv_write_state "$SHA" "proxy ${UATENV_DATASTORES[*]} keycloak ${APPS[*]}"
bash "$TOOLS/uatenv-health.sh" --json "$UATENV_EVIDENCE/services-$(date -u +%Y%m%dT%H%M%SZ).json"

# Prune: keep the current and the previous release (dirs and images).
KEEP=("$(basename "$REL")")
[[ -n "$PREV_REL" ]] && KEEP+=("$(basename "$PREV_REL")")
for dir in "$UATENV_RT"/releases/*; do
  [[ -d "$dir" ]] || continue
  name="$(basename "$dir")"
  [[ " ${KEEP[*]} " == *" $name "* ]] && continue
  uatenv_log "pruning release $name"
  rm -rf "$dir"
  docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E "^proctira/[a-z-]+:uatenv-${name:0:12}$" | xargs -r docker image rm >/dev/null || true
done
uatenv_log "redeploy complete: $SHA"
