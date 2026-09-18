---
inclusion: auto
name: government-education-context
description: Repository-specific government, ministry, district, school-board, statutory reporting, public procurement, data-sovereignty, and education-interoperability context for ProctiraErp.
---

# ProctiraErp government and school-board context

Apply `government-education-interoperability` with `enterprise-school-sis-erp`. Those skills own jurisdiction, statutory-lifecycle, standards, procurement, and conformance methods; this file only maps them to repository evidence.

## Repository map

- Institution hierarchy, board/curriculum, academic periods, identifiers, and tenant configuration: relevant domain packages, `packages/shared/database/prisma/schema.prisma`, and migrations.
- Runtime registration for report, workflow, institution, student, attendance, assessment/examination, finance, staff/payroll, and integration capabilities: `apps/api-gateway/src/domain-plugins.ts`.
- Government-facing and assisted-service clients: active routes in `apps/web`, `apps/mobile`, and `apps/registration-portal`.
- Data exchange evidence: active API routes/contracts, provider adapters, jobs/events, imports/exports, reconciliation code, and contract tests—not package or OpenAPI presence alone.
- Deployment and sovereignty declarations: `.github/workflows`, `docker-compose.yml`, `infrastructure/`, `infra/observability/`, and `docs/runbooks/`. Their presence does not prove certification or operation in a jurisdiction.

No repository artifact is authoritative for current CBSE, CISCE/ICSE, state-board, UDISE+, APAAR, DIKSHA, NDEAR, OneRoster, Ed-Fi, SIF, CEDS, LTI, SCORM, xAPI, or statutory requirements. Use current official sources and record their version/effective date in the resulting design or evidence.
