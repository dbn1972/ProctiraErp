# DEV — Examinations invigilation · appeals · durable docs (P1-EXAM)

**Capability / module:** Academics · Examinations ops + durable documents  
**Branch / tip:** `cursor/exam-invigilate-appeals-docs-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_EXAM_INVIGILATE_APPEALS.md`  
**Waiver board:** `docs/audits/WAIVER_BOARD_20260912.md` (**PRD-017**)  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P1-EXAM** (DEV audit only — **do not edit TASKS**)

---

## Honesty

| Item                   | Content                                                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Decision               | **P1-EXAM** closes as **shipped capabilities + dated NON-GOAL** — not a greenfield build                                          |
| What already ships     | Invigilation / seating / double-entry / re-eval (**G-908**); durable exam-document worker (**P0-06**)                             |
| IA alias               | Product **appeal** = marks **re-evaluation** (UI may label “Appeal / re-evaluation”; API remains `/reevaluations`)                |
| What does **not** ship | Malpractice **case management** (incident → hearing → sanction); **formal appeals** beyond marks re-eval (tribunal / multi-stage) |
| Claims forbidden       | Peer board-exam malpractice desk parity; formal academic-appeals parity beyond re-eval                                            |
| Re-open when           | Product funds malpractice / formal-appeals epic; then reverse **PRD-017** and replace this note with a real DEV pack              |

**Minimal code this slice:** optional IA alias copy on exam ops re-eval card. No schema / route / worker changes.

---

## 0. Audit — capabilities that exist

| Capability                       | Status | Evidence                                                                                                 |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Invigilator allocate + clash 409 | ☑      | `packages/backend/examination/src/ops-service.ts`, `clash.ts`, `invigilator-allocation.property.test.ts` |
| Persisted seating                | ☑      | ops store + `/examinations/[id]/ops` (`ExamOpsPanel`)                                                    |
| Double marks entry + variance    | ☑      | `ops-routes.ts` / `ops-service.ts`; `e2e/45-exam-ops-write-smoke.spec.ts`                                |
| Re-evaluation (marks appeal)     | ☑      | request → assign → complete; unit `ops-service.test.ts`; UI `exam-ops-panel.tsx` (`exam-reeval-card`)    |
| Durable exam documents           | ☑      | `workers/exam-document` + `DEV_P0_06_DURABLE_WORKERS_SPINE.md` restart-safe proof                        |
| Domain RBAC on mutating ops      | ☑      | `examination-access.ts` + HTTP guard; teacher 403                                                        |

Wave 9 pack: `docs/audits/WAVE9_GAP_CLOSURE_TEST_EVIDENCE.md` (Examinations · ops row; `e2e/45`).

---

## 1. Dated NON-GOAL residuals (PRD-017)

| Residual                                  | Status (2026-09-12)     | Notes                                               |
| ----------------------------------------- | ----------------------- | --------------------------------------------------- |
| Malpractice case management               | **NON-GOAL**            | No incident/hearing/sanction entities or staff desk |
| Formal appeals beyond marks re-evaluation | **NON-GOAL**            | No multi-stage / non-marks tribunal workflow        |
| Parent/student self-serve appeal portal   | **NON-GOAL** this slice | Staff re-eval only                                  |

---

## 2. How to verify (no new tests required)

```bash
pnpm --filter @proctira/examination test -- src/ops-routes.test.ts src/invigilator-allocation.property.test.ts
pnpm --filter @proctira/exam-document-worker test
# optional UI smoke when backend ready:
# pnpm --filter @proctira/web exec playwright test e2e/45-exam-ops-write-smoke.spec.ts
```

---

## Status

**P1-EXAM honesty close @ 2026-09-12** — invigilation + durable docs **exist**; malpractice / formal appeals beyond re-eval = **PRD-017 NON-GOAL**. Tip CI independent of this docs-first slice.
