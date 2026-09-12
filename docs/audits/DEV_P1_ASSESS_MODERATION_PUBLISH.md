# DEV — P1-ASSESS gap-close: assessment moderation + publication

**Capability / module:** Assessment moderation + publication lifecycle  
**Gap ID:** **P1-ASSESS** (`docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` — agents do not edit TASKS)  
**Branch / tip:** `cursor/assess-moderation-publish-56c3`  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Teacher submits marks; registrar/moderator approves → locks → publishes; parents/students see only published grades  
**Closure path:** Map to existing **gradebook** workflow (G-303 / G-907) — no parallel assessment-only state machine  
**Paired proofs:** `packages/backend/gradebook/src/grade-workflow.test.ts`; `apps/web/e2e/42-gradebook-workflow-write-smoke.spec.ts`; tip fragment below

Copied from `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md` (trimmed to gap-close honesty).

---

## 0. Product contract

| Item                   | Content                                                                                                                                                                                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | Staff move section grade entries through **DRAFT → SUBMITTED → APPROVED → LOCKED → PUBLISHED** (reject/reopen supported); published rows are parent-visible via `/api/v1/gradebook/published`. |
| In scope (peer parity) | Reuse gradebook transitions, RBAC (`grade.entry` / `grade.moderate`), UI workflow panel, assessments hub → report-cards path, tip ungated smoke + unit state-machine proof                     |
| Explicit non-goals     | Separate assessment-module moderation engine; CA-sealed PDF transcripts; live IdP E2E; TASKS file Status edits; exam double-entry (that is **P1-EXAM** / G-908)                                |
| Roles (RBAC)           | Teacher: submit; registrar/admin: approve / reject / lock / publish / reopen — `gradebook-access.ts` + transition routes                                                                       |
| Boards impacted        | CBSE ☑ ICSE ☑ State ☑ (workflow is board-agnostic; scales already seeded)                                                                                                                      |

### Gap → shipped surface map (P1-ASSESS → gradebook)

| P1-ASSESS need                      | Shipped surface                                                                        | Evidence                                  |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------- |
| Draft marks entry                   | `PUT /api/v1/gradebook/entries` → `workflowStatus=DRAFT`                               | `gradebook-service.ts`                    |
| Submit for moderation               | `POST .../entries/:id/transition` `action=submit`                                      | `routes.ts`                               |
| Moderator approve / reject          | `approve` / `reject` (requires `grade.moderate`)                                       | `gradebook-access` + e2e TEACHER 403      |
| Lock after approval                 | `lock` sets `lockedAt`; edits blocked                                                  | unit + service tests                      |
| Publish to parents / students       | `publish` sets `publishedAt`; `GET /gradebook/published`                               | G-907 + portal grades                     |
| Assessment UX discoverability       | `/assessments` lifecycle callout → `/assessments/report-cards` → institution gradebook | tip e2e fragment                          |
| Prior product close (G-303 / G-907) | Fable51 audit DONE; DEV_SIS_GRADEBOOK + WAVE9 e2e 42                                   | `ENTERPRISE_FABLE51_PRODUCT_GAP_AUDIT.md` |

Screen / API inventory:

| Nav / surface            | Route                               | API                                      | Tables / store          | PII              |
| ------------------------ | ----------------------------------- | ---------------------------------------- | ----------------------- | ---------------- |
| Assessments hub          | `/assessments`                      | schemes list                             | grading schemes         | Low              |
| Report cards (published) | `/assessments/report-cards`         | `/gradebook/published`, report-card jobs | `grade_entries`, jobs   | Scores           |
| Institution gradebook    | `/institutions/[id]/gradebook`      | entries + `/transition` + bulk           | `grade_entries` + audit | Student + scores |
| Parent / student grades  | `/parent/grades`, `/student/grades` | published grades only                    | published filter        | Scores           |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                                                  |
| ----------------------------- | ---- | ------------------------------------------------------------------------- |
| Versioned SQL under `db/sql/` | ☑    | Existing gradebook schema + `032` grade-change audit (G-907) — no new DDL |
| Constraints / indexes / FKs   | ☑    | Prior WS3 / G-907                                                         |
| Multi-board seed fixtures     | ☑    | Board scales + e2e section seed                                           |
| Domain unit/property tests    | ☑    | `grade-workflow.test.ts` draft→publish; service publish list              |
| Invariants documented         | ☑    | `grade-workflow.ts` TRANSITIONS; illegal → BusinessRuleError              |

