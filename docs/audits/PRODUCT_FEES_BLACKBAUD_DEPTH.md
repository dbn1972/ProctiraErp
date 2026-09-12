# Enterprise product / IA — Fees Blackbaud-depth (F0)

**Module / slice:** Student finance depth v2 — scholarship netting UI · dunning console · recon/parent instalments  
**Branch / tip:** `cursor/fees-ia-lock-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (F0 IA lock only — no UI/API in this slice)  
**Plan of record:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md`  
**Prior product:** `docs/audits/PRODUCT_FEES_FINANCE_V1.md` · security: `docs/audits/SEC_FEES_FINANCE.md`  
**Gateway:** `backend/fees` → `/fees` (`docs/audits/GATEWAY_MOUNT_MATRIX.md`; schemas `010`/`011`/`031`)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Complete **before** F1–F3 build.

---

## 1. Capability statement

When F1–F3 ship on top of today’s Fees v1 (~8.4 PROD_WAIVED), **finance staff** can preview and apply scholarship netting against student invoices, run a dunning/reminder console over the existing overdue feed (sandbox email/SMS honesty), and work reconciliation match/exception lists with an audit trail; **parents** see instalment schedule and remaining-balance clarity on `/parent/fees` while still paying open invoices via sandbox PSP. Live provider receipt proof (G-202) stays on a dated waiver until sandbox keys exist — this epic does **not** claim Blackbaud Tuition “complete” without that evidence or an explicit release-board refresh.

## 2. Personas & jobs

| Persona                     | Job-to-be-done                                                    | Success looks like                                                              |
| --------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Finance / bursar (staff)    | Net a scholarship disbursement onto the right invoice / credit    | Staff surface preview → apply via `POST /fees/scholarships/net`; credit visible |
| Fee officer / collections   | Remind families of overdue balances without blasting suppressions | Dunning console over `GET /fees/reminders/overdue`; cadence + send audit        |
| Fee officer / cashier       | Clear bank/PSP CSV against invoices and escalate exceptions       | Recon import → match/exception list + audit (beyond thin import today)          |
| Parent / guardian (linked)  | Understand what is due when and what remains after instalments    | `/parent/fees` shows schedule + remaining balance; sandbox pay still works      |
| School admin / finance lead | Trust tenant isolation and role gates on money writes             | Cross-tenant deny; pay/netting gated; no SaaS billing crosstalk                 |
| Release / ops (honesty)     | Know whether live PSP is proven or waived                         | G-202 remains dated WAIVED until keys; scorecard stays PROD_WAIVED honestly     |

## 3. Scope

| In scope                                                                                                                                  | Non-goals                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **F0** PRODUCT/IA lock (this document)                                                                                                    | Any UI, API, schema, or e2e implementation in the F0 PR                                                       |
| **F1** Scholarship netting staff UI (closes **F-2**)                                                                                      | New scholarship award/disbursement product (use existing scholarships module hooks)                           |
| **F2** Dunning / reminder operator console (closes **F-3**)                                                                               | Live Twilio/SES/FCM delivery proof (G-709) — sandbox honesty only unless separately funded                    |
| **F3** Recon match/exception UX + parent instalment clarity (closes **F-5**, **F-6**)                                                     | Full ERP GL suite, chart-of-accounts mapping, tax lines, multi-entity consolidation (**F-4** deferred)        |
| Wire to existing APIs: structures, instalments, concessions, refunds, dues CSV, recon import, overdue feed, `POST /fees/scholarships/net` | Replacing sandbox PSP with live capture in this epic (**F-1 / G-202** = keep dated waiver until sandbox keys) |
| Staff shell under `/fees/*` + parent shell `/parent/fees`                                                                                 | Admissions OCR / document AI (**PRD-014** — N/A to Fees; remains NON-GOAL)                                    |
| Tenant + RBAC honesty consistent with `SEC_FEES_FINANCE.md`                                                                               | SaaS `packages/backend/billing`; MapLibre; Flutter device-farm; Keycloak live login evidence (G-107)          |

### Explicit decisions (locked)

