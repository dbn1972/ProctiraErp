# Task file — Enterprise P0 / P1 / P2 gap register

**Status:** OPEN — **plan of record** (supersedes Fees/Admissions depth queue for sequencing)  
**Created (UTC):** 2026-09-12  
**Base tip:** `bd45ba1e` (`main` after F3)  
**Source:** Product owner gap register (P0 blockers → P1 functional → P2 depth)  
**Prior queue:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` — A5 tip journey remains in flight; **F5 GL/tax export stays deferred** and is absorbed by **P1-FIN-GL** below. Do not claim Fees/Admissions “world-class complete” while P0s remain OPEN.

**Skills gate (every slice):** `product/IA → build → UX → a11y → security → mobile* → data/SQL* → test → release`

**Working rules**

1. One slice = one branch `cursor/<slice-id>-56c3` = one PR. Delete branch after merge.
2. Agents **must not** edit this TASKS file (parent reconciles Status / progress log after merges).
3. Prefer parallel agents on **non-overlapping** packages; serialize when both touch gateway mount, RLS policies, or money ledger.
4. Honesty: PROD_WAIVED / NON-GOAL ≠ capability complete. Tip CI green on merge commit before “shipped”.
5. External secrets (live IdP, PSP, Twilio, farm) → dated WAIVER, never fake green.

---

## 0. Capability statement (program)

Close **production blockers first** (authZ depth, durable persistence, money integrity, PHI, ops evidence), then **functional breadth** (SIS/HR/exam/finance/ops), then **depth modules** (LMS/campus services/analytics/mobile). Success = every P0 DONE or dated WAIVER; P1 S0/S1 DONE or WAIVER; P2 tracked without blocking release.

---

## 1. P0 — Blockers (must clear before “enterprise ready”)

| ID        | Gap                                                                                              | Slice                         | Primary packages / paths                          | Exit / DoD                                                                                | Status |
| --------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| **P0-01** | Fine-grained backend authorization not consistently proven                                       | `authz-deny-matrix`           | gateway plugins, RBAC middleware, e2e deny matrix | Every mutating `/api/v1/*` route has permission + automated deny test; matrix doc         | OPEN   |
| **P0-02** | One web authentication shell remains stubbed                                                     | `auth-shell-unstub`           | `apps/web` auth layout/shell                      | Real session gate; no stub login shell in prod build; axe + e2e                           | OPEN   |
| **P0-03** | Guardian / household / custody / consent / relationship authZ missing                            | `guardian-relationship-authz` | parent portal, guardianship APIs, consent         | Relationship-scoped APIs; cross-household deny tests; PRODUCT + SEC audits                | OPEN   |
| **P0-04** | Student enrollment / progression UI paths incomplete                                             | `enrol-progression-ui`        | SIS enrollment / promotion screens                | No dead-end CTAs; happy-path + empty/error; tip e2e fragment                              | OPEN   |
| **P0-05** | Production modules can fall back to in-memory                                                    | `kill-memory-fallback`        | domain repos / factory switches                   | `DATABASE_URL` set ⇒ pg only (hard fail); CI proves no silent memory                      | OPEN   |
| **P0-06** | Report cards, exam docs, notifications, scheduled reports, escalations, ETL lack durable workers | `durable-workers-spine`       | workers/, queues, notifications, reports, exams   | At least one durable worker path per domain with restart-safe proof **or** dated NON-GOAL | OPEN   |
| **P0-07** | Finance floating-point money; needs transactional posting, safe sequencing, recon                | `finance-money-integrity`     | fees/finance schema + services                    | Integer minor units; transactional post; sequence safety; recon audit (builds on F3)      | OPEN   |
| **P0-08** | Attendance audit lacks full tenant / RLS protection                                              | `attendance-rls-audit`        | attendance SQL + audit tables                     | RLS + tenant deny tests on attendance audit read/write                                    | OPEN   |
| **P0-09** | Health / counselling need field-level + break-glass authZ                                        | `health-phi-breakglass`       | health/counselling plugins                        | Field ACL + break-glass dual control + PHI access audit                                   | OPEN   |
| **P0-10** | ETL persistence in-memory; deploy health probes mismatch server                                  | `etl-persist-probes`          | ETL service + k8s/compose probes                  | PG (or documented store) + probes hit live `/health` of same process                      | OPEN   |
| **P0-11** | Developer-portal API keys / webhook signatures non-cryptographic                                 | `devportal-crypto-keys`       | developer portal                                  | HMAC/crypto keys; signature verify tests; rotate/revoke                                   | OPEN   |
| **P0-12** | Deployment references Helm chart path missing from repo                                          | `helm-chart-path`             | deploy/helm CI                                    | Chart path exists **or** deploy refs fixed; `helm template` CI green                      | OPEN   |
| **P0-13** | Automated backup + restore-drill evidence unverified                                             | `backup-restore-drill`        | ops scripts / runbooks / CI evidence              | Documented backup job + restore drill artifact (or dated WAIVER)                          | OPEN   |

### Suggested P0 parallel packs

| Pack                         | Slices              | Notes                               |
| ---------------------------- | ------------------- | ----------------------------------- |
| A — AuthZ spine              | P0-01, P0-02, P0-03 | Serialize if shared auth middleware |
| B — Persistence honesty      | P0-05, P0-06, P0-10 | Factories + workers                 |
| C — Money / PHI / attendance | P0-07, P0-08, P0-09 | Highest sensitivity                 |
| D — Platform ops             | P0-11, P0-12, P0-13 | Can run parallel to A–C             |
| E — SIS UX blocker           | P0-04               | After or beside A                   |

---

## 2. P1 — Functional gaps (after P0 or with explicit dependency)

| ID            | Area                                                                | Slice hint                       | Status                      |
| ------------- | ------------------------------------------------------------------- | -------------------------------- | --------------------------- |
| **P1-ACAD**   | Academic calendar, curriculum delivery, institution structure depth | `acad-calendar-curriculum-depth` | OPEN                        |
| **P1-ADM**    | Admissions review, seat allocation, offers → enrollment             | `adm-review-seat-offer-enrol`    | OPEN (A0–A5 residual depth) |
| **P1-HR**     | Staff contracts, recruitment, leave, workload, offboarding          | `hr-contracts-leave-offboard`    | OPEN                        |
| **P1-ASSESS** | Assessment moderation + publication lifecycle                       | `assess-moderation-publish`      | OPEN                        |
| **P1-EXAM**   | Invigilation, malpractice, appeals, durable documents               | `exam-invigilate-appeals-docs`   | OPEN                        |
| **P1-TT**     | Timetable concurrency protection + publication/versioning           | `timetable-concurrency-publish`  | OPEN                        |
| **P1-FIN-GL** | GL, budgets, journals, period close                                 | `finance-gl-period-close`        | OPEN (absorbs Fees F5)      |
| **P1-PAY**    | Statutory payroll + accounting integration                          | `payroll-statutory-gl`           | OPEN                        |
| **P1-PROC**   | Procurement, vendors, POs, receiving, fixed assets                  | `procurement-assets`             | OPEN                        |
| **P1-SAFE**   | Discipline, behavior, safeguarding                                  | `safeguarding-discipline`        | OPEN                        |
| **P1-WF**     | Durable workflow escalation + report scheduling                     | `workflow-escalation-schedules`  | OPEN (ties P0-06)           |

---

## 3. P2 — Depth gaps (track; do not block P0)

| ID               | Area                                   | Status             |
| ---------------- | -------------------------------------- | ------------------ |
| **P2-LMS**       | Complete LMS learning workflows        | OPEN               |
| **P2-LIB**       | Library circulation + acquisitions     | OPEN               |
| **P2-HOSTEL**    | Hostel bed-level operations            | OPEN               |
| **P2-CANTEEN**   | Canteen POS, dietary safety, inventory | OPEN               |
| **P2-TRANSPORT** | Trips, boarding, GPS                   | OPEN               |
| **P2-SURVEY**    | Survey authoring / analytics           | OPEN               |
| **P2-ALUMNI**    | Alumni engagement                      | OPEN               |
| **P2-WH**        | Governed warehouse / ETL / lineage     | OPEN (after P0-10) |
| **P2-MOBILE**    | Full mobile parity + device security   | OPEN               |

---

## 4. Explicit non-goals / waivers (until dated otherwise)

| Item                                                       | Treatment                            |
| ---------------------------------------------------------- | ------------------------------------ |
| Live IdP / PSP / Twilio / device-farm                      | Dated WAIVER — sandbox only          |
| Fees “Blackbaud-complete” / Admissions “peer CRM-complete” | Not claimable while P0 OPEN          |
| Full ERP multi-entity consolidation                        | NON-GOAL unless funded (see Fees F0) |
| OCR document intake                                        | NON-GOAL (Admissions A3)             |

---

## 5. Definition of done (program)

1. All **P0** rows DONE or dated WAIVER/NON-GOAL on release board.
2. Each closed slice has PRODUCT (if greenfield) → DEV → SEC (if sensitive) → tip CI evidence.
3. No silent in-memory fallback when `DATABASE_URL` is set (P0-05).
4. Money paths use integer minor units + transactional post (P0-07).
5. Main tip CI green on the merge commit that closes the last P0.

---

## 6. Progress log (parent-owned)

| Date (UTC) | Event                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-09-12 | Register opened from product owner P0/P1/P2 list; Fees/Admissions queue demoted for sequencing (A5 still in flight; F5 → P1-FIN-GL). |
|            |                                                                                                                                      |

---

## 7. Branch naming cheat-sheet

```
cursor/authz-deny-matrix-56c3
cursor/auth-shell-unstub-56c3
cursor/guardian-relationship-authz-56c3
cursor/enrol-progression-ui-56c3
cursor/kill-memory-fallback-56c3
cursor/durable-workers-spine-56c3
cursor/finance-money-integrity-56c3
cursor/attendance-rls-audit-56c3
cursor/health-phi-breakglass-56c3
cursor/etl-persist-probes-56c3
cursor/devportal-crypto-keys-56c3
cursor/helm-chart-path-56c3
cursor/backup-restore-drill-56c3
```
