---
name: enterprise-school-sis-erp
description: Evidence-first architecture, implementation, review, modernization, and capability-gap analysis for this enterprise multi-tenant School/SIS ERP. Use for institution, student, guardian, admissions, enrollment, academics, attendance, assessment, exams, timetable, fees, finance, HR, payroll, library, hostel, transport, health, LMS, reporting, analytics, integrations, security, privacy, tenancy, reliability, deployment, or production-readiness work.
license: Proprietary
metadata:
  domain: school-sis-erp
  repository: ProctiraErp
  version: '1.0.0'
---

# Enterprise School/SIS ERP engineering skill

Use this skill to make repository-grounded decisions for ProctiraErp. Optimize for correctness, tenant safety, historical integrity, operational durability, and complete user workflows—not package count, route count, or optimistic documentation.

## Non-negotiable operating principles

1. **Inspect before proposing or editing.** Trace the relevant UI, API route, schema/validation, service, repository, persistence adapter, authorization, audit, async processing, tests, deployment, and runbook.
2. **Code evidence outranks status labels.** A package, Prisma model, route, screen, test, or document marked `FULL` is not proof of an enterprise workflow. Verify the executable end-to-end path.
3. **Use one exclusive evidence status:** `implemented`, `partial`, `absent`, or `unverified`. Record documentation/code conflict as a separate `contradiction` flag, maturity as a separate descriptor, and priority separately. Never convert missing evidence into an assertion.
4. **Do not call CRUD an enterprise module.** A module is complete only when its core lifecycle, invariants, permissions, accounting/history, exception paths, integrations, UI, audit, jobs, tests, and operations are coherent.
5. **Treat tenant isolation and authorization as security boundaries.** Every tenant-owned query, cache key, event, object key, report, job, log, and export must carry trusted tenant context. Enforce authorization server-side and deny by default.
6. **Preserve history.** Model academic periods, enrollments, assignments, fee schedules, payroll structures, consent, and policy changes with effective dates/versioning. Do not overwrite facts needed for transcripts, audits, or reconciliation.
7. **Design durable workflows.** High-impact writes require transactions or explicit sagas, idempotency, optimistic concurrency where relevant, immutable audit evidence, and retry-safe side effects.
8. **Fail closed in production.** In-memory repositories, console providers, missing secrets, unavailable queues, or disabled idempotency must not silently masquerade as successful production behavior.
9. **No security/privacy theatre.** UI permission metadata, role names, hashed-looking placeholders, marketing compliance pages, and documented backup steps are not operating controls.
10. **Complete the applicable vertical slice.** Assess authorization, validation, persistence/migration, UI/client contract, audit, observability, tests, rollout/rollback, and operations. Implement every applicable control and state a short rationale for any `N/A`; do not manufacture irrelevant artifacts.

## Start every task with repository context

Read `references/architecture.md` for system boundaries and known risks. For reviews, also read `references/review-checklist.md`. For audits or planning, also read `references/gap-analysis.md`. Use `assets/master-prompt.md` when a comprehensive audit or modernization plan is requested.

Before implementation, identify:

- Task mode: investigate, gap analysis, design, implementation, migration, review, incident, or production-readiness assessment.
- Affected actors: platform admin, tenant admin, principal, registrar, teacher, staff, accountant, librarian, nurse/counsellor, student, guardian, auditor, integration client, or operator.
- Scope boundaries: tenant, area hierarchy, institution/campus, board, academic period, grade/class/section, and user/institution scope.
- Authoritative domain and data owner; upstream/downstream consumers; consistency requirements.
- Sensitive data involved: identity, child data, guardian/custody, health, counselling, disability, finance, credentials, or audit evidence.
- Existing implementation and whether the actual runtime uses it.

## Enterprise capability model

Consider impacts across these capability groups whenever relevant:

- **Foundation:** tenant lifecycle, institution hierarchy, board/curriculum, academic calendar, identity, roles/policies, configuration, custom fields, localization, accessibility.
- **Student lifecycle:** inquiry, admissions, applicant review, guardian/household/custody, enrollment, class placement, transfer, promotion/retention, withdrawal, graduation, alumni, records/transcripts/certificates.
- **Academics:** curriculum, course/subject offering, timetable, attendance, assignments, assessment, grading, moderation, examinations, report cards, learning support, LMS.
- **People:** staff master, recruitment, onboarding, contracts, assignments, workload, attendance, leave, appraisal, training, payroll, offboarding.
- **Student services:** health, medication, counselling confidentiality, special needs/accommodations, discipline/behavior, transport, hostel, library, meals.
- **Finance/operations:** fee billing, concessions, collections, refunds, reconciliation, scholarship, GL/budget, procurement, inventory/assets, vendors, payroll accounting.
- **Engagement:** parent/student/staff portals, notifications, consent/preferences, surveys, documents, service cases, mobile/offline workflows.
- **Intelligence/integration:** operational reports, regulatory reporting, analytics, warehouse/ETL, APIs, webhooks, standards, imports/exports, migration/reconciliation.
- **Platform operations:** audit, privacy, retention, security, observability, SLOs, queues/workers, backups, DR, release safety, capacity, cost.

