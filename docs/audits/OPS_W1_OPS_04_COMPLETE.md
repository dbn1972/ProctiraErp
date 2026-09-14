# OPS — W1-OPS-04 COMPLETE (backup encrypt / offsite / immutability)

**Module / slice:** DR logical backups — encryption at rest, offsite second copy,
Object Lock / independent retention (PARTIAL → COMPLETE)  
**Branch:** `cursor/w1-ops-04-backup-complete-56c3`  
**Tip SHA:** `d3466e1049494aead1f34b66faf5a6e8925da67f`
**Date (UTC):** 2026-09-14  
**Paired gates:** `tools/scripts/check-backup-prod-gate.sh`,
`tools/scripts/helm-template-check.sh`  
**Prior wave:** `#105` optional encrypt/offsite (`727b13a4`) — defaults off

Copy of release gate: `docs/audits/templates/ENTERPRISE_RELEASE_OPS_CHECKLIST.md`.

---

## Finding (PARTIAL residual)

Backups were **optionally** encrypted and optionally pushed offsite. Production
Helm defaults left `dr.backup.encrypt.enabled=false` and
`dr.backup.offsite.enabled=false`, so the mutable PVC could remain the sole
retention surface with plaintext dumps. Immutability / WORM and independent
offsite retention were documented as aspirational only.

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Prod overlay | `…/values-production.yaml` | encrypt + offsite URI + Object Lock floors |
| Base values | `…/values.yaml` | `objectLock` schema; sandbox still optional |
| CronJob | `…/templates/dr/backup-cronjob.yaml` | Production fail-closed; `BACKUP_REQUIRE_OFFSITE` + lock env |
| Crypto helpers | `tools/scripts/backup-crypto.sh` | Require-offsite; refuse plaintext offsite; Object Lock headers |
| Static gate | `tools/scripts/check-backup-prod-gate.sh` | Prod profile missing encrypt/offsite/lock → fail |
| Helm CI | `tools/scripts/helm-template-check.sh` + `helm-template.yml` | Render asserts + disable-encrypt/offsite refuse |
| Runbook | `docs/BACKUP_RESTORE.md` §1.1, §3.6, §9–10 | Honesty + operator Object Lock bucket note |
| Audit | this file | Tip SHA + residuals |

## Invariants

1. **Production** (`global.environment=production` + backup enabled) refuses
   template render unless encrypt, offsite `s3://` URI, and
   `objectLock.mode` ∈ {GOVERNANCE, COMPLIANCE} with
   `retainDays >= retentionDays`.
2. **Sandbox** may leave encrypt/offsite disabled (base chart defaults).
3. CronJob sets `BACKUP_ENCRYPT=1` and `BACKUP_REQUIRE_OFFSITE=1` when those
   features are enabled; runtime sync fails closed if URI/keys missing.
4. PVC prune does **not** delete offsite objects (independent retention).
5. Static `check-backup-prod-gate.sh` fails if prod values or fail-closed
   markers regress.

## Apply / verify

```bash
./tools/scripts/check-backup-prod-gate.sh
./tools/scripts/helm-template-check.sh   # includes W1-OPS-04 render + refuse cases
```

## Residuals (honesty — do NOT claim live vault)

| Residual | Status |
| -------- | ------ |
| Live production cluster CronJob uploaded `.dump.age` to the documented S3 URI | **Not proven** — config/IaC/CI only |
| Offsite Object Lock bucket actually created with Object Lock enabled | **Operator-owned** — AWS requires enable-at-create; tip cannot verify |
| Restore from live offsite object into scratch DB | **Not proven** (see also W1-OPS-20 tip pack honesty) |
| WAL / PITR continuous archive | **Out of scope** (logical dumps only) |
| Age recipient / S3 credentials present in live `proctira-prod-secrets` | **Not proven** — ExternalSecret / operator |

Tip COMPLETE means **production profiles cannot ship without encrypt + documented
offsite + immutability floors expressed and gated**. It does **not** mean a live
offsite vault drill has been executed.

## Rollback

Revert this PR to restore optional encrypt/offsite defaults (not recommended for
production).

## Sign-off

| Claim | Status |
| ----- | ------ |
| Prod values require encrypt + offsite URI + Object Lock | ☑ |
| Helm fail-closed when prod disables encrypt/offsite | ☑ |
| Script/CI gate fails on missing prod settings | ☑ |
| Independent offsite retention documented (PVC prune ≠ S3 delete) | ☑ |
| Live vault / offsite restore proven | ☐ **residual** |

**Ops claim:** W1-OPS-04 **PARTIAL → COMPLETE** for in-repo pipeline config,
immutability/retention controls, and fail-closed prod gates — with live vault
residuals above.
