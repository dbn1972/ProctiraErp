# Backup & Restore Guide

> ProctiraERP Unified Platform — Backup Strategy, RPO/RTO Targets, and Restore Procedures
>
> This document covers backup and restore for all deployment modes:
> Docker Compose, Kubernetes (Helm), and managed cloud services.

---

## 1. Overview

ProctiraERP stores data across multiple systems that must be backed up in coordination:

| Data Store                | Contents                                            | Criticality     |
| ------------------------- | --------------------------------------------------- | --------------- |
| PostgreSQL                | All application data, tenant configs, user accounts | Critical        |
| Object Storage (S3/MinIO) | File uploads, attachments, documents                | Critical        |
| Redis                     | Session cache, rate-limit counters                  | Low (ephemeral) |
| Message Queue             | In-flight messages                                  | Low (transient) |
| Configuration             | Environment variables, secrets                      | Critical        |

---

## 2. RPO/RTO Targets by Deployment Mode

### 2.1 Single-Node (Docker Compose)

| Metric                             | Target             | Strategy                       |
| ---------------------------------- | ------------------ | ------------------------------ |
| **RPO** (Recovery Point Objective) | ≤ 24 hours         | Daily automated backups        |
| **RTO** (Recovery Time Objective)  | ≤ 4 hours          | Restore from backup + redeploy |
| Backup Frequency                   | Daily at 02:00 UTC | Cron job                       |
| Retention                          | 30 days            | Local + offsite                |

### 2.2 Kubernetes (Helm)

| Metric           | Target                              | Strategy                                    |
| ---------------- | ----------------------------------- | ------------------------------------------- |
| **RPO**          | ≤ 1 hour                            | Continuous WAL archiving + hourly snapshots |
| **RTO**          | ≤ 30 minutes                        | Automated failover + PVC restore            |
| Backup Frequency | Continuous (WAL) + hourly snapshots | Velero + pg_basebackup                      |
| Retention        | 90 days                             | Object storage lifecycle                    |

### 2.3 Managed Cloud (RDS/Aurora + S3)

| Metric           | Target                                              | Strategy                                    |
| ---------------- | --------------------------------------------------- | ------------------------------------------- |
| **RPO**          | ≤ 5 minutes                                         | Point-in-time recovery (PITR)               |
| **RTO**          | ≤ 15 minutes                                        | Automated failover + read replica promotion |
| Backup Frequency | Continuous                                          | AWS/GCP managed                             |
| Retention        | 35 days (automated) + indefinite (manual snapshots) | Cloud provider                              |

---

## 3. PostgreSQL Backup

### 3.1 Logical Backup (pg_dump)

Best for: single-node deployments, small-to-medium databases (< 50 GB).

```bash
# Full database backup
pg_dump \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --format=custom \
  --compress=9 \
  --file="backup-$(date +%Y%m%d-%H%M%S).dump"

# Backup specific tenant schema (if using schema-per-tenant)
pg_dump \
  --host="${POSTGRES_HOST}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --schema="tenant_${TENANT_ID}" \
  --format=custom \
  --file="tenant-${TENANT_ID}-$(date +%Y%m%d).dump"
```

### 3.2 Physical Backup (pg_basebackup)

Best for: large databases, faster restore times.

```bash
pg_basebackup \
  --host="${POSTGRES_HOST}" \
  --username="${POSTGRES_USER}" \
  --pgdata=/backups/base-$(date +%Y%m%d) \
  --format=tar \
  --gzip \
  --checkpoint=fast \
  --wal-method=stream
```

### 3.3 Continuous Archiving (WAL)

Best for: minimal data loss (RPO < 5 minutes).

```ini
# postgresql.conf
archive_mode = on
archive_command = 'aws s3 cp %p s3://backups/wal/%f'
wal_level = replica
```

### 3.4 Automated Backup Script

The shipped backup script is `tools/scripts/pg-backup.sh` (pg_dump custom
format, `--no-owner`, compression 9). It refuses to run unless the connected
role can bypass row-level security (see §3.5), fails on suspiciously small
dumps, and prunes `proctira-*.dump` files older than `BACKUP_RETENTION_DAYS`.

```bash
DATABASE_URL=postgresql://proctira_backup:...@db:5432/proctira \
  BACKUP_DIR=/backups BACKUP_RETENTION_DAYS=30 \
  bash tools/scripts/pg-backup.sh
```

