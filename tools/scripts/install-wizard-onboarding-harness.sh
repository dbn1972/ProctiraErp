#!/usr/bin/env bash
# G-507 — Install wizard tenant onboarding recording harness runner.
# Usage:
#   bash tools/scripts/install-wizard-onboarding-harness.sh
# Optional:
#   RECORD=1  → Playwright video on
#   ARTIFACT_DIR=/opt/cursor/artifacts/install-wizard-g507
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
ARTIFACT_DIR="${ARTIFACT_DIR:-/opt/cursor/artifacts/install-wizard-g507}"
mkdir -p "$ARTIFACT_DIR"

cd "$ROOT/apps/install-wizard"

echo "[G-507] Running tenant onboarding harness (RECORD=${RECORD:-0})"
export RECORD="${RECORD:-0}"
export PW_VIDEO="${PW_VIDEO:-$RECORD}"

if pnpm exec playwright test e2e/02-tenant-onboarding-harness.spec.ts \
  --project=chromium \
  --reporter=line 2>&1 | tee "$ARTIFACT_DIR/harness.log"; then
  echo "ok" > "$ARTIFACT_DIR/status.txt"
else
  echo "fail" > "$ARTIFACT_DIR/status.txt"
  exit 1
fi

cat > "$ARTIFACT_DIR/summary.json" <<EOF
{
  "gap": "G-507",
  "recorded": ${RECORD:-0},
  "spec": "apps/install-wizard/e2e/02-tenant-onboarding-harness.spec.ts",
  "residual": "Live upstream install API / IdP still waived without secrets"
}
EOF

echo "[G-507] Evidence written to $ARTIFACT_DIR"
