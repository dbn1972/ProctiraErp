# Phase 13 — ProctiraERP Notification schema sign-off

**Status:** Complete in repo; EC3 apply + boundary checks (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Schema | Postgres/`Prisma` schema **`notification`** |
| Tables created | `notifications`, `notification_rules`, `notification_templates` |
| Boundaries | Bare `tenant_id`; bare cross-domain UUIDs (no Tenant FKs) |
| Tests | `packages/backend/notification/src/schema-boundary.test.ts` |
| Validate | `tools/scripts/validate-phase13-notification-ec3.sh` |

## EC3

- Schemas include `notification`; forbidden cross-schema FKs from `notification` = **0**
- Tables created (empty seed OK)
- Regression: students / staff / examinations still **200**

## Explicit non-goals
- Full Prisma repository wiring for this domain (in-memory remains until wired)
- Flutter mobile (after Phase 16)

## Next
Phase 14.
