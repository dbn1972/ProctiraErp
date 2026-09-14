#!/usr/bin/env bash
# W1-OPS-08 — fail if prod deploy paths pin mutable :latest app image tags,
# or if image naming drifts from the canonical proctira/<service> form.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_ROOT="$ROOT/infrastructure/k8s"
HELM_ROOT="$ROOT/infrastructure/helm"
DEPLOY_WF="$ROOT/.github/workflows/deploy.yml"
RELEASE_WF="$ROOT/.github/workflows/release.yml"
SUPPLY_WF="$ROOT/.github/workflows/supply-chain.yml"

fail=0

die_msg() {
  echo "W1-OPS-08: $*" >&2
  fail=1
}

search_yaml() {
  local pattern="$1"
  shift
  if [[ "$#" -eq 0 ]]; then
    return 0
  fi
  if command -v rg >/dev/null 2>&1; then
    rg -n --glob '*.yaml' --glob '*.yml' "$pattern" "$@" 2>/dev/null || true
  else
    grep -RIn --include='*.yaml' --include='*.yml' -E "$pattern" "$@" 2>/dev/null || true
  fi
}

if [[ ! -d "$K8S_ROOT" ]]; then
  die_msg "missing $K8S_ROOT"
  echo "W1-OPS-08 FAILED" >&2
  exit 1
fi

# --- 1) Kustomize: no image: ...:latest ------------------------------------
matches="$(search_yaml 'image:\s*\S+:latest\b' "$K8S_ROOT")"
if [[ -n "$matches" ]]; then
  die_msg "mutable :latest image tags are forbidden under infrastructure/k8s:"
  echo "$matches" >&2
fi

# Naming consistency: Deployment container images must use the proctira/ prefix.
if command -v rg >/dev/null 2>&1; then
  bad_prefix="$(rg -n --glob '**/deployment.yaml' '^\s+image:\s+\S+' "$K8S_ROOT" \
    | grep -v 'image:[[:space:]]*proctira/' || true)"
else
  bad_prefix="$(grep -RIn --include='deployment.yaml' -E '^\s+image:[[:space:]]+\S+' "$K8S_ROOT" \
    | grep -v 'image:[[:space:]]*proctira/' || true)"
fi

if [[ -n "$bad_prefix" ]]; then
  die_msg "Deployment images must use the proctira/ prefix:"
  echo "$bad_prefix" >&2
fi

COMPONENT="$K8S_ROOT/components/image-tag/kustomization.yaml"
if [[ ! -f "$COMPONENT" ]]; then
  die_msg "missing shared image-tag component at $COMPONENT"
else
  if ! grep -qE '^\s+-\s+name:\s+proctira/' "$COMPONENT"; then
    die_msg "image-tag component must declare proctira/* images"
  fi
  if grep -qE 'newTag:\s*latest\b' "$COMPONENT"; then
    die_msg "image-tag component must not use newTag latest"
  fi
fi

# --- 2) Helm (when present): no tag: latest / :latest ----------------------
if [[ -d "$HELM_ROOT" ]]; then
  helm_latest="$(search_yaml 'tag:[[:space:]]*['\''"]?latest['\''"]?[[:space:]]*$|image:[[:space:]]*\S+:latest\b' "$HELM_ROOT")"
  helm_latest="$(printf '%s\n' "$helm_latest" | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
  if [[ -n "$helm_latest" ]]; then
    die_msg "mutable :latest / tag: latest forbidden under infrastructure/helm:"
    echo "$helm_latest" >&2
  fi
  svc_values="$HELM_ROOT/proctira-service/values.yaml"
  if [[ -f "$svc_values" ]]; then
    if grep -qE 'repository:.*proctira-[a-z]' "$svc_values"; then
      die_msg "proctira-service values must use proctira/<service> (slash), not proctira-<service>"
    fi
    if ! grep -qE 'repository:.*(proctira/)' "$svc_values"; then
      die_msg "proctira-service values.image.repository must include proctira/<service>"
    fi
  fi
fi

# --- 3) Workflows (when present): no :latest app tags; slash naming --------
check_workflow() {
  local file="$1"
  local label="$2"
  [[ -f "$file" ]] || return 0

  local hits
  # App-image :latest only — do not match runs-on: ubuntu-latest.
  hits="$(grep -nE 'proctira[^[:space:]"]*:latest\b|value=latest\b|,value=latest\b|:\s+latest\s*$' "$file" || true)"
  hits="$(printf '%s\n' "$hits" | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
  if [[ -n "$hits" ]]; then
    die_msg "$label must not publish/consume mutable :latest app image tags:"
    echo "$hits" >&2
  fi

  # Forbid hyphenated OCI repo proctira-<service> on image/tag/IMAGE lines only.
  local img_hyphen
  img_hyphen="$(grep -nE '(images:|tags:|IMAGE:|IMAGE=|repository:).*(/|")proctira-[a-z0-9._-]+|/proctira-\$\{\{\s*matrix\.service|/proctira-\$\{SERVICE\}|proctira-\$\{\{\s*matrix\.service' "$file" || true)"
  img_hyphen="$(printf '%s\n' "$img_hyphen" | grep -vE ':[0-9]+:[[:space:]]*#' || true)"
  if [[ -n "$img_hyphen" ]]; then
    die_msg "$label must use proctira/<service> image paths (not proctira-<service>):"
    echo "$img_hyphen" >&2
  fi

  if ! grep -qE 'proctira/\$\{|/proctira/[a-z]' "$file"; then
    die_msg "$label must reference proctira/<service> image repositories"
  fi
}

check_workflow "$DEPLOY_WF" "deploy.yml"
check_workflow "$RELEASE_WF" "release.yml"
check_workflow "$SUPPLY_WF" "supply-chain.yml"

# --- 4) Compose: no proctira app image :latest -----------------------------
for compose in \
  "$ROOT/docker-compose.yml" \
  "$ROOT/infrastructure/docker/docker-compose.services.yml"; do
  [[ -f "$compose" ]] || continue
  hits="$(grep -nE 'image:[[:space:]]*.*proctira[^[:space:]]*:latest\b' "$compose" || true)"
  if [[ -n "$hits" ]]; then
    die_msg "compose must not pin proctira app images to :latest ($(basename "$compose")):"
    echo "$hits" >&2
  fi
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "W1-OPS-08 OK: no :latest app image tags in prod deploy paths; naming uses proctira/<service>"
