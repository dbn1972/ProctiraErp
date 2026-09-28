#!/usr/bin/env bash
# Dry-run of the deploy/release image coordinate. No registry, cluster, or act.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SCRIPT="${ROOT}/tools/scripts/image-repository.sh"

fail=0
check() {
  local name="$1"
  local got="$2"
  local want="$3"
  if [[ "$got" != "$want" ]]; then
    echo "FAIL ${name}: got '${got}' want '${want}'" >&2
    fail=1
  else
    echo "OK ${name}"
  fi
}

repo="$(bash "$SCRIPT" ghcr.io DBN1972 web)"
check "lowercase owner" "$repo" "ghcr.io/dbn1972/proctira/web"
check "deploy tag" "${repo}:aa373768-20260928130858" \
  "ghcr.io/dbn1972/proctira/web:aa373768-20260928130858"

repo="$(bash "$SCRIPT" ghcr.io ProctiraErp Web)"
check "mixed-case owner and service" "$repo" "ghcr.io/proctiraerp/proctira/web"

repo="$(bash "$SCRIPT" Registry.Example.COM:5000 MyOrg api-gateway)"
check "non-ghcr host and port" "$repo" "registry.example.com:5000/myorg/proctira/api-gateway"

repo="$(bash "$SCRIPT" "ghcr.io/" "/DBN1972/" "web")"
check "trim slashes" "$repo" "ghcr.io/dbn1972/proctira/web"

if bash "$SCRIPT" "https://ghcr.io" dbn1972 web >/dev/null 2>&1; then
  echo "FAIL scheme must be rejected" >&2
  fail=1
else
  echo "OK reject scheme"
fi

if bash "$SCRIPT" ghcr.io "dbn1972/../other" web >/dev/null 2>&1; then
  echo "FAIL dot-dot namespace must be rejected" >&2
  fail=1
else
  echo "OK reject dot-dot namespace"
fi

if bash "$SCRIPT" ghcr.io "" web >/dev/null 2>&1; then
  echo "FAIL empty namespace must be rejected" >&2
  fail=1
else
  echo "OK reject empty namespace"
fi

# Helm --set uses the repository without the tag, same string as the push.
helm_repo="$(bash "$SCRIPT" ghcr.io dbn1972 web)"
check "helm image.repository" "$helm_repo" "ghcr.io/dbn1972/proctira/web"

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "image-repository dry-run OK"
