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

### 1.1 Honesty gate (W1-OPS-10)

Distinguish **implemented by default executable manifests** from **aspirational / operator-owned** targets:

| Capability | Default Helm chart / scripts on tip | Notes |
| ---------- | ----------------------------------- | ----- |
| Logical `pg_dump` CronJob | **Implemented** (`dr.backup.schedule`, default daily `0 2 * * *`) | See `infrastructure/helm/proctira-platform` |
| On-volume retention pruning | **Implemented** (`dr.backup.retentionDays`, default **30**) | PVC copy is not offsite by itself |
| Age/GPG encryption at rest | **Optional implemented** (`dr.backup.encrypt.enabled` + recipient secret) | Off unless enabled |
| Second-copy / offsite push | **Optional implemented** (`dr.backup.offsite.*`) | Requires operator URI/credentials |
| Continuous WAL archiving | **Not in default chart** | Documented below as a target architecture |
| PITR ≤ 5 minutes RPO | **Not in default chart** | Requires managed Postgres or operator WAL+basebackup stack |
| Immutable/WORM object-lock | **Not in default chart** | Bucket policy / object-lock is environment-owned |
| Automated HA failover | **Not in default chart** | Platform/provider concern |

Treat §2.2–2.3 aspirational rows as planning targets unless the matching control plane is actually provisioned.

---

## 2. RPO/RTO Targets by Deployment Mode

### 2.1 Single-Node (Docker Compose) — default executable posture

| Metric                             | Target             | Strategy                       |
| ---------------------------------- | ------------------ | ------------------------------ |
| **RPO** (Recovery Point Objective) | ≤ 24 hours         | Daily automated logical backups |
| **RTO** (Recovery Time Objective)  | ≤ 4 hours          | Restore from backup + redeploy |
| Backup Frequency                   | Daily at 02:00 UTC | Cron / compose job             |
| Retention                          | 30 days            | Local volume; enable offsite for a second copy |

### 2.2 Kubernetes (Helm) — what the chart implements today

| Metric           | Default chart reality | Strategy on tip |
| ---------------- | --------------------- | --------------- |
| **RPO**          | ≤ 24 hours (daily dump) | `dr.backup` CronJob logical dump |
| **RTO**          | Operator-dependent (manual restore drill) | Restore runbook + PVC/object artifact |
| Backup Frequency | Daily (`0 2 * * *` default) | Helm CronJob |
| Retention        | 30 days default | `dr.backup.retentionDays`; optional offsite URI |

#### 2.2.1 Kubernetes target architecture (not default chart)

| Metric           | Planning target                         | Requires outside default chart              |
| ---------------- | --------------------------------------- | ------------------------------------------- |
| **RPO**          | ≤ 1 hour                                | Continuous WAL archiving + base backups     |
| **RTO**          | ≤ 30 minutes                            | Automated failover tooling (e.g. Velero + HA Postgres operator) |
| Backup Frequency | Continuous WAL + hourly snapshots       | Operator-managed WAL archive + snapshot tool |
| Retention        | 90 days                                 | Object-storage lifecycle policies            |

### 2.3 Managed Cloud (RDS/Aurora + S3) — provider-owned target

| Metric           | Target (when using managed PITR)                        | Strategy                                    |
| ---------------- | ------------------------------------------------------- | ------------------------------------------- |
| **RPO**          | ≤ 5 minutes (provider PITR window)                      | Cloud continuous backup                     |
| **RTO**          | ≤ 15 minutes (typical provider failover)                | Automated failover + replica promotion      |
| Backup Frequency | Continuous                                              | AWS/GCP managed                             |
| Retention        | Provider default (often ~35 days) + manual snapshots    | Cloud provider                              |

These managed-cloud numbers apply only when the deployment actually uses RDS/Aurora (or equivalent) PITR — they are **not** implied by the in-cluster Helm CronJob alone.

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

### 3.2 Physical Backup (pg_basebackup) — aspirational

**Not scheduled by `proctira-platform`.** Example for operators who run their
own physical backup pipeline. The shipped CronJob uses logical `pg_dump` only
(§3.4).

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