**Kubernetes (Helm):** the `proctira-platform` chart schedules it as a
`CronJob` (`<release>-pg-backup`, default `0 2 * * *` UTC) running the
`proctira/dr-tools` image (`infrastructure/docker/Dockerfile.dr-tools`) against
a dedicated PVC (`<release>-backups`, 50 Gi by default). A second CronJob
(`<release>-phi-retention`, Sundays 03:30, **dry-run** unless
`dr.phiRetention.apply=true`) runs `tools/scripts/phi-retention-job.mjs`.
Values live under `dr:` in `values.yaml`; the CI job
`.github/workflows/helm-template.yml` asserts both CronJobs render.

**Docker Compose / bare metal:** call the same script from cron:

```cron
# /etc/cron.d/proctira-backup
0 2 * * * proctira DATABASE_URL=postgresql://proctira_backup:...@localhost:5432/proctira BACKUP_DIR=/backups/proctira BACKUP_RETENTION_DAYS=30 /opt/proctira/tools/scripts/pg-backup.sh >> /var/log/proctira-backup.log 2>&1
```

Offsite copy (S3 / MinIO sync or PVC snapshots) is configured per §4; the
CronJob itself only writes to the volume.

### 3.5 Backup role (FORCE RLS)

Every tenant table has `FORCE ROW LEVEL SECURITY` (G-710). A `pg_dump` run as
the application role therefore either errors with _"query would be affected by
row-level security policy"_ or, with `--enable-row-security`, silently dumps
**zero rows**. Backups must use a role that bypasses RLS and is used for
nothing else:

```sql
CREATE ROLE proctira_backup LOGIN PASSWORD '<strong password>' BYPASSRLS;
GRANT pg_read_all_data TO proctira_backup;          -- read every table for pg_dump
-- only if the restore drill should create its scratch database:
ALTER ROLE proctira_backup CREATEDB;
```

Store its URL as `BACKUP_DATABASE_URL` (`secrets.backupDatabaseUrl` in Helm;
the CronJobs read `dr.databaseUrlSecretKey`, default `BACKUP_DATABASE_URL`).
`pg-backup.sh` exits `2` with an explanatory message when the role cannot
bypass RLS — the weekly drill asserts this.

---

## 4. Object Storage Backup

### 4.1 S3 Cross-Region Replication

For AWS S3 deployments, enable cross-region replication:

```json
{
  "Role": "arn:aws:iam::ACCOUNT:role/replication-role",
  "Rules": [
    {
      "Status": "Enabled",
      "Destination": {
        "Bucket": "arn:aws:s3:::proctira-backup-region2"
      }
    }
  ]
}
```

### 4.2 MinIO Mirror (Self-Hosted)

```bash
# Configure mirror target
mc alias set backup https://backup-minio.example.com ACCESS_KEY SECRET_KEY

# Mirror all buckets
mc mirror --watch minio/proctira-uploads backup/proctira-uploads
```

### 4.3 Periodic Sync

```bash
#!/bin/bash
# Sync object storage to backup location
aws s3 sync \
  "s3://${S3_BUCKET}" \
  "s3://${BACKUP_S3_BUCKET}/object-storage/" \
  --storage-class STANDARD_IA
```

---

## 5. Configuration Backup

### 5.1 Environment Variables

```bash
# Export current configuration (secrets redacted for storage)
env | grep -E "^(OPENEMIS_|POSTGRES_|REDIS_|S3_|KAFKA_|RABBITMQ_|JWT_|TENANT_)" \
  | sed 's/\(PASSWORD\|SECRET\|KEY\)=.*/\1=***REDACTED***/' \
  > config-backup-$(date +%Y%m%d).env
```

### 5.2 Kubernetes Secrets

```bash
# Backup all secrets in the proctira namespace
kubectl get secrets -n proctira -o yaml > secrets-backup.yaml

# Encrypt before storing
gpg --encrypt --recipient ops@example.com secrets-backup.yaml
```

---

## 6. Restore Procedures

### 6.1 PostgreSQL Restore

```bash
# From pg_dump custom format
pg_restore \
  --host="${POSTGRES_HOST}" \
  --port="${POSTGRES_PORT}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  --clean \
  --if-exists \
  --no-owner \
  "${BACKUP_FILE}"

# From plain SQL
psql \
  --host="${POSTGRES_HOST}" \
  --username="${POSTGRES_USER}" \
  --dbname="${POSTGRES_DB}" \
  < backup.sql
```

