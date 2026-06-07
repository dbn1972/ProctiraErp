# Backup & Restore Guide

> ProctiraERP Unified Platform — Backup Strategy, RPO/RTO Targets, and Restore Procedures
>
> This document covers backup and restore for all deployment modes:
> Docker Compose, Kubernetes (Helm), and managed cloud services.

---

## 1. Overview

ProctiraERP stores data across multiple systems that must be backed up in coordination:

| Data Store | Contents | Criticality |
|-----------|----------|-------------|
| PostgreSQL | All application data, tenant configs, user accounts | Critical |
| Object Storage (S3/MinIO) | File uploads, attachments, documents | Critical |
| Redis | Session cache, rate-limit counters | Low (ephemeral) |
| Message Queue | In-flight messages | Low (transient) |
| Configuration | Environment variables, secrets | Critical |

---

## 2. RPO/RTO Targets by Deployment Mode

### 2.1 Single-Node (Docker Compose)

| Metric | Target | Strategy |
|--------|--------|----------|
| **RPO** (Recovery Point Objective) | ≤ 24 hours | Daily automated backups |
| **RTO** (Recovery Time Objective) | ≤ 4 hours | Restore from backup + redeploy |
| Backup Frequency | Daily at 02:00 UTC | Cron job |
| Retention | 30 days | Local + offsite |

### 2.2 Kubernetes (Helm)

| Metric | Target | Strategy |
|--------|--------|----------|
| **RPO** | ≤ 1 hour | Continuous WAL archiving + hourly snapshots |
| **RTO** | ≤ 30 minutes | Automated failover + PVC restore |
| Backup Frequency | Continuous (WAL) + hourly snapshots | Velero + pg_basebackup |
| Retention | 90 days | Object storage lifecycle |

### 2.3 Managed Cloud (RDS/Aurora + S3)

| Metric | Target | Strategy |
|--------|--------|----------|
| **RPO** | ≤ 5 minutes | Point-in-time recovery (PITR) |
| **RTO** | ≤ 15 minutes | Automated failover + read replica promotion |
| Backup Frequency | Continuous | AWS/GCP managed |
| Retention | 35 days (automated) + indefinite (manual snapshots) | Cloud provider |

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

```bash
#!/bin/bash
# /etc/cron.d/proctira-backup
# 0 2 * * * /opt/proctira/scripts/backup.sh

set -euo pipefail

BACKUP_DIR="/backups/proctira"
RETENTION_DAYS="${DB_BACKUP_RETENTION_DAYS:-30}"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/proctira-${TIMESTAMP}.dump"

mkdir -p "${BACKUP_DIR}"

# Create backup
pg_dump \
  --host="${POSTGRES_HOST:-localhost}" \
  --port="${POSTGRES_PORT:-5432}" \
  --username="${POSTGRES_USER:-proctira}" \
  --dbname="${POSTGRES_DB:-proctira}" \
  --format=custom \
  --compress=9 \
  --file="${BACKUP_FILE}"

# Upload to object storage
if [ -n "${BACKUP_S3_BUCKET:-}" ]; then
  aws s3 cp "${BACKUP_FILE}" "s3://${BACKUP_S3_BUCKET}/db-backups/"
fi

# Cleanup old backups
find "${BACKUP_DIR}" -name "proctira-*.dump" -mtime "+${RETENTION_DAYS}" -delete

echo "Backup completed: ${BACKUP_FILE}"
```

---

## 4. Object Storage Backup

### 4.1 S3 Cross-Region Replication

For AWS S3 deployments, enable cross-region replication:

```json
{
  "Role": "arn:aws:iam::ACCOUNT:role/replication-role",
  "Rules": [{
    "Status": "Enabled",
    "Destination": {
      "Bucket": "arn:aws:s3:::proctira-backup-region2"
    }
  }]
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

Run restore tests weekly in an isolated environment:

```bash
#!/bin/bash
# Weekly restore verification
set -euo pipefail

LATEST_BACKUP=$(ls -t /backups/proctira/proctira-*.dump | head -1)

# Create test database
createdb --host=localhost --username=proctira proctira_restore_test