### 3.3 Continuous Archiving (WAL) — aspirational

**Not configured by this repo's Helm chart or scripts.** Example only. Claiming
sub-hour RPO requires operator-owned WAL archive + base backups outside
`proctira-platform` (see §2.2.1).

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

By default the CronJob writes only to the PVC. Optional encrypt + offsite
upload are gated by `dr.backup.encrypt.enabled` / `dr.backup.offsite.enabled`
(§3.6). Application object-storage mirroring (§4) is separate and not scheduled
by this chart.

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

### 3.6 Encryption at rest (W1-OPS-04)

Logical dumps are **plaintext pg_dump custom format** unless encryption is
configured. For production clusters, enable age encryption and an offsite copy
so the mutable PVC is not the sole retention surface.

**Encrypt with age (recommended):**

```bash
# Operator generates a keypair once; store the identity in a secret manager.
age-keygen -o backup-recipient.txt   # BACKUP_AGE_IDENTITY_FILE for restore
export BACKUP_AGE_RECIPIENT="$(age-keygen -y backup-recipient.txt)"

DATABASE_URL=postgresql://proctira_backup:...@db:5432/proctira \
  BACKUP_DIR=/backups BACKUP_RETENTION_DAYS=30 \
  BACKUP_ENCRYPT=1 BACKUP_AGE_RECIPIENT="$BACKUP_AGE_RECIPIENT" \
  bash tools/scripts/pg-backup.sh
# → /backups/proctira-YYYYMMDDTHHMMSSZ.dump.age (plaintext .dump removed)
```

**Offsite copy (S3 with SSE — second copy):**

```bash
export BACKUP_OFFSITE_URI="s3://proctira-backups/pg/"
export BACKUP_S3_SSE="AES256"   # or aws:kms + BACKUP_S3_SSE_KMS_KEY_ID
export AWS_ACCESS_KEY_ID=... AWS_SECRET_ACCESS_KEY=... AWS_DEFAULT_REGION=...
# Runs after encryption; uploads the .dump.age artifact, not plaintext.
bash tools/scripts/pg-backup.sh
```

**Kubernetes (Helm):** set `secrets.backupAgeRecipient`, then:

```yaml
dr:
  backup:
    encrypt:
      enabled: true
    offsite:
      enabled: true
      uri: s3://proctira-backups/pg/
      sse: AES256
```

The `<release>-pg-backup` CronJob sets `BACKUP_ENCRYPT=1`, reads
`BACKUP_AGE_RECIPIENT` from the platform Secret, and when offsite is enabled
pushes each encrypted artifact via `aws s3 cp` with server-side encryption.
Re-use `secrets.s3AccessKey` / `secrets.s3SecretKey` for the upload credentials.

**Restore from encrypted artifact:**

```bash
export BACKUP_AGE_IDENTITY_FILE=/secure/backup-recipient.txt
DATABASE_URL=postgresql://proctira:...@db:5432/proctira \
  bash tools/scripts/pg-restore.sh /backups/proctira-20260913T020000Z.dump.age
```

`pg-restore.sh` decrypts `.dump.age` / `.dump.gpg` to a temp file, runs
`pg_restore`, then removes the temp file. Plaintext `.dump` files still work
for dev / legacy paths.

**Alternative — GPG:** set `BACKUP_GPG_RECIPIENT` instead of
`BACKUP_AGE_RECIPIENT`. Restore requires the matching private key in the
operator's gpg keyring.

---

## 4. Object Storage Backup — operator guidance

**Not scheduled by `proctira-platform`.** The optional `dr.backup.offsite`
path only uploads **Postgres dump artifacts**. Bucket mirroring / CRR below
are examples for operators who back up application object storage separately.

### 4.1 S3 Cross-Region Replication (example)

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

### 6.2 Point-in-Time Recovery (PITR) — aspirational

**Requires operator-owned base backups + WAL archive (§3.2–3.3).** The shipped
path is logical restore from a dated `pg_dump` artifact (§6.1 / `pg-restore.sh`),
which recovers to the dump timestamp only — not arbitrary points in time.

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