## Architecture rules for this repository

- Preserve package/domain ownership and the current Fastify plugin composition unless a measured reason justifies extraction.
- Use Prisma/PostgreSQL adapters in production. Any memory adapter must be test/dev-explicit and guarded by production configuration.
- Use `withTenantTransaction` (or the sanctioned equivalent) for RLS-sensitive work; do not assume an arbitrary pooled connection retains tenant context.
- Cross-domain UUID references need explicit validation, lifecycle handling, reconciliation, and events/read models because database foreign keys do not protect them.
- Prefer an outbox/inbox pattern for domain events and external side effects. Consumers must be tenant-aware, idempotent, observable, retry-bounded, and backed by DLQ/replay procedures.
- Do not split services merely because standalone launchers or Kubernetes manifests exist. First establish ownership, independent scaling/deployment need, durable messaging, and operational maturity.
- Keep API contracts versioned and backward compatible. Validate request and response schemas; use stable error codes, pagination, filtering, concurrency controls, and idempotency keys.
- Monetary values require decimal/minor-unit handling, currency rules, immutable ledger entries, transactional posting, sequence safety, reversals instead of destructive edits, and reconciliation.
- Health/counselling/child records require field-level access decisions, purpose-limited audit, secure export controls, retention, and redaction in logs.

## Task workflows

### Investigation or gap analysis

1. Build a capability-to-code trace from UI to operations.
2. Verify the runtime composition, not only source availability.
3. Compare current behavior with enterprise lifecycle expectations.
4. Produce evidence, gap, risk, recommendation, dependency, priority, effort band, and confidence.
5. Separate confirmed defects, capability gaps, technical debt, documentation drift, and unverified operational controls.
6. End with a sequenced roadmap that resolves security/data foundations before feature breadth.

### Design

Document:

- Goals, non-goals, actors, use cases, invariants, state machine, failure/exception paths.
- Domain ownership, entities/value objects, effective dates, data classification, retention.
- APIs/events/jobs, authorization matrix, audit events, transaction/idempotency/concurrency strategy.
- Migration/backfill/reconciliation, rollout/rollback, observability/SLOs, and test strategy.
- Alternatives and tradeoffs. Reuse existing patterns when safe; explain deviations.

### Implementation

1. Trace requirements to concrete acceptance criteria.
2. Implement one complete vertical slice at a time.
3. Validate IDs and tenant ownership at boundaries; never trust tenant IDs from mutable payloads over authenticated context.
4. Enforce permission and scope in backend routes/services.
5. Preserve atomicity for invariants and publish side effects reliably.
6. Add or update migrations without destructive assumptions; include backfill and rollback/forward-fix notes.
7. Add audit and safe structured telemetry without sensitive payload leakage.
8. Update all active clients and eliminate placeholder/duplicate paths where practical.
9. Run targeted tests, typecheck/lint/build, tenant-isolation checks, and a relevant smoke test.
10. Report what was verified and what remains environment-dependent.

### Review

Lead with findings ordered `critical`, `high`, `medium`, `low`. Cite files and locations. Focus on behavior rather than style. Verify tenant isolation, permission/scope, domain invariants, transaction boundaries, concurrency, event delivery, privacy, migrations, compatibility, tests, telemetry, and rollback.

## Definition of enterprise-ready

A capability is enterprise-ready only when all applicable items are evidenced:

- Complete primary and exception workflows for required actors.
- Durable production persistence and background execution.
- Tenant isolation plus server-side fine-grained authorization.
- Validated domain invariants under concurrency.
- Historical/effective-dated records and immutable audit trail.
- Privacy, consent, retention, export, and sensitive-field controls.
- Versioned API/event contracts and resilient integration behavior.
- Accessible, localized, responsive UI and deliberate offline behavior.
- Automated unit/property/integration/tenant-isolation/E2E coverage proportional to risk.
- Metrics, logs, traces, alerts, SLOs, runbooks, backup/restore, rollout and rollback evidence.
- No silent production fallback, fake crypto, placeholder screen, or unconsumed queued job in the claimed workflow.

## Required response quality

- Put conclusions and highest risks first.
- Cite repository evidence; state conflicts between documentation and code.
- Be explicit about assumptions and confidence.
- Prefer a smaller safe vertical slice over broad scaffolding.
- Do not claim success from a passing command alone; verify requested behavior and artifacts.
