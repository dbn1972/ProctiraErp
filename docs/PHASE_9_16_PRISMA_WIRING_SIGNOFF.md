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
- Flutter device / emulator E2E
- Live FCM / production push config
- Marketing App Router pages (legacy SPA / redesign HTML only)

**Resolved residuals (2026-09-04 follow-on):**
- Cross-module analytical `ReportDataSource` via `createReportDataSource`
- Notification role/area recipient expansion (sequential lookups + UUID merge)
- Institution infrastructure, student bulk import, assessment report-cards,
  staff appraisal/training, and registration form configurations — Prisma +
  gateway (+ matching web surfaces where listed in `SCHOOL_ERP_MODULE_SCOPE.md`)

## Verification
- `pnpm --filter @proctira/api-gateway typecheck` — pass
- `pnpm --filter @proctira/backend-{scholarship,transport,health,workflow,notification,report,survey,registration} typecheck` — pass