**State machine:** `DRAFT → SUBMITTED → APPROVED → LOCKED → PUBLISHED` with `SUBMITTED → REJECTED → DRAFT` and reopen from locked/approved/published.

---

## 2. API / services

| Check                              | Done | Evidence                                                        |
| ---------------------------------- | ---- | --------------------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | Gradebook plugin `tenantIdOf`                                   |
| Validation + typed errors          | ☑    | TypeBox transition body; illegal transition → rule error        |
| RBAC enforced                      | ☑    | submit=`grade.entry`; moderate/lock/publish=`grade.moderate`    |
| Conflict / rule failures → 409/422 | ☑    | Locked/submitted edit blocks; illegal transitions               |
| Idempotent writes where needed     | ☑    | Upsert by section/student/assessment; publish from PUBLISHED OK |
| Cross-tenant deny test             | ☑    | e2e 42 tenant B cannot see tenant A published grades            |

---

## 3. UI (redesign)

| Screen                         | Empty/loading/error | Write works                | Board-aware | Evidence                       |
| ------------------------------ | ------------------- | -------------------------- | ----------- | ------------------------------ |
| `/assessments`                 | ☑ schemes empty     | N/A + lifecycle callout    | N/A         | moderation callout + tip e2e   |
| `/assessments/report-cards`    | ☑ empty classes     | links to gradebook         | N/A         | report-cards page              |
| `/institutions/[id]/gradebook` | ☑ API / no sections | workflow panel transitions | scales      | `gradebook-workflow-panel.tsx` |

---

## 4. Cross-module integration

| Dependency               | Integrated | Evidence                                         |
| ------------------------ | ---------- | ------------------------------------------------ |
| Gradebook (canonical)    | ☑          | This gap closes **via** gradebook, not beside it |
| Assessment schemes/items | ☑          | Scheme inventory; marks publication on gradebook |
| Parent / student portals | ☑          | Published-only grade reads                       |
| Examinations ops         | ☐          | Explicit non-goal — **P1-EXAM**                  |

---

## 5. Observability & audit

| Check                               | Done    | Evidence                                 |
| ----------------------------------- | ------- | ---------------------------------------- |
| Structured logs on writes           | Partial | Gateway request logs                     |
| Audit trail for sensitive mutations | ☑       | `grade.*` audits + Pg grade-change trail |

---

## 6. Security & compliance

| Check             | Done | Evidence                              |
| ----------------- | ---- | ------------------------------------- |
| Tenant isolation  | ☑    | Queries scoped; e2e cross-tenant deny |
| RBAC matrix       | ☑    | Teacher cannot APPROVE (e2e 42)       |
| Parent visibility | ☑    | Only `publishedAt` / PUBLISHED listed |

---

## 7. Hand-off / tip proofs

| Check                          | Done | Evidence                                                       |
| ------------------------------ | ---- | -------------------------------------------------------------- |
| Unit proof draft→publish       | ☑    | `packages/backend/gradebook/src/grade-workflow.test.ts`        |
| Service publish + parent list  | ☑    | `gradebook-service.test.ts` G-907 case                         |
| Tip ungated e2e fragment       | ☑    | `42-gradebook-workflow-write-smoke.spec.ts` P1-ASSESS describe |
| Live write chain (gated)       | ☑    | Same file — `E2E_BACKEND_READY` submit→…→publish               |
| DEV audit maps gap → gradebook | ☑    | This file                                                      |

### How to verify

```bash
pnpm --filter @proctira/backend-gradebook exec vitest run src/grade-workflow.test.ts
# ungated tip fragment (Playwright web package)
pnpm --filter @proctira/web exec playwright test e2e/42-gradebook-workflow-write-smoke.spec.ts -g 'P1-ASSESS'
```

---

## Verdict

**P1-ASSESS CLOSED** on tip by mapping to the shipped gradebook moderation / publication lifecycle (G-303 / G-907). Parent TASKS Status row remains for the reconciler — this branch does not edit `TASKS_ENTERPRISE_P0_P1_P2_GAPS.md`.

### Residuals (honest)

1. Authenticated Playwright write journey still gated on `E2E_BACKEND_READY=1`.
2. Exam-specific double marks entry / malpractice appeals stay under **P1-EXAM**, not this gap.
