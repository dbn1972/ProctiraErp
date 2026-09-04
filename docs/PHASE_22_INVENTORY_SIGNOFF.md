# Phase 22 — ProctiraERP Inventory sign-off

**Status:** MVP scaffolded (API + web list).

| Stream | Result |
|--------|--------|
| Schema | `inventory` |
| Tables | `items`, `stock_movements` |
| Boundaries | Bare `tenant_id` + cross-domain UUIDs (no Tenant FKs) |
| Gateway | `/inventory` via `@proctira/backend-inventory` |
| Web | `/(dashboard)/inventory` |

Non-goals: see [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).
