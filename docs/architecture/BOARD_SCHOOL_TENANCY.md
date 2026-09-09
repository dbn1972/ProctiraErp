# Board → School tenancy model

**Gap:** G-805 · **Related:** Wave 8 FRS

## Hierarchy

Tenant (Board SaaS customer) → Board → Institution (school) → classes / students / staff / LMS

## Enforcement

| Layer | Mechanism |
|-------|-----------|
| Postgres RLS | `app.tenant_id` / `withPgTenant` |
| JWT | `institutions: string[]`, roles |
| Gateway institution-scope (G-805) | Inject / 403 on school-bound list/read prefixes |
| Domain filters | Optional `institutionId` on students/staff/fees/library/hostel |
| Feature entitlements (G-810) | JWT/env feature maps; 403 `FEATURE_NOT_ENTITLED` |

School-bound = `institutions.length > 0` and not board/tenant/platform admin.
