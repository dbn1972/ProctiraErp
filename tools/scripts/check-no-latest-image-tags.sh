#!/usr/bin/env bash
# W1-OPS-08 — fail if deployment manifests pin mutable :latest tags.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
matches="$(rg -n --glob '*.yaml' --glob '*.yml' 'image:\s*\S+:latest\b' "$ROOT/infrastructure/k8s" || true)"
if [[ -n "$matches" ]]; then
  echo "W1-OPS-08: mutable :latest image tags are forbidden under infrastructure/k8s:" >&2
  echo "$matches" >&2
  exit 1
fi
echo "W1-OPS-08 OK: no :latest image tags under infrastructure/k8s"