### 6.5 Full Platform Restore (Kubernetes) — implemented path

Velero is **not** part of `proctira-platform`. Use the logical dump on the
backups PVC (or the offsite S3 copy if enabled):

```bash
# 1. Scale down application pods
kubectl scale deployment --all --replicas=0 -n proctira

# 2. Copy / mount a dump from the backups PVC (or download from BACKUP_OFFSITE_URI)
# 3. Restore with the shipped script (decrypts .dump.age when needed)
kubectl exec -it deploy/<dr-tools-or-postgres-access> -n proctira -- \
  bash tools/scripts/pg-restore.sh /backups/proctira-YYYYMMDDTHHMMSSZ.dump.age

# 4. Scale up application pods
kubectl scale deployment --all --replicas=2 -n proctira

# 5. Verify health
kubectl exec -it deploy/api-gateway -n proctira -- \
  wget -qO- http://localhost:3000/health
```

Operators who separately install Velero may restore volumes that way; that is
outside this chart and does not change the documented RPO in §2.2.
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
5. Encrypted round-trip: ephemeral age keypair → `BACKUP_ENCRYPT=1` backup →
   `pg-restore.sh` on `.dump.age` → row parity on restored DB.
6. PHI-retention dry-run against the restored copy.
7. The `proctira/dr-tools` image is built and smoke-run (backup + retention
   plan) so the CronJob runtime is exercised, not just the runner.

Evidence (`summary.json`, logs, counts) is uploaded as the `restore-drill`
artifact (90-day retention). Run the same drill by hand:

```bash
DATABASE_URL=postgresql://proctira_backup:...@db:5432/proctira \
  ARTIFACT_DIR=/tmp/restore-drill BACKUP_DIR=/tmp/restore-drill/dumps \
  bash tools/scripts/restore-drill.sh
```

