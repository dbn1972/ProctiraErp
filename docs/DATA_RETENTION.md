# Data retention — PHI & minor records (G-503 / W1-OPS-19)

## Policy summary

| Class                                  |     Default retention | Env override               |
| -------------------------------------- | --------------------: | -------------------------- |
| Adult PHI (counselling, special-needs) |  2555 days (~7 years) | `PHI_RETENTION_DAYS`       |
| Minor-linked PHI                       | 3650 days (~10 years) | `MINOR_PHI_RETENTION_DAYS` |
| Database logical backups               |         30 days local | `BACKUP_RETENTION_DAYS` (Helm `dr.backup.retentionDays`) |

`RETENTION_DRY_RUN` is **required**. There is no silent dry-run default:

| Value | Meaning |
| ----- | ------- |
| `0` | Enforce deletion (production CronJob) |
| `1` | Sandbox dry-run (counts only; staging/dev CronJobs) |
| unset / other | Fail closed |

## Job

```bash
DATABASE_URL=postgresql://... \
RETENTION_DRY_RUN=1 \
ARTIFACT_DIR=/opt/cursor/artifacts/phi-retention \
node tools/scripts/phi-retention-job.mjs
```

Writes `summary.json` with candidate counts (and applied deletes when
`RETENTION_DRY_RUN=0`), `tenantsScanned`, per-tenant counts and
`heldByLegalHold`.

- **One transaction (PRC-M559).** Counts and deletes for every tenant run in
  one psql session under `--single-transaction`. Any error, a role without
  the needed privileges, no visible tenant, or a deleted count that differs
  from the eligible count exits 1 and deletes nothing.
- **Audited (PRC-M435).** Each deleted row queues one `audit_ingest_queue`
  event for its tenant (`system:phi-retention`, `DELETE`, record and student
  ids only) in the same statement; the gateway drain seals it into the keyed
  audit chain.
- **Own role and legal holds (PRC-M623).** `DATABASE_URL` is the
  `proctira_phi_retention` role (`PHI_RETENTION_DATABASE_URL`), never the
  BYPASSRLS backup role. Tenants with `tenants.legal_hold` or an active
  tenant-scope hold, and students with an active subject hold in
  `privacy_legal_holds`, keep their rows; they are counted as held.

Helm: `dr.phiRetention.apply` must be an explicit bool — `true` in
`values-production.yaml` (enforce), `false` in staging/development (dry-run).
Unset mode refuses at `helm template` time.

## Backup / restore

See `docs/BACKUP_RESTORE.md` and:

- `tools/scripts/pg-backup.sh`
- `tools/scripts/pg-restore.sh`
- `tools/scripts/restore-drill.sh` → evidence under `/opt/cursor/artifacts/restore-drill/`
