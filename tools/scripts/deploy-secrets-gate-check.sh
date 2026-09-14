#!/usr/bin/env bash
# =============================================================================
# W1-OPS-15 — Deploy secrets fail-closed / no-greenwash static check
# =============================================================================
# Verifies .github/workflows/deploy.yml cannot report success while silently
# skipping image build/push and Helm deploy when registry secrets are absent.
#
# Required contracts:
#   1) Production missing REGISTRY_* secrets → prepare step exits non-zero
#   2) Explicit deploy-secrets-gate job fails the aggregate when can_deploy!=true
#   3) Soft "::warning::…skipping…" alone is forbidden (greenwash vector)
#
# Usage (repo root):
#   ./tools/scripts/deploy-secrets-gate-check.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

DEPLOY_WF=.github/workflows/deploy.yml

die() {
  echo "deploy-secrets-gate-check: $*" >&2
  exit 1
}

echo "==> bash -n self"
bash -n "$0"

[[ -f "$DEPLOY_WF" ]] || die "missing ${DEPLOY_WF}"

echo "==> production fail-closed on missing registry secrets"
grep -q 'W1-OPS-15: Production deploy requires REGISTRY_USERNAME and REGISTRY_PASSWORD' "$DEPLOY_WF" \
  || die "deploy.yml missing production fail-closed error (W1-OPS-15)"
grep -q 'ENVIRONMENT: \${{ steps.env.outputs.environment }}' "$DEPLOY_WF" \
  || die "deploy.yml registry check must bind ENVIRONMENT from prepare"
# Production branch must exit 1 immediately after the production error marker.
grep -A2 'W1-OPS-15: Production deploy requires REGISTRY_USERNAME and REGISTRY_PASSWORD' "$DEPLOY_WF" \
  | grep -q 'exit 1' \
  || die "deploy.yml production secrets path must exit 1 (W1-OPS-15)"

echo "==> explicit deploy-secrets-gate aggregate job"
grep -qE '^[[:space:]]*deploy-secrets-gate:' "$DEPLOY_WF" \
  || die "deploy.yml missing deploy-secrets-gate job (W1-OPS-15)"
grep -q 'Deploy secrets gate (W1-OPS-15)' "$DEPLOY_WF" \
  || die "deploy.yml missing named secrets gate job"
grep -q 'needs.prepare.outputs.can-deploy' "$DEPLOY_WF" \
  || die "deploy.yml secrets gate must read can-deploy"
# Gate must fail (exit 1) when secrets are missing — not soft-pass.
grep -A40 'deploy-secrets-gate:' "$DEPLOY_WF" | grep -q 'exit 1' \
  || die "deploy-secrets-gate must exit 1 when can_deploy is not true"
grep -A20 'deploy-secrets-gate:' "$DEPLOY_WF" | grep -q 'always()' \
  || die "deploy-secrets-gate should use always() so skipped deploy still evaluates"

echo "==> forbid greenwash-only warning"
if grep -qE '::warning::.*skipping image build/push and deploy' "$DEPLOY_WF"; then
  die "deploy.yml still greenwashes missing secrets with ::warning:: skip (W1-OPS-15)"
fi

echo "deploy-secrets-gate-check: PASS"
