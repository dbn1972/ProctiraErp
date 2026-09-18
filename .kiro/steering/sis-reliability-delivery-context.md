---
inclusion: auto
name: sis-reliability-delivery-context
description: Repository-specific testing, observability, jobs, performance, migrations, CI/CD, Kubernetes, Helm, backup, disaster recovery, incident, and production-readiness context for ProctiraErp School/SIS.
---

# ProctiraErp reliability and delivery context

Apply `sis-reliability-quality` with `enterprise-school-sis-erp`. Those skills own SRE, quality, migration, release, and recovery methods; this file maps their evidence to the repository.

## Repository map

- Current checks and package boundaries: root `package.json` and affected workspace manifests.
- Runtime and health behavior: `apps/api-gateway/src/app.ts`, `apps/api-gateway/src/domain-plugins.ts`, active worker entry points, and production adapter factories.
- Data-change evidence: `packages/shared/database/prisma/schema.prisma`, migrations, repositories, and executed reconciliation/verification results.
- Declared CI and release paths: `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, and release workflows.
- Topology intent: `docker-compose.yml`, `infrastructure/helm/openemis-platform`, `infrastructure/k8s`, `infra/observability`, and `docs/runbooks/`.

The primary gateway is an in-process Fastify composition even though standalone launchers and distributed deployment assets exist. Verify worker/consumer registration, probe paths, chart/workflow agreement, production adapters, alert delivery, backup schedules, and restore evidence in the current code and target environment. A manifest, queued row, dashboard, alert rule, runbook, or backup document proves intent only—not operation or achieved SLO/RPO/RTO.
