# Production Readiness Checklist

> ProctiraERP Unified Platform — Enterprise Deployment Readiness Guide
>
> Use this checklist before promoting any environment to production.
> Run `proctira-install readiness` for an automated score.

---

## 1. Infrastructure Prerequisites

| #    | Check                                 | Required    | Notes                         |
| ---- | ------------------------------------- | ----------- | ----------------------------- |
| 1.1  | Node.js ≥ 20 LTS installed            | ✅          | Use exact LTS version         |
| 1.2  | PostgreSQL 16+ with PostGIS           | ✅          | RDS/Cloud SQL or self-managed |
| 1.3  | Redis 7+ (cluster mode for HA)        | ✅          | ElastiCache or self-managed   |
| 1.4  | Object storage (S3/MinIO/GCS)         | ✅          | Versioning enabled            |
| 1.5  | Message queue (RabbitMQ or Kafka)     | ✅          | With DLQ configured           |
| 1.6  | Container runtime (Docker/containerd) | ✅          | For containerized deployments |
| 1.7  | Kubernetes 1.28+ (if using Helm)      | Recommended | With RBAC enabled             |
| 1.8  | DNS configured for tenant subdomains  | ✅          | Wildcard DNS or per-tenant    |
| 1.9  | Load balancer with health checks      | ✅          | ALB/NLB/Traefik/nginx         |
| 1.10 | Minimum 4 GB RAM per node             | ✅          | 8 GB recommended              |
| 1.11 | Minimum 10 GB disk per node           | ✅          | SSD recommended               |

---

## 2. Security

| #    | Check                                               | Required    | Notes                                 |
| ---- | --------------------------------------------------- | ----------- | ------------------------------------- |
| 2.1  | TLS certificates installed                          | ✅          | Valid, non-self-signed for production |
| 2.2  | HTTPS enforced (HTTP → HTTPS redirect)              | ✅          | At load balancer or app level         |
| 2.3  | JWT_SECRET is cryptographically random (≥ 32 bytes) | ✅          | `openssl rand -base64 32`             |
| 2.4  | COOKIE_SECRET is cryptographically random           | ✅          | Different from JWT_SECRET             |
| 2.5  | Database password is strong and unique              | ✅          | Not a default value                   |
| 2.6  | Secrets stored in vault/secrets manager             | Recommended | Vault, AWS SM, GCP SM                 |
| 2.7  | CORS_ORIGINS restricted to known domains            | ✅          | No wildcards in production            |
| 2.8  | Rate limiting configured                            | ✅          | Default: 100 req/min                  |
| 2.9  | Admin account created with strong password          | ✅          | MFA enabled                           |
| 2.10 | MFA enabled for all admin roles                     | ✅          | TOTP or WebAuthn                      |
| 2.11 | SSO configured (SAML/OIDC)                          | Recommended | For enterprise deployments            |
| 2.12 | API keys rotated from defaults                      | ✅          | No dev keys in production             |
| 2.13 | Debug endpoints disabled                            | ✅          | NODE_ENV=production                   |
| 2.14 | Source maps not served to clients                   | ✅          | Build without source maps             |
| 2.15 | Security headers configured (CSP, HSTS, etc.)       | ✅          | Via reverse proxy or app              |

---

## 3. Database

| #    | Check                                    | Required    | Notes                         |
| ---- | ---------------------------------------- | ----------- | ----------------------------- |
| 3.1  | All migrations applied                   | ✅          | `prisma migrate deploy`       |
| 3.2  | Row-Level Security (RLS) policies active | ✅          | Tenant isolation              |
| 3.3  | Connection pooling configured            | ✅          | PgBouncer or built-in         |
| 3.4  | Read replicas configured (HA)            | Recommended | For read-heavy workloads      |
| 3.5  | Automated backups enabled                | ✅          | Daily minimum                 |
| 3.6  | Point-in-time recovery (PITR) enabled    | ✅          | For RDS/Cloud SQL             |
| 3.7  | Backup retention ≥ 30 days               | ✅          | Compliance requirement        |
| 3.8  | Restore procedure tested                 | ✅          | Document RTO/RPO              |
| 3.9  | Database monitoring enabled              | ✅          | Slow query logging            |
| 3.10 | Connection limits set appropriately      | ✅          | Based on pool size × replicas |

---

## 4. Object Storage

