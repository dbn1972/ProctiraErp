#!/usr/bin/env bash
# =============================================================================
# P0-12 / G-501 / W1-OPS-21 — Local + CI helm template dry-run
# =============================================================================
# Proves deploy.yml chart paths exist and render without a live cluster.
# Also asserts application probe handlers still expose the paths Helm / Docker
# HEALTHCHECK expect (W1-OPS-21), so app-only probe edits fail closed in CI.
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

assert_deployment_hardening() {
  local rendered="$1"
  local label="$2"
  local expected="$3"
  local deployments
  deployments="$(grep -c '^kind: Deployment$' "$rendered" || true)"
  [[ "$deployments" -eq "$expected" ]] \
    || die "${label}: expected ${expected} Deployments, got ${deployments}"

  local marker count
  for marker in \
    'automountServiceAccountToken: false' \
    'runAsNonRoot: true' \
    'seccompProfile:' \
    'allowPrivilegeEscalation: false' \
    'readOnlyRootFilesystem: true' \
    'mountPath: /tmp'; do
    count="$(grep -c "$marker" "$rendered" || true)"
    [[ "$count" -ge "$deployments" ]] \
      || die "${label}: hardening marker '${marker}' covers ${count}/${deployments} Deployments"
  done
}

# Require a string literal route in an app source file (W1-OPS-21).
assert_app_route() {
  local file="$1"
  local route="$2"
  local label="$3"
  [[ -f "$file" ]] || die "missing ${file} (${label})"
  grep -qE "['\"]${route}['\"]" "$file" \
    || die "${label}: ${file} must still register '${route}' (W1-OPS-21)"
}

command -v helm >/dev/null 2>&1 || die "helm not found on PATH (install Helm v3.14+)"

# --- Path alignment with .github/workflows/deploy.yml -------------------------
[[ -f "${SERVICE_CHART}/Chart.yaml" ]] || die "missing ${SERVICE_CHART}/Chart.yaml (deploy.yml chart path)"
[[ -f "${PLATFORM_CHART}/Chart.yaml" ]] || die "missing ${PLATFORM_CHART}/Chart.yaml"
for env in development staging production; do
  [[ -f "${SERVICE_CHART}/values-${env}.yaml" ]] || die "missing ${SERVICE_CHART}/values-${env}.yaml"
done

mapfile -t K8S_BASE_DEPLOYMENTS < <(find ./infrastructure/k8s/base -mindepth 2 -maxdepth 2 -name deployment.yaml -print | sort)
[[ "${#K8S_BASE_DEPLOYMENTS[@]}" -eq 16 ]] \
  || die "expected 16 Kustomize base Deployments, got ${#K8S_BASE_DEPLOYMENTS[@]}"
for deployment in "${K8S_BASE_DEPLOYMENTS[@]}"; do
  assert_deployment_hardening "$deployment" "$deployment" 1
done

# Historical / wrong paths must NOT be what deploy expects
if [[ -d ./infrastructure/helm/openemis-platform ]]; then
  echo "WARN: legacy openemis-platform dir still present; deploy uses proctira-service" >&2
fi
if [[ -d ./infrastructure/helm/proctira && ! -f ./infrastructure/helm/proctira/Chart.yaml ]]; then
  die "ambiguous infrastructure/helm/proctira without Chart.yaml"
fi

# --- W1-OPS-21: app handlers must still expose chart / HEALTHCHECK probe paths -
echo "==> W1-OPS-21 app probe contract sources"
assert_app_route apps/api-gateway/src/plugins/health.ts '/health' 'api-gateway legacy/thin-chart'
assert_app_route apps/api-gateway/src/plugins/health.ts '/health/live' 'api-gateway liveness'
assert_app_route apps/api-gateway/src/plugins/health.ts '/health/ready' 'api-gateway readiness'
assert_app_route apps/etl-worker/src/server.ts '/health' 'etl-worker legacy'
assert_app_route apps/etl-worker/src/server.ts '/health/live' 'etl-worker liveness'
assert_app_route apps/etl-worker/src/server.ts '/health/ready' 'etl-worker readiness'
[[ -f apps/web/src/app/api/health/route.ts ]] \
  || die "missing apps/web/src/app/api/health/route.ts (web probe)"
grep -q 'export async function GET' apps/web/src/app/api/health/route.ts \
  || die "web /api/health route must export GET (W1-OPS-21)"
