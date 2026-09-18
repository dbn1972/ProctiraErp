# Enterprise SIS review checklist

Apply only relevant sections, but never omit tenancy, authorization, privacy, data integrity, and production behavior for a tenant-owned mutation.

## 1. Requirement and workflow

- Are actors, permissions, institution/area scope, preconditions, state transitions, exception paths, and acceptance criteria explicit?
- Does the change complete an actual workflow or only add scaffolding/CRUD?
- Are guardian, student, staff, finance, and operator experiences consistent where the workflow crosses roles?
- Are notifications, documents, approvals, and reconciliation part of the same operational story?

## 2. Domain model and history

- Is the authoritative domain clear?
- Are effective dates, academic period, status history, reversals, and immutable facts represented?
- Are business invariants enforced in the service and, where possible, by database constraints?
- Can concurrent requests violate capacity, uniqueness, balances, stock, room/bed occupancy, clashes, or sequence numbers?
- Are cross-domain UUIDs validated for tenant and lifecycle state? Is orphan handling defined?
- Are money values decimal/minor units rather than floating point?

## 3. Tenant isolation and authorization

- Is tenant context derived from authenticated trusted context rather than request body/query?
- Does every repository query, cache key, object path, event, job, report/export, and log include tenant scope?
- Do Prisma operations use the sanctioned tenant transaction/RLS path?
- Is backend permission and area/institution scope checked with deny-by-default behavior?
- Are ownership/relationship checks present for student/guardian self-service?
- Are negative tests present for cross-tenant and cross-scope access?

## 4. Privacy and security

- Is sensitive data minimized and redacted from logs/errors/metrics?
- Do health, counselling, disability, custody, credentials, and finance fields have stricter access and audit?
- Are consent, purpose, retention, export, correction, deletion/anonymization, and legal-hold implications addressed?
- Are cryptography, token generation, signature comparison, password/session behavior, uploads, and URLs production-grade?
- Are file type/size/content scanning, signed access, encryption, and object retention handled?
- Does production fail closed when secrets/providers/Redis/queues/databases are unavailable?

## 5. API and integration contract

- Are request/response schemas, stable error codes, pagination, filtering, and limits defined?
- Are versioning and backward compatibility addressed for web, Flutter, integrations, and offline queues?
- Are writes idempotent and retry-safe? Is optimistic concurrency used for contested records?
- Are webhooks/events signed, tenant-scoped, ordered where needed, and replayable?
- Is a transactional outbox/inbox or equivalent used for reliable side effects?
- Are timeout, circuit breaking, retry budget, DLQ, and reconciliation defined?

## 6. Persistence and migrations

- Does production use a durable adapter with no silent memory fallback?
- Is migration additive/expand-contract where needed, with backfill, validation, and rollback/forward-fix?
- Are indexes aligned with tenant-first query patterns?
- Are constraints and RLS policies present for every new tenant-owned table?
- Are retention/partitioning/archive requirements considered for high-volume attendance, audit, notification, event, and analytics data?

## 7. Async processing

- Is there a real producer and consumer, not merely a job row or interface?
- Are handlers idempotent, lease-safe, retry-bounded, observable, cancellable, and horizontally safe?
- Are poison messages quarantined in a DLQ with replay tooling/runbook?
- Are job status transitions atomic and protected from duplicate workers?
- Are output objects and partial failures reconciled and cleaned up?

## 8. UI/mobile/accessibility/localization

- Is the screen connected to the active routing/auth shell and live API?
- Are loading, empty, validation, permission-denied, offline, conflict, and partial-failure states handled?
- Are keyboard navigation, focus, labels, contrast, screen-reader semantics, reduced motion, and responsive behavior covered?
- Are messages and data formatting localized, including RTL, dates, time zones, numbers, and currency?
- Is offline capture intentional, encrypted as appropriate, tenant-scoped, idempotent, and conflict-aware?

## 9. Audit and observability

- Is an immutable audit record emitted for high-impact reads/writes, with actor, tenant, scope, reason, before/after or safe diff, request ID, and timestamp?
- Are logs structured and safe? Are metrics bounded-cardinality and tenant-safe?
- Are latency, errors, saturation, job lag/failures, provider failures, and reconciliation drift observable?
- Are traces/correlation propagated across API, queue, worker, and provider boundaries?
- Are SLOs, alerts, runbooks, ownership, and dashboards updated?

## 10. Verification and operations

- Do tests cover invariants, negative authorization, tenant isolation, transactions/concurrency, production adapter integration, retries, and E2E workflow?
- Do deployment probes match actual endpoints?
- Are resources, scaling behavior, PDB/HPA, migration ordering, rollout, rollback, and feature flags safe?
- Are backup, restore, reconciliation, data migration, and operator procedures updated and exercised?
- Does the final report distinguish locally verified behavior from environment-dependent claims?

## Severity guide

- **Critical:** tenant/data exposure, auth bypass, irreversible corruption, credential compromise, or deployment-wide outage likely.
- **High:** core workflow wrong/unavailable, money/history inconsistency, non-durable production behavior, missing reliable side effect, or unsafe migration.
- **Medium:** incomplete exception workflow, insufficient observability/test coverage, scalability/accessibility/localization issue with meaningful impact.
- **Low:** maintainability/documentation issue that does not currently threaten correctness or operations.
