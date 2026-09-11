# World-class gaps 1–10 — headless backend close (2026-09-11)

**Branch:** `cursor/w10-health-dw-ux-56c3`  
**Scope:** backend/API only (no MapLibre UI, no sealed CA PDF, no live secrets).

| # | Gap | Headless close | Evidence |
|---|-----|----------------|----------|
| 1 | Student finance depth / scholarship netting | `FeesService.applyScholarshipNetting` + `POST /fees/scholarships/net`; scholarship `onDisbursementPaid` → fee credit | `scholarship-netting.test.ts`; domain-plugins wiring |
| 2 | Admissions offer → fee → enrol | `createOfferFeeInvoice` / `assertOfferFeePaid` on pipeline; invoice on create/send; pay gate on accept | `pipeline-service.ts`, `domain-plugins.ts` |
| 3 | LMS depth | Already mounted (bank/rubrics/files/discussions/analytics/Spiral PAL) — no new residual | `038_lms_depth_schema.sql`, `/lms` |
| 4 | Parent academic 360 | Aliases `…/report-cards` + `…/lms` (homework) on parent/student portals | `parent-portal/routes.ts` |
| 5 | Year rollover fees/timetable | `cloneStructuresForPeriod`, `TimetableService.cloneForAcademicPeriod`, calendar rollover flags `copyFeeStructures` / `copyTimetable` | fees + timetable + academic-calendar |
| 6 | Exam board ops | Already mounted (invigilators, double entry, re-eval). **Sealed PDF = NON-GOAL** | `/examinations` ops routes |
| 7 | Provider sandboxes | `@proctira/backend-providers` + `GET /providers/capabilities` + sandbox IdP token | `providers-plugin.ts` |
| 8 | BI scheduled reports | Already mounted (`/reports` scheduler) — DW stays honesty/demo | reports package |
| 9 | Transport telematics | GPS ingest + device key already headless; MapLibre UI = NON-GOAL | `/transport/gps` |
| 10 | Tenant branding | `branding: { disabled: false }` on tenant lifecycle | `app.ts` |

## Non-goals (unchanged)
- Live IdP / PSP / Twilio / FCM without secrets
- MapLibre map UI
- CA-sealed exam PDF
