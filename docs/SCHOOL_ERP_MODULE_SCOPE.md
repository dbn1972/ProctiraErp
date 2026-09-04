# School ERP module scope — built vs planned vs not done

**Audited:** 2026-09-04 (parallel team pass).  
**Updated:** 2026-09-04 — §4 residuals closed in code (CTAs, Flutter thin screens, DW map, SMS OTP abstraction, FCM secret injection, EC3 migrations). Live Twilio/FCM/device E2E remain ops-blocked.  
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
| Institution | 3 | Prisma incl. subjects, areas, **infrastructure** (+ repair logs) | `/institutions`, boards/periods/grades/classes, `/subjects`, `/institution-subjects`, `/areas`, `/infrastructure` | Redesign-aligned list/detail tabs **incl. Staff tab** + repair CTA | List + detail | **FULL** |
| Student | 4 | Prisma CRUD + enrollments + **bulk import** | `/students`, `/enrollments`, `/students/import` | Redesign-aligned (incl. import) | List/profile/enrollment/docs | **FULL** |
| Attendance | 5 | Prisma record/roster/reports | `/attendance` | Redesign-aligned mark + reports | Mark + reports | **FULL** |
| Assessment | 6 | Schemes/items/results + **report-cards** Prisma | Core + `/report-cards` | Schemes/items/results + report-cards | Results only | **FULL** (API+web); Flutter partial |
| Examination | 7 | Prisma exams/candidates/results/docs | `/examinations` (+ candidates list) | Redesign-aligned | List + detail + candidates | **FULL** |
| Staff | 8 | Profile + assignments + **appraisal/training** Prisma | `/staff` (+ appraisals, training) | Deep profile + appraisal/training | List + detail (+ appraisals/training) | **FULL** |
| Scholarship | 9 | Prisma + factory + **document upload** | `/scholarships` | Redesign-aligned | Programs/apply/status + upload | **FULL** |
| Transport | 10 | Prisma + factory | `/transport` | Redesign-aligned | Overview/routes/vehicles/assignments | **FULL** |
| Health | 11 | Prisma + factory | `/api/v1/health` | Redesign-aligned | Records | **FULL** |
| Workflow | 12 | Prisma defs/instances/cases (+ **pause / isActive**) | `/workflows` | Definitions + instances + approvals + pause | Definitions/instances/approvals | **FULL** |
| Notification | 13 | Prisma + **role/area recipient expansion** | `/notifications` | Inbox + preferences + admin rules | Inbox + prefs | **FULL** |
| Report | 14 | Prisma jobs/templates + cross-module ReportDataSource (+ **enrollment_summary**) | `/reports` | List/new/results | List + detail + enrollment_summary | **FULL** |
| Survey | 15 | Prisma + factory | `/surveys` | List + create/edit/detail/distributions/results | List + detail/respond | **FULL** |
| Registration | 16 | Applications + **FormConfiguration** Prisma | `/registrations` (+ form-config admin) | Public portal + admin forms | N/A (portal) | **FULL** |

---

## 2. Platform (not school schema phases)

| Area | Status |
|------|--------|
| Auth (P2) | **FULL** on gateway with Keycloak/`DATABASE_URL`; mobile login uses `/auth/login` (+ password/refresh). SMS MFA OTP: Console + Twilio providers; invite + tenant directory routes mounted |
| Marketing site | App Router pages under `(marketing)` — home, about, features, pricing, contact, demo, legal, installation, security, status |
| Tenant / billing / plugin / audit / policy / theme / custom-field / dashboards / DW / admin-dashboard / developer-portal | Mostly **STUB**; DW map is interactive Leaflet (institution lat/lng + GIS features) |
| ETL | Worker-side **PARTIAL** |
| SaaS billing | Platform SaaS — **not** school fees/finance |

---

## 3. Fully built

All P3–P16 school domains meet **FULL** for Prisma + gateway + App Router web (when `DATABASE_URL` set), with Flutter parity for Staff/Transport/Workflow/Survey and §4 thin screens.  
P2 Auth + P9–16 Prisma wiring + P17 Flutter analyze remain signed off.

---

## 4. Remaining residuals

