---
name: world-class-sis-product
description: Product strategy, discovery, capability design, roadmap, KPI, adoption, packaging, and outcome governance for a world-class School/SIS ERP. Use for PRDs, requirements, user journeys, prioritization, product-market fit, government procurement, school-board variants, SaaS editions, release planning, module completion, and deciding what to build or integrate.
license: Proprietary
metadata:
  domain: school-sis-product
  repository: ProctiraErp
  version: '1.0.0'
---

# World-class School/SIS product skill

Apply this alongside `enterprise-school-sis-erp`. The enterprise skill owns evidence and engineering safety; this skill owns product outcomes, capability coherence, adoption, and portfolio decisions.

## Product doctrine

1. Optimize for measurable school outcomes, trustworthy records, staff time saved, family access, statutory compliance, and service reliability—not module count.
2. Design for complete actor journeys. A feature is not delivered when administrators can create records but teachers, students, guardians, finance staff, auditors, and support teams cannot complete their work.
3. Separate universal education capabilities from jurisdiction, school-board, institution-type, and tenant configuration. Avoid hardcoded policy.
4. Prioritize child safety, tenant/privacy risk, statutory deadlines, financial integrity, and operational continuity ahead of novelty.
5. Treat assisted service, low bandwidth, intermittent connectivity, shared devices, bulk operations, and multilingual users as primary—not edge—contexts.
6. Prefer configuration and standards-based integration over tenant forks.
7. Do not label a capability `complete` from CRUD, schema, route, mock, list page, or demo evidence.

## Required discovery

Before defining a solution, identify:

- Decision owner, target segment, jurisdiction and institution archetypes.
- Actors, jobs-to-be-done, frequency, volume, current workaround and failure cost.
- Student/guardian/staff data sensitivity and child-safety implications.
- Academic calendar, board/regulator, statutory deadline and audit requirements.
- Tenant/area/institution/relationship scope and exception/appeal paths.
- Existing code path and whether the active runtime actually uses it.
- Build, buy, partner, configure and standards-integration alternatives.
- Baseline metrics and the behavior/outcome expected to change.

Use interviews, workflow observation, support tickets, analytics, data-quality reports and operational evidence when available. State when discovery evidence is absent.

## Product artifact standard

For a significant capability, produce:

1. **Opportunity:** affected actors, problem, evidence, frequency, severity and strategic fit.
2. **Outcome:** one primary outcome plus guardrail metrics; avoid output-only KPIs.
3. **Scope:** use cases, non-goals, jurisdiction assumptions and edition/entitlement implications.
4. **Journey/service blueprint:** user steps, backstage operations, systems, handoffs and failure recovery.
5. **Lifecycle:** states, transitions, approvals, reversals, correction, appeal, archive and retention.
6. **Rules:** configurable policy, board/jurisdiction profile, effective dates and precedence.
7. **Experience:** active web/mobile/offline surfaces and all loading/empty/error/permission/conflict states.
8. **Data/integration:** owner, identifiers, quality, migration, reconciliation, API/event/report obligations.
9. **Trust:** authorization, privacy, audit, accessibility and safeguarding requirements.
10. **Operations:** rollout, support, telemetry, SLO, training, migration and rollback.
11. **Acceptance:** behavior-level scenarios and measurable exit criteria.
12. **Evidence freshness:** owner, audited commit/date and revalidation trigger.

## Prioritization

Score value, urgency, confidence, reach, effort and dependency, then apply mandatory risk overrides:

- **P0:** tenant leakage, child-safety/privacy, corrupted academic/financial history, credential risk, data loss or broken production deployment.
- **P1:** core enrollment/attendance/assessment/finance/HR/statutory workflow integrity.
- **P2:** parity, operational depth, integrations and adoption improvements.
- **P3:** optimization and differentiation.

Do not allow high demo value to outrank a P0 foundation. Sequence shared identity, guardian relationships, authorization, audit, jobs/events, monetary primitives and deployment safety before dependent feature breadth.

## SaaS product model

When designing editions or entitlements:

- Separate commercial packaging from authorization.
- Define tenant lifecycle, trial/provisioning, plan change, quotas, grace, suspension, export and offboarding.
- Keep school fees distinct from platform subscription billing.
- Measure activation, time-to-value, adoption by role, workflow completion, support burden, data quality, retention and reliability.
- Provide in-product guidance, role-aware onboarding and safe sample/sandbox data.
- Avoid dark patterns, inaccessible upsells, irreversible cancellation and data hostage behavior.

## Product review questions

- Does this solve a validated high-value job for a named actor?
- Can every required actor complete the full lifecycle and recover from exceptions?
- Is policy configurable across boards/jurisdictions without code forks?
- What becomes the source of truth, and how is history corrected without erasure?
- What is the adoption, quality and outcome metric?
- What support, migration and training burden is created?
- Is this capability truly differentiated, or should it use an established standard/provider?
- Which claim remains unverified?

## Repository anchors

Use `docs/ENTERPRISE_SIS_ERP_GAP_ANALYSIS.md`, `docs/PRODUCTION_READINESS.md`, `docs/SCHOOL_ERP_MODULE_SCOPE.md`, active routes, production adapters, tests and runbooks. When documents disagree with code, report the contradiction and use executable evidence.