# Deploy Dockerfiles HEALTHCHECK paths (thin chart + compose parity)
for df in \
  apps/api-gateway/Dockerfile \
  infrastructure/docker/Dockerfile.api-gateway \
  Dockerfile.fastify-base \
  apps/etl-worker/Dockerfile \
  infrastructure/docker/Dockerfile.etl-worker; do
  [[ -f "$df" ]] || die "missing ${df}"
  grep -q '/health' "$df" || die "${df} HEALTHCHECK must probe /health (W1-OPS-21)"
done
for df in \
  apps/web/Dockerfile \
  infrastructure/docker/Dockerfile.web \
  infrastructure/docker/Dockerfile.nextjs-app \
  Dockerfile.web-base; do
  [[ -f "$df" ]] || die "missing ${df}"
  grep -q '/api/health' "$df" || die "${df} HEALTHCHECK must probe /api/health (W1-OPS-21)"
done
echo "OK app + Dockerfile probe contracts (W1-OPS-21)"

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
  assert_deployment_hardening "$out" "proctira-${SERVICE}" 1
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

echo "==> production profile (HPA + ExternalSecret + authenticated metrics)"
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
grep -q "name: METRICS_ENABLED" "$out" || die "missing METRICS_ENABLED binding"
grep -q "name: METRICS_BEARER_TOKEN" "$out" || die "missing metrics bearer env"
grep -q "name: proctira-metrics" "$out" || die "missing metrics Secret reference"
grep -q "optional: false" "$out" || die "metrics Secret must fail closed when absent"
grep -q 'prometheus.io/path: "/metrics"' "$out" || die "scrape path must match application /metrics"
grep -q "app.kubernetes.io/name: prometheus" "$out" || die "missing Prometheus pod selector"
rm -f "$out"

echo "==> W1-SEC-07 production metrics fail-closed render gates"
public_err="$(mktemp)"
if helm template proctira-api-gateway "${SERVICE_CHART}" \
  --namespace proctira-production \
  --set service.name=api-gateway \
  --set image.tag=sha-ci \
  --set env.METRICS_PUBLIC=1 \
  --values "${SERVICE_CHART}/values-production.yaml" \
  >/dev/null 2>"$public_err"; then
  rm -f "$public_err"
  die "W1-SEC-07: production METRICS_PUBLIC=1 must fail rendering"
fi
grep -q "METRICS_PUBLIC=1 is forbidden" "$public_err" \
  || die "W1-SEC-07: public-mode failure must be explicit"
rm -f "$public_err"

missing_token_err="$(mktemp)"
if helm template proctira-api-gateway "${SERVICE_CHART}" \
  --namespace proctira-production \
  --set service.name=api-gateway \
  --set image.tag=sha-ci \
  --set-string metrics.bearerTokenSecret.name= \
  --values "${SERVICE_CHART}/values-production.yaml" \
  >/dev/null 2>"$missing_token_err"; then
  rm -f "$missing_token_err"
  die "W1-SEC-07: production metrics without bearer Secret must fail rendering"
fi
grep -q "metrics.bearerTokenSecret.name" "$missing_token_err" \
  || die "W1-SEC-07: missing bearer failure must be explicit"
rm -f "$missing_token_err"
echo "OK production profile + W1-SEC-07 metrics contract"

echo "==> lint + template ${PLATFORM_CHART}"
# Umbrella may warn on icon/etc.; lint is advisory for platform.
helm lint "${PLATFORM_CHART}" || true

# Base values are intentionally non-destructive: DR jobs require an explicit
# environment overlay, but all canonical Deployments must still render hardened.
base_platform_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-base \
  >"$base_platform_out"
assert_deployment_hardening "$base_platform_out" "platform base" 7
[[ "$(grep -c '^kind: CronJob$' "$base_platform_out" || true)" -eq 0 ]] \
  || die "platform base must not render DR CronJobs without an environment overlay"
rm -f "$base_platform_out"

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
assert_deployment_hardening "$platform_out" "platform staging" 7

# Render every lab-only split service once so disabled templates cannot drift
# from the same security baseline unnoticed.
split_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-lab \
  -f "${PLATFORM_CHART}/values-development.yaml" \
  --set topology.mode=split \
  --set institutionService.enabled=true \
  --set studentService.enabled=true \
  --set staffService.enabled=true \
  --set assessmentService.enabled=true \
  --set attendanceService.enabled=true \
  --set examinationService.enabled=true \
  --set workflowService.enabled=true \
  --set notificationService.enabled=true \
  --set reportService.enabled=true \
  >"$split_out"
