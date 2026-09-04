# Charter expansion plan — §5 modules (not yet chartered)

**Status:** Plan only — **do not implement** until charter explicitly expands.  
**Source:** [SCHOOL_ERP_MODULE_SCOPE.md](../SCHOOL_ERP_MODULE_SCOPE.md) §5  
**Architecture lock:** one Postgres, **schema per domain**, bare UUID refs, no cross-schema FKs/SQL joins (same as P2–P16).  
**Platform note:** SaaS/platform billing stays separate from **school** finance/fees.

---

## 0. Decision gate (required before any build)

Charter must approve, for each module below:

1. Phase number + owning package (`packages/backend/<domain>/`)
2. Postgres schema name
3. MVP entity list + explicit non-goals
4. Gateway mount prefixes
5. Web redesign screens to implement (or “no redesign mock → defer UI”)
6. Flutter: in-scope for MVP or API+web only

Until that gate passes, agents must **not** add packages, migrations, or marketing entitlement keys that imply these domains are shipped.

---

## 1. Proposed phase map (P18+)

| Phase | Module | Schema | Package | Primary gateway prefixes |
|------:|--------|--------|---------|--------------------------|
| 18 | School finance / fees | `finance` | `backend-finance` | `/fees`, `/invoices`, `/payments`, `/fee-structures` |
| 19 | Timetable | `timetable` | `backend-timetable` | `/timetables`, `/periods`, `/substitutions` |
| 20 | Library | `library` | `backend-library` | `/library` |
| 21 | Hostel | `hostel` | `backend-hostel` | `/hostels` |
| 22 | Inventory | `inventory` | `backend-inventory` | `/inventory` |
| 23 | Canteen / MDM | `canteen` | `backend-canteen` | `/canteen` |
| 24 | Payroll | `payroll` | `backend-payroll` | `/payroll` |
| 25 | Alumni | `alumni` | `backend-alumni` | `/alumni` |
| 26 | LMS | `lms` | `backend-lms` | `/lms` |

Numbering is contiguous after P17 Flutter; adjust if charter inserts platform work first.

---

## 2. Delivery waves (dependency order)

### Wave A — money + schedule (highest school ops value)

1. **P18 Finance / fees** — depends on Institution (classes/grades), Student (enrollments), Scholarship (optional credit/waiver UUID refs), Notification (receipts/reminders), Report (collections).
2. **P19 Timetable** — depends on Institution (subjects, classes, periods), Staff (assignments), Attendance (optional period-level mark later).

### Wave B — campus operations

3. **P20 Library** — Student + Staff UUID refs; optional fine → Finance invoice UUID.
4. **P21 Hostel** — Student + Institution area/infra UUID; room fees → Finance.
5. **P22 Inventory** — Institution; issues to Staff/Hostel/Canteen by UUID.
6. **P23 Canteen / MDM** — Student (eligibility), Inventory (stock), Attendance (optional meal presence).

### Wave C — staff compensation

7. **P24 Payroll** — Staff + assignments; payslip artifacts; optional journal export UUID into Finance (not bidirectional SQL).

### Wave D — engagement / learning

8. **P25 Alumni** — Student graduation snapshot (copy fields + `studentId` UUID); optional donation → Finance.
9. **P26 LMS** — Assessment/Examination item UUIDs; content store (MinIO); heaviest UI — last.

Do **not** start Wave D before Wave A is FULL (API+web). LMS especially tends to sprawl.

---

## 3. Per-module MVP plans

Each module follows the P9–P16 pattern:

- Prisma schema + migration + `schema-boundary.test.ts`
- In-memory + Prisma repositories + factory
- Gateway registrar in `domain-plugins.ts`
- App Router web under `(dashboard)/…` matching redesign where mocks exist
- Flutter thin list/detail only if charter includes mobile
- EC3: migrate + validate script + sign-off doc

### P18 — School finance / fees

| | |
|--|--|
| **Own** | Fee structures (by grade/class/year), student fee assignments, invoices, payments, concessions/waivers, receipt numbers |
| **Bare UUID refs** | `tenantId`, `institutionId`, `studentId`, `enrollmentId`, `scholarshipApplicationId?`, `createdByUserId` |
| **MVP flows** | Define structure → assign to enrollment → generate invoice → record payment → receipt PDF/notification |
| **Non-goals (v1)** | Full double-entry GL, bank reconciliation, GST e-invoice network, multi-currency FX, ministry treasury integration |
| **Integrations** | Notification (due reminders); Report (`fee_collection_summary`); Workflow (concession approval); Scholarship (waiver amount applied in-app) |
| **Risk** | Confusing with platform SaaS billing — keep packages/APIs named `finance`/`fees`, never `billing` |

### P19 — Timetable

| | |
|--|--|
| **Own** | Bell periods, timetable grids, section-subject-teacher slots, substitutions, clash rules |
| **Bare UUID refs** | `classId`, `subjectId`, `staffId`, `roomInfrastructureId?`, `academicPeriodId` |
| **MVP flows** | Build weekly grid → publish → substitution for absent teacher → clash validation on save |
| **Non-goals (v1)** | Genetic auto-scheduler, exam seating plans (stay in Examination), parent “today’s periods” push until Notification template exists |
| **Integrations** | Staff workload caps (read staff assignments); Attendance optional later |