| # | Item | Status |
|---|------|--------|
| 1 | **Flutter device/emulator E2E** | **Ops-blocked** — `tools/scripts/run-mobile-e2e.sh` + `integration_test` present; exits 2 when no AVD/device. `flutter test` unit/widget suite passes. Needs developer machine or CI emulator. |
| 2 | **Live FCM** | **Code complete / secrets-blocked** — example configs + `scripts/apply-fcm-secrets.sh`; without real Firebase files FCM no-ops; with secrets, token registers to `POST /api/v1/notifications/devices`. |
| 3 | **EC3 migrate + redeploy** | **Done** — EC3 Postgres includes P18–P26 schemas (39 migrations); gateway (:3200) registers finance…lms; web (:3201) list pages present. Use `REDIS_URL_HOST` / `DATABASE_URL_HOST` outside Compose. |
| 4 | **Data-warehouse map** | **Done** — interactive Leaflet map (`map-client` / `map-canvas`); institution overview links with `?institutionId=`. |
| 5 | **Live SMS / MFA OTP** | **Code complete / secrets-blocked** — OTP send/verify + Console/Twilio; hashed store in `auth.otp_challenges`; web MFA SMS path. Set `TWILIO_*` on EC3 for live SMS. |
| 6 | **Disabled CTAs** | **Done** — infra repair/log, district map link, admin invite user, workflow pause wired to APIs. |
| 7 | **Flutter thin screens** | **Done** — exam candidates, scholarship document upload, tenant directory (`/auth/tenants`), `enrollment_summary` report generation. |

---

## 5. Charter expansion P18–P26 — **production MVP**

Built in wave order after charter go-ahead. Finance / timetable / payroll deepened beyond CRUD:

| Phase | Module | Schema | Gateway | Web | Status |
|------:|--------|--------|---------|-----|--------|
| 18 | Finance / fees | `finance` | `/fees` | `/(dashboard)/finance` | **Ops cycle** — assign → invoice → pay + receipts |
| 19 | Timetable | `timetable` | `/timetables` | `/(dashboard)/timetable` | **Ops cycle** — clash detection (409) |
| 20 | Library | `library` | `/library` | `/(dashboard)/library` | **CRUD + web list** |
| 21 | Hostel | `hostel` | `/hostels` | `/(dashboard)/hostel` | **CRUD + web list** |
| 22 | Inventory | `inventory` | `/inventory` | `/(dashboard)/inventory` | **CRUD + web list** |
| 23 | Canteen / MDM | `canteen` | `/canteen` | `/(dashboard)/canteen` | **CRUD + web list** |
| 24 | Payroll | `payroll` | `/payroll` | `/(dashboard)/payroll` | **Ops cycle** — generate run + payslips |
| 25 | Alumni | `alumni` | `/alumni` | `/(dashboard)/alumni` | **CRUD + web list** |
| 26 | LMS | `lms` | `/lms` | `/(dashboard)/lms` | **CRUD + web list** |

Plan + non-goals: [plans/CHARTER_EXPANSION_SECTION5.md](./plans/CHARTER_EXPANSION_SECTION5.md).  
Production posture: [PRODUCTION_READINESS.md](./PRODUCTION_READINESS.md).  
Sign-offs: `docs/PHASE_18_FINANCE_SIGNOFF.md` … `docs/PHASE_26_LMS_SIGNOFF.md`.  
EC3: migrations through `20260904_finance_fee_cycle`; gateway registers all nine domains.

---

## 6. Migrations for partial-completion + §4 residual + §5 expansion

- `20260904_add_institution_infrastructure`
- `20260904_assessment_report_cards`
- `20260904_staff_appraisal_training`
- `20260904_form_configurations`
- `20260904_user_role_assignments`
- `20260904_infrastructure_repair_logs`
- `20260904_workflow_definition_is_active`
- `20260904_user_invites`
- `20260904_auth_otp_challenges`
- `20260904_finance_schema`
- `20260904_timetable_schema`
- `20260904_library_schema`
- `20260904_hostel_schema`
- `20260904_inventory_schema`
- `20260904_canteen_schema`
- `20260904_payroll_schema`
- `20260904_alumni_schema`
- `20260904_lms_schema`
- `20260904_finance_fee_cycle`

Apply via [docs/runbooks/APPLY_PARTIAL_MODULE_MIGRATIONS.md](./runbooks/APPLY_PARTIAL_MODULE_MIGRATIONS.md) on deployed databases.
