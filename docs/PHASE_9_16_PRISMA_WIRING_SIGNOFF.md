# Phases 9–16 — Prisma repository wiring sign-off

**Status:** Complete in repo (2026-09-04). P9–P16 domain packages now select Prisma when `DATABASE_URL` is set (else in-memory), and the API gateway registers them in-process.

## Delivered

| Domain | Package | Factory | Gateway prefix |
|--------|---------|---------|----------------|
| Scholarship | `@proctira/backend-scholarship` | `createScholarshipRepository` | `/scholarships` |
| Transport | `@proctira/backend-transport` | `createTransportRepository` | `/transport` |
| Health | `@proctira/backend-health` | `createHealthRepository` | `/health` (under `/api/v1`) |
| Workflow | `@proctira/backend-workflow` | `createWorkflowRepository` + `createCaseRepository` | `/workflows` |
| Notification | `@proctira/backend-notification` | `createNotificationRepository` | `/notifications` |
| Report | `@proctira/backend-report` | `createReportRepository` | `/reports` |
| Survey | `@proctira/backend-survey` | survey / distribution / submission + institution lookup | `/surveys` |
| Registration | `@proctira/backend-registration` | `createRegistrationRepository` | `/registrations` |

Composition root: `apps/api-gateway/src/domain-plugins.ts`.

## Explicit non-goals
- Notification role/area recipient expansion beyond explicit user IDs
- Full web module UI redesign per domain
- Flutter device / emulator E2E

**Resolved residual:** Cross-module analytical `ReportDataSource` is wired via
`createReportDataSource` (per-schema repository queries + in-memory UUID joins)
in `apps/api-gateway/src/domain-plugins.ts`.

## Verification
- `pnpm --filter @proctira/api-gateway typecheck` — pass
- `pnpm --filter @proctira/backend-{scholarship,transport,health,workflow,notification,report,survey,registration} typecheck` — pass
