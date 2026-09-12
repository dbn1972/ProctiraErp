# Task file — Fees (Blackbaud-class) + Admissions CRM→enrol gaps

**Status:** OPEN — plan of record for the next two depth slices  
**Created (UTC):** 2026-09-12  
**Base tip:** `536619cf` (`main`)  
**Peer targets:** Blackbaud Tuition Management · PowerSchool / Infinite Campus admissions CRM  
**Skills gate (every task):** `product/IA → build → UX → a11y → security → test → release`  
**Honesty:** v1 is **PROD_WAIVED**, not world-class 10/10. Do not close this file as “complete” while live PSP / public-apply secrets stay waived unless the release board re-dates the waiver.

---

## 0. Baseline (what is already shipped)

| Module         | On `main` today                                                                                                                                                                     | Honest score                                             |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| **Fees**       | Structures (class × category × term), instalments, concessions, refunds, dues CSV, recon import, overdue feed, scholarship **net API** (`POST /fees/scholarships/net`), sandbox PSP | ~**8.4 PROD_WAIVED** (G-202 live PSP)                    |
| **Admissions** | Enquiry CRM, seat matrix, merit lists, offers → invoice → pay gate → auto-enrol; waitlist/interview slots; staff UI under `/admissions/*`                                           | ~**8.0 PROD_WAIVED** (OCR NON-GOAL; live apply residual) |

Evidence: `docs/audits/GATEWAY_MOUNT_MATRIX.md`, `DEV_WORLD_CLASS_GAPS_1_10_HEADLESS.md`, scorecard Fees/Admissions rows, PRs #30 / #33 / #41 / Wave-10 headless.

---

## 1. Gap register (residuals only)

### A — Student finance depth (Blackbaud-class)

| ID      | Gap                                  | Severity    | Why it blocks “world class”                                                                     | Fix type                                       |
| ------- | ------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| **F-1** | **Live / sandbox PSP proof (G-202)** | S0 evidence | Pay+receipt still honesty-stub without keys; Blackbaud-class ops need provider receipt          | Secrets + adapter e2e **or** keep dated waiver |
| **F-2** | **Scholarship netting UI**           | S1          | API/`onDisbursementPaid` exist; no staff surface to run/review netting vs awards                | Build (UI + audit)                             |
| **F-3** | **Dunning / reminder console**       | S1          | Overdue feed exists; no operator console for cadence, channels, suppressions                    | Build                                          |
| **F-4** | **GL / tax / export depth**          | S2          | No chart-of-accounts mapping, tax lines, or accounting-pack export                              | Build (scope-lock first)                       |
| **F-5** | **Parent instalment clarity**        | S2          | Parent `/parent/fees` pays invoices; schedule/breakdown UX thinner than Blackbaud family portal | UX                                             |
| **F-6** | **Recon ops UX**                     | S2          | CSV import API/UI present; match/exception workflow + audit trail thin                          | Build                                          |
| **F-7** | **Tip CI live pay journey**          | S1 test     | e2e 39 covers structures; gated paid→receipt against sandbox provider not tip-proven            | Test                                           |

### B — Admissions CRM → enrol (enquiry → merit → seat → offer → pay → enrol)

| ID      | Gap                                    | Severity   | Why it blocks “world class”                                                              | Fix type                             |
| ------- | -------------------------------------- | ---------- | ---------------------------------------------------------------------------------------- | ------------------------------------ |
| **A-1** | **Public apply + applicant IdP**       | S0 product | Staff CRM exists; public apply/account path residual vs peer CRM                         | Build **or** dated NON-GOAL          |
| **A-2** | **Parent / applicant offer-pay UX**    | S1         | Offer fee invoice + accept pay-gate headless; family-facing “pay to accept” journey thin | Build                                |
| **A-3** | **Pipeline store persistence honesty** | S1         | Plugin still defaults pipeline CRM store to **in-memory** if PG not wired                | Build (force PG when `DATABASE_URL`) |
| **A-4** | **OCR / document AI**                  | —          | **PRD-014 NON-GOAL** (manual capture)                                                    | Do not build unless product reverses |
| **A-5** | **Entrance-test / exam link**          | S2         | Merit weights exist; no first-class entrance-test score ingest UI                        | IA then build                        |
| **A-6** | **Quota / category rules UI**          | S2         | Seat matrix rows exist; category/reservation rules UX incomplete vs IC/PS                | Build                                |
| **A-7** | **End-to-end tip proof**               | S1 test    | e2e 41 smoke; full enquiry→merit→seat→offer→pay→enrol not tip-CI green as one journey    | Test                                 |

---

## 2. Ordered task queue (execute top-down)

One slice per PR. Copy PRODUCT checklist before build. Tip CI green before merge; watch **main** tip after merge.

### Slice F0 — IA lock (Fees depth v2)

- [x] Copy `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md` → `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md`
- [x] Lock peer table (Blackbaud Tuition): structures, instalments, refunds, recon, scholarship netting, dunning
- [x] Explicit non-goals: full ERP GL suite / multi-entity consolidation (unless funded)
- [x] Decision on **F-1**: **keep dated G-202 waiver** until sandbox keys (do not block F1–F3)
- **Exit:** PRODUCT audit **IN PR** on `cursor/fees-ia-lock-56c3`; handoff to build skill
- **Status:** DONE (IA) — docs-only; see `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md`

### Slice F1 — Scholarship netting UI (closes F-2)

- [x] Staff page under `/fees` (or scholarships) to preview/apply netting + show credits
- [x] Wire to `POST /fees/scholarships/net` + disbursement credit events
- [x] Unit + write smoke; tenant deny
- [x] UX empty/error honesty; a11y list routes
- **Exit:** DEV + SEC notes; tip CI green

