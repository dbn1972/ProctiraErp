---
name: sis-reliability-quality
description: SRE, observability, performance, scalability, testing, data migration, release engineering, incident response, backup, disaster recovery, and operational excellence for enterprise School/SIS ERP. Use for SLOs, alerts, runbooks, queues, jobs, CI/CD, Kubernetes, Helm, capacity, load, chaos, failover, deployment, production readiness, and quality gates.
license: Proprietary
metadata:
  domain: sis-reliability-quality
  repository: ProctiraErp
  version: '1.0.0'
---

# School/SIS reliability and quality skill

Apply this alongside `enterprise-school-sis-erp`. Declarative assets are not operating evidence: a dashboard, alert, HPA, backup document, test file or runbook proves intent only until execution is observed.

## Reliability principles

1. Define reliability from user journeys: login, enrollment, attendance capture, grade publication, fee payment, statutory submission and emergency record access.
2. Assign service tier, owner, SLI/SLO, dependency budget, RPO/RTO and support path before scaling architecture.
3. Prefer a reliable modular monolith over premature distributed services. Extract only with ownership, deployment/scaling need and mature contracts/operations.
4. Every background job must be durable, tenant-aware, idempotent, leased, retry-bounded, cancellable where needed, observable and replayable through a DLQ/quarantine process.
5. Test failure and recovery, not only happy-path output.
6. Use progressive delivery, compatibility windows and reversible changes.
7. Keep telemetry low-cardinality, correlation-rich and free of sensitive data.

## SLO and observability standard

For each critical journey define:

- Availability and correctness SLI, not only HTTP success.
- Latency distribution by operation/role and acceptable data freshness.
- Job lag, queue age, provider delivery, reconciliation drift and saturation.
- Error budget, burn-rate alerts, ownership, escalation and decision policy.
- Structured logs, request/correlation propagation and trace boundaries.
- Dashboard and runbook links validated against deployed components.

Avoid tenant/user/student IDs as metric labels. Preserve correlation in logs/traces with access controls. Test Prometheus rules and zero-traffic/error cases.

## Quality strategy

Match validation to risk:

- Unit/property tests for domain invariants and parsers.
- Repository integration tests against production adapters and transactions.
- Tenant/authorization negative tests across HTTP, DB, cache, queue, search, reports and objects.
- Contract tests for APIs/events/providers and backward compatibility.
- Authenticated journey E2E for representative roles and exception paths.
- Accessibility/localization/offline/device tests for affected experiences.
- Load/soak for rosters, attendance, imports, reports, statutory submissions and peak login.
- Chaos/failover and restore tests for critical dependencies.

Affected-only checks accelerate feedback; full release gates remain necessary before production.

## Data and migration safety

- Use expand/backfill/verify/switch/contract for incompatible changes.
- Make backfills resumable, tenant-scoped, observable, idempotent and reconciled.
- Define data-quality rules, quarantine and operator correction.
- Preserve immutable academic/financial/audit history.
- Verify RLS, indexes, query plans, lock/transaction duration and rollback/forward-fix.
- Never run destructive reset or data-loss push against valuable environments.

## Release engineering

Require one authoritative topology and artifact path. A production release should evidence:

1. Immutable artifact/SBOM/provenance and environment configuration validation.
2. Backward-compatible schema/API/event rollout order.
3. Preflight capacity/dependency/secret/migration checks.
4. Canary or staged rollout with automated smoke and SLO observation.
5. Explicit rollback/roll-forward thresholds and data compatibility.
6. Post-deploy workflow, job, reconciliation and alert verification.
7. Change record, owner and support communication.

Do not deploy from an unverified push independently of required CI gates.

## Backup and disaster recovery

For PostgreSQL, object storage, identity, configuration, queues and required secrets, define ownership, encrypted schedule, immutability/offsite copy, retention, monitoring and restoration. Run restore drills into isolated environments, verify tenant isolation and business reconciliation, measure achieved RPO/RTO and track corrective actions. Documentation alone is `unverified`.

## Incident operations

Maintain actionable runbooks, on-call routing, severity taxonomy, communication templates, safe diagnostic access and postmortem action tracking. Include child-safety/privacy and statutory-deadline escalation. Practice game days for database loss, identity outage, queue backlog, provider outage, bad migration, tenant leak and region failure.

## Repository-specific checks to revalidate

- Gateway health, rate-limit and idempotency degradation behavior.
- ETL durable state and probe endpoint alignment.
- Helm chart path used by the deploy workflow.
- Actual Loki/tracing availability versus runbook references.
- Alert delivery, backup schedules, restore drills and achieved SLO/RPO/RTO.
- Queue consumers, DLQs and replay tooling behind persisted job rows.

## Required output

State target journey/SLO, current evidence, failure modes, capacity assumptions, dependency behavior, telemetry, tests, rollout, rollback, runbook, DR and unresolved external verification. Do not claim production readiness from configuration or a passing build alone.
