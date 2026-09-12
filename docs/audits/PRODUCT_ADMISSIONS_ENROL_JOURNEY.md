# Enterprise product / IA — Admissions CRM → enrol journey v2

**Module / slice:** Admissions enrol journey (enquiry → merit → seat → offer → pay → enrol) — **A0 IA lock**  
**Branch / tip:** `cursor/adm-enrol-ia-lock-56c3` (tip at merge)  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (A0)  
**Prior PRODUCT:** `docs/audits/PRODUCT_ADMISSIONS_CRM.md` (waitlist + interview slots)  
**Task file:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` (slice A0)  
**Peers:** PowerSchool / Infinite Campus admissions CRM · Ellucian Recruit (offer conversion)

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`. Complete **before** build slices A1+.

---

## 1. Capability statement

When the Admissions enrol-journey v2 program ships (A1–A5), a tenant admissions officer can run a full cycle from **enquiry → application → merit ranking → seat allocation → offer → fee payment gate → auto-enrol**, with durable Postgres-backed pipeline state. A linked **parent / guardian** (and, later, a public applicant where funded) can see an outstanding offer, pay the offer fee via the sandbox/live PSP path already used for fees, and complete acceptance so the student appears enrolled — without staff pretending payment happened. Until A3, public “peer CRM apply + applicant IdP” remains a **dated residual**, not claimed complete; OCR stays out of scope.

---

## 2. Personas & jobs

| Persona                        | Job-to-be-done                                           | Success looks like                                                                                         |
| ------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Admissions officer / registrar | Capture and progress enquiries into applications         | Enquiry list → convert; follow-ups due; stage moves visible on `/admissions/enquiries`                     |
| Admissions officer / registrar | Rank applicants and reserve seats by quota               | Merit generate/read on `/admissions/merit`; seat matrix upsert on `/admissions/seat-matrix`                |
| Admissions officer / registrar | Issue offer, gate on fee, enrol on accept                | Offer create/send/accept on `/admissions/[id]`; unpaid fee blocks enrol; paid accept creates student+enrol |
| Parent / guardian (linked)     | Understand and pay an offer fee, then confirm acceptance | Family surface (A2): view offer + sandbox invoice + accept → enrolled child visible in parent shell        |
| Public applicant / guardian    | Apply and track without staff account (peer CRM parity)  | **Deferred to A3** — see §9 Decision A-1                                                                   |
| Principal / admin (read/audit) | See pipeline health without editing CRM                  | Existing staff RBAC read where granted; no new public admin surface in this program                        |

---

## 3. Scope

| In scope                                                                                        | Non-goals / deferred                                                                                       |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Journey lock: enquiry → merit → seat → offer → pay → enrol for **staff** + **parent/applicant** | **A-4 OCR / document AI** — remains **PRD-014 NON-GOAL** (manual capture only)                             |
| Honesty on pipeline store: force PG when `DATABASE_URL` (closes **A-3** in build slice **A1**)  | Full Ellucian/PowerSchool feature parity in one PR                                                         |
| Parent/applicant **offer-pay UX** (closes **A-2** in build slice **A2**)                        | **A-1 public apply + applicant IdP** — **deferred to slice A3** (dated residual; not a permanent NON-GOAL) |
| Tip-CI full journey proof (closes **A-7** in **A5**)                                            | Live Keycloak login evidence (G-107) except where A3 explicitly requires IdP                               |
| Category/reservation + entrance-score polish only after IA in **A4** (A-5, A-6)                 | Replacing registration-portal home/schools UX; MapLibre; sealed PDF; LTI                                   |
| Keep waitlist / interview CRM from prior slice                                                  | Claiming “world-class complete” while A-1 residual or OCR is still open                                    |

### Explicit product decisions (A0 lock)