### 6.2 Point-in-Time Recovery (PITR)

```bash
# Stop PostgreSQL
systemctl stop postgresql

# Restore base backup
rm -rf /var/lib/postgresql/16/main/*
tar -xzf /backups/base-20250101/base.tar.gz -C /var/lib/postgresql/16/main/

# Configure recovery target
cat > /var/lib/postgresql/16/main/recovery.signal << EOF
EOF

cat >> /var/lib/postgresql/16/main/postgresql.auto.conf << EOF
restore_command = 'aws s3 cp s3://backups/wal/%f %p'
recovery_target_time = '2025-01-15 14:30:00 UTC'
EOF

# Start PostgreSQL (will replay WAL to target time)
systemctl start postgresql
```

### 6.3 Object Storage Restore

```bash
# Restore from backup bucket
aws s3 sync \
  "s3://${BACKUP_S3_BUCKET}/object-storage/" \
  "s3://${S3_BUCKET}/"

# For MinIO
mc mirror backup/proctira-uploads minio/proctira-uploads
```

### 6.4 Full Platform Restore (Docker Compose)

```bash
# 1. Stop all services
docker compose down

# 2. Restore PostgreSQL data
docker compose up -d postgres
sleep 10  # Wait for PostgreSQL to start

docker exec -i proctira-erp-postgres-1 \
  pg_restore \
    --username=proctira \
    --dbname=proctira \
    --clean \
    --if-exists \
    < backup.dump

# 3. Restore object storage
docker compose up -d minio
sleep 5
mc mirror /backups/object-storage/ minio/proctira-uploads

# 4. Start all services
docker compose up -d

# 5. Verify health
npx proctira-install health
```

### 6.5 Full Platform Restore (Kubernetes)

```bash
# 1. Scale down application pods
kubectl scale deployment --all --replicas=0 -n proctira

# 2. Restore database (using Velero or manual)
velero restore create --from-backup daily-backup-20250115

# 3. Or manual restore
kubectl exec -it postgres-0 -n proctira -- \
  pg_restore --clean --if-exists --dbname=proctira < /tmp/backup.dump

# 4. Scale up application pods
kubectl scale deployment --all --replicas=2 -n proctira

# 5. Verify health
kubectl exec -it deploy/api-gateway -n proctira -- \
  wget -qO- http://localhost:3000/health
```

---

## 7. Backup Verification

### 7.1 Automated Restore Testing

`.github/workflows/restore-drill.yml` runs every Sunday 04:15 UTC (and on any
change to the DR scripts, the dr-tools Dockerfile or the Helm DR templates):

1. Postgres 16 service → Prisma migrations → `db/sql` schemas + demo seeds.
2. `tools/scripts/restore-drill.sh`: `pg_dump` → recreate
   `proctira_restore_drill` → `pg_restore` → read back tenant / board /
   institution counts. The job **fails** unless the drill ran in `full-db`
   mode and the restored counts equal the source counts.
3. Negative check: a `NOBYPASSRLS` role is refused by `pg-backup.sh` (exit 2,
   no dump written).
4. Retention pruning: a 40-day-old dump is removed with
   `BACKUP_RETENTION_DAYS=30`.
5. PHI-retention dry-run against the restored copy.
6. The `proctira/dr-tools` image is built and smoke-run (backup + retention
   plan) so the CronJob runtime is exercised, not just the runner.

Evidence (`summary.json`, logs, counts) is uploaded as the `restore-drill`
artifact (90-day retention). Run the same drill by hand:

```bash
DATABASE_URL=postgresql://proctira_backup:...@db:5432/proctira \
  ARTIFACT_DIR=/tmp/restore-drill BACKUP_DIR=/tmp/restore-drill/dumps \
  bash tools/scripts/restore-drill.sh
```

### 7.2 Backup Monitoring Alerts

Configure alerts for:

- Backup job failure
- Backup age > 25 hours (for daily backups)
- Backup size anomaly (> 50% change)
- Storage quota approaching limit

---

## 8. Disaster Recovery Scenarios

### Scenario A: Single Service Failure

