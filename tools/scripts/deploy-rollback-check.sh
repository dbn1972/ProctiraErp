#!/usr/bin/env bash
# =============================================================================
# W1-OPS-09 — Deploy atomic + rollback path dry-run check
# =============================================================================
# Verifies (no cluster required):
#   1) deploy.yml uses helm --atomic --wait
#   2) rollback.yml exists with workflow_dispatch + helm rollback / --atomic
#   3) dry_run defaults to true (fail-closed plan-only)
#   4) chart single-wave baseline: RollingUpdate maxUnavailable: 0
#   5) progressiveDelivery.canary.enabled defaults to false
#   6) chart progressiveDelivery.canary annotations render when enabled
#   7) runbook docs/runbooks/deploy-rollback.md documents single-wave + rollback
#   8) bash -n on this script + rollback workflow is parseable YAML
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
RUNBOOK=docs/runbooks/deploy-rollback.md

die() {
  echo "deploy-rollback-check: $*" >&2
  exit 1
}

echo "==> bash -n self"
bash -n "$0"

[[ -f "$DEPLOY_WF" ]] || die "missing ${DEPLOY_WF}"
[[ -f "$ROLLBACK_WF" ]] || die "missing ${ROLLBACK_WF}"
[[ -f "$RUNBOOK" ]] || die "missing ${RUNBOOK} (W1-OPS-09 runbook)"

echo "==> deploy.yml atomic progressive hooks"
grep -qE -- '--atomic' "$DEPLOY_WF" || die "deploy.yml missing --atomic (W1-OPS-09)"
grep -qE -- '--wait' "$DEPLOY_WF" || die "deploy.yml missing --wait"
grep -q 'maxUnavailable=0\|progressiveDelivery.canary' "$DEPLOY_WF" \
  || die "deploy.yml should document progressive / canary hook"

echo "==> rollback.yml workflow_dispatch + helm rollback + fail-closed dry_run"
grep -q 'workflow_dispatch:' "$ROLLBACK_WF" || die "rollback.yml missing workflow_dispatch"
grep -q 'helm rollback' "$ROLLBACK_WF" || die "rollback.yml missing helm rollback"
grep -qE -- '--atomic' "$ROLLBACK_WF" || die "rollback.yml image_tag path missing --atomic"
grep -q 'dry_run' "$ROLLBACK_WF" || die "rollback.yml missing dry_run input"
grep -q 'secrets.KUBECONFIG is required when dry_run=false' "$ROLLBACK_WF" \
  || die "rollback.yml missing KUBECONFIG fail-closed apply gate"

# Minimal YAML shape: required input keys appear under on.workflow_dispatch.inputs
for key in environment services revision image_tag dry_run; do
  grep -q "^[[:space:]]*${key}:" "$ROLLBACK_WF" || die "rollback.yml missing input ${key}"
done

# dry_run must default true (plan-only / fail-closed for accidental apply).
# Note: PyYAML 1.1 loads the workflow key `on:` as boolean True.
python3 - "$ROLLBACK_WF" <<'PY' || die "rollback.yml dry_run must default to true"
import sys, yaml
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    doc = yaml.safe_load(f)
on = doc.get("on", doc.get(True))
if not isinstance(on, dict):
    raise SystemExit(f"missing workflow on: block ({type(on).__name__})")
inputs = on["workflow_dispatch"]["inputs"]
dry = inputs.get("dry_run") or {}
default = dry.get("default")
if default is not True:
    raise SystemExit(f"dry_run.default={default!r}, expected True")
conc = doc.get("concurrency") or {}
if conc.get("cancel-in-progress") is not False:
    raise SystemExit("concurrency.cancel-in-progress must be false")
print("OK rollback.yml YAML + dry_run default true")
PY

echo "==> single-wave chart baseline (values.yaml)"
grep -qE 'type:[[:space:]]*RollingUpdate' "${SERVICE_CHART}/values.yaml" \
  || die "values.yaml missing RollingUpdate strategy"
grep -qE 'maxUnavailable:[[:space:]]*0' "${SERVICE_CHART}/values.yaml" \
  || die "values.yaml missing maxUnavailable: 0 single-wave baseline"
# canary must be off by default — progressive delivery is opt-in hooks only
python3 - "${SERVICE_CHART}/values.yaml" <<'PY' || die "canary must default disabled"
import sys, yaml
path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    doc = yaml.safe_load(f)
canary = ((doc.get("progressiveDelivery") or {}).get("canary") or {})
if canary.get("enabled") is not False:
    raise SystemExit(f"progressiveDelivery.canary.enabled={canary.get('enabled')!r}")
print("OK progressiveDelivery.canary.enabled=false")
PY

echo "==> runbook documents single-wave + atomic rollback"
grep -qE 'single-wave' "$RUNBOOK" || die "runbook missing single-wave"
grep -qE 'helm (upgrade|rollback)|--atomic' "$RUNBOOK" || die "runbook missing helm atomic/rollback"
grep -qE 'rollback\.yml|Actions → Rollback' "$RUNBOOK" || die "runbook missing workflow pointer"
# Honesty: must not claim production canary proof
if grep -qiE 'production canary (proven|exercised|certified)' "$RUNBOOK"; then
  die "runbook must not invent production canary proof"
fi

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