| ID      | Topic                        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Effective  |
| ------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| **A-1** | Public apply + applicant IdP | **DEFER to build slice A3** as a dated residual. Product has **not** committed peer-class public apply + applicant account/IdP for near-term enrol-journey v2. Existing `apps/registration-portal` apply/track remains a **basic** public intake (DOB-gated track; no applicant IdP; not wired as the CRM→offer→pay→enrol family path). A3 must either **build** public apply + status/IdP policy **or** convert to a **dated NON-GOAL / waiver** and stop claiming peer CRM parity. | 2026-09-12 |
| **A-3** | PG pipeline store            | **Next build = slice A1.** When `DATABASE_URL` is set, admissions pipeline must use PG (`db/sql/034_*`); no silent in-memory default via plugin/factory.                                                                                                                                                                                                                                                                                                                             | 2026-09-12 |
| **A-4** | OCR / document AI            | **Remains NON-GOAL** (PRD-014). Manual document metadata/capture only. Do not build unless product reverses the waiver board.                                                                                                                                                                                                                                                                                                                                                        | 2026-09-12 |

---

## 4. Peer parity

| Peer capability (PS / IC / Ellucian-class)  | Our target this program (A1–A5)                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Enquiry / lead CRM → application conversion | Staff enquiry CRUD + convert (shipped v1; harden persistence A1)                                |
| Merit / ranking with weights                | Merit list generate + weights (shipped); entrance-score ingest UI only if A4 IA says yes        |
| Seat / quota matrix                         | Seat matrix per institution × period × grade × quota (shipped); category rules UI in A4         |
| Offer letter → fee → enrol                  | Offer + invoice hook + pay gate + auto-enrol (API/headless shipped); parent UX in A2; e2e in A5 |
| Public apply portal + applicant account     | **Not this near-term slice** — residual dated to **A3** (build or waiver)                       |
| Document OCR / ID scan                      | **Explicit NON-GOAL** (A-4 / PRD-014)                                                           |

---

## 5. Surface map

### Journey (canonical)

```text
enquiry  →  convert/application  →  merit  →  seat reserve  →  offer  →  pay (fee invoice)  →  accept  →  enrol
   │                                      │         │            │            │                  │
 staff UI                            staff UI   staff UI     staff UI    fees/PSP           enrolOnAccept
                                                                                 │
                                                                    parent/applicant (A2; public A3)
```

### Nav → route → API → data → shell

| Nav label              | Route                                      | API (gateway)                                                             | Tables / events                                  | Shell                          |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------ |
| Enquiries              | `/admissions/enquiries`                    | `GET/POST /admissions/enquiries`, `PATCH …/:id`, follow-ups, `…/convert`  | `034` enquiries, follow-ups                      | Staff                          |
| Applications / CRM     | `/admissions`                              | Registration CRM list/status; waitlist; interview slots (prior CRM slice) | `014` applications / waitlist / slots            | Staff                          |
| Application + offers   | `/admissions/[id]`                         | `GET /admissions/applications/:id`, offers CRUD, send/accept/decline      | offers, placement; fee invoice id; enrol hook    | Staff                          |
| Merit list             | `/admissions/merit`                        | `POST/GET /admissions/merit-lists`                                        | merit lists + entries                            | Staff                          |
| Seat matrix            | `/admissions/seat-matrix`                  | `GET/PUT /admissions/seat-matrix`                                         | seat matrix rows; filled from accepted offers    | Staff                          |
| Parent fees (pay path) | `/parent/fees`                             | Parent-portal / fees invoice pay (existing)                               | fee invoices / payments                          | Parent                         |
| Parent offer-pay (A2)  | `/parent/offers`                           | `GET/POST /parent-portal/offers` (+ accept)                               | offers + invoice + enrol                         | Parent                         |
| Public apply (A3)      | `registration-portal` `/apply/*`, `/track` | `POST /registrations`, `GET` status (DOB-gated)                           | applications (`014`); **no** applicant IdP today | Public — **deferred residual** |

Staff admissions chrome: `apps/web` dashboard `/admissions/*`. Backend: `packages/backend/registration` pipeline + CRM stores.

---

## 6. Roles & tenancy (high level)

