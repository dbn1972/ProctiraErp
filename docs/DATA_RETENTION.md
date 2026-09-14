# Data retention — PHI & minor records (G-503 / W1-OPS-19)

## Policy summary

| Class                                  |     Default retention | Env override               |
| -------------------------------------- | --------------------: | -------------------------- |
| Adult PHI (counselling, special-needs) |  2555 days (~7 years) | `PHI_RETENTION_DAYS`       |
| Minor-linked PHI                       | 3650 days (~10 years) | `MINOR_PHI_RETENTION_DAYS` |
| Database logical backups               |         30 days local | `BACKUP_RETENTION_DAYS` (Helm `dr.backup.retentionDays`) |

Safety rails on every count/delete:

- Retention windows above
- Skip rows under active tenant or student **legal hold** (`tenants.legal_hold` /
  `privacy_legal_holds`, W1-SEC-06)

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
`RETENTION_DRY_RUN=0`).

Helm: `dr.phiRetention.apply` must be an explicit bool — `true` in
`values-production.yaml` (enforce), `false` in staging/development (dry-run).
Unset mode refuses at `helm template` time.

## Backup / restore

See `docs/BACKUP_RESTORE.md` and:

- `tools/scripts/pg-backup.sh`
- `tools/scripts/pg-restore.sh`
- `tools/scripts/restore-drill.sh` → evidence under `/opt/cursor/artifacts/restore-drill/`