### Slice F2 — Dunning console (closes F-3)

- [ ] PRODUCT mini-lock for reminder cadence / channels (sandbox email/SMS honesty)
- [ ] Operator UI over overdue feed; suppressions; send audit
- [ ] No claim of live Twilio until G-709 secrets
- **Exit:** tip CI; waiver row unchanged if sandbox-only

### Slice F3 — Recon + parent instalment UX (closes F-5, F-6)

- [ ] Recon match/exception list + audit
- [ ] Parent fees: instalment schedule / remaining balance clarity
- **Exit:** e2e/visual smoke; tip CI

### Slice F4 — PSP evidence or waiver refresh (closes F-1 / F-7)

- [ ] If keys: sandbox charge → webhook idempotency → receipt e2e on tip
- [ ] Else: release-board re-date G-202 in `WAIVER_BOARD_*.md` — **do not claim Blackbaud-complete**

### Slice F5 — GL/tax export (optional, closes F-4)

- [ ] Only after F0 non-goals revisited; otherwise leave OPEN

---

### Slice A0 — IA lock (Admissions enrol journey v2)

- [x] `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md`
- [x] Journey map: enquiry → merit → seat → offer → pay → enrol (staff + applicant/parent)
- [x] Decision on **A-1** public apply (build vs NON-GOAL)
- [x] Confirm OCR stays NON-GOAL (A-4)
- **Exit:** PRODUCT audit merged (branch `cursor/adm-enrol-ia-lock-56c3`)

### Slice A1 — PG pipeline store default (closes A-3)

- [x] When `DATABASE_URL` set, admissions pipeline uses PG store (no silent in-memory)
- [x] Migration/verify if needed; unit isolation; restart-safe proof
- **Exit:** DEV + tip CI — **DONE** on `cursor/adm-pipeline-pg-56c3` (plugin default via `createAdmissionsPipelineStore`; gateway already wired)

### Slice A2 — Parent/applicant offer-pay (closes A-2)

- [ ] Parent (or applicant) surface: view offer, pay sandbox invoice, accept enrol
- [ ] Staff offer panel already has payment ref — keep consistent honesty banners
- [ ] Cross-tenant deny + e2e journey fragment
- **Exit:** tip CI

### Slice A3 — Public apply (closes A-1) **or** waiver

- [ ] If building: public apply form + status track + IdP/session policy
- [ ] Else: dated NON-GOAL in PRODUCT + waiver board — stop claiming peer CRM parity

### Slice A4 — Seat/category + merit polish (closes A-5, A-6)

- [ ] Category/reservation rules UI; entrance-score ingest if IA says yes
- **Exit:** tip CI

### Slice A5 — Full journey tip proof (closes A-7)

- [ ] One gated e2e: enquiry → merit → seat reserve → offer → pay → enrol
- [ ] Soft-fail honesty when gateway offline (pattern from Wave 11)
- **Exit:** tip CI green on journey spec

---

## 3. Definition of “world-class / full complete” (both modules)

All must be true:

1. Every **S0/S1** row above is DONE **or** has a **dated** release-board waiver/NON-GOAL.
2. Named peer capabilities in PRODUCT audits are checked with evidence (API + UI + test).
3. Tip CI green on merge commit; **main tip CI** green after merge.
4. No claim of live PSP / live apply IdP / OCR without secrets or explicit NON-GOAL.

Until then, status remains: **solid v1 / PROD_WAIVED — not world-class complete.**

---

## 4. Suggested branch names

| Slice          | Branch                                |
| -------------- | ------------------------------------- |
| F0/A0 IA       | `cursor/fees-adm-ia-lock-56c3`        |
| F1 netting UI  | `cursor/fees-scholarship-net-ui-56c3` |
| F2 dunning     | `cursor/fees-dunning-console-56c3`    |
| A1 PG store    | `cursor/adm-pipeline-pg-56c3`         |
| A2 offer-pay   | `cursor/adm-offer-pay-parent-56c3`    |
| A5 journey e2e | `cursor/adm-enrol-journey-e2e-56c3`   |

---

## 5. Out of scope for this task file

- MapLibre, sealed exam PDF, LTI/SCORM Canvas parity
- Live Keycloak login evidence (G-107) except where admissions public apply needs IdP
- Re-opening peer-gap queue #1–#10 as missing

---

## 6. Progress log

| Date (UTC) | Event                                                                                                                                                                                                                              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | Task file created from honest residual audit (Fees ~8.4, Admissions ~8.0 PROD_WAIVED)                                                                                                                                              |
| 2026-09-12 | **F0 DONE (IA)** — merged `cursor/fees-ia-lock-56c3` → `docs/audits/PRODUCT_FEES_BLACKBAUD_DEPTH.md` (F-1 keep G-202 waiver; F-4 GL/tax deferred; OCR N/A)                                                                         |
| 2026-09-12 | **A0** PRODUCT IA lock: `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` — A-1 deferred to A3; A-4 OCR remains NON-GOAL; A-3 → build A1                                                                                           |
| 2026-09-12 | **A1 DONE** — plugin defaults `pipelineStore` via `createAdmissionsPipelineStore()`; `docs/audits/DEV_ADMISSIONS_PIPELINE_PG.md`; merged PR #56                                                                                    |
| 2026-09-12 | **F1 UI** — staff `/fees/scholarship-netting` + `applyScholarshipNetting` client; DEV `docs/audits/DEV_FEES_SCHOLARSHIP_NETTING_UI.md` (branch `cursor/fees-scholarship-net-ui-56c3`); tip CI / Blackbaud-complete **not** claimed |
