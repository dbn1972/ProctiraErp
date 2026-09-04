# School ERP module scope — built vs planned vs not done

**Audited:** 2026-09-04 (parallel team pass).  
**Updated:** 2026-09-04 — API+web PARTIAL gaps closed; Flutter Staff/Transport/Workflow/Survey + Keycloak login polish + marketing App Router + migrate runbook completed. Device E2E blocked (no Android SDK in this environment).  
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
| Institution | 3 | Prisma incl. subjects, areas, **infrastructure** | `/institutions`, boards/periods/grades/classes, `/subjects`, `/institution-subjects`, `/areas`, `/infrastructure` | Redesign-aligned list/detail tabs **incl. Staff tab** | List + detail | **FULL** |
| Student | 4 | Prisma CRUD + enrollments + **bulk import** | `/students`, `/enrollments`, `/students/import` | Redesign-aligned (incl. import) | List/profile/enrollment/docs | **FULL** |
| Attendance | 5 | Prisma record/roster/reports | `/attendance` | Redesign-aligned mark + reports | Mark + reports | **FULL** |
| Assessment | 6 | Schemes/items/results + **report-cards** Prisma | Core + `/report-cards` | Schemes/items/results + report-cards | Results only | **FULL** (API+web); Flutter partial |
| Examination | 7 | Prisma exams/candidates/results/docs | `/examinations` | Redesign-aligned | List + results | **FULL** (web); Flutter partial |
| Staff | 8 | Profile + assignments + **appraisal/training** Prisma | `/staff` (+ appraisals, training) | Deep profile + appraisal/training | List + detail (+ appraisals/training) | **FULL** |
| Scholarship | 9 | Prisma + factory | `/scholarships` | Redesign-aligned | Programs/apply/status | **FULL** |
| Transport | 10 | Prisma + factory | `/transport` | Redesign-aligned | Overview/routes/vehicles/assignments | **FULL** |
| Health | 11 | Prisma + factory | `/api/v1/health` | Redesign-aligned | Records | **FULL** |
| Workflow | 12 | Prisma defs/instances/cases | `/workflows` | Definitions + instances + approvals | Definitions/instances/approvals | **FULL** |
| Notification | 13 | Prisma + **role/area recipient expansion** | `/notifications` | Inbox + preferences + admin rules | Inbox + prefs | **FULL** |
| Report | 14 | Prisma jobs/templates + cross-module ReportDataSource | `/reports` | List/new/results | List + detail (thin) | **FULL** (API+web); Flutter thin |
| Survey | 15 | Prisma + factory | `/surveys` | List + create/edit/detail/distributions/results | List + detail/respond | **FULL** |
| Registration | 16 | Applications + **FormConfiguration** Prisma | `/registrations` (+ form-config admin) | Public portal + admin forms | N/A (portal) | **FULL** |

---

## 2. Platform (not school schema phases)

| Area | Status |
|------|--------|
| Auth (P2) | **FULL** on gateway with Keycloak/`DATABASE_URL`; mobile login uses `/auth/login` (+ password/refresh). Live SMS OTP out of scope |
| Marketing site | App Router pages under `(marketing)` — home, about, features, pricing, contact, demo, legal, installation, security, status |
| Tenant / billing / plugin / audit / policy / theme / custom-field / dashboards / DW / admin-dashboard / developer-portal | Mostly **STUB** |
| ETL | Worker-side **PARTIAL** |
| SaaS billing | Platform SaaS — **not** school fees/finance |

---

## 3. Fully built

All P3–P16 school domains meet **FULL** for Prisma + gateway + App Router web (when `DATABASE_URL` set), with Flutter parity for Staff/Transport/Workflow/Survey added.  
P2 Auth + P9–16 Prisma wiring + P17 Flutter analyze remain signed off.

---

## 4. Remaining residuals

1. **Flutter device/emulator E2E** — blocked here (no Android SDK). Unit/widget tests pass (`flutter test`). Run `flutter test integration_test` on a host with Android SDK + emulator (or iOS). See mobile README.
2. **Live FCM** — code path ready; needs `google-services.json` / `GoogleService-Info.plist` (not committed). Without configs, FCM no-ops safely.
3. **EC3 migrate** — residual tables applied on EC3 Postgres (2026-09-04); schema up to date. Redeploy gateway/web only if binary lags the branch.
4. Data-warehouse map placeholder; platform DW not gateway school domain
5. Live SMS / MFA OTP (P2 non-goal)
6. CTAs still intentionally disabled (no API): infra repair/log, district map, admin invite user, workflow pause
7. Flutter still thin where APIs lack list endpoints: exam candidates list, scholarship binary upload, tenant directory, enrollment-summary report

---

## 5. Planned / marketing only — **not chartered**

Do **not** build unless charter expands: school finance/fees, payroll, timetable, library, hostel, inventory, canteen/MDM, alumni, LMS.

---

## 6. Migrations for partial-completion pass

- `20260904_add_institution_infrastructure`
- `20260904_assessment_report_cards`
- `20260904_staff_appraisal_training`
- `20260904_form_configurations`
- `20260904_user_role_assignments`

Apply via the runbook above on deployed databases.
