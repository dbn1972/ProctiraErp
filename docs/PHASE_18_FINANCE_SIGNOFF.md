# Phase 18 — ProctiraERP Finance / Fees sign-off

**Status:** MVP scaffolded (API + web list).

| Stream | Result |
|--------|--------|
| Schema | `finance` |
| Tables | `fee_structures`, `invoices`, `payments` |
| Boundaries | Bare `tenant_id` + cross-domain UUIDs (no Tenant FKs) |
| Gateway | `/fees` via `@proctira/backend-finance` |
| Web | `/(dashboard)/finance` |

Non-goals: see [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).
