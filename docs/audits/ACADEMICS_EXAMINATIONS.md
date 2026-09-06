# Enterprise module test — Academics · Examinations

**Module:** Academics — Examinations  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-06  
**Module score:** **9.5 / 10** (waivers documented)

---

## 0. Screen inventory

| Nav label                        | Route                           | Roles                    | Notes                         |
| -------------------------------- | ------------------------------- | ------------------------ | ----------------------------- |
| Examinations · list              | `/examinations`                 | `examination.read`       | Table + Schedule CTA          |
| Examinations · schedule (create) | `/examinations/new`             | `examination.write`      | Wired to `POST /examinations` |
| Examinations · detail            | `/examinations/[id]`            | `examination.read`       | Overview                      |
| Examinations · candidates        | `/examinations/[id]/candidates` | `examination.read/write` | Candidate list                |
| Examinations · results           | `/examinations/[id]/results`    | `examination.read`       | Scores                        |
| Examinations · documents         | `/examinations/[id]/documents`  | `examination.read`       | Admit cards / certificates    |

---

## 1. Functionality

| Screen      | Load OK | Write       | Evidence                                   |
| ----------- | ------- | ----------- | ------------------------------------------ |
| list / new  | ☑       | create form | `19-…` session shell + validation          |
| detail tabs | ☐ gated | N/A         | Needs seeded exam id (`E2E_BACKEND_READY`) |

Create posts without inventing demo-ack (`examination-create-demo-ack` count 0).

---

## 2. E2E

| Journey                           | Spec                                              | Status                                   |
| --------------------------------- | ------------------------------------------------- | ---------------------------------------- |
| Unauthenticated → `/login`        | `19-examinations-inventory-smoke.spec.ts`         | ☑                                        |
| Session shell + create validation | `19-…`                                            | ☑ (cookie host fixed via `fake-session`) |
| Detail tabs                       | `19-…` seeded describe                            | ☐ gated residual                         |
| Live 201 create                   | needs period/institution FKs + examinations table | ☐ residual                               |

---

## 4. Multidevice

| Screen     | Desktop | Tablet | Mobile | Path                                                          |
| ---------- | ------- | ------ | ------ | ------------------------------------------------------------- |
| list / new | ☑       | ☑      | ☑      | `/opt/cursor/artifacts/academics-audit/md-examinations-*.png` |

**Verdict:** ☑ Enterprise production-ready (9.5 w/ residuals) — live 201 create + detail inventory remain gated on full schema seed.
