---
inclusion: auto
name: school-sis-erp-context
description: Repository-local runtime and source-of-truth map for ProctiraErp School/SIS vertical slices. Apply to gateway domains, tenant-owned data, Prisma/RLS, web/mobile/registration clients, jobs, integrations, school modules, or their deployment paths.
---

# ProctiraErp School/SIS runtime context

ProctiraErp is a multi-tenant education platform. This steering file maps School/SIS work to the active repository; detailed engineering standards belong to `enterprise-school-sis-erp` and the matching specialist skills.

## Runtime and source-of-truth map

- Backend composition: `apps/api-gateway/src/app.ts` and `apps/api-gateway/src/domain-plugins.ts`. A package or standalone launcher is not active evidence unless the runtime mounts or deploys it.
- Database model: `packages/shared/database/prisma/schema.prisma` and migrations. Inspect production repositories and adapter factories before assuming models are used durably.
- Tenant/RLS path: use the sanctioned tenant transaction helper exported by `packages/shared/database`; verify queries run on its scoped connection.
- Staff web: `apps/web`; inspect the active Next.js route, feature registry/shell, auth/session path, and API client rather than assuming one UI architecture.
- Other active client roots: `apps/mobile` and `apps/registration-portal`; support apps under `apps/` vary in maturity and must be traced separately.
- Design system: `packages/ui`; shared primitives/tokens are authoritative over screen-local copies.
- CI and topology intent: root/workspace manifests, `.github/workflows`, `docker-compose.yml`, `infrastructure/`, `infra/observability/`, and `docs/runbooks/`.

## Vertical-slice navigation

For the requested capability, locate the active client journey, gateway route/plugin, validation/schema, service, repository/production adapter, Prisma model/migration, authorization, audit, async side effects, tests, deployment dependency, and runbook. Keep domain ownership explicit and validate bare cross-domain identifiers through the owning domain.

## Specialist routing

- Architecture, domain integrity, implementation and evidence review: `enterprise-school-sis-erp`.
- Product outcomes, roadmap, packaging and adoption: `world-class-sis-product`.
- UX/UI, accessibility, localization, responsive/mobile/offline: `inclusive-sis-experience`.
- Government, school boards, statutory returns and standards: `government-education-interoperability`.
- Multi-tenant SaaS security and child-data privacy: `saas-security-privacy`.
- Testing, SRE, migration, release, backup and DR: `sis-reliability-quality`.

`docs/ENTERPRISE_SIS_ERP_GAP_ANALYSIS.md` is a dated audit pinned to commit `09d26e798d332be105c407039d21493ee27a9388` on 2026-09-12. Treat its findings, `docs/SCHOOL_ERP_MODULE_SCOPE.md`, and `docs/PRODUCTION_READINESS.md` as hypotheses to revalidate against current executable evidence.
