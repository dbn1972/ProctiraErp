#!/usr/bin/env bash
# Probe every UAT service, directly on its loopback port and through the proxy.
#   uatenv-health.sh [--json <file>]
# Exit 0 only when every probe passes. No credential is printed.
set -uo pipefail
# shellcheck source=uatenv-lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/uatenv-lib.sh"

JSON_OUT=''
[[ "${1:-}" == "--json" ]] && JSON_OUT="${2:?--json needs a file}"
load_env_file "$UATENV_SEC/uatenv.env"
P="${UATENV_PROXY_PORT:-29080}"
PLATFORM="${UATENV_PLATFORM_DOMAIN:-proctira-uat.localhost}"
TENANT_BASE="${UATENV_TENANT_BASE_DOMAIN:-proctira.localhost}"
WITH_SECONDARY=0
docker inspect "$UATENV_PROJECT-admin-console-1" >/dev/null 2>&1 && WITH_SECONDARY=1

ROWS=()
FAILS=0
record() { # name kind target result detail
  ROWS+=("$1"$'\t'"$2"$'\t'"$3"$'\t'"$4"$'\t'"$5")
  [[ "$4" == ok ]] || FAILS=$((FAILS + 1))
  printf '%-34s %-8s %-70s %s %s\n' "$1" "$2" "$3" "$4" "$5"
}

http_probe() { # name url [resolve-host] [expected-code-regex]
  local name="$1" url="$2" host="${3:-}" want="${4:-^2..$}" code args=(-s -o /dev/null -w '%{http_code}' --max-time 15)
  [[ -n "$host" ]] && args+=(--resolve "$host:$P:127.0.0.1")
  [[ "$url" == https://127.0.0.1:* ]] && args+=(--cacert "$UATENV_RT/generated/tls/ca.crt")
  code="$(curl "${args[@]}" "$url" 2>/dev/null)"
  if [[ "$code" =~ $want ]]; then record "$name" http "$url" ok "$code"; else record "$name" http "$url" FAIL "${code:-no-response}"; fi
}

container_probe() { # service
  local svc="$1" cname="$UATENV_PROJECT-$1-1" st restart
  st="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cname" 2>/dev/null || echo missing)"
  restart="$(docker inspect -f '{{.HostConfig.RestartPolicy.Name}}' "$cname" 2>/dev/null || echo '?')"
  if [[ "$st" == healthy ]]; then record "$svc" docker "$cname" ok "healthy restart=$restart"; else record "$svc" docker "$cname" FAIL "$st restart=$restart"; fi
}

SERVICES=(proxy postgres redis rabbitmq kafka minio keycloak "${UATENV_CORE_APPS[@]}")
((WITH_SECONDARY)) && SERVICES+=("${UATENV_SECONDARY_APPS[@]}")
for s in "${SERVICES[@]}"; do container_probe "$s"; done

# Direct (loopback) health endpoints
http_probe keycloak-ready http://127.0.0.1:29021/health/ready
http_probe gateway-health http://127.0.0.1:29030/health
http_probe gateway-live http://127.0.0.1:29030/health/live
http_probe gateway-ready http://127.0.0.1:29030/health/ready
http_probe web-health http://127.0.0.1:29031/api/health
http_probe registration-health http://127.0.0.1:29032/api/health
http_probe etl-worker-ready http://127.0.0.1:29040/health/ready
http_probe exam-document-worker-ready http://127.0.0.1:29041/health/ready
http_probe rabbitmq-mgmt-ui http://127.0.0.1:29012/ '^(200|301|302)$'
http_probe minio-console https://127.0.0.1:29016/ '^(200|301|302|307)$'
if ((WITH_SECONDARY)); then
  http_probe public-website-health http://127.0.0.1:29033/api/health
  http_probe admin-console-health http://127.0.0.1:29034/api/health
  http_probe developer-portal-health http://127.0.0.1:29035/api/health
  http_probe install-wizard-health http://127.0.0.1:29036/api/health
fi

# Through the proxy (host-based routing)
http_probe proxy-health "http://127.0.0.1:$P/__uatenv_proxy_health"
http_probe proxy-gateway "http://api.$PLATFORM:$P/health/ready" "api.$PLATFORM"
http_probe proxy-keycloak-oidc "http://auth.$PLATFORM:$P/realms/proctira/.well-known/openid-configuration" "auth.$PLATFORM"
http_probe proxy-web-tenant-a "http://sunrise-public-school.$TENANT_BASE:$P/api/health" "sunrise-public-school.$TENANT_BASE"
http_probe proxy-web-tenant-b "http://e2e-tenant-a.$TENANT_BASE:$P/api/health" "e2e-tenant-a.$TENANT_BASE"
http_probe proxy-web-localhost "http://localhost:$P/api/health" localhost
http_probe proxy-web-login-page "http://sunrise-public-school.$TENANT_BASE:$P/login" "sunrise-public-school.$TENANT_BASE"
http_probe proxy-registration "http://register.$PLATFORM:$P/api/health" "register.$PLATFORM"
http_probe proxy-unknown-host-421 "http://unknown.example:$P/" unknown.example '^421$'

# Datastores from inside their containers (credentials stay in the container env)
if uatenv_compose exec -T postgres pg_isready -U postgres -d proctira >/dev/null 2>&1; then record postgres-ready exec pg_isready ok accepting; else record postgres-ready exec pg_isready FAIL no; fi
if [[ "$(uatenv_compose exec -T redis redis-cli ping 2>/dev/null | tr -d '\r')" == PONG ]]; then record redis-auth-ping exec 'redis-cli ping (REDISCLI_AUTH)' ok PONG; else record redis-auth-ping exec 'redis-cli ping' FAIL no; fi
if uatenv_compose exec -T redis env -u REDISCLI_AUTH redis-cli ping 2>/dev/null | grep -q NOAUTH; then record redis-requirepass exec 'unauthenticated ping refused' ok NOAUTH; else record redis-requirepass exec 'unauthenticated ping' FAIL accepted; fi

if [[ -n "$JSON_OUT" ]]; then
  mkdir -p "$(dirname "$JSON_OUT")"
  printf '%s\n' "${ROWS[@]}" | FAILS="$FAILS" python3 -c '
import json, sys, os, datetime
rows = [dict(zip(["name", "kind", "target", "result", "detail"], l.rstrip("\n").split("\t"))) for l in sys.stdin if l.strip()]
print(json.dumps({"checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                  "failures": int(os.environ["FAILS"]), "probes": rows}, indent=2))' >"$JSON_OUT"
  uatenv_log "health summary written: $JSON_OUT"
fi
if ((FAILS > 0)); then
  uatenv_log "$FAILS probe(s) failed"
  exit 1
fi
uatenv_log "all ${#ROWS[@]} probes passed"