# Restore
pg_restore \
  --host=localhost \
  --username=proctira \
  --dbname=proctira_restore_test \
  --no-owner \
  "${LATEST_BACKUP}"

# Verify data integrity
psql --host=localhost --username=proctira --dbname=proctira_restore_test \
  -c "SELECT count(*) FROM tenants;" \
  -c "SELECT count(*) FROM users;" \
  -c "SELECT count(*) FROM audit_logs ORDER BY created_at DESC LIMIT 1;"

# Cleanup
dropdb --host=localhost --username=proctira proctira_restore_test

echo "Restore verification passed: ${LATEST_BACKUP}"
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

| Step | Action | Expected RTO |
|------|--------|-------------|
| 1 | Kubernetes auto-restarts pod | < 1 minute |
| 2 | Health check detects failure | < 30 seconds |
| 3 | Load balancer routes to healthy replica | Immediate |

### Scenario B: Database Corruption

| Step | Action | Expected RTO |
|------|--------|-------------|
| 1 | Detect via monitoring alert | < 5 minutes |
| 2 | Failover to read replica (if configured) | < 2 minutes |
| 3 | Or: PITR to last known good state | 15–30 minutes |
| 4 | Verify data integrity | 5–10 minutes |
| 5 | Resume normal operations | Total: 15–45 minutes |

### Scenario C: Complete Infrastructure Loss

| Step | Action | Expected RTO |
|------|--------|-------------|
| 1 | Provision new infrastructure (Terraform) | 10–20 minutes |
| 2 | Deploy platform (Helm/Docker Compose) | 5–10 minutes |
| 3 | Restore database from backup | 15–60 minutes |
| 4 | Restore object storage | 10–30 minutes |
| 5 | Verify and resume | 10 minutes |
| | **Total** | **50 minutes – 2 hours** |

### Scenario D: Ransomware/Security Breach

| Step | Action | Expected RTO |
|------|--------|-------------|
| 1 | Isolate affected systems | Immediate |
| 2 | Assess scope of compromise | 1–4 hours |
| 3 | Provision clean infrastructure | 20 minutes |
| 4 | Restore from verified clean backup | 30–60 minutes |
| 5 | Rotate all secrets and credentials | 30 minutes |
| 6 | Verify integrity and resume | 1 hour |
| | **Total** | **3–7 hours** |

---

## 9. Backup Retention Policy

| Backup Type | Retention | Storage Class |
|-------------|-----------|---------------|
| Hourly WAL archives | 7 days | Standard |
| Daily full backups | 30 days | Standard-IA |
| Weekly full backups | 90 days | Standard-IA |
| Monthly full backups | 1 year | Glacier/Archive |
| Pre-upgrade snapshots | Until next successful upgrade | Standard |
| Compliance archives | 7 years | Glacier Deep Archive |

---

## 10. Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DB_BACKUP_ENABLED` | Enable automated backups | `false` |
| `DB_BACKUP_SCHEDULE` | Cron expression for backup timing | `0 2 * * *` |
| `DB_BACKUP_RETENTION_DAYS` | Days to retain local backups | `30` |
| `BACKUP_S3_BUCKET` | S3 bucket for offsite backup storage | — |
| `BACKUP_ENCRYPTION_KEY` | GPG key ID for backup encryption | — |
| `LAST_BACKUP_TIMESTAMP` | Set by backup script after success | — |
| `BACKUP_ALERT_WEBHOOK` | Webhook URL for backup failure alerts | — |

---

## 11. Quick Reference Commands

```bash
# Create immediate backup
pg_dump --format=custom --compress=9 \
  --file="emergency-$(date +%Y%m%d-%H%M%S).dump" \
  "${DATABASE_URL}"

# List available backups
ls -la /backups/proctira/ | tail -20

# Check backup integrity
pg_restore --list backup.dump | head -20

# Estimate restore time
pg_restore --list backup.dump | wc -l
# Rule of thumb: ~1 minute per 1000 objects

# Verify current backup status
npx proctira-install readiness | jq '.categories[] | select(.name == "db-backup")'
```

---

*Last updated: 2025-01-01*
*Spec reference: Volume 11 — Enterprise Installation, Deployment Automation, and Readiness*
