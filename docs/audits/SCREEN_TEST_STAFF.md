# Screen test — Staff module (Sunrise Public School)

**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** `db/seeds/006_sunrise_public_school_demo.sql` (see `docs/audits/DATA_SUNRISE_DEMO_TENANT.md`)  
**Branch:** `cursor/screen-test-staff`  
**Reviewer session (UTC):** 2026-09-26  
**Auth:** HS256 gateway cookie (`setupGatewayTenantSession` pattern), `JWT_SECRET=dev-secret-change-in-production`  
**Out of scope:** `/staff/attendance` (skipped per campaign), parent/fees/students trees untouched  

**Seeded staff (primary labels):**

| Person        | Role              | Id |
| ------------- | ----------------- | -- |
| Sunil Rao     | Principal         | `00000000-0000-4000-8000-00000000a591` |
| Priya Sharma  | Class teacher 9-B | `00000000-0000-4000-8000-00000000a592` |
| Neha Verma    | Accounts          | `00000000-0000-4000-8000-00000000a593` |

## Environment

Local Postgres 16 + api-gateway (`:3000`) + `@proctira/web` (`:3001`). Sunrise seed applied after Prisma migrate + `apply-sql.sh`.

## Route table

| Route | Primary action exercised | Result | Notes |
| ----- | ------------------------ | ------ | ----- |
| `/staff` | Open **Sunil Rao** from directory table | **PASS** | Three seeded names listed; no UUID primary labels in table |
| `/staff/00000000-0000-4000-8000-00000000a591` | Profile head shows **Sunil Rao**; overview loads | **PASS** | Principal row; assignments tab empty (expected) |
| `/staff/00000000-0000-4000-8000-00000000a592` | **Assignments** tab shows **9-B**, **Mathematics** | **PASS** | Institution **Sunrise Public School** (post label fix) |
| `/staff/00000000-0000-4000-8000-00000000a592/edit` | Edit shell for **Priya Sharma** | **PASS** | `Edit Priya Sharma` heading |
| `/staff/new` | Add staff form renders | **PASS** | Primary CTA present; no write attempted |
| `/staff/import` | Bulk import heading + panel | **PASS** | CSV dry-run not re-run (non-destructive inventory) |
| `/staff/contracts` | Contract form staff picker lists **Sunil Rao** | **PASS** | Name labels in `<select>` |
| `/staff/payroll` | **Build export** for current month | **PASS** | Panel hydrates; export returns rows / empty-state copy |
| `/staff/leaves` | Submit leave for **Neha Verma**; **Approve** opens confirm dialog | **PASS** | `ConfirmActionDialog` before approve POST |
| `/staff/substitutions` | Substitutions workspace + create form | **PASS** | **No timetable meetings** seeded — create submit not exercised (empty options) |
| `/staff/00000000-0000-4000-8000-00000000a592/assignments/new` | Workload sidebar shows **9-B · Mathematics** | **PASS** | No raw assignment UUIDs in sidebar after fix |
| `/staff/00000000-0000-4000-8000-00000000a591/appraisals/new` | **New appraisal** form for Sunil Rao | **PASS** | Heading + criteria card |
| `/staff/attendance` | — | **BLOCKED** | Skipped per screen-test scope |

## Fixes applied (staff-only)

1. **`apps/web/src/app/(dashboard)/staff/[id]/page.tsx`** — Resolve institution/class/subject labels on assignment cards and assignments table (was raw UUID / truncated id).
2. **`apps/web/src/app/(dashboard)/staff/[id]/assignments/new/page.tsx`** — Workload sidebar uses class/subject names; loads class catalog for all assignment institutions.
3. **`apps/web/src/features/staff/pages/StaffProfile.tsx`** — Federated profile title loads **First Last** from gateway instead of `Staff {uuid}`.

## Residual / honest limits

- Substitutions **write** path needs timetable meetings (not in Sunrise seed).
- Payroll export may show **no rows** until attendance/payroll inputs exist; export action still succeeds.
- Program **production-ready** / CI **Aggregate** not claimed here — merge only if tip Aggregate is green (squash-merge policy).

## Evidence

- Playwright headless checks (Sunrise tenant cookie) on 2026-09-26 against local stack.
- Assignment label spot-check: Priya profile HTML contains `9-B`, `Mathematics`, `Sunrise Public School` without assignment UUIDs in visible table cells.
