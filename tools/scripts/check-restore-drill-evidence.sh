#!/usr/bin/env bash
# P0-13 / W3-OPS-C6 — Tip check: restore-drill evidence pack present and coherent.
# Wired into CI (restore-drill-evidence job) and ci-aggregate; fails closed.
# Does not re-run Postgres backup/restore (see restore-drill.sh / restore-drill.yml).
#
# Usage (repo root):
#   ./tools/scripts/check-restore-drill-evidence.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

EVIDENCE_DIR=docs/audits/evidence
die() {
  echo "check-restore-drill-evidence: $*" >&2
  exit 1
}

[[ -d "$EVIDENCE_DIR" ]] || die "missing $EVIDENCE_DIR"

mapfile -t packs < <(ls -1 "$EVIDENCE_DIR"/restore-drill-*.json 2>/dev/null | sort)
[[ ${#packs[@]} -gt 0 ]] || die "no $EVIDENCE_DIR/restore-drill-YYYYMMDD.json tip pack"

latest="${packs[-1]}"
command -v node >/dev/null 2>&1 || die "node required to validate JSON"

node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
if (j.ok !== true) { console.error("ok must be true"); process.exit(1); }
const mode = j.localDrill?.mode || j.mode || "";
if (!String(mode).includes("full-db") && mode !== "local-full-db" && mode !== "ci-full-db") {
  console.error("expected full-db mode, got:", mode);
  process.exit(1);
}
const counts = j.localDrill?.counts || j.counts || {};
for (const k of ["tenants", "boards", "institutions"]) {
  if (typeof counts[k] !== "number") {
    console.error("missing numeric counts." + k);
    process.exit(1);
  }
}
const runUrl = j.ciCrossRef?.latestSuccessfulRun?.url || j.runUrl || "";
if (!runUrl.includes("github.com") || !runUrl.includes("/actions/runs/")) {
  console.error("missing ciCrossRef.latestSuccessfulRun.url (or runUrl)");
  process.exit(1);
}
console.log("OK", p);
console.log("  mode=", mode);
console.log("  counts=", JSON.stringify(counts));
console.log("  run=", runUrl);
const scripts = j.scriptsExercised || [];
for (const rel of scripts) {
  if (typeof rel !== "string" || !rel.startsWith("tools/scripts/")) {
    console.error("invalid scriptsExercised entry:", rel);
    process.exit(1);
  }
}
' "$latest"

for rel in $(node -p "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')).scriptsExercised.join('\n')" "$latest" 2>/dev/null); do
  [[ -f "$rel" ]] || die "scriptsExercised missing on disk: $rel"
done

# Runbook must point at tip evidence (§7)
grep -q 'docs/audits/evidence/restore-drill-' docs/BACKUP_RESTORE.md \
  || die "docs/BACKUP_RESTORE.md must link docs/audits/evidence/restore-drill-*"

echo "check-restore-drill-evidence: PASS ($latest)"