**Tip-committed evidence (P0-13):** GH Actions artifacts alone are not durable
in-repo proof. After a successful local or CI drill, commit a dated pack under
`docs/audits/evidence/restore-drill-YYYYMMDD.json` (mode, row counts, CI run
URL). Current pack: [`docs/audits/evidence/restore-drill-20260912.json`](./audits/evidence/restore-drill-20260912.json)
(local `full-db` drill + cross-ref to the latest successful
[`Restore Drill`](https://github.com/dbn1972/ProctiraErp/actions/runs/34683877155)
workflow run). Validate the tip pack without re-running Postgres:

```bash
./tools/scripts/check-restore-drill-evidence.sh
```

If neither local Postgres nor a successful workflow run is available, file a
dated waiver under `docs/audits/WAIVER_P0_13_….md` with an expiry instead of
faking green — honesty over theater.

### 7.2 Backup Monitoring Alerts

Configure alerts for:

- Backup job failure
- Backup age > 25 hours (for daily backups)
- Backup size anomaly (> 50% change)
- Storage quota approaching limit

---

## 8. Disaster Recovery Scenarios

Times below are planning estimates for the **implemented** daily-logical-backup
path unless marked aspirational. They are not automated SLOs.

### Scenario A: Single Service Failure

| Step | Action                                  | Expected RTO |
| ---- | --------------------------------------- | ------------ |
| 1    | Kubernetes auto-restarts pod            | < 1 minute   |
| 2    | Health check detects failure            | < 30 seconds |
| 3    | Load balancer routes to healthy replica | Immediate    |

### Scenario B: Database Corruption

| Step | Action                                                        | Expected RTO         |
| ---- | ------------------------------------------------------------- | -------------------- |
| 1    | Detect via monitoring alert                                   | < 5 minutes          |
| 2a   | **Implemented:** restore latest logical dump (`pg-restore.sh`)| 30–90 minutes        |
| 2b   | *Aspirational:* failover to read replica / PITR (if operator-owned) | varies          |
| 3    | Verify data integrity (counts / smoke)                        | 5–15 minutes         |
| 4    | Resume normal operations                                      | Total often 1–2 hours|

Data lost on the implemented path is bounded by the last successful daily dump
(plus any newer offsite copy), i.e. up to ~24 h RPO — not WAL PITR.

### Scenario C: Complete Infrastructure Loss

| Step | Action                                   | Expected RTO             |
| ---- | ---------------------------------------- | ------------------------ |
| 1    | Provision new infrastructure (Terraform) | 10–20 minutes            |
| 2    | Deploy platform (Helm/Docker Compose)    | 5–10 minutes             |
| 3    | Restore database from logical backup     | 15–60 minutes            |
| 4    | Restore object storage (operator-owned)  | 10–30 minutes            |
| 5    | Verify and resume                        | 10 minutes               |
|      | **Total**                                | **~1–2 hours typical**   |

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

### 9.1 Implemented (shipped scripts / Helm defaults)

| Backup Type                         | Retention                     | Where                                      |
| ----------------------------------- | ----------------------------- | ------------------------------------------ |
| Daily logical dumps (`pg-backup.sh`)| 30 days (`dr.backup.retentionDays` / `BACKUP_RETENTION_DAYS`) | Backups PVC (and optional S3 offsite copy) |
| Pre-upgrade / ad-hoc dumps          | Operator-managed              | Same volume / offsite prefix               |
| Restore-drill CI artifacts          | 90 days (GitHub Actions)      | Workflow artifact only — not production DR |

Offsite S3 lifecycle rules are **operator-owned**; the chart does not create
bucket retention policies. Increasing `dr.backup.retentionDays` only affects
on-volume prune — ensure PVC size and any offsite lifecycle match.

### 9.2 Aspirational (not shipped)

| Backup Type           | Example retention             | Notes                                    |
| --------------------- | ----------------------------- | ---------------------------------------- |
| Hourly WAL archives   | 7 days                        | Needs §3.3 WAL pipeline                  |
| Weekly / monthly tiers| 90 days / 1 year              | Needs separate schedules + lifecycle     |
| Compliance archives   | multi-year / Glacier          | Legal hold — outside this chart          |

---

## 10. Environment Variables

Variables actually read by `pg-backup.sh` / Helm CronJob (not legacy aliases):

| Variable                   | Description                                      | Default / Helm                          |
| -------------------------- | ------------------------------------------------ | --------------------------------------- |
| `DATABASE_URL`             | BYPASSRLS backup role URL                        | Secret `BACKUP_DATABASE_URL`            |
| `BACKUP_DIR`               | Dump directory                                   | `/backups` (CronJob)                    |
| `BACKUP_RETENTION_DAYS`    | Prune artifacts older than N days                | `30` (`dr.backup.retentionDays`)        |
| `BACKUP_AGE_RECIPIENT`     | age public key — encrypt dumps at rest           | Secret when `dr.backup.encrypt.enabled` |
| `BACKUP_AGE_IDENTITY_FILE` | age private key file for restore                 | —                                       |
| `BACKUP_AGE_IDENTITY`      | age private key inline (optional)                | —                                       |
| `BACKUP_GPG_RECIPIENT`     | GPG recipient — encrypt dumps at rest            | —                                       |
| `BACKUP_ENCRYPT`           | Require encryption keys (`1` / `true`)           | set by CronJob when encrypt enabled     |
| `BACKUP_OFFSITE_URI`       | Offsite destination (`s3://bucket/prefix/`)      | `dr.backup.offsite.uri`                 |
| `BACKUP_S3_SSE`            | S3 server-side encryption (`AES256`, `aws:kms`)  | `dr.backup.offsite.sse`                 |
| `BACKUP_S3_SSE_KMS_KEY_ID` | KMS key when `BACKUP_S3_SSE=aws:kms`             | `dr.backup.offsite.sseKmsKeyId`         |

Schedule is Helm `dr.backup.schedule` (default `0 2 * * *`), not an env var.
Enable/disable is `dr.enabled` + `dr.backup.enabled` in values.

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

_Last updated: 2026-09-14 (W1-OPS-10: align RPO/WAL/retention claims with Helm)_
_Spec reference: Volume 11 — Enterprise Installation, Deployment Automation, and Readiness_
