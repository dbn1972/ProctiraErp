# School ERP module scope — built vs planned vs not done

**Audited:** 2026-09-04 (parallel team pass against packages, gateway, web App Router, Flutter, sign-offs, redesign/marketing).  
**Charter index:** [specs/SCHOOL_ERP_INDEX.md](./specs/SCHOOL_ERP_INDEX.md)

Legend:
- **FULL** — Prisma (when `DATABASE_URL`) + gateway-mounted + usable surface
- **PARTIAL** — chartered domain present but gaps (unmounted subdomains, stubs, thin UI)
- **STUB** — package or UI exists without durable school-domain persistence / gateway mount
- **MARKETING** — claimed in redesign/website/admin entitlements; **no** charter phase / backend domain

---

## 1. Chartered school domains (P3–P16)

| Module | Phase | Backend | Gateway | Web UI | Flutter | Verdict |
|--------|-------|---------|---------|--------|---------|---------|
| Institution | 3 | Prisma + subjects/areas now mounted; infrastructure still in-memory / unmounted | `/institutions`, boards/periods/grades/classes, `/subjects`, `/institution-subjects`, `/areas` | Redesign-aligned list/detail tabs | List + detail | **PARTIAL** (infra gap) |
| Student | 4 | Prisma CRUD + enrollments; bulk import not on Prisma path | `/students`, `/enrollments` | Redesign-aligned (incl. import UI) | List/profile/enrollment/docs | **PARTIAL** (import) |
| Attendance | 5 | Prisma record/roster/reports | `/attendance` | Redesign-aligned mark + reports | Mark + reports | **FULL** |
| Assessment | 6 | Schemes/items/results Prisma; report-cards intentionally unwired | Core only; no `/report-cards` | Partial (schemes/items/results) | Results only | **PARTIAL** |
| Examination | 7 | Prisma exams/candidates/results/docs | `/examinations` | Redesign-aligned | List + results | **FULL** (web); Flutter partial |
| Staff | 8 | Profile + assignments Prisma; appraisal/training in-memory, unmounted | `/staff`, `/staff/assignments` | Deep profile UI (calls appraisal/training APIs that may 404) | **Missing** | **PARTIAL** |
| Scholarship | 9 | Prisma + factory | `/scholarships` | Redesign-aligned | Programs/apply/status | **FULL** |
| Transport | 10 | Prisma + factory | `/transport` | Redesign-aligned | **Missing** | **FULL** (web/API); Flutter gap |
| Health | 11 | Prisma + factory | `/api/v1/health` | Redesign-aligned | Records | **FULL** |
| Workflow | 12 | Prisma defs/instances/cases | `/workflows` | Partial (approvals history/actions incomplete) | **Missing** | **PARTIAL** (UI) |
| Notification | 13 | Prisma; Prisma recipients = explicit `userIds` only | `/notifications` | Inbox + admin rules; no prefs route | Inbox + prefs | **PARTIAL** (recipient expansion) |
| Report | 14 | Prisma jobs/templates; **cross-module ReportDataSource wired** (in-memory UUID joins) | `/reports` | List/new/results (update copy after DS wire) | List + detail (placeholder tables) | **FULL** (API); Flutter partial |
| Survey | 15 | Prisma + factory | `/surveys` | List-only | **Missing** | **PARTIAL** (web depth) |
| Registration | 16 | Applications Prisma; form configs in-memory seed | `/registrations` | Public portal redesign-aligned | **Missing** (by design) | **PARTIAL** (form config) |

---

## 2. Platform (not school schema phases)

| Area | Status |
|------|--------|
| Auth (P2) | **FULL** on gateway with Keycloak/`DATABASE_URL`; live SMS OTP out of scope |
| Tenant / billing / plugin / audit / policy / theme / custom-field / dashboards / DW / admin-dashboard / developer-portal | Mostly **STUB** (in-memory or not on school gateway) |
| ETL | Worker-side **PARTIAL**; not a school gateway domain |
| SaaS billing (`backend-billing`) | Platform SaaS — **not** school fees/finance |

---

## 3. Fully built (charter depth)

Schemas + sign-offs P2–P16 + P9–16 Prisma wiring + P17 Flutter analyze.  
**Strongest end-to-end (API + redesign web):** Attendance, Examination, Scholarship, Transport, Health, Survey (API), Registration portal (public), Auth login.

---

## 4. Chartered but not done / residual

1. Institution **infrastructure** (no Prisma; routes unmounted)
2. Student **bulk import** on Prisma store (import API shape ≠ Prisma student repo)
3. Assessment **report-cards** (no Prisma; gateway disabled)
4. Staff **appraisal / training** (no Prisma; unmounted; web still calls paths)
5. Notification **role/area recipient expansion** on Prisma path
6. Registration **FormConfiguration** table (still in-memory seed)
7. Workflow web **approve/reject + history** completeness
8. Survey web **create/edit/respond/results** beyond list
9. Flutter **device/emulator E2E**, live FCM, Keycloak login polish
10. Flutter screens missing for Staff, Transport, Workflow, Survey
11. Marketing App Router pages under `(marketing)` — empty (legacy SPA / `redesign/website` only)
12. Data-warehouse map placeholder; platform DW not gateway school domain
13. EC3 / production redeploy of latest web+gateway (ops)
14. Live SMS / MFA OTP (P2 non-goal)

---

## 5. Planned / marketing only — **not chartered**

Do **not** build unless charter expands:

| Claim | Where it appears | Backend domain? |
|-------|------------------|-----------------|
| School finance / fees / receipts | Website, redesign, report catalog copy | **No** |
| Payroll | Marketing / i18n | **No** |
| Timetable | Redesign / public site | **No** |
| Library | Infrastructure / plugin mocks | **No** |
| Hostel | Transfer / custom-field mocks | **No** |
| LMS | Admin entitlement stubs | **No** |
| Inventory / assets | — | **No** |
| Canteen / MDM | Marketing / plugin fiction | **No** |
| Alumni CRM | Students redesign tab | **No** |

---

## 6. Recommended remaining order (charter only)

1. Notification recipient expansion; registration form-config persistence; student import Prisma adapter  
2. Staff appraisal/training schema **or** remove web calls until schema exists; assessment report-cards if product needs them  
3. Institution infrastructure Prisma + mount  
4. Workflow approvals + survey depth + reports UI copy sync  
5. Flutter Keycloak + device E2E; mobile Staff/Transport/Workflow/Survey if product needs parity  
6. Only after charter change: Finance/Fees → Timetable/Payroll → Library → Hostel → LMS  

---

## 7. Sign-off staleness

Individual `PHASE_9_*` … `PHASE_16_*` docs may still say “in-memory until wired” — **superseded** by [PHASE_9_16_PRISMA_WIRING_SIGNOFF.md](./PHASE_9_16_PRISMA_WIRING_SIGNOFF.md). ReportDataSource empty stub is **resolved** (cross-module source + gateway inject).
