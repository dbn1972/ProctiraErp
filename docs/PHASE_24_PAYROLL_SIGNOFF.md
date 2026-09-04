# Phase 24 — ProctiraERP Payroll sign-off

**Status:** MVP scaffolded (API + web list).

| Stream | Result |
|--------|--------|
| Schema | `payroll` |
| Tables | `pay_structures`, `payroll_runs`, `payslips` |
| Boundaries | Bare `tenant_id` + cross-domain UUIDs (no Tenant FKs) |
| Gateway | `/payroll` via `@proctira/backend-payroll` |
| Web | `/(dashboard)/payroll` |

Non-goals: see [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).
