# School ERP module scope — built vs planned vs not done

**Audited:** 2026-09-04 (parallel team pass).  
**Updated:** 2026-09-04 — all chartered school-domain PARTIAL gaps closed for API + web E2E.  
**Charter index:** [specs/SCHOOL_ERP_INDEX.md](./specs/SCHOOL_ERP_INDEX.md)

Legend:
- **FULL** — Prisma (when `DATABASE_URL`) + gateway-mounted + usable web surface
- **PARTIAL** — chartered domain present but gaps remain
- **STUB** — package or UI without durable school-domain persistence / gateway mount
- **MARKETING** — claimed in redesign/website/admin entitlements; **no** charter phase / backend domain

---

## 1. Chartered school domains (P3–P16)

| Module | Phase | Backend | Gateway | Web UI | Flutter | Verdict |
|--------|-------|---------|---------|--------|---------|---------|
| Institution | 3 | Prisma incl. subjects, areas, **infrastructure** | `/institutions`, boards/periods/grades/classes, `/subjects`, `/institution-subjects`, `/areas`, `/infrastructure` | Redesign-aligned list/detail tabs | List + detail | **FULL** (API+web) |
| Student | 4 | Prisma CRUD + enrollments + **bulk import** | `/students`, `/enrollments`, `/students/import` | Redesign-aligned (incl. import) | List/profile/enrollment/docs | **FULL** (API+web) |
| Attendance | 5 | Prisma record/roster/reports | `/attendance` | Redesign-aligned mark + reports | Mark + reports | **FULL** |
| Assessment | 6 | Schemes/items/results + **report-cards** Prisma | Core + `/report-cards` | Schemes/items/results + report-cards | Results only | **FULL** (API+web) |
| Examination | 7 | Prisma exams/candidates/results/docs | `/examinations` | Redesign-aligned | List + results | **FULL** (web); Flutter partial |
| Staff | 8 | Profile + assignments + **appraisal/training** Prisma | `/staff` (+ appraisals, training) | Deep profile + appraisal/training APIs | **Missing** | **FULL** (API+web) |
| Scholarship | 9 | Prisma + factory | `/scholarships` | Redesign-aligned | Programs/apply/status | **FULL** |
| Transport | 10 | Prisma + factory | `/transport` | Redesign-aligned | **Missing** | **FULL** (web/API) |
| Health | 11 | Prisma + factory | `/api/v1/health` | Redesign-aligned | Records | **FULL** |
| Workflow | 12 | Prisma defs/instances/cases | `/workflows` | Definitions + instances + **approvals wired** | **Missing** | **FULL** (API+web) |
| Notification | 13 | Prisma + **role/area recipient expansion** | `/notifications` | Inbox + preferences tab + admin rules | Inbox + prefs | **FULL** (API+web) |
| Report | 14 | Prisma jobs/templates + cross-module ReportDataSource | `/reports` | List/new/results | List + detail (thin) | **FULL** (API+web) |
| Survey | 15 | Prisma + factory | `/surveys` | List + create/edit/detail/distributions/results | **Missing** | **FULL** (API+web) |
| Registration | 16 | Applications + **FormConfiguration** Prisma | `/registrations` (+ form-config admin) | Public portal + `/admin/registration-forms` | N/A (portal) | **FULL** (API+web) |

---

## 2. Platform (not school schema phases)

| Area | Status |
|------|--------|
| Auth (P2) | **FULL** on gateway with Keycloak/`DATABASE_URL`; live SMS OTP out of scope |
| Tenant / billing / plugin / audit / policy / theme / custom-field / dashboards / DW / admin-dashboard / developer-portal | Mostly **STUB** (in-memory or not on school gateway) |
| ETL | Worker-side **PARTIAL**; not a school gateway domain |
| SaaS billing (`backend-billing`) | Platform SaaS — **not** school fees/finance |

---

## 3. Fully built (charter depth — API + web)

All P3–P16 school domains now meet **FULL** for Prisma + gateway + App Router web (when `DATABASE_URL` set).  
P2 Auth + P9–16 Prisma wiring + P17 Flutter analyze remain signed off.

---

## 4. Remaining residuals (non-blocking / out of school E2E)

1. Flutter **device/emulator E2E**, live FCM, Keycloak login polish
2. Flutter screens missing for Staff, Transport, Workflow, Survey (parity optional; Transport was already FULL without mobile)
3. Marketing App Router pages under `(marketing)` — empty (legacy SPA / `redesign/website` only)
4. Data-warehouse map placeholder; platform DW not gateway school domain
5. EC3 / production redeploy of latest web+gateway (ops)
6. Live SMS / MFA OTP (P2 non-goal)
7. Apply new Prisma migrations on deployed DBs (`20260904_*` infrastructure, report-cards, staff appraisal/training, form configs, user role assignments)

---

## 5. Planned / marketing only — **not chartered**

Do **not** build unless charter expands:

| Claim | Where it appears | Backend domain? |
|-------|------------------|-----------------|
| School finance / fees / receipts | Website, redesign, report catalog copy | **No** |
| Payroll | Marketing / i18n | **No** |
| Timetable | Redesign / public site | **No** |
| Library / hostel / inventory / canteen/MDM / alumni / LMS | Redesign mocks / admin entitlements | **No** |

---

## 6. Migrations added for this completion pass

- `20260904_add_institution_infrastructure`
- `20260904_assessment_report_cards`
- `20260904_staff_appraisal_training`
- `20260904_form_configurations`
- `20260904_user_role_assignments`