### P20 — Library

| | |
|--|--|
| **Own** | Titles, copies, members (student/staff UUID), loans, returns, reservations, fines |
| **MVP flows** | Catalog copy → issue → return → overdue fine (create Finance invoice UUID or local fine until P18 linked) |
| **Non-goals (v1)** | MARC/z39.50 federation, RFID gates, public OPAC multi-tenant discovery |

### P21 — Hostel

| | |
|--|--|
| **Own** | Hostels, blocks/rooms, beds, allocations, visitor logs, mess linkage key |
| **Bare UUID refs** | `studentId`, `infrastructureItemId?`, `feeInvoiceId?` |
| **MVP flows** | Allocate bed → occupancy roster → vacate; optional hostel fee via Finance |
| **Non-goals (v1)** | Full facilities CMMS (use Institution infrastructure), biometric door access |

### P22 — Inventory

| | |
|--|--|
| **Own** | Items, SKUs, stores, stock ledger, indent/issue/return, low-stock threshold |
| **MVP flows** | Receive stock → issue to department/staff → stock on hand report |
| **Non-goals (v1)** | Full procurement/PO/vendor portal, barcode hardware drivers |

### P23 — Canteen / MDM

| | |
|--|--|
| **Own** | Menus, meal calendars, beneficiary eligibility, daily serving counts, wastage |
| **Bare UUID refs** | `studentId`, `inventoryItemId`, `attendanceRecordId?` |
| **MVP flows** | Publish weekly menu → mark served headcount → stock deduct |
| **Non-goals (v1)** | State MDM portal file formats beyond a single export adapter; kitchen IoT |

### P24 — Payroll

| | |
|--|--|
| **Own** | Pay structures, salary components, monthly runs, payslips, statutory deduction placeholders |
| **Bare UUID refs** | `staffId`, `assignmentId`, bank detail fields owned here (or Staff profile UUID only) |
| **MVP flows** | Configure structure → run month → generate payslip PDF → mark paid |
| **Non-goals (v1)** | Live PF/ESI/TDS filings, bank ACH files beyond CSV export, contractor billing |
| **Depends on** | Staff appraisal/training already FULL; do after Finance patterns for “money documents” exist |

### P25 — Alumni

| | |
|--|--|
| **Own** | Alumni profiles (grad year, last class), contact preferences, events, donation intents |
| **MVP flows** | Graduate student → alumni record → directory + event RSVP |
| **Non-goals (v1)** | Full CRM/fundraising automation, LinkedIn sync |

### P26 — LMS

| | |
|--|--|
| **Own** | Courses, enrollments, lessons/content refs, submissions, grade sync keys |
| **Bare UUID refs** | `classId`, `subjectId`, `assessmentItemId?`, `examinationId?`, MinIO object keys |
| **MVP flows** | Course for a class-subject → publish lesson → student submit → teacher acknowledge |
| **Non-goals (v1)** | SCORM/xAPI completeness, video CDN, proctoring, open MOOC marketplace |
| **Depends on** | Assessment + Examination FULL; Notification for assignment due |

---

## 4. Cross-cutting work (once per wave)

| Concern | Approach |
|---------|----------|
| AuthZ | Extend role permissions per domain (`finance.invoice.read`, etc.); reuse area/institution scoping from Staff/Institution |
| Notifications | New templates per domain; no new schema if Notification already expands recipients |
| Reports | Add `ReportDataSource` ports + report types; sequential per-schema queries + in-memory UUID join |
| Workflow | Concession, leave-to-substitution, indent approval — definitions in `workflow`, domain stores result UUID |
| Files | Reuse MinIO/document pattern from Scholarship/Examination |
| Flutter | Wave A: fee balance + timetable “my day”; Wave B+: thin lists; LMS last |
| EC3 | One migrate runbook section per phase; validate script mirroring `validate-phaseN-*-ec3.sh` |
| Marketing entitlements | Flip admin-console keys only after FULL sign-off — not before |

---

## 5. Suggested charter wording (copy/paste)

> Expand ProctiraERP charter with Phases 18–26 for school finance/fees, timetable, library, hostel, inventory, canteen/MDM, payroll, alumni, and LMS. Each phase owns one Postgres schema, mounts on the API gateway, and ships App Router web MVP. Flutter is API+thin screens for Wave A–B; LMS mobile is post-MVP. Platform SaaS billing remains out of scope for school fees. Delivery order: P18→P19, then P20–P23, then P24, then P25–P26.

---

## 6. What “done” means per phase

Same bar as current **FULL** in the scope inventory:

1. Prisma schema + migration applied on EC3  
2. Gateway-mounted routes with boundary tests  
3. Usable redesign-aligned web for MVP flows  
4. Sign-off doc + validate script  
5. Scope table row flipped from MARKETING → FULL (API+web)  

---

## 7. Immediate next step (human)

Pick **one** of:

- **A.** Charter **P18 Finance only** (recommended first cut)  
- **B.** Charter **Wave A** (P18 + P19)  
- **C.** Charter **all P18–P26** with the wave order above  

Reply with A/B/C (and any MVP cuts). Implementation should not start until that choice is explicit.
