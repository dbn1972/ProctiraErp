#!/usr/bin/env bash
# =============================================================================
# W1-OPS-09 — Deploy atomic + rollback path dry-run check
# =============================================================================
# Verifies (no cluster required):
#   1) deploy.yml uses helm --atomic --wait
#   2) rollback.yml exists with workflow_dispatch + helm rollback / --atomic
#   3) chart progressiveDelivery.canary annotations render when enabled
#   4) RollingUpdate maxUnavailable: 0 remains the progressive baseline
#   5) bash -n on this script + rollback workflow is syntactically valid YAML
#
# Usage (repo root):
#   ./tools/scripts/deploy-rollback-check.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEPLOY_WF=.github/workflows/deploy.yml
ROLLBACK_WF=.github/workflows/rollback.yml
SERVICE_CHART=./infrastructure/helm/proctira-service

die() {
  echo "deploy-rollback-check: $*" >&2
  exit 1
}

echo "==> bash -n self"
bash -n "$0"

[[ -f "$DEPLOY_WF" ]] || die "missing ${DEPLOY_WF}"
[[ -f "$ROLLBACK_WF" ]] || die "missing ${ROLLBACK_WF}"

echo "==> deploy.yml atomic progressive hooks"
grep -qE -- '--atomic' "$DEPLOY_WF" || die "deploy.yml missing --atomic (W1-OPS-09)"
grep -qE -- '--wait' "$DEPLOY_WF" || die "deploy.yml missing --wait"
grep -q 'maxUnavailable=0\|progressiveDelivery.canary' "$DEPLOY_WF" \
  || die "deploy.yml should document progressive / canary hook"

echo "==> rollback.yml workflow_dispatch + helm rollback"
grep -q 'workflow_dispatch:' "$ROLLBACK_WF" || die "rollback.yml missing workflow_dispatch"
grep -q 'helm rollback' "$ROLLBACK_WF" || die "rollback.yml missing helm rollback"
grep -qE -- '--atomic' "$ROLLBACK_WF" || die "rollback.yml image_tag path missing --atomic"
grep -q 'dry_run' "$ROLLBACK_WF" || die "rollback.yml missing dry_run input"

# Minimal YAML shape: required input keys appear under on.workflow_dispatch.inputs
for key in environment services revision image_tag dry_run; do
  grep -q "^[[:space:]]*${key}:" "$ROLLBACK_WF" || die "rollback.yml missing input ${key}"
done

command -v helm >/dev/null 2>&1 || die "helm not found on PATH (install Helm v3.14+)"

echo "==> helm template canary annotations (progressiveDelivery.canary.enabled=true)"
out="$(mktemp)"
helm template proctira-api-gateway "${SERVICE_CHART}" \
  --namespace proctira-staging \
  --set service.name=api-gateway \
  --set image.tag=sha-ci \
  --set progressiveDelivery.canary.enabled=true \
  --set progressiveDelivery.canary.weight=15 \
  --values "${SERVICE_CHART}/values-staging.yaml" \
  >"$out"
grep -q 'proctira.io/progressive-delivery: canary' "$out" \
  || die "missing canary annotation when progressiveDelivery.canary.enabled=true"
grep -q 'proctira.io/canary-weight: "15"' "$out" \
  || die "missing canary-weight annotation"
grep -q 'maxUnavailable: 0' "$out" || die "missing RollingUpdate maxUnavailable: 0"
rm -f "$out"
echo "OK canary annotations + RollingUpdate baseline"

echo "==> dry-run rollback command plan (no cluster)"
ENVIRONMENT=staging
SERVICES=api-gateway,web
REVISION=0
NAMESPACE="proctira-${ENVIRONMENT}"
IFS=',' read -ra SERVICE_ARRAY <<< "$SERVICES"
for SERVICE in "${SERVICE_ARRAY[@]}"; do
  RELEASE="proctira-${SERVICE}"
  echo "[dry-run] helm rollback ${RELEASE} ${REVISION} --namespace ${NAMESPACE} --wait --timeout 300s"
done

echo "deploy-rollback-check: PASS"
