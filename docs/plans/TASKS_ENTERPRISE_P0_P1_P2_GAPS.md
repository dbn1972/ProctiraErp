# Task file — Enterprise P0 / P1 / P2 gap register

**Status:** OPEN — **plan of record** (all **P0 DONE**; P1/P2 remain) (supersedes Fees/Admissions depth queue for sequencing)  
**Created (UTC):** 2026-09-12  
**Base tip:** `fc4b222c` (`main` after P0-02 auth shell)  
**Source:** Product owner gap register (P0 blockers → P1 functional → P2 depth)  
**Prior queue:** `docs/plans/TASKS_FEES_ADMISSIONS_WORLD_CLASS_GAPS.md` — A5 tip journey **DONE** (`#66`); **F5 GL/tax export stays deferred** and is absorbed by **P1-FIN-GL** below. Do not claim Fees/Admissions “world-class complete” while P0s remain OPEN.

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

| ID        | Gap                                                                                              | Slice                         | Primary packages / paths                          | Exit / DoD                                                                                | Status                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **P0-01** | Fine-grained backend authorization not consistently proven                                       | `authz-deny-matrix`           | gateway plugins, RBAC middleware, e2e deny matrix | Every mutating `/api/v1/*` route has permission + automated deny test; matrix doc         | **DONE** — `#75` mounted domains `rbacWired: true` + extended deny tests; parked packages remain false   |
| **P0-02** | One web authentication shell remains stubbed                                                     | `auth-shell-unstub`           | `apps/web` auth layout/shell                      | Real session gate; no stub login shell in prod build; axe + e2e                           | **DONE** — `#71` AuthProvider → cookie session BFF; visual baselines updated                             |
| **P0-03** | Guardian / household / custody / consent / relationship authZ missing                            | `guardian-relationship-authz` | parent portal, guardianship APIs, consent         | Relationship-scoped APIs; cross-household deny tests; PRODUCT + SEC audits                | **DONE** — `#81` guardian authority flags + medical/fee gates + PRODUCT/SEC audits                       |
| **P0-04** | Student enrollment / progression UI paths incomplete                                             | `enrol-progression-ui`        | SIS enrollment / promotion screens                | No dead-end CTAs; happy-path + empty/error; tip e2e fragment                              | **DONE** — `#76` App Router enroll hub/form + federated redirects + e2e smoke                            |
| **P0-05** | Production modules can fall back to in-memory                                                    | `kill-memory-fallback`        | domain repos / factory switches                   | `DATABASE_URL` set ⇒ pg only (hard fail); CI proves no silent memory                      | **DONE** — `#72` fail-closed when `DATABASE_URL` set across factories                                    |
| **P0-06** | Report cards, exam docs, notifications, scheduled reports, escalations, ETL lack durable workers | `durable-workers-spine`       | workers/, queues, notifications, reports, exams   | At least one durable worker path per domain with restart-safe proof **or** dated NON-GOAL | **DONE** — `#77` exam-document durable worker + restart proof; other domains dated NON-GOAL in DEV audit |
| **P0-07** | Finance floating-point money; needs transactional posting, safe sequencing, recon                | `finance-money-integrity`     | fees/finance schema + services                    | Integer minor units; transactional post; sequence safety; recon audit (builds on F3)      | **DONE** — `#80` fees API/service reject non-integer `amountCents`; SQL already integer cents            |
| **P0-08** | Attendance audit lacks full tenant / RLS protection                                              | `attendance-rls-audit`        | attendance SQL + audit tables                     | RLS + tenant deny tests on attendance audit read/write                                    | **DONE (refuted as gap)** — wave7 FORCE RLS + live cross-tenant deny test on tip                         |
| **P0-09** | Health / counselling need field-level + break-glass authZ                                        | `health-phi-breakglass`       | health/counselling plugins                        | Field ACL + break-glass dual control + PHI access audit                                   | **DONE** — `#82` counselling case-notes field ACL + dual-control break-glass + PHI audit                 |
| **P0-10** | ETL persistence in-memory; deploy health probes mismatch server                                  | `etl-persist-probes`          | ETL service + k8s/compose probes                  | PG (or documented store) + probes hit live `/health` of same process                      | **DONE** — `#74` `/health/live`+`/ready` + fail-closed PG when `DATABASE_URL` set                        |
| **P0-11** | Developer-portal API keys / webhook signatures non-cryptographic                                 | `devportal-crypto-keys`       | developer portal                                  | HMAC/crypto keys; signature verify tests; rotate/revoke                                   | **DONE** — `#68` Node crypto keys/HMAC                                                                   |
| **P0-12** | Deployment references Helm chart path missing from repo                                          | `helm-chart-path`             | deploy/helm CI                                    | Chart path exists **or** deploy refs fixed; `helm template` CI green                      | **DONE** — path refuted on tip; `#69` helm template-check CI parity                                      |
| **P0-13** | Automated backup + restore-drill evidence unverified                                             | `backup-restore-drill`        | ops scripts / runbooks / CI evidence              | Documented backup job + restore drill artifact (or dated WAIVER)                          | **DONE** — `#79` tip-committed restore-drill evidence + runbook link + tip check script                  |

