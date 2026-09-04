# Phase 25 — ProctiraERP Alumni sign-off

**Status:** MVP scaffolded (API + web list).

| Stream | Result |
|--------|--------|
| Schema | `alumni` |
| Tables | `profiles`, `events` |
| Boundaries | Bare `tenant_id` + cross-domain UUIDs (no Tenant FKs) |
| Gateway | `/alumni` via `@proctira/backend-alumni` |
| Web | `/(dashboard)/alumni` |

Non-goals: see [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).
