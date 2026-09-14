#!/usr/bin/env bash
# =============================================================================
# P0-12 / G-501 — Local + CI helm template dry-run
# =============================================================================
# Proves deploy.yml chart paths exist and render without a live cluster.
# No secrets: only ci-placeholder values for umbrella template stubs.
#
# Usage (repo root):
#   ./tools/scripts/helm-template-check.sh
#
# Requires: helm >= 3.14 (azure/setup-helm@v4 in CI).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SERVICE_CHART=./infrastructure/helm/proctira-service
PLATFORM_CHART=./infrastructure/helm/proctira-platform

die() {
  echo "helm-template-check: $*" >&2
  exit 1
}

command -v helm >/dev/null 2>&1 || die "helm not found on PATH (install Helm v3.14+)"

# --- Path alignment with .github/workflows/deploy.yml -------------------------
[[ -f "${SERVICE_CHART}/Chart.yaml" ]] || die "missing ${SERVICE_CHART}/Chart.yaml (deploy.yml chart path)"
[[ -f "${PLATFORM_CHART}/Chart.yaml" ]] || die "missing ${PLATFORM_CHART}/Chart.yaml"
for env in development staging production; do
  [[ -f "${SERVICE_CHART}/values-${env}.yaml" ]] || die "missing ${SERVICE_CHART}/values-${env}.yaml"
done

# Historical / wrong paths must NOT be what deploy expects
if [[ -d ./infrastructure/helm/openemis-platform ]]; then
  echo "WARN: legacy openemis-platform dir still present; deploy uses proctira-service" >&2
fi
if [[ -d ./infrastructure/helm/proctira && ! -f ./infrastructure/helm/proctira/Chart.yaml ]]; then
  die "ambiguous infrastructure/helm/proctira without Chart.yaml"
fi

echo "==> lint ${SERVICE_CHART}"
helm lint "${SERVICE_CHART}"

echo "==> template proctira-service (deploy.yml shape)"
for SERVICE in api-gateway web student; do
  out="$(mktemp)"
  helm template "proctira-${SERVICE}" "${SERVICE_CHART}" \
    --namespace "proctira-staging" \
    --set image.repository="ghcr.io/proctira/${SERVICE}" \
    --set image.tag="sha-ci" \
    --set environment=staging \
    --set service.name="${SERVICE}" \
    --values "${SERVICE_CHART}/values-staging.yaml" \
    >"$out"
  grep -q "name: proctira-${SERVICE}" "$out" || die "missing release name proctira-${SERVICE}"
  grep -q "kind: Deployment" "$out" || die "missing Deployment for ${SERVICE}"
  grep -q "readOnlyRootFilesystem: true" "$out" || die "missing readOnlyRootFilesystem (${SERVICE})"
  grep -q "runAsNonRoot: true" "$out" || die "missing runAsNonRoot (${SERVICE})"
  grep -q "kind: ServiceAccount" "$out" || die "missing ServiceAccount (${SERVICE})"
  grep -q "kind: PodDisruptionBudget" "$out" || die "missing PDB (${SERVICE})"
  grep -q "kind: NetworkPolicy" "$out" || die "missing NetworkPolicy (${SERVICE})"
  if [[ "$SERVICE" == "web" ]]; then
    grep -q "path: /api/health" "$out" || die "web probe should be /api/health"
  else
    grep -q "path: /health" "$out" || die "${SERVICE} probe should be /health"
  fi
  rm -f "$out"
  echo "OK proctira-${SERVICE}"
done

echo "==> production profile (HPA + ExternalSecret opt-in)"
out="$(mktemp)"
helm template proctira-api-gateway "${SERVICE_CHART}" \
  --namespace proctira-production \
  --set service.name=api-gateway \
  --set image.tag=sha-ci \
  --set externalSecret.enabled=true \
  --set externalSecret.secretStoreRef.name=ci-store \
  --values "${SERVICE_CHART}/values-production.yaml" \
  >"$out"
grep -q "kind: HorizontalPodAutoscaler" "$out" || die "missing HPA"
grep -q "kind: ExternalSecret" "$out" || die "missing ExternalSecret"
grep -q "name: proctira-api-gateway-env" "$out" || die "missing ExternalSecret name"
grep -q "topologySpreadConstraints" "$out" || die "missing topologySpreadConstraints"
rm -f "$out"
echo "OK production profile"

echo "==> lint + template ${PLATFORM_CHART}"
# Umbrella may warn on icon/etc.; lint is advisory for platform.
helm lint "${PLATFORM_CHART}" || true
platform_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-staging \
  --set global.environment=staging \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  -f "${PLATFORM_CHART}/values-staging.yaml" \
  >"$platform_out"
[[ -s "$platform_out" ]] || die "empty platform template output"
grep -Eq "proctira-platform|api-gateway|kind: Deployment" "$platform_out" || die "platform render missing expected content"

# G-707 — DR CronJobs
cron_count="$(grep -c '^kind: CronJob$' "$platform_out" || true)"
[[ "$cron_count" -ge 2 ]] || die "expected >=2 CronJobs, got ${cron_count}"
grep -Eq 'name: proctira-proctira-platform-pg-backup|name: proctira-pg-backup|pg-backup$' "$platform_out" \
  || die "missing pg-backup CronJob"
grep -q 'phi-retention' "$platform_out" || die "missing phi-retention"
grep -q 'RETENTION_DRY_RUN' "$platform_out" || die "missing RETENTION_DRY_RUN"
grep -q 'kind: PersistentVolumeClaim' "$platform_out" || die "missing PVC"
grep -q 'dr-tools' "$platform_out" || die "missing dr-tools"

# W1-OPS-02 (B4) — etl-worker Helm probes must match Fastify handlers (/health/live, /health/ready).
etl_deploy="$(awk '/Source: proctira-platform\/templates\/etl-worker\/deployment.yaml/,/^---$/' "$platform_out")"
[[ -n "$etl_deploy" ]] || die "missing etl-worker Deployment in platform render"
echo "$etl_deploy" | grep -q 'path: /health/live' \
  || die "etl-worker liveness probe must be /health/live (W1-OPS-02 B4)"
echo "$etl_deploy" | grep -q 'path: /health/ready' \
  || die "etl-worker readiness probe must be /health/ready (W1-OPS-02 B4)"
echo "OK etl-worker probe paths (W1-OPS-02 B4)"

lines="$(wc -l <"$platform_out" | tr -d ' ')"
rm -f "$platform_out"
echo "OK proctira-platform (${lines} lines, ${cron_count} CronJobs)"
echo "helm-template-check: PASS"
