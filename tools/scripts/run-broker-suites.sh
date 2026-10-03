#!/usr/bin/env bash
# Broker-backed integration suites (PRC-H039 / PRC-H078 / PRC-H087 / PRC-M019).
#
# Each suite skips itself when RABBITMQ_URL / REDIS_URL is unset so local `pnpm test` stays
# offline. This runner requires both URLs and fails when any listed test was skipped, so a
# CI run cannot go green without actually talking to the broker.
set -euo pipefail

: "${RABBITMQ_URL:?RABBITMQ_URL is required (amqp://user:pass@host:5672)}"
: "${REDIS_URL:?REDIS_URL is required (redis://host:6379)}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT_DIR="$(mktemp -d)"
trap 'rm -rf "$OUT_DIR"' EXIT

# package dir|space-separated test files (relative to the package)
SUITES=(
  "packages/shared/queue-abstraction|src/__tests__/rabbitmq-broker.integration.test.ts"
  "packages/backend/assessment|src/report-card-queue.rabbitmq.test.ts"
)

status=0
i=0
for entry in "${SUITES[@]}"; do
  pkg="${entry%%|*}"
  files="${entry#*|}"
  i=$((i + 1))
  report="$OUT_DIR/report-$i.json"
  echo "::group::broker suites: $pkg"
  # shellcheck disable=SC2086 # files is an intentional word list
  if ! (cd "$ROOT/$pkg" && npx vitest run $files --reporter=default --reporter=json \
    --outputFile.json="$report"); then
    status=1
  fi
  echo "::endgroup::"
  if [[ ! -s "$report" ]]; then
    echo "::error::no vitest report for $pkg"
    status=1
    continue
  fi
  node -e '
    const r = require(process.argv[1]);
    const skipped = (r.numPendingTests ?? 0) + (r.numTodoTests ?? 0);
    const passed = r.numPassedTests ?? 0;
    if (skipped > 0 || passed === 0) {
      console.error(`::error::${process.argv[2]}: ${passed} passed, ${skipped} skipped (broker suites must execute)`);
      process.exit(1);
    }
    console.log(`${process.argv[2]}: ${passed} broker-backed tests passed`);
  ' "$report" "$pkg" || status=1
done
exit "$status"
