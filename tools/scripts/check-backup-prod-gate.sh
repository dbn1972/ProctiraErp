#!/usr/bin/env bash
# =============================================================================
# W1-OPS-04 — Production backup encrypt / offsite / immutability gate
# =============================================================================
# Fails when Helm production profiles omit encryption-at-rest, a documented
# offsite s3:// target, Object Lock floors, or when the CronJob template loses
# fail-closed production asserts. Does not prove a live vault upload.
#
# Usage (repo root):
#   ./tools/scripts/check-backup-prod-gate.sh
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

die() {
  echo "check-backup-prod-gate: $*" >&2
  exit 1
}

PLATFORM_PROD=infrastructure/helm/proctira-platform/values-production.yaml
PLATFORM_BASE=infrastructure/helm/proctira-platform/values.yaml
CRONJOB=infrastructure/helm/proctira-platform/templates/dr/backup-cronjob.yaml
CRYPTO=tools/scripts/backup-crypto.sh
AUDIT=docs/audits/OPS_W1_OPS_04_COMPLETE.md
RUNBOOK=docs/BACKUP_RESTORE.md

for f in "$PLATFORM_PROD" "$PLATFORM_BASE" "$CRONJOB" "$CRYPTO" "$AUDIT" "$RUNBOOK"; do
  [[ -f "$f" ]] || die "missing required file: $f"
done

command -v python3 >/dev/null 2>&1 || die "python3 required"

python3 - "$ROOT" <<'PY'
import re
import sys
from pathlib import Path

root = Path(sys.argv[1])
errors: list[str] = []

try:
    import yaml
except ImportError:
    # Minimal nested loader for our simple values files (no anchors needed).
    yaml = None


def load_yaml(path: Path):
    text = path.read_text(encoding="utf-8")
    if yaml is not None:
        return yaml.safe_load(text) or {}
    # Extremely small fallback: only used if PyYAML missing — prefer fail.
    raise SystemExit("check-backup-prod-gate: PyYAML required (pip install pyyaml)")


prod = load_yaml(root / "infrastructure/helm/proctira-platform/values-production.yaml")
base = load_yaml(root / "infrastructure/helm/proctira-platform/values.yaml")

dr = (prod.get("dr") or {})
backup = (dr.get("backup") or {})
encrypt = (backup.get("encrypt") or {})
offsite = (backup.get("offsite") or {})
olock = (offsite.get("objectLock") or {})

if encrypt.get("enabled") is not True:
    errors.append("values-production.yaml: dr.backup.encrypt.enabled must be true")

if offsite.get("enabled") is not True:
    errors.append("values-production.yaml: dr.backup.offsite.enabled must be true")

uri = (offsite.get("uri") or "").strip()
if not uri.startswith("s3://") or len(uri) < len("s3://x/y"):
    errors.append(
        "values-production.yaml: dr.backup.offsite.uri must be a documented s3://bucket/prefix/"
    )

mode = str(olock.get("mode") or "").upper()
if mode not in ("GOVERNANCE", "COMPLIANCE"):
    errors.append(
        "values-production.yaml: dr.backup.offsite.objectLock.mode must be GOVERNANCE or COMPLIANCE"
    )

base_backup = ((base.get("dr") or {}).get("backup") or {})
retention = int(backup.get("retentionDays") or base_backup.get("retentionDays") or 0)
retain_days = int(olock.get("retainDays") or 0)
if retain_days < retention or retain_days < 1:
    errors.append(
        f"values-production.yaml: objectLock.retainDays ({retain_days}) must be >= retentionDays ({retention})"
    )

cron = (root / "infrastructure/helm/proctira-platform/templates/dr/backup-cronjob.yaml").read_text(
    encoding="utf-8"
)
for needle in (
    "W1-OPS-04",
    'fail "W1-OPS-04: production backups require dr.backup.encrypt.enabled=true',
    'fail "W1-OPS-04: production backups require dr.backup.offsite.enabled=true',
    "BACKUP_REQUIRE_OFFSITE",
    "BACKUP_S3_OBJECT_LOCK_MODE",
):
    if needle not in cron:
        errors.append(f"backup-cronjob.yaml missing fail-closed marker: {needle}")

crypto = (root / "tools/scripts/backup-crypto.sh").read_text(encoding="utf-8")
for needle in (
    "BACKUP_REQUIRE_OFFSITE",
    "object-lock-mode",
    "refusing offsite upload of unencrypted",
):
    if needle not in crypto:
        errors.append(f"backup-crypto.sh missing control: {needle}")

runbook = (root / "docs/BACKUP_RESTORE.md").read_text(encoding="utf-8")
if "W1-OPS-04" not in runbook or "objectLock" not in runbook:
    errors.append("docs/BACKUP_RESTORE.md must document W1-OPS-04 encrypt/offsite/objectLock")

audit = (root / "docs/audits/OPS_W1_OPS_04_COMPLETE.md").read_text(encoding="utf-8")
if "W1-OPS-04" not in audit or "residual" not in audit.lower():
    errors.append("OPS_W1_OPS_04_COMPLETE.md must exist with honest residuals")

if errors:
    for e in errors:
        print(f"check-backup-prod-gate: {e}", file=sys.stderr)
    sys.exit(1)

print("check-backup-prod-gate: PASS (prod encrypt+offsite+objectLock + fail-closed markers)")
PY