assert_deployment_hardening "$split_out" "platform split lab" 16
rm -f "$split_out"

# G-707 — DR CronJobs
cron_count="$(grep -c '^kind: CronJob$' "$platform_out" || true)"
[[ "$cron_count" -ge 2 ]] || die "expected >=2 CronJobs, got ${cron_count}"
grep -Eq 'name: proctira-proctira-platform-pg-backup|name: proctira-pg-backup|pg-backup$' "$platform_out" \
  || die "missing pg-backup CronJob"
grep -q 'phi-retention' "$platform_out" || die "missing phi-retention"
grep -q 'RETENTION_DRY_RUN' "$platform_out" || die "missing RETENTION_DRY_RUN"
# W1-OPS-19 — staging/sandbox must set explicit dry-run (RETENTION_DRY_RUN=1)
awk '
  /name: RETENTION_DRY_RUN/ { found=1; next }
  found && /value:/ {
    if ($0 !~ /value: "1"/) { exit 2 }
    exit 0
  }
' "$platform_out" || die "W1-OPS-19: staging phi-retention must set RETENTION_DRY_RUN=\"1\" (explicit sandbox dry-run)"
grep -q 'kind: PersistentVolumeClaim' "$platform_out" || die "missing PVC"
grep -q 'dr-tools' "$platform_out" || die "missing dr-tools"

# W1-OPS-19 — production must enforce deletion (RETENTION_DRY_RUN=0); unset apply fails closed
echo "==> W1-OPS-19 production PHI retention enforce"
prod_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set global.environment=production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >"$prod_out"
assert_deployment_hardening "$prod_out" "platform production" 7
awk '
  /name: RETENTION_DRY_RUN/ { found=1; next }
  found && /value:/ {
    if ($0 !~ /value: "0"/) { exit 2 }
    exit 0
  }
' "$prod_out" || die "W1-OPS-19: production phi-retention must set RETENTION_DRY_RUN=\"0\" (enforce deletion)"
rm -f "$prod_out"

unset_out="$(mktemp)"
if helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set global.environment=production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  --set dr.phiRetention.apply=null \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >"$unset_out" 2>"${unset_out}.err"; then
  rm -f "$unset_out" "${unset_out}.err"
  die "W1-OPS-19: production with unset dr.phiRetention.apply must fail closed"
fi
grep -Eqi 'W1-OPS-19|dr.phiRetention.apply' "${unset_out}.err" \
  || die "W1-OPS-19: expected fail message mentioning apply when unset"
rm -f "$unset_out" "${unset_out}.err"
echo "OK W1-OPS-19 PHI retention (prod enforce + unset refuse)"

# W1-OPS-04 — production backups require encrypt + offsite + object-lock (fail closed)
echo "==> W1-OPS-04 production backup encrypt/offsite gate"
bash "$ROOT/tools/scripts/check-backup-prod-gate.sh"
prod_backup_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set global.environment=production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >"$prod_backup_out"
grep -q 'BACKUP_ENCRYPT' "$prod_backup_out" \
  || die "W1-OPS-04: production pg-backup CronJob must set BACKUP_ENCRYPT"
grep -q 'BACKUP_OFFSITE_URI' "$prod_backup_out" \
  || die "W1-OPS-04: production pg-backup CronJob must set BACKUP_OFFSITE_URI"
grep -q 'BACKUP_REQUIRE_OFFSITE' "$prod_backup_out" \
  || die "W1-OPS-04: production pg-backup CronJob must set BACKUP_REQUIRE_OFFSITE"
grep -q 'BACKUP_S3_OBJECT_LOCK_MODE' "$prod_backup_out" \
  || die "W1-OPS-04: production pg-backup CronJob must set Object Lock mode"
grep -q 's3://proctira-prod-pg-backups/logical/' "$prod_backup_out" \
  || die "W1-OPS-04: production render must include documented offsite URI"
rm -f "$prod_backup_out"

no_encrypt_err="$(mktemp)"
if helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set global.environment=production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  --set dr.backup.encrypt.enabled=false \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >/dev/null 2>"$no_encrypt_err"; then
  rm -f "$no_encrypt_err"
  die "W1-OPS-04: production with encrypt.enabled=false must fail closed"