| ID / topic            | Decision                                                                                                                                                                                                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **F-1 / G-202**       | **Keep dated waiver** (`docs/audits/WAIVER_BOARD_20260912.md`; note `DEV_FEES_G202_WAIVER.md`) until PSP sandbox keys are available. Do not reopen as a build blocker for F1–F3. **F4 (2026-09-12)** refreshed the waiver date only — still no keys; **do not claim Blackbaud-complete**. |
| **F-4 GL / tax**      | **Deferred non-goal for this epic** unless separately funded. Slice F5 stays optional/OPEN; do not smuggle CoA/tax into F1–F3.                                                                                                                                                            |
| **OCR / ID scan**     | **N/A** to Fees Blackbaud-depth. Admissions **PRD-014** remains NON-GOAL; Fees does not introduce document-AI intake.                                                                                                                                                                     |
| **Staff vs parent**   | Netting, dunning, recon = **staff** shell only. Instalment schedule / remaining balance = **parent** shell. No staff jargon on parent surfaces.                                                                                                                                           |
| **World-class claim** | Until S0/S1 residuals are DONE or dated-waived **and** peer table evidence exists, Fees remains **solid v1 / PROD_WAIVED — not Blackbaud-complete**.                                                                                                                                      |

## 4. Peer parity

Named peer: **Blackbaud Tuition Management** (family billing + school finance ops). Not vague “world class.”

| Peer capability (Blackbaud Tuition)    | Our target this epic (F1–F3)                                                               | Status after F0   |
| -------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------- |
| Fee structures / term billing          | Already on `main` (class × category × term structures)                                     | Shipped v1        |
| Instalment schedules                   | Staff generate/list; **F3** parent schedule/remaining-balance clarity                      | Partial → F3      |
| Concessions / credits / refunds        | Already on `main`                                                                          | Shipped v1        |
| Scholarship / aid netting to tuition   | API + `onDisbursementPaid` exist; **F1** staff preview/apply UI                            | API only → F1     |
| Overdue reminders / dunning            | Overdue feed exists; **F2** operator console (cadence, channels, suppressions, send audit) | Feed only → F2    |
| Bank / payment reconciliation          | CSV import exists; **F3** match/exception workflow + audit                                 | Import only → F3  |
| Family portal pay + receipts           | Parent `/parent/fees` sandbox pay + receipt; honesty banners                               | Shipped (sandbox) |
| Live PSP provider receipt              | **Out** until keys — keep **G-202** dated waiver (**F-1**)                                 | Waived            |
| Full GL / tax / accounting pack export | **Out** this epic (**F-4** deferred)                                                       | Non-goal          |

## 5. Surface map

Existing v1 surfaces remain; F1–F3 add/extend as below. APIs already mounted under gateway `/fees` unless noted.

| Nav label           | Route (proposed)                                            | API                                                                               | Tables / events                                 | Shell (staff / parent / public) | Build slice         |
| ------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------- | ------------------- |
| Fees home           | `/fees`                                                     | plans / invoices summary (existing)                                               | fee plans, invoices                             | staff                           | shipped             |
| Structures          | `/fees/structures`                                          | `GET/POST /fees/structures`, instalments                                          | structures, instalments                         | staff                           | shipped             |
| Plans               | `/fees/plans`                                               | `GET/POST /fees/plans`                                                            | fee_plans                                       | staff                           | shipped             |
| Invoices            | `/fees/invoices`                                            | `GET/POST /fees/invoices`, void/pay                                               | invoices, ledger                                | staff                           | shipped             |
| Receipts            | `/fees/receipts`                                            | `GET /fees/receipts`                                                              | receipts, payments                              | staff                           | shipped             |
| Reports / dues      | `/fees/reports`                                             | `GET /fees/reports/dues` (+ CSV)                                                  | dues aggregates                                 | staff                           | shipped             |
| Scholarship netting | `/fees/netting` (or under `/fees` + scholarships deep-link) | `POST /fees/scholarships/net` + disbursement credit events                        | scholarship credits → fee ledger                | staff                           | **F1**              |
| Dunning / reminders | `/fees/dunning`                                             | `GET /fees/reminders/overdue`; send via notification sandbox                      | overdue feed; reminder send audit; suppressions | staff                           | **F2**              |
| Reconciliation      | `/fees/reconciliation`                                      | `POST /fees/reconciliation/import` + match/exception list APIs (extend as needed) | recon batches/rows; exception audit             | staff                           | **F3**              |
| Family fees         | `/parent/fees`                                              | parent-portal → fees pay/receipts; instalment/remaining read models               | invoices, instalments, receipts                 | parent                          | shipped + **F3** UX |

