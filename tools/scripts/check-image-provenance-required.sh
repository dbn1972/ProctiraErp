#!/usr/bin/env bash
# W1-OPS-14 — fail if production image workflows disable BuildKit provenance.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
FILES=(
  "$ROOT/.github/workflows/release.yml"
  "$ROOT/.github/workflows/supply-chain.yml"
)

# Match YAML keys only (ignore comments that mention "provenance: false").
match_yaml_key() {
  local file="$1"
  local pattern="$2"
  grep -nE "^[[:space:]]*${pattern}" "$file" 2>/dev/null || true
}

fail=0
for f in "${FILES[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "W1-OPS-14: missing $f" >&2
    fail=1
    continue
  fi
  disabled="$(match_yaml_key "$f" 'provenance:[[:space:]]*false')"
  if [[ -n "$disabled" ]]; then
    echo "W1-OPS-14: provenance must not be disabled in $(basename "$f"):" >&2
    echo "$disabled" >&2
    fail=1
  fi
  if [[ -z "$(match_yaml_key "$f" 'provenance:[[:space:]]*mode=max')" ]]; then
    echo "W1-OPS-14: expected provenance: mode=max in $(basename "$f")" >&2
    fail=1
  fi
done

# Fail-closed signing: workflows must not soft-skip cosign via the old variable.
for f in "${FILES[@]}"; do
  hits="$(grep -nE 'SUPPLY_CHAIN_SIGN_IMAGES' "$f" 2>/dev/null || true)"
  if [[ -n "$hits" ]]; then
    echo "W1-OPS-14: $(basename "$f") must not gate cosign on SUPPLY_CHAIN_SIGN_IMAGES" >&2
    echo "$hits" >&2
    fail=1
  fi
done

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi
echo "W1-OPS-14: provenance mode=max + fail-closed cosign OK on release/supply-chain workflows"
