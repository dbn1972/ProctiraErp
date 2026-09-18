---
inclusion: auto
name: saas-security-privacy-context
description: Repository-specific tenant isolation, IAM, authorization, RLS, child-data privacy, secrets, audit, files, payments, webhooks, entitlements, and secure SaaS context for ProctiraErp.
---

# ProctiraErp SaaS security and privacy context

Apply `saas-security-privacy` with `enterprise-school-sis-erp`. Those skills own the control model and review method; this file identifies repository trust anchors and evidence caveats.

## Repository trust map

- Gateway authentication, tenant resolution, rate limiting, idempotency, and mounted domains: `apps/api-gateway/src/app.ts` and `apps/api-gateway/src/domain-plugins.ts`.
- Tenant-owned persistence: `packages/shared/database/prisma/schema.prisma`, migrations, and the sanctioned tenant-transaction helper exported by `packages/shared/database`.
- Identity, policy, and audit evidence: active auth, tenant, policy, audit, and affected domain route/service packages. Frontend permission metadata is navigation behavior, not backend enforcement.
- Sensitive boundaries to trace: public registration, web/mobile offline storage, reports/exports, caches, queues/events, object storage, notifications, payments, webhooks, support access, and developer credentials.
- Production adapter selection: inspect repository/provider factories and environment guards; memory or console implementations elsewhere in the tree do not prove production use.

Global JWT or tenant middleware does not by itself prove route-level permission, institution/area, relationship, record-state, or sensitive-field authorization. RLS evidence is valid only when affected queries use the tenant-scoped connection. Treat security/privacy/compliance documents and tests as claims until the active runtime and target environment evidence support them.
