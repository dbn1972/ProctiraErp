#!/usr/bin/env bash
# =============================================================================
# W1-OPS-11 — Security scanner contract (fail-closed static check)
# =============================================================================
# Verifies SAST + secret + IaC + container FS CVE scanners are present in
# security-scans.yml, remain fail-closed (no soft-pass), and are wired into
# the CI Aggregate gate via ci.yml + ci-aggregate-gate.mjs.
#
# Usage (repo root):
#   ./tools/scripts/check-security-scans-required.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

SCANS_WF=.github/workflows/security-scans.yml
CI_WF=.github/workflows/ci.yml
AGG_JS=tools/scripts/ci-aggregate-gate.mjs

die() {
  echo "check-security-scans-required: $*" >&2
  exit 1
}

echo "==> bash -n self"
bash -n "$0"

[[ -f "$SCANS_WF" ]] || die "missing ${SCANS_WF}"
[[ -f "$CI_WF" ]] || die "missing ${CI_WF}"
[[ -f "$AGG_JS" ]] || die "missing ${AGG_JS}"

echo "==> required scanner jobs present"
for job in security-scans-contract secret-scan sast-semgrep iac-trivy container-fs-trivy security-scans-summary; do
  grep -qE "^[[:space:]]*${job}:" "$SCANS_WF" \
    || die "${SCANS_WF} missing job ${job}"
done

echo "==> workflow_call so CI Aggregate can invoke scans"
grep -qE '^[[:space:]]*workflow_call:' "$SCANS_WF" \
  || die "${SCANS_WF} must expose workflow_call for ci.yml"

echo "==> fail-closed: no continue-on-error: true on scan steps"
if grep -nE 'continue-on-error:[[:space:]]*true' "$SCANS_WF" >/tmp/ops11-coe.txt 2>/dev/null; then
  die "${SCANS_WF} must not soft-pass scanners (continue-on-error: true):$(printf '\n'; cat /tmp/ops11-coe.txt)"
fi
# Positive markers — each scanner step declares fail-closed.
for marker in \
  'continue-on-error: false' \
  '--exit-code 1' \
  '--error' \
  "exit-code: '1'"
do
  grep -qF -- "$marker" "$SCANS_WF" \
    || die "${SCANS_WF} missing fail-closed marker: ${marker}"
done

echo "==> scanner tool identity (gitleaks / semgrep / trivy)"
grep -q 'gitleaks detect' "$SCANS_WF" || die "secret scan must invoke gitleaks detect"
grep -qF -- '--log-opts "${{ github.event.pull_request.base.sha }}..${{ github.event.pull_request.head.sha }}"' "$SCANS_WF" \
  || die "secret scan must cover the complete pull-request base-to-head graph"
if grep -qE -- '--no-merges|--first-parent' "$SCANS_WF"; then
  die "secret scan must not omit merged source commits"
fi
grep -q 'security-scan-range.test.mjs' "$SCANS_WF" \
  || die "scanner contract must run the merge-history range regression"
grep -q 'semgrep scan' "$SCANS_WF" || die "SAST must invoke semgrep scan"
grep -qF "SETUPTOOLS_VERSION: '80.9.0'" "$SCANS_WF" \
  || die "Semgrep compatibility requires pinned setuptools 80.9.0"
grep -qF '"setuptools==${SETUPTOOLS_VERSION}"' "$SCANS_WF" \
  || die "Semgrep install must pin setuptools via SETUPTOOLS_VERSION"
grep -qF '"semgrep==${SEMGREP_VERSION}"' "$SCANS_WF" \
  || die "Semgrep install must remain version-pinned"
grep -q 'scan-type: config' "$SCANS_WF" || die "IaC must use Trivy config scan"
grep -q 'scan-type: fs' "$SCANS_WF" || die "container CVE equivalent must use Trivy fs scan"
grep -q "severity: 'CRITICAL,HIGH'" "$SCANS_WF" || die "IaC must block HIGH+"
grep -q "severity: 'CRITICAL'" "$SCANS_WF" || die "container FS CVE must block CRITICAL"

echo "==> summary gate fails closed on any non-success"
grep -A80 'security-scans-summary:' "$SCANS_WF" | grep -q 'if: always()' \
  || die "security-scans-summary must use always()"
grep -A120 'security-scans-summary:' "$SCANS_WF" | grep -q 'exit 1' \
  || die "security-scans-summary must exit 1 when a scanner is not success"

echo "==> CI wires reusable Security Scans into aggregate"
grep -qE '^[[:space:]]*security-scans:' "$CI_WF" \
  || die "ci.yml missing security-scans job"
grep -A6 '^[[:space:]]*security-scans:' "$CI_WF" | grep -q 'uses: ./.github/workflows/security-scans.yml' \
  || die "ci.yml security-scans must call ./.github/workflows/security-scans.yml"
grep -A40 'ci-aggregate:' "$CI_WF" | grep -qE '^[[:space:]]*- security-scans$' \
  || die "ci-aggregate needs must include security-scans"
grep -q 'SECURITY_SCANS_RESULT: \${{ needs.security-scans.result }}' "$CI_WF" \
  || die "ci-aggregate must pass SECURITY_SCANS_RESULT"

echo "==> aggregate gate requires security-scans always"
grep -q "job: 'security-scans'" "$AGG_JS" \
  || die "${AGG_JS} missing security-scans gate"
grep -q 'securityScans: process.env.SECURITY_SCANS_RESULT' "$AGG_JS" \
  || die "${AGG_JS} must read SECURITY_SCANS_RESULT"
# Ensure security-scans is its own always-required gate object (not mashed).
node - "$AGG_JS" <<'NODE'
const fs = require('node:fs');
const src = fs.readFileSync(process.argv[2], 'utf8');
const block = src.match(/\{\s*job:\s*'security-scans'[\s\S]*?requiredWhen:\s*\(\)\s*=>\s*true,\s*\}/);
if (!block) {
  console.error('check-security-scans-required: security-scans gate must be requiredWhen: () => true');
  process.exit(1);
}
NODE

echo "check-security-scans-required: PASS"
