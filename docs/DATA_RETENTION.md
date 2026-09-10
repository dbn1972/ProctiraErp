# Data retention — PHI & minor records (G-503)

## Policy summary

| Class                                  |     Default retention | Env override               |
| -------------------------------------- | --------------------: | -------------------------- |
| Adult PHI (counselling, special-needs) |  2555 days (~7 years) | `PHI_RETENTION_DAYS`       |
| Minor-linked PHI                       | 3650 days (~10 years) | `MINOR_PHI_RETENTION_DAYS` |
| Database logical backups               |         30 days local | `DB_BACKUP_RETENTION_DAYS` |

Dry-run is the default. Set `RETENTION_DRY_RUN=0` only in controlled jobs.

## Job

```bash
DATABASE_URL=postgresql://... \
ARTIFACT_DIR=/opt/cursor/artifacts/phi-retention \
node tools/scripts/phi-retention-job.mjs
```

Writes `summary.json` with candidate counts (and applied deletes when not dry-run).

## Backup / restore

See `docs/BACKUP_RESTORE.md` and:

- `tools/scripts/pg-backup.sh`
- `tools/scripts/pg-restore.sh`
- `tools/scripts/restore-drill.sh` → evidence under `/opt/cursor/artifacts/restore-drill/`
