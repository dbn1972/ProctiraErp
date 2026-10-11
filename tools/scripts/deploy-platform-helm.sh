#!/usr/bin/env bash
# =============================================================================
# PRC-H062 — single source of the proctira-platform Helm invocation.
# =============================================================================
# deploy.yml's deploy-platform job runs `upgrade`; the render contract
# (tools/scripts/check-platform-deploy-render.mjs) runs `template` with the
# SAME value arguments, so CI proves exactly what the deploy would apply.
#
# The release owns only etl-worker, exam-document-worker and the DR CronJobs
# (values-workers-only.yaml). Edge apps stay on the thin proctira-service chart.
# Every rendered image is pinned to the CI-built repository + tag:
#   <registry>/<namespace>/proctira/<service>:<IMAGE_TAG>   (image-repository.sh)
#
# Usage (repo root):
#   deploy-platform-helm.sh upgrade    # helm upgrade --install --atomic --wait
#   deploy-platform-helm.sh template   # helm template (no cluster), to stdout
#
# Required env: ENVIRONMENT, IMAGE_TAG, PLATFORM_EXISTING_SECRET, REGISTRY,
#               IMAGE_NAMESPACE
# Optional env: HELM (default: helm)
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MODE="${1:-}"
HELM="${HELM:-helm}"
RELEASE=proctira-platform
CHART=./infrastructure/helm/proctira-platform

die() {
  echo "deploy-platform-helm: $*" >&2
  exit 1
}

case "$MODE" in
  upgrade | template) ;;
  *) die "usage: deploy-platform-helm.sh upgrade|template" ;;
esac

for var in ENVIRONMENT IMAGE_TAG PLATFORM_EXISTING_SECRET REGISTRY IMAGE_NAMESPACE; do
  [[ -n "${!var:-}" ]] || die "${var} must be set (PRC-H062: fail closed)"
done
case "$ENVIRONMENT" in
  staging | production) ;;
  *) die "ENVIRONMENT must be staging or production (got '${ENVIRONMENT}')" ;;
esac
[[ -f "${CHART}/values-${ENVIRONMENT}.yaml" ]] || die "missing ${CHART}/values-${ENVIRONMENT}.yaml"
[[ -f "${CHART}/values-workers-only.yaml" ]] || die "missing ${CHART}/values-workers-only.yaml"

NAMESPACE="proctira-${ENVIRONMENT}"
repo() { bash tools/scripts/image-repository.sh "$REGISTRY" "$IMAGE_NAMESPACE" "$1"; }
EXAM_WORKER_REPOSITORY="$(repo exam-document-worker)"
ETL_WORKER_REPOSITORY="$(repo etl-worker)"
DR_TOOLS_REPOSITORY="$(repo dr-tools)"

# Value arguments shared by both modes. values-workers-only.yaml comes last so
# it overrides the environment overlay (edge apps + Ingress off). --set always
# wins over -f files, so the image pins cannot be undone by either overlay.
VALUE_ARGS=(
  --namespace "${NAMESPACE}"
  --values "${CHART}/values-${ENVIRONMENT}.yaml"
  --values "${CHART}/values-workers-only.yaml"
  --set global.environment="${ENVIRONMENT}"
  --set-string secrets.existingSecret="${PLATFORM_EXISTING_SECRET}"
  # Repositories below are fully qualified; an extra registry prefix would
  # produce <registry>/<registry>/… references.
  --set-string global.imageRegistry=""
  --set-string examDocumentWorker.image.repository="${EXAM_WORKER_REPOSITORY}"
  --set-string examDocumentWorker.image.tag="${IMAGE_TAG}"
  --set-string etlWorker.image.repository="${ETL_WORKER_REPOSITORY}"
  --set-string etlWorker.image.tag="${IMAGE_TAG}"
  --set-string dr.image.repository="${DR_TOOLS_REPOSITORY}"
  --set-string dr.image.tag="${IMAGE_TAG}"
  # Belt and braces over values-workers-only.yaml: no edge workload or public
  # entry point from this release even if the overlay file drifts.
  --set ingress.enabled=false
  --set apiGateway.enabled=false
  --set web.enabled=false
  --set registrationPortal.enabled=false
  --set publicWebsite.enabled=false
  --set adminConsole.enabled=false
  --set developerPortal.enabled=false
)

if [[ "$MODE" == "template" ]]; then
  exec "$HELM" template "$RELEASE" "$CHART" "${VALUE_ARGS[@]}"
fi

# W1-OPS-09: --atomic rolls back on failure; --wait blocks on readiness.
exec "$HELM" upgrade --install "$RELEASE" "$CHART" \
  --create-namespace \
  "${VALUE_ARGS[@]}" \
  --atomic \
  --wait \
  --timeout 600s