**Shell decision:** Staff operator chrome for F1–F2–F3 recon; dedicated **parent** shell (`data-shell="parent"`) for instalment clarity. No public unauthenticated fee pay in this epic.

## 6. Roles & tenancy (high level)

| Role                     | Can                                                                               | Cannot                                               |
| ------------------------ | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Finance / bursar (staff) | Structures, invoices, refunds, netting apply, recon import/resolve, dunning send  | Cross-tenant reads/writes; live PSP without keys     |
| Fee officer (staff)      | Dues reports, overdue console, suppressions, exception triage                     | Change scholarship award policy outside scholarships |
| School admin             | Configure structures/plans; view reports                                          | Bypass tenant JWT scope                              |
| Parent (linked)          | View own children’s invoices, instalment schedule, remaining balance; sandbox pay | Other families’ invoices; staff netting/dunning      |
| Student (self)           | Existing student-portal fee reads if already exposed                              | Staff finance writes                                 |
| Unauthenticated / public | —                                                                                 | Pay, net, recon, dunning                             |

Tenant boundary notes:

- All fees rows are `tenantId`-scoped (JWT tenant); repository filters + unit isolation remain the bar (`SEC_FEES_FINANCE.md`).
- Parent pay requires parent–child link assertion (existing).
- Scholarship netting must not credit another tenant’s invoice/disbursement (IDOR deny in F1 tests).
- Sandbox-only honesty banners on pay/dunning until G-202 / G-709 reopen.
- No crosstalk with SaaS `packages/backend/billing`.

## 7. Success metrics / DoD

### F0 (this slice) — Definition of Scope

- [x] PRODUCT audit exists at `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md` with all checklist sections filled
- [x] Peer table names **Blackbaud Tuition** capabilities vs our targets
- [x] Explicit decisions: **F-1/G-202 keep waiver**; **F-4 GL/tax deferred**; **OCR N/A**
- [x] Surface map covers F1–F3 (netting, dunning, recon/parent instalments)
- [x] Staff vs parent shell decision recorded
- [x] TASKS progress log updated; handoff to build skill without implementing UI/API here

### Epic DoD (after F1–F3; not claimed by F0)

- [ ] F1: Staff netting UI + unit/write smoke + tenant deny; tip CI green
- [ ] F2: Dunning console over overdue feed; sandbox channel honesty; tip CI green
- [ ] F3: Recon match/exception + parent instalment clarity; e2e/visual smoke; tip CI green
- [ ] No claim of Blackbaud-complete while G-202 remains waived without dated board acceptance
- [ ] F-4 remains OPEN/deferred unless funded

## 8. Handoff

| Next skill       | Audit path / action                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Build (F1 first) | `.cursor/skills/enterprise-module-development/SKILL.md` → `docs/audits/DEV_FEES_SCHOLARSHIP_NETTING.md` (create on F1) |
| UX               | `docs/audits/UX_FEES_BLACKBAUD_DEPTH.md` (after F1–F3 UI; designer pass + captures)                                    |
| A11y             | Route list includes `/fees/netting`, `/fees/dunning`, `/fees/reconciliation`, `/parent/fees`                           |
| Security         | Extend `docs/audits/SEC_FEES_FINANCE.md` (netting IDOR, dunning RBAC, recon audit)                                     |
| Test             | e2e 39 extend / new specs; gated paid→receipt remains F4/G-202                                                         |
| Release          | Tip CI on each slice PR; main tip follow-up; waiver board untouched unless F4 keys                                     |

**Build order:** F1 (netting UI) → F2 (dunning) → F3 (recon + parent instalments) → F4 (PSP evidence **or** waiver refresh) → F5 optional only if F-4 funded.

**Honesty:** F0 is docs-only. Do not start SQL/UI until this PRODUCT audit is on the slice branch used for build.