| Step | Action                                  | Expected RTO |
| ---- | --------------------------------------- | ------------ |
| 1    | Kubernetes auto-restarts pod            | < 1 minute   |
| 2    | Health check detects failure            | < 30 seconds |
| 3    | Load balancer routes to healthy replica | Immediate    |

### Scenario B: Database Corruption

| Step | Action                                   | Expected RTO         |
| ---- | ---------------------------------------- | -------------------- |
| 1    | Detect via monitoring alert              | < 5 minutes          |
| 2    | Failover to read replica (if configured) | < 2 minutes          |
| 3    | Or: PITR to last known good state        | 15–30 minutes        |
| 4    | Verify data integrity                    | 5–10 minutes         |
| 5    | Resume normal operations                 | Total: 15–45 minutes |

### Scenario C: Complete Infrastructure Loss

| Step | Action                                   | Expected RTO             |
| ---- | ---------------------------------------- | ------------------------ |
| 1    | Provision new infrastructure (Terraform) | 10–20 minutes            |
| 2    | Deploy platform (Helm/Docker Compose)    | 5–10 minutes             |
| 3    | Restore database from backup             | 15–60 minutes            |
| 4    | Restore object storage                   | 10–30 minutes            |
| 5    | Verify and resume                        | 10 minutes               |
|      | **Total**                                | **50 minutes – 2 hours** |

### Scenario D: Ransomware/Security Breach

| Step | Action                             | Expected RTO  |
| ---- | ---------------------------------- | ------------- |
| 1    | Isolate affected systems           | Immediate     |
| 2    | Assess scope of compromise         | 1–4 hours     |
| 3    | Provision clean infrastructure     | 20 minutes    |
| 4    | Restore from verified clean backup | 30–60 minutes |
| 5    | Rotate all secrets and credentials | 30 minutes    |
| 6    | Verify integrity and resume        | 1 hour        |
|      | **Total**                          | **3–7 hours** |

---

## 9. Backup Retention Policy

| Backup Type           | Retention                     | Storage Class        |
| --------------------- | ----------------------------- | -------------------- |
| Hourly WAL archives   | 7 days                        | Standard             |
| Daily full backups    | 30 days                       | Standard-IA          |
| Weekly full backups   | 90 days                       | Standard-IA          |
| Monthly full backups  | 1 year                        | Glacier/Archive      |
| Pre-upgrade snapshots | Until next successful upgrade | Standard             |
| Compliance archives   | 7 years                       | Glacier Deep Archive |

---

## 10. Environment Variables

| Variable                   | Description                           | Default     |
| -------------------------- | ------------------------------------- | ----------- |
| `DB_BACKUP_ENABLED`        | Enable automated backups              | `false`     |
| `DB_BACKUP_SCHEDULE`       | Cron expression for backup timing     | `0 2 * * *` |
| `DB_BACKUP_RETENTION_DAYS` | Days to retain local backups          | `30`        |
| `BACKUP_S3_BUCKET`         | S3 bucket for offsite backup storage  | —           |
| `BACKUP_ENCRYPTION_KEY`    | GPG key ID for backup encryption      | —           |
| `LAST_BACKUP_TIMESTAMP`    | Set by backup script after success    | —           |
| `BACKUP_ALERT_WEBHOOK`     | Webhook URL for backup failure alerts | —           |

---

## 11. Scripted drill (G-503)

```bash
# Backup + restore into disposable DB + verify artifact
DATABASE_URL=postgresql://proctira:.../proctira \
  ARTIFACT_DIR=/opt/cursor/artifacts/restore-drill \
  bash tools/scripts/restore-drill.sh

# PHI / minor retention dry-run
DATABASE_URL=postgresql://proctira:.../proctira \
  ARTIFACT_DIR=/opt/cursor/artifacts/phi-retention \
  node tools/scripts/phi-retention-job.mjs
```

Policy details: `docs/DATA_RETENTION.md`.

---

## 12. Quick Reference Commands

```bash
# Create immediate backup
bash tools/scripts/pg-backup.sh

# List available backups
ls -la .backups/ | tail -20

# Check backup integrity
pg_restore --list backup.dump | head -20

# Verify current backup status
npx proctira-install readiness | jq '.categories[] | select(.name == "db-backup")'
```

---

_Last updated: 2026-09-08 (G-503 scripts + retention job)_
_Spec reference: Volume 11 — Enterprise Installation, Deployment Automation, and Readiness_