| #   | Check                                  | Required    | Notes                            |
| --- | -------------------------------------- | ----------- | -------------------------------- |
| 4.1 | Bucket created with proper permissions | ✅          | Least-privilege IAM              |
| 4.2 | Versioning enabled                     | Recommended | For accidental deletion recovery |
| 4.3 | Lifecycle policies configured          | Recommended | Archive old objects              |
| 4.4 | Encryption at rest enabled             | ✅          | SSE-S3 or SSE-KMS                |
| 4.5 | CORS configured for direct uploads     | ✅          | If using presigned URLs          |
| 4.6 | Backup/replication configured          | Recommended | Cross-region for DR              |

---

## 5. Message Queue

| #   | Check                              | Required    | Notes                       |
| --- | ---------------------------------- | ----------- | --------------------------- |
| 5.1 | Queue service running and healthy  | ✅          | RabbitMQ or Kafka           |
| 5.2 | Dead-letter queue (DLQ) configured | ✅          | For failed message handling |
| 5.3 | Message retention configured       | ✅          | Based on replay needs       |
| 5.4 | Queue monitoring/alerting          | ✅          | Queue depth alerts          |
| 5.5 | Consumer group configured          | ✅          | For horizontal scaling      |
| 5.6 | TLS enabled for queue connections  | Recommended | In production               |

---

## 6. Observability

| #   | Check                                   | Required           | Notes                                                                                                                                                                                                                                             |
| --- | --------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1 | Structured logging (JSON) enabled       | ✅                 | LOG_LEVEL=info                                                                                                                                                                                                                                    |
| 6.2 | Log aggregation configured              | ✅                 | ELK, Loki, CloudWatch                                                                                                                                                                                                                             |
| 6.3 | Metrics export enabled (Prometheus)     | ✅                 | `GET /metrics` on api-gateway, etl-worker and the 9 standalone services via `@proctira/observability`; scraped by `infra/observability/prometheus.yml`. **No OTLP exporter** — `METRICS_ENABLED=false` is the only switch                         |
| 6.4 | Distributed tracing enabled             | ❌ Not implemented | No OpenTelemetry SDK/exporter is wired; `TRACING_ENABLED` / `OTEL_EXPORTER_OTLP_ENDPOINT` have no effect. Logs are `x-request-id` correlated across gateway → domain plugins. Tracked in the gap audit (G-725 follow-up)                          |
| 6.5 | Dashboards created (Grafana/CloudWatch) | ✅                 | Service health, latency, errors (`infra/observability/grafana/`)                                                                                                                                                                                  |
| 6.6 | Alerting rules configured               | ✅                 | `infra/observability/alerts/*.yml`; receivers rendered from `ALERT_EMAIL_TO`, `PAGERDUTY_INTEGRATION_KEY`, `SLACK_WEBHOOK_URL`, `SLACK_SECURITY_WEBHOOK_URL` by `render-alertmanager.sh` — missing keys fall back to email, never to a dead route |
| 6.7 | SLO/SLA targets defined                 | Recommended        | 99.9% availability                                                                                                                                                                                                                                |
| 6.8 | Error tracking (Sentry/Bugsnag)         | Recommended        | For frontend errors                                                                                                                                                                                                                               |
| 6.9 | Uptime monitoring (external)            | ✅                 | Pingdom/UptimeRobot                                                                                                                                                                                                                               |

---

## 7. Audit & Compliance

| #   | Check                                | Required | Notes                     |
| --- | ------------------------------------ | -------- | ------------------------- |
| 7.1 | Audit logging enabled                | ✅       | AUDIT_ENABLED=true        |
| 7.2 | Audit log retention configured       | ✅       | ≥ 365 days for compliance |
| 7.3 | Audit logs are immutable/append-only | ✅       | Separate storage          |
| 7.4 | Data retention policies configured   | ✅       | Per jurisdiction          |
| 7.5 | GDPR/privacy controls enabled        | ✅       | Data export, deletion     |
| 7.6 | Access logs retained                 | ✅       | Load balancer + app level |

---

## 8. High Availability

