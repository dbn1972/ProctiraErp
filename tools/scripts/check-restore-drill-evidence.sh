#!/usr/bin/env bash
# P0-13 / W3-OPS-C6 / W1-OPS-20 — Tip check: restore-drill evidence pack present
# and coherent. Wired into CI (restore-drill-evidence job), restore-drill.yml,
# and ci-aggregate; fails closed.
# Does not re-run Postgres backup/restore (see restore-drill.sh / restore-drill.yml).
#
# W1-OPS-20: pack MUST declare timestamp, encryption, and offsiteTarget, and MUST
# NOT claim production/offsite recovery (claimsProductionRestore === false).
# Field presence ≠ production DR proof — see docs/audits/OPS_W1_OPS_20_RESTORE.md.
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

// --- W1-OPS-20 required fields (presence + honesty) ---
const timestamp = j.timestamp || j.localDrill?.timestamp || j.recordedAt || "";
if (!String(timestamp).trim()) {
  console.error("missing required field: timestamp (top-level, localDrill.timestamp, or recordedAt)");
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}T|\d{8}T\d{6}Z$/.test(String(timestamp).trim())) {
  console.error("timestamp must be ISO-8601 or YYYYMMDDTHHMMSSZ, got:", timestamp);
  process.exit(1);
}

const enc = j.encryption;
if (!enc || typeof enc !== "object" || Array.isArray(enc)) {
  console.error("missing required field: encryption (object)");
  process.exit(1);
}
if (!String(enc.method || "").trim()) {
  console.error("encryption.method must be a non-empty string (e.g. age, none)");
  process.exit(1);
}
if (typeof enc.ciRoundTripProven !== "boolean") {
  console.error("encryption.ciRoundTripProven must be boolean");
  process.exit(1);
}

const offsite = j.offsiteTarget;
if (!offsite || typeof offsite !== "object" || Array.isArray(offsite)) {
  console.error("missing required field: offsiteTarget (object)");
  process.exit(1);
}
if (typeof offsite.configured !== "boolean") {
  console.error("offsiteTarget.configured must be boolean");
  process.exit(1);
}
if (!("uri" in offsite)) {
  console.error("offsiteTarget.uri must be present (string or null)");
  process.exit(1);
}
if (offsite.uri != null && typeof offsite.uri !== "string") {
  console.error("offsiteTarget.uri must be string or null");
  process.exit(1);
}
if (typeof offsite.exercised !== "boolean") {
  console.error("offsiteTarget.exercised must be boolean");
  process.exit(1);
}

if (j.claimsProductionRestore !== false) {
  console.error(
    "claimsProductionRestore must be explicitly false — tip pack is not production/offsite recovery proof (W1-OPS-20)"
  );
  process.exit(1);
}
if (j.productionRestoreProven === true) {
  console.error("refusing productionRestoreProven=true on tip evidence pack (W1-OPS-20)");
  process.exit(1);
}
if (offsite.exercised === true && offsite.configured !== true) {
  console.error("offsiteTarget.exercised cannot be true when configured is false");
  process.exit(1);
}

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
console.log("  timestamp=", timestamp);
console.log("  encryption.method=", enc.method, "ciRoundTrip=", enc.ciRoundTripProven);
console.log("  offsite.configured=", offsite.configured, "exercised=", offsite.exercised, "uri=", offsite.uri);
console.log("  claimsProductionRestore=", j.claimsProductionRestore);
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

# W1-OPS-20 honesty audit must exist and refuse a production-restore claim
[[ -f docs/audits/OPS_W1_OPS_20_RESTORE.md ]] \
  || die "missing docs/audits/OPS_W1_OPS_20_RESTORE.md (W1-OPS-20 honesty)"
grep -qiE 'not (a )?production|does not (claim|prove) production|≠ production|not production' \
  docs/audits/OPS_W1_OPS_20_RESTORE.md \
  || die "OPS_W1_OPS_20_RESTORE.md must state tip pack is not production restore proof"

echo "check-restore-drill-evidence: PASS ($latest)"
