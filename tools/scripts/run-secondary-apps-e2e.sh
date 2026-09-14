#!/usr/bin/env bash
# W1-OPS-12 — run Chromium Playwright smokes for affected secondary Next apps.
# Ungated public/auth surfaces always execute; live-backend describes skip unless
# E2E_BACKEND_READY=1 (not set here — honest residual for gateway-backed paths).
#
# Env (from ci.yml paths-filter outputs): ADMIN_CONSOLE, DEVELOPER_PORTAL,
# INSTALL_WIZARD, PUBLIC_WEBSITE, REGISTRATION_PORTAL, HARNESS — each "true"/"false".
# When HARNESS=true (workflow/script change), all five apps run.
set -euo pipefail

truthy() {
  case "${1:-}" in
    true|TRUE|1|yes|YES) return 0 ;;
    *) return 1 ;;
  esac
}

RUN_ALL=0
if truthy "${HARNESS:-}"; then
  RUN_ALL=1
fi

declare -a SELECTED=()

maybe_add() {
  local flag="$1"
  local pkg="$2"
  if [[ "$RUN_ALL" -eq 1 ]] || truthy "$flag"; then
    SELECTED+=("$pkg")
  fi
}

maybe_add "${ADMIN_CONSOLE:-}" "@proctira/admin-console"
maybe_add "${DEVELOPER_PORTAL:-}" "@proctira/developer-portal"
maybe_add "${INSTALL_WIZARD:-}" "@proctira/install-wizard"
maybe_add "${PUBLIC_WEBSITE:-}" "@proctira/public-website"
maybe_add "${REGISTRATION_PORTAL:-}" "@proctira/registration-portal"

if [[ "${#SELECTED[@]}" -eq 0 ]]; then
  echo "No secondary apps selected (unexpected with secondary-apps-changed=true)." >&2
  exit 1
fi

{
  echo "## Secondary Apps Playwright (W1-OPS-12)"
  echo ""
  echo "- Apps: ${SELECTED[*]}"
  echo "- Browser project: chromium only (mobile-chrome deferred)"
  echo "- E2E_BACKEND_READY: unset (live-backend describes skip)"
  echo ""
} >> "${GITHUB_STEP_SUMMARY:-/dev/null}" 2>/dev/null || true

echo "Selected secondary apps: ${SELECTED[*]}"

status=0
for pkg in "${SELECTED[@]}"; do
  echo "::group::Playwright chromium — ${pkg}"
  if ! pnpm --filter "$pkg" exec playwright install --with-deps chromium; then
    echo "::error::playwright install failed for ${pkg}"
    status=1
    echo "::endgroup::"
    continue
  fi
  if ! pnpm --filter "$pkg" exec playwright test --project=chromium; then
    echo "::error::playwright test failed for ${pkg}"
    status=1
  fi
  echo "::endgroup::"
done

exit "$status"