fi
grep -Eqi 'W1-OPS-04|encrypt' "$no_encrypt_err" \
  || die "W1-OPS-04: expected fail message mentioning encrypt when disabled"
rm -f "$no_encrypt_err"

no_offsite_err="$(mktemp)"
if helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set global.environment=production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  --set dr.backup.offsite.enabled=false \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >/dev/null 2>"$no_offsite_err"; then
  rm -f "$no_offsite_err"
  die "W1-OPS-04: production with offsite.enabled=false must fail closed"
fi
grep -Eqi 'W1-OPS-04|offsite' "$no_offsite_err" \
  || die "W1-OPS-04: expected fail message mentioning offsite when disabled"
rm -f "$no_offsite_err"
echo "OK W1-OPS-04 backup encrypt/offsite (prod require + disable refuse)"

# W1-OPS-02 (B4) — etl-worker Helm probes must match Fastify handlers (/health/live, /health/ready).
etl_deploy="$(awk '/Source: proctira-platform\/templates\/etl-worker\/deployment.yaml/,/^---$/' "$platform_out")"
[[ -n "$etl_deploy" ]] || die "missing etl-worker Deployment in platform render"
echo "$etl_deploy" | grep -q 'path: /health/live' \
  || die "etl-worker liveness probe must be /health/live (W1-OPS-02 B4)"
echo "$etl_deploy" | grep -q 'path: /health/ready' \
  || die "etl-worker readiness probe must be /health/ready (W1-OPS-02 B4)"
echo "OK etl-worker probe paths (W1-OPS-02 B4)"

# W1-OPS-21 — platform api-gateway probes match gateway Fastify handlers.
gw_deploy="$(awk '/Source: proctira-platform\/templates\/api-gateway\/deployment.yaml/,/^---$/' "$platform_out")"
[[ -n "$gw_deploy" ]] || die "missing api-gateway Deployment in platform render"
echo "$gw_deploy" | grep -q 'path: /health/live' \
  || die "api-gateway liveness probe must be /health/live (W1-OPS-21)"
echo "$gw_deploy" | grep -q 'path: /health/ready' \
  || die "api-gateway readiness probe must be /health/ready (W1-OPS-21)"
echo "OK api-gateway platform probe paths (W1-OPS-21)"

# W1-OPS-08 — no mutable :latest under prod deploy paths (k8s/helm/workflows/compose)
echo "==> W1-OPS-08 prod image tag + naming guard"
bash "$ROOT/tools/scripts/check-no-latest-image-tags.sh"

# W1-OPS-16 — canonical in-process topology
echo "==> W1-OPS-16 topology canonical gate"
bash "$ROOT/tools/scripts/check-topology-canonical.sh"

# W1-OPS-17 — production replica / PDB coherence
echo "==> W1-OPS-17 replica policy gate"
bash "$ROOT/tools/scripts/check-replica-policy.sh"

# Production umbrella must not render split-domain Deployments
echo "==> W1-OPS-16 production platform render (no split domains)"
prod_out="$(mktemp)"
helm template proctira "${PLATFORM_CHART}" \
  --namespace proctira-production \
  --set secrets.jwtSecret=ci-placeholder \
  --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
  -f "${PLATFORM_CHART}/values-production.yaml" \
  >"$prod_out"
grep -q 'api-gateway' "$prod_out" || die "production platform missing api-gateway"
if grep -E 'app.kubernetes.io/name: institution-service|name: .*institution-service$' "$prod_out" >/dev/null; then
  die "production platform must not render institution-service (W1-OPS-16)"
fi
# W1-OPS-17 — production render must include HA PDBs for canonical services
for pdb_svc in api-gateway web etl-worker registration-portal public-website admin-console developer-portal; do
  grep -q "app.kubernetes.io/name: ${pdb_svc}" "$prod_out" \
    || die "production platform missing ${pdb_svc} resources (W1-OPS-17)"
done
pdb_count="$(grep -c '^kind: PodDisruptionBudget$' "$prod_out" || true)"
[[ "$pdb_count" -ge 7 ]] || die "expected >=7 production PDBs for HA services, got ${pdb_count}"
rm -f "$prod_out"
echo "OK production platform without split-domain Deployments (+ W1-OPS-17 PDBs)"

lines="$(wc -l <"$platform_out" | tr -d ' ')"
rm -f "$platform_out"
echo "OK proctira-platform (${lines} lines, ${cron_count} CronJobs)"
echo "helm-template-check: PASS"
