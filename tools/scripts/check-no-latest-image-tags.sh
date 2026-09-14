#!/usr/bin/env bash
# W1-OPS-08 — fail if deployment manifests pin mutable :latest tags.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
K8S_ROOT="$ROOT/infrastructure/k8s"

if [[ ! -d "$K8S_ROOT" ]]; then
  echo "W1-OPS-08: missing $K8S_ROOT" >&2
  exit 1
fi

# Prefer ripgrep; fall back to grep -R for local/dev without rg.
if command -v rg >/dev/null 2>&1; then
  matches="$(rg -n --glob '*.yaml' --glob '*.yml' 'image:\s*\S+:latest\b' "$K8S_ROOT" || true)"
else
  matches="$(grep -RIn --include='*.yaml' --include='*.yml' -E 'image:[[:space:]]*\S+:latest\b' "$K8S_ROOT" || true)"
fi

if [[ -n "$matches" ]]; then
  echo "W1-OPS-08: mutable :latest image tags are forbidden under infrastructure/k8s:" >&2
  echo "$matches" >&2
  exit 1
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
  echo "W1-OPS-08: Deployment images must use the proctira/ prefix:" >&2
  echo "$bad_prefix" >&2
  exit 1
fi

# Shared overlay pin component must exist and list images (not an empty stub).
COMPONENT="$K8S_ROOT/components/image-tag/kustomization.yaml"
if [[ ! -f "$COMPONENT" ]]; then
  echo "W1-OPS-08: missing shared image-tag component at $COMPONENT" >&2
  exit 1
fi
if ! grep -qE '^\s+-\s+name:\s+proctira/' "$COMPONENT"; then
  echo "W1-OPS-08: image-tag component must declare proctira/* images" >&2
  exit 1
fi
if grep -qE 'newTag:\s*latest\b' "$COMPONENT"; then
  echo "W1-OPS-08: image-tag component must not use newTag latest" >&2
  exit 1
fi

echo "W1-OPS-08 OK: no :latest image tags under infrastructure/k8s"
