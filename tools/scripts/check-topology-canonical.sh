#!/usr/bin/env bash
# =============================================================================
# W1-OPS-16 — Canonical topology gate (in-process gateway)
# =============================================================================
# Fails when production Helm/k8s/docs drift back to treating split-domain
# services as the default production topology.
#
# Usage (repo root):
#   ./tools/scripts/check-topology-canonical.sh
#   ROOT=/path/to/fixture ./tools/scripts/check-topology-canonical.sh
# =============================================================================
set -euo pipefail

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$ROOT"

die() {
  echo "check-topology-canonical: $*" >&2
  exit 1
}

need() {
  [[ -f "$1" ]] || die "missing required file: $1"
}

need docs/audits/OPS_W1_OPS_16_TOPOLOGY.md
need docs/DEPLOYMENT_TOPOLOGY.md
need infrastructure/helm/proctira-platform/values.yaml
need infrastructure/helm/proctira-platform/values-production.yaml
need infrastructure/k8s/base/kustomization.yaml
need infrastructure/k8s/overlays/production/kustomization.yaml
need infrastructure/docker/docker-compose.services.yml
need docker-compose.yml

# --- Docs / compose honesty ---------------------------------------------------
grep -qi 'NON-PROD\|lab only\|LAB ONLY' infrastructure/docker/docker-compose.services.yml \
  || die "docker-compose.services.yml must be marked NON-PROD / lab (W1-OPS-16)"

grep -qi 'in-process' docker-compose.yml \
  || die "root docker-compose.yml must declare in-process gateway as canonical"

grep -qi 'in-process' docs/architecture/HIGH_LEVEL.md \
  || die "HIGH_LEVEL.md must document in-process as canonical"

grep -q 'topology.mode' docs/DEPLOYMENT_TOPOLOGY.md \
  || die "DEPLOYMENT_TOPOLOGY.md must document topology.mode"

# --- Helm production defaults -------------------------------------------------
prod_values=infrastructure/helm/proctira-platform/values-production.yaml
grep -E '^topology:' -A2 "$prod_values" | grep -q 'mode:[[:space:]]*in-process' \
  || die "values-production.yaml must set topology.mode: in-process"

for svc in institutionService studentService staffService assessmentService \
  attendanceService examinationService workflowService notificationService reportService; do
  # First "enabled:" under the service key must be false
  block="$(awk -v svc="$svc" '
    $0 ~ "^"svc":" {grab=1; next}
    grab && /^[a-zA-Z]/ {exit}
    grab {print}
  ' "$prod_values")"
  echo "$block" | grep -q 'enabled:[[:space:]]*false' \
    || die "production $svc must have enabled: false"
done

base_values=infrastructure/helm/proctira-platform/values.yaml
grep -E '^topology:' -A2 "$base_values" | grep -q 'mode:[[:space:]]*in-process' \
  || die "values.yaml must default topology.mode: in-process"

# --- Kustomize: production must not opt into split-domain ---------------------
base_kust=infrastructure/k8s/base/kustomization.yaml
for path in institution/ student/ staff/ assessment/ attendance/ examination/ \
  workflow/ notification/ report/; do
  if grep -E "^[[:space:]]*-[[:space:]]*${path}" "$base_kust" >/dev/null 2>&1; then
    die "base kustomization must not list split-domain path ${path} (use components/split-domain-services)"
  fi
done

prod_kust=infrastructure/k8s/overlays/production/kustomization.yaml
if grep -E '^[[:space:]]*-[[:space:]]*.*split-domain-services' "$prod_kust" >/dev/null; then
  die "production overlay must not include split-domain-services component"
fi

need infrastructure/k8s/components/split-domain-services/kustomization.yaml
need infrastructure/k8s/overlays/lab-split/kustomization.yaml
grep -q 'split-domain-services' infrastructure/k8s/overlays/lab-split/kustomization.yaml \
  || die "lab-split overlay must include split-domain-services"

# --- Optional: helm render production must omit domain Deployments ------------
if command -v helm >/dev/null 2>&1; then
  out="$(mktemp)"
  helm template proctira ./infrastructure/helm/proctira-platform \
    --namespace proctira-production \
    --set secrets.jwtSecret=ci-placeholder \
    --set secrets.databaseUrl=postgresql://ci:ci@localhost:5432/ci \
    -f ./infrastructure/helm/proctira-platform/values-production.yaml \
    >"$out" 2>/dev/null || die "helm template production failed"
  if grep -E 'name: .*institution-service$|app.kubernetes.io/name: institution-service' "$out" >/dev/null; then
    rm -f "$out"
    die "production helm render must not include institution-service"
  fi
  grep -q 'api-gateway' "$out" || {
    rm -f "$out"
    die "production helm render missing api-gateway"
  }
  rm -f "$out"
fi

echo "W1-OPS-16 OK — canonical topology is in-process gateway"
