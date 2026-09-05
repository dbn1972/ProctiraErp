# Web App — Scholarships (programs / applications / disbursements)

Live verification for the Scholarships service screens listed in the redesign
nav (`WEB APP — SERVICES`).

## Redesign nav → live status

| Redesign item | Live route | Status | Evidence |
|---|---|---|---|
| Scholarships · programs | `/scholarships` | **DONE** | H1 programs list + Applications / Disbursements / New program CTAs |
| Scholarships · program detail | `/scholarships/programs/[id]` | **DONE** | Seeded program detail with slots, award, application window |
| Scholarships · new program | `/scholarships/programs/new` | **DONE** | Create form wired to `createScholarshipProgramAction` |
| Scholarships · applications | `/scholarships/applications` | **DONE** | Applications list + status tabs / export affordances |
| Scholarships · application detail | `/scholarships/applications/[id]` | **DONE** | Seeded application review page |
| Scholarships · disbursements | `/scholarships/disbursements` | **DONE** | Disbursements table + retry failed transfers action |

**Result: 6 / 6 DONE** (route chrome + primary CTAs load without 404/500).

## Production wiring in this branch

- `@proctira/backend-scholarship` registered in-process on the API gateway under `/api/v1/scholarships`
- In-memory repository seeded with demo program / application / disbursement IDs for detail routes
- Web API client maps backend field names (`amountPerRecipient`, `under_review`, payment statuses) to UI types
- Create / update program and disbursement retry server actions

## Seed IDs

- Program: `11111111-1111-4111-8111-111111111111` (National Merit Scholarship 2026)
- Application: `22222222-2222-4222-8222-222222222222`
- Disbursement: `33333333-3333-4333-8333-333333333333`

## Automated coverage

- Playwright: `apps/web/e2e/10-scholarships.spec.ts` (6 screens)
- Screen capture targets updated in `apps/web/scripts/capture-screens.mjs`

## Notes

- Empty-state UIs still count as route-ready when page chrome and primary CTA load.
- Screenshots: `/opt/cursor/artifacts/scholarships-audit/`.
- Gateway on this branch registers an in-memory scholarship plugin with demo seed
  (Prisma `createScholarshipRepository` is not yet on `main`). Environments that
  already wire Prisma scholarships (e.g. EC3) keep their existing repository;
  live verify seeds demo rows via the public API for those hosts.
- Capture IDs can be overridden with `SCHOLARSHIP_PROGRAM_ID` /
  `SCHOLARSHIP_APPLICATION_ID` when seeding against a live database.