### Suggested P0 parallel packs

| Pack                    | Slices                 | Notes                               |
| ----------------------- | ---------------------- | ----------------------------------- |
| A — AuthZ spine         | P0-01✓, P0-02✓, P0-03  | Serialize if shared auth middleware |
| B — Persistence honesty | P0-05✓, P0-06✓, P0-10✓ | Factories + workers                 |
| C — Money / PHI         | P0-07, P0-09           | P0-08 closed (RLS already on tip)   |
| D — Platform ops        | P0-11✓, P0-12✓, P0-13  | Ops evidence residual = P0-13       |
| E — SIS UX blocker      | P0-04✓                 | After or beside A                   |

### Tip verification (2026-09-12)

Evidence pass against `origin/main`: **P0-08 REFUTED** (already RLS-protected); **P0-12 path REFUTED** (chart present — CI script still valuable); **P0-07 float columns REFUTED** (integer cents in SQL; TS `number` residual only). Prefer remaining **CONFIRMED** rows before re-litigating closed ones.

**First pack merged (2026-09-12):** P0-02 `#71`, P0-05 `#72`, P0-11 `#68`, P0-12 `#69` (plus plan `#67`, honesty `#70`, A5 `#66`). Remaining OPEN after pack 1: was 01/03/04/06/07/09/10/13.

**Second pack merged (2026-09-12):** P0-01 `#75`, P0-04 `#76`, P0-06 `#77`, P0-10 `#74`. Remaining OPEN after pack 2: was 03/07/09/13.

**Third pack merged (2026-09-12):** P0-13 `#79`, P0-07 `#80`, P0-03 `#81`, P0-09 `#82`. **All P0 rows DONE.**

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

| Date (UTC) | Event                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-09-12 | Register opened from product owner P0/P1/P2 list; Fees/Admissions queue demoted for sequencing (A5 still in flight; F5 → P1-FIN-GL).      |
| 2026-09-12 | Tip evidence pass: P0-08 DONE (refuted); P0-12 path refuted (chart present); P0-07 float SQL refuted; P0-11/12 hardening PRs `#68`/`#69`. |
| 2026-09-12 | First pack merged: P0-11 `#68`, P0-12 `#69`, P0-05 `#72`, P0-02 `#71`; plan `#67`; honesty `#70`; A5 `#66`. Register statuses reconciled. |
| 2026-09-12 | Second pack merged: P0-10 `#74`, P0-01 `#75`, P0-06 `#77`, P0-04 `#76`. Register statuses reconciled.                                     |
| 2026-09-12 | Third pack merged: P0-13 `#79`, P0-07 `#80`, P0-03 `#81`, P0-09 `#82`. **All P0 DONE.** Register reconciled.                              |

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
