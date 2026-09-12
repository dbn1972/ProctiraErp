# Enterprise product / IA — Examinations invigilation · appeals · durable docs (P1-EXAM)

**Module / slice:** Examinations — invigilation, marks appeal (re-eval), durable document workers  
**Branch / tip:** `cursor/exam-invigilate-appeals-docs-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (P1-EXAM honesty close)  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P1-EXAM** (this file is the PRODUCT audit — **do not edit TASKS** from this slice)  
**Prior evidence:** G-908 exam ops (`WAVE9_GAP_CLOSURE_TEST_EVIDENCE.md`); P0-06 durable exam-document worker (`DEV_P0_06_DURABLE_WORKERS_SPINE.md`)  
**Peers:** Board-exam ops (CBSE/ICSE-style seating + invigilation); marks recheck / re-evaluation desks  
**Honesty:** Do **not** claim malpractice case-management or formal tribunal-style appeals beyond marks re-evaluation.

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`.

---

## 1. Capability statement

A tenant exam controller can allocate invigilators (clash-checked), persist seating, run double marks entry with variance, and process **marks re-evaluation** requests on `/examinations/[id]/ops`. Admit-card / seating / certificate generation can publish to a durable queue and survive worker restart (**P0-06** `workers/exam-document`). In product IA, **“appeal” means marks re-evaluation** (request → assign → complete with audited delta). **Malpractice case management** and **formal appeals beyond re-eval** are a **dated NON-GOAL (2026-09-12)** until a funded epic (PRD-017).

---

## 2. Personas & jobs

| Persona                       | Job-to-be-done                                | Success looks like                                                                 |
| ----------------------------- | --------------------------------------------- | ---------------------------------------------------------------------------------- |
| Exam controller / registrar   | Staff rooms and seat candidates for a session | Invigilator allocate + seating on `/examinations/[id]/ops`; clash → 409            |
| Exam controller / marker lead | Resolve marks disputes via re-evaluation      | Re-eval (IA alias: **appeal**) request → assign → complete; delta audited          |
| Exam ops / SRE                | Generate admit cards / certificates reliably  | `POST …/documents/generate` → durable worker completes after restart (P0-06 proof) |
| Teacher (no exam.write)       | Must not mutate ops                           | Domain RBAC 403 on mutating ops routes                                             |
| Discipline / malpractice desk | Open incident cases, hearings, sanctions      | **NON-GOAL (dated 2026-09-12)** — see §3 / PRD-017                                 |
| Formal appeals tribunal       | Multi-stage appeal beyond marks recheck       | **NON-GOAL (dated 2026-09-12)** — see §3 / PRD-017                                 |

---

## 3. Scope

| In scope (already shipped / this honesty close)                                                      | Non-goals / deferred                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Invigilator allocation + clash property/tests (G-908)                                                | **Malpractice case management** (incident, hearing, sanction workflow) — **PRD-017**       |
| Persisted seating, double marks entry + variance resolve (G-908)                                     | **Formal appeals beyond re-eval** (tribunal, multi-stage, non-marks grounds) — **PRD-017** |
| Marks **re-evaluation** workflow (requested → assigned → completed/rejected)                         | Claiming peer board-exam “malpractice + appeals desk” parity                               |
| IA alias: **appeal ≡ re-evaluation** for marks challenges (UI label only; API stays `reevaluations`) | Live IdP / sealed national exam PDFs (unrelated waivers)                                   |
| Durable exam **document** generation worker + restart-safe proof (**P0-06**)                         | Full multi-domain durable worker fleet (other P0-06 residuals)                             |

### Explicit product decisions

| ID      | Topic                                  | Decision                                                                                                                                                            | Effective  |
| ------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **E-1** | Invigilation + seating + double-entry  | **DONE** via G-908 — no new build required for P1-EXAM close                                                                                                        | 2026-09-09 |
| **E-2** | Durable exam documents                 | **DONE** via P0-06 (`workers/exam-document` + restart proof) — no new build required                                                                                | 2026-09-12 |
| **E-3** | Marks appeal                           | **IA alias:** product language **appeal** = existing **re-evaluation** workflow. Minimal UI copy may say “Appeal / re-evaluation”; routes/API remain re-eval        | 2026-09-12 |
| **E-4** | Malpractice case mgmt + formal appeals | **Dated NON-GOAL (2026-09-12)** until funded epic. Record as **PRD-017**. Stop claiming malpractice/formal-appeals parity. Re-open only when product funds the epic | 2026-09-12 |

---

## 4. Peer parity

| Peer capability                                 | Our target this slice                    |
| ----------------------------------------------- | ---------------------------------------- |
| Invigilator roster + clash avoidance            | **Met** (G-908)                          |
| Seating + double entry / moderation             | **Met** (G-908)                          |
| Marks recheck / re-evaluation desk              | **Met** as re-eval; IA-aliased as appeal |
| Malpractice incident / hearing case file        | **NON-GOAL (PRD-017)** — no parity claim |
| Formal multi-stage academic appeals (non-marks) | **NON-GOAL (PRD-017)** — no parity claim |
| Durable admit-card / certificate generation     | **Met** (P0-06 exam-document worker)     |

---

## 5. Surface map

| Nav label                | Route / process                | API / queue                                                                   | Tables / stores                                         | Shell |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------- | ----- |
| Examinations · ops       | `/examinations/[id]/ops`       | `/examinations/:id/sessions/…/invigilators`, seating, marks, `/reevaluations` | `exam_invigilators`, seating, marks pairs, re-eval rows | Staff |
| Examinations · documents | `/examinations/[id]/documents` | `POST /examinations/:id/documents/generate`                                   | document jobs + PDF                                     | Staff |
| Exam-document worker     | `workers/exam-document`        | `tenant.*.exam.document.generate`                                             | same job rows                                           | Ops   |

---

## 6. Roles & tenancy (high level)

| Role                                  | Can                                               | Cannot                                     |
| ------------------------------------- | ------------------------------------------------- | ------------------------------------------ |
| Exam controller (`examination.write`) | Allocate invigilators, seating, re-eval mutations | Cross-tenant ops; malpractice cases (none) |
| Reader (`examination.read`)           | View ops / documents                              | Mutate                                     |
| Teacher (no write)                    | —                                                 | Mutating ops (403)                         |

Tenant boundary: all ops rows keyed by `tenant_id`; document queue routing is tenant-scoped.

---

## 7. Success metrics / DoD

- [x] Invigilation + seating + double-entry + re-eval evidenced (G-908 / `e2e/45`)
- [x] Durable exam-document worker + restart-safe proof (P0-06)
- [x] Dated NON-GOAL for malpractice case mgmt + formal appeals beyond re-eval (**PRD-017**, 2026-09-12)
- [x] IA alias documented: appeal → re-evaluation (optional UI label)
- [x] No TASKS plan edits in this slice
- [x] No claim of malpractice / formal-appeals parity

---

## 8. Handoff

| Next skill | Audit path                                                        |
| ---------- | ----------------------------------------------------------------- |
| Build      | N/A this slice (honesty close) — `DEV_EXAM_INVIGILATE_APPEALS.md` |
| Test       | Prior Wave 9 + P0-06 evidence packs                               |
| Release    | Waiver board **PRD-017**                                          |

**Conclusion (2026-09-12):** Close **P1-EXAM** product honesty: invigilation and durable documents **exist**; marks **appeal** is the existing re-evaluation path; malpractice case management and formal appeals beyond re-eval are **dated NON-GOAL**.
