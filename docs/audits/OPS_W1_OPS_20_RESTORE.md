# W1-OPS-20 — Restore-drill tip evidence ≠ production/offsite recovery

**Module / slice:** backup / restore drill evidence gate  
**Branch / tip:** `cursor/aud-w1-ops-20-restore-proof-56c3`  
**Date (UTC):** 2026-09-14  
**Paired evidence:** `docs/audits/evidence/restore-drill-YYYYMMDD.json`  
**Gate:** `tools/scripts/check-restore-drill-evidence.sh` (CI + `restore-drill.yml`)

## Finding

A dated local restore-drill evidence pack existed and the tip check passed on
mode / row counts / CI run URL alone. That is **tooling proof**, not
**production or offsite recovery proof**. Packs could omit encryption and
offsite declaration while still reading as “green DR.”

## Closed (this PR)

| Control | Path | Notes |
| ------- | ---- | ----- |
| Fail-closed required fields | `check-restore-drill-evidence.sh` | Requires `timestamp`, `encryption` (`method`, `ciRoundTripProven`), `offsiteTarget` (`uri`, `configured`, `exercised`) |
| Refuse prod claim | same | `claimsProductionRestore` must be explicitly `false` |
| Workflow gate | `.github/workflows/restore-drill.yml` | Runs tip evidence check after drill (fail closed) |
| Tip pack honesty | `docs/audits/evidence/restore-drill-20260912.json` | Declares fields; `claimsProductionRestore: false` |
| Runbook | `docs/BACKUP_RESTORE.md` §7.1 | Documents schema + honesty residual |

## What the tip pack proves

- Local (or CI) `full-db` dump → restore → row parity for tenants/boards/institutions
- Scripts under `tools/scripts/` exist and are referenced
- CI workflow cross-ref URL for a successful Restore Drill run
- Optional: CI age encrypted round-trip (`encryption.ciRoundTripProven`)

## What it does **not** prove (honesty)

| Claim | Status |
| ----- | ------ |
| Production cluster CronJob took / restored a dump | **Not proven** |
| Offsite second-copy (`BACKUP_OFFSITE_URI` / S3) restore | **Not proven** (`offsiteTarget.exercised: false`) |
| Production encryption-at-rest enabled for live backups | **Not proven** (Helm encrypt defaults off) |
| Operator RTO / RPO met in a real incident | **Not proven** |
| WAL / PITR recovery | **Out of scope** (logical dumps only) |

Tip pack **≠ production restore**. Treat `ok: true` as “scripts + local/CI
drill coherent,” never as “DR certified for production.”

## Operator path for real offsite proof (residual)

1. Enable `dr.backup.encrypt.enabled` + `dr.backup.offsite.*` in Helm values with live credentials.
2. Confirm CronJob uploads `.dump.age` to the offsite URI.
3. Restore from that offsite object into a scratch DB; record row parity + wall-clock.
4. Commit a new dated pack with `offsiteTarget.configured/exercised: true`, real (redacted) URI class, and keep `claimsProductionRestore: false` unless a separate signed production DR report is filed outside this tip gate.

## Sign-off

| Claim | Status |
| ----- | ------ |
| Tip gate fails closed without required fields | ☑ |
| Tip pack does not claim production restore | ☑ |
| Production/offsite recovery residual documented | ☑ (accepted residual) |

**Ops claim:** Tip evidence gate honest (with residuals above). Not a production DR certification.
