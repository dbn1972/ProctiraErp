#!/usr/bin/env bash
# W3-D6 — Tip check: DoD closure evidence pack present and coherent.
# Validates the committed baseline plus the latest docs/audits/evidence/dod-gate-*.json
# tip pack. Does not re-run the full dod-check aggregator (see check:dod in CI).
#
# Usage (repo root):
#   ./tools/scripts/check-dod-evidence.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EVIDENCE_DIR=docs/audits/evidence
BASELINE=tools/dod-checks/reports/baseline.json

die() {
  echo "check-dod-evidence: $*" >&2
  exit 1
}

[[ -f "$BASELINE" ]] || die "missing committed baseline at $BASELINE"

command -v node >/dev/null 2>&1 || die "node required to validate JSON"

node tools/scripts/assert-dod-evidence.mjs --baseline-only

[[ -d "$EVIDENCE_DIR" ]] || die "missing $EVIDENCE_DIR"

mapfile -t packs < <(ls -1 "$EVIDENCE_DIR"/dod-gate-*.json 2>/dev/null | sort)
[[ ${#packs[@]} -gt 0 ]] || die "no $EVIDENCE_DIR/dod-gate-*.json tip pack"

latest="${packs[-1]}"

node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.ok !== true) { console.error("ok must be true"); process.exit(1); }
if (j.gap !== "W3-D6") { console.error("gap must be W3-D6"); process.exit(1); }
const gate = j.gate || {};
if (!gate.script || !String(gate.script).includes("assert-dod-evidence")) {
  console.error("gate.script must reference assert-dod-evidence.mjs");
  process.exit(1);
}
if (typeof gate.requiredChecks !== "number" || gate.requiredChecks !== 7) {
  console.error("gate.requiredChecks must be 7");
  process.exit(1);
}
const baseline = j.baselineSnapshot || {};
if (typeof baseline.totalErrors !== "number") {
  console.error("baselineSnapshot.totalErrors must be numeric");
  process.exit(1);
}
if (typeof baseline.checksPresent !== "number" || baseline.checksPresent !== 7) {
  console.error("baselineSnapshot.checksPresent must be 7");
  process.exit(1);
}
const runUrl = j.ciCrossRef?.latestSuccessfulRun?.url || j.runUrl || "";
if (!runUrl.includes("github.com") || !runUrl.includes("/actions/runs/")) {
  console.error("missing ciCrossRef.latestSuccessfulRun.url (or runUrl)");
  process.exit(1);
}
console.log("OK", p);
console.log("  gap=", j.gap);
console.log("  baselineErrors=", baseline.totalErrors);
console.log("  run=", runUrl);
' "$latest"

echo "check-dod-evidence: PASS ($latest)"
