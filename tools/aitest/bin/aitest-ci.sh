#!/usr/bin/env bash
# CI entry for one aitest suite (aitest-scheduled.yml matrix leg).
#   bash tools/aitest/bin/aitest-ci.sh <suite-id>
# Runs the suite on a throwaway stack with port base 34000 and compose project
# proctira-aitest-ci-<suite>, writes results to $AITEST_OUT (default
# tools/aitest/out/<suite>) and always tears the stack down.
set -euo pipefail
SUITE="${1:-}"
if [[ ! "$SUITE" =~ ^[a-z0-9][a-z0-9-]*$ ]]; then
  echo "usage: aitest-ci.sh <suite-id> (lowercase kebab-case)" >&2
  exit 2
fi
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OUT="${AITEST_OUT:-$ROOT/tools/aitest/out/$SUITE}"
mkdir -p "$OUT"
cd "$ROOT"
pnpm --filter @proctira/aitest aitest run "$SUITE" \
  --unit "ci-$SUITE" --port-base 34000 --project "proctira-aitest-ci-$SUITE" --out "$OUT"