| #   | Check                               | Required    | Notes                                  |
| --- | ----------------------------------- | ----------- | -------------------------------------- |
| 8.1 | Multiple application replicas (≥ 2) | ✅          | Behind load balancer                   |
| 8.2 | Database failover configured        | ✅          | Multi-AZ or streaming replication      |
| 8.3 | Redis sentinel/cluster mode         | Recommended | For cache HA                           |
| 8.4 | Queue cluster mode                  | Recommended | RabbitMQ cluster or Kafka multi-broker |
| 8.5 | Health check endpoints configured   | ✅          | /health on all services                |
| 8.6 | Graceful shutdown handling          | ✅          | SIGTERM handling                       |
| 8.7 | Rolling deployment strategy         | ✅          | Zero-downtime deploys                  |
| 8.8 | Pod disruption budgets (K8s)        | Recommended | minAvailable: 1                        |
| 8.9 | Multi-AZ deployment                 | Recommended | For zone failure resilience            |

---

## 9. Tenant Configuration

| #   | Check                             | Required    | Notes                   |
| --- | --------------------------------- | ----------- | ----------------------- |
| 9.1 | Tenant base domain configured     | ✅          | TENANT_BASE_DOMAIN      |
| 9.2 | Wildcard DNS or per-tenant DNS    | ✅          | \*.platform.example.com |
| 9.3 | Tenant isolation verified         | ✅          | RLS + schema isolation  |
| 9.4 | Default tenant created            | ✅          | Via install wizard/CLI  |
| 9.5 | Tenant resource limits configured | Recommended | Rate limits per tenant  |

---

## 10. Deployment Pipeline

| #    | Check                             | Required    | Notes                    |
| ---- | --------------------------------- | ----------- | ------------------------ |
| 10.1 | CI/CD pipeline configured         | ✅          | GitHub Actions/GitLab CI |
| 10.2 | Automated tests pass              | ✅          | Unit + integration       |
| 10.3 | Container images built and tagged | ✅          | Semantic versioning      |
| 10.4 | Image vulnerability scanning      | ✅          | Trivy/Snyk               |
| 10.5 | Staging environment validated     | ✅          | Mirror of production     |
| 10.6 | Rollback procedure documented     | ✅          | Tested in staging        |
| 10.7 | Change management process         | Recommended | For enterprise           |

---

## 11. Documentation & Runbooks

| #    | Check                               | Required    | Notes                  |
| ---- | ----------------------------------- | ----------- | ---------------------- |
| 11.1 | Runbooks for all services           | ✅          | In docs/runbooks/      |
| 11.2 | Incident response plan              | ✅          | Escalation paths       |
| 11.3 | Backup/restore procedure documented | ✅          | See BACKUP_RESTORE.md  |
| 11.4 | Upgrade procedure documented        | ✅          | Version-specific notes |
| 11.5 | Architecture diagram current        | Recommended | Updated per release    |
| 11.6 | On-call rotation established        | ✅          | For production support |

---

## 12. Pre-launch Validation

| #    | Check                                   | Required    | Notes                |
| ---- | --------------------------------------- | ----------- | -------------------- |
| 12.1 | `proctira-install validate` passes      | ✅          | All checks green     |
| 12.2 | `proctira-install health` passes        | ✅          | All services healthy |
| 12.3 | `proctira-install readiness` score ≥ 80 | ✅          | Grade B or above     |
| 12.4 | Load test completed                     | Recommended | Verify capacity      |
| 12.5 | Penetration test completed              | Recommended | For enterprise       |
| 12.6 | Disaster recovery drill completed       | Recommended | Annual minimum       |
| 12.7 | Stakeholder sign-off obtained           | ✅          | Before go-live       |

---

## Quick Commands

```bash
# Run all pre-install checks
npx proctira-install validate

# Verify post-install health
npx proctira-install health

# Get enterprise readiness score
npx proctira-install readiness

# Generate diagnostic bundle for support
npx proctira-install diagnostics

# Pre-check before upgrading
npx proctira-install upgrade-check --target 1.2.0
```

---

## Scoring Guide

| Grade | Score  | Meaning                                  |
| ----- | ------ | ---------------------------------------- |
| A     | 90–100 | Production ready                         |
| B     | 80–89  | Acceptable with minor gaps               |
| C     | 70–79  | Significant gaps — address before launch |
| D     | 60–69  | Major issues — not production ready      |
| F     | < 60   | Critical failures — do not deploy        |

---

_Last updated: 2025-01-01_
_Spec reference: Volume 11 — Enterprise Installation, Deployment Automation, and Readiness_