| Role                       | Can                                                                   | Cannot                                            |
| -------------------------- | --------------------------------------------------------------------- | ------------------------------------------------- |
| Admissions / admin (staff) | Full pipeline writes in tenant; accept with payment ref when fee paid | Cross-tenant enquiry/offer/application IDs        |
| Parent (linked)            | After A2: view own child’s offer, pay invoice, accept                 | Browse other families’ offers; staff CRM writes   |
| Public applicant (today)   | Submit/track registration via portal + DOB gate                       | Applicant account, IdP session, offer-pay journey |
| Teacher / unrelated staff  | None on admissions CRM unless RBAC grants                             | Pipeline mutations                                |

Tenant boundary notes:

- All `/admissions/*` pipeline routes require tenant context (`x-tenant-id` / JWT tenant).
- Public registration status remains DOB-gated (existing SEC posture).
- Offer accept must not enrol across tenants; fee invoice assertion is tenant-scoped.
- Cross-tenant deny proofs required in A1 (store) and A2 (parent offer-pay) security passes.

---

## 7. Success metrics / DoD

### A0 (this slice — docs only)

- [x] `docs/audits/PRODUCT_ADMISSIONS_ENROL_JOURNEY.md` exists from enterprise IA template
- [x] Journey locked for staff + parent/applicant
- [x] **A-1** decision recorded (defer to A3 / dated residual)
- [x] **A-4** confirmed NON-GOAL (PRD-014)
- [x] **A-3** named as next build slice **A1**
- [ ] Parent agent merges A0; TASKS progress log updated

### Program exit (A1–A5 — not claimed by A0)

- [ ] A1: PG pipeline store when `DATABASE_URL`; restart-safe; no silent in-memory
- [x] A2: Parent/applicant offer-pay UX with honesty banners; tenant deny
- [ ] A3: Public apply + IdP **or** dated NON-GOAL/waiver on release board
- [ ] A4: Seat/category + optional entrance-score per IA
- [ ] A5: One tip-CI journey e2e enquiry → … → enrol (soft-fail if gateway offline)
- [ ] No claim of live PSP / live apply IdP / OCR without secrets or explicit NON-GOAL

---

## 8. Handoff

| Next skill | Audit path / slice                                             |
| ---------- | -------------------------------------------------------------- |
| Build      | **A1** — `DEV_ADMISSIONS_PIPELINE_PG.md` (closes A-3)          |
| Build      | **A2** — parent offer-pay (closes A-2)                         |
| Product    | **A3** — public apply build **or** dated NON-GOAL (closes A-1) |
| Build      | **A4** — A-5 / A-6 polish                                      |
| Test       | **A5** — full journey tip proof (closes A-7)                   |
| UX         | After A2 UI — `UX_ADMISSIONS_OFFER_PAY.md`                     |
| Security   | Extend `SEC_ADMISSIONS_CRM.md` per A1/A2                       |
| Release    | Tip CI per slice; main tip after merge; waiver honesty         |

**Gate order:** `product/IA (A0 ☑) → build → UX → a11y → security → test → release`

---

## 9. Decision appendix — A-1 research note

Checked against shipped product on `main` (2026-09-12):

| Artifact                                              | Finding                                                                                         |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `apps/registration-portal` `/apply/*`, `/track`       | Public apply + DOB-gated track **exists** as basic intake                                       |
| `PRODUCT_ADMISSIONS_CRM.md` / `SEC_ADMISSIONS_CRM.md` | Live apply portal IdP explicitly **waived**                                                     |
| `WAIVER_BOARD_20260910.md` PRD-014                    | OCR NON-GOAL — unrelated to A-1                                                                 |
| `TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md`           | A-1 listed S0 residual; A3 = build **or** waiver                                                |
| Parent shell                                          | `/parent/fees` exists; **no** first-class offer-pay surface (A-2)                               |
| Pipeline plugin factory                               | PG when `DATABASE_URL` via factory; plugin still defaults missing store to in-memory (A-3 / A1) |

**Conclusion:** Do **not** treat peer-class public apply + applicant IdP as already committed for enrol-journey v2. Keep A-1 open as **dated residual → A3**. Do **not** silently mark A-1 NON-GOAL in A0 (that would under-claim peer parity without a release-board date). OCR (A-4) stays NON-GOAL.
