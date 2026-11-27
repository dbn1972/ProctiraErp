# ProctiraERP UAT release plan

> Tracked copy (UAT closure, 18 Nov 2026). Only section E is current, as of wave w3-3e961b23 on main `3e961b23`. Everything else in this file (preamble, counts, timeline, running work, sections 0, A-D, F, merge order and change log) is a point-in-time copy of the local plan from 27-28 Oct 2026 and is not current. Local paths and workflow ids in it do not resolve in the repository.

Every step to close the open audit gaps and certify the UAT release. A step is crossed out only once it is merged to `main` and verified. Times are IST.

Updated: 27 Oct 2026, 22:15 IST. Main tip: `26f42428` (#684, merge train 5). Main `CI` run 40538162964 is still queued. DoD, Helm, Observability, Workflow Lint and Supply Chain are green on that commit.

| Closed | Merged, main CI pending | Agent working | Waiting on you | Not started | Total |
| ------ | ----------------------- | ------------- | -------------- | ----------- | ----- |
| 11     | 11                      | 0             | 6              | 4           | 32    |

Ledger on `main` now: 758 findings, 389 FULLY_CLOSED, 202 PARTIAL, 161 OPEN, 6 DUPLICATE (395 closed, 363 pending). Closeout report: `.agents/tasks/wave3-wave4-closeout-2026-10-26/report.md` (142 ids: 55 FIXED, 44 PARTIAL, 27 BLOCKED_FOR_APPROVAL, 11 SKIPPED, 6 STALE, 1 DUPLICATE).

UAT timeline (from `AUDIT_363_CLOSURE_PLAN.md`):

- 28 Oct 18:00: open PRs merged, main green.
- 1 Nov 18:00: T1 and T6 closed.
- 3 Nov 18:00: T2, T3, T4 and T8 closed.
- 4 Nov 18:00: all 363 closed.
- 5 Nov 12:00: E1.
- 5 Nov 18:00: E2.
- 6 Nov: E3 UAT deploy (environment must be named by 3 Nov).

Running now, both due ready-to-merge by 28 Oct 14:00 IST:

- `wf_7acd51c12d5e428f` uat-main-green-2. Main CI on `26f42428`: Secondary Apps Playwright failed. Branch `fix/main-green-ci-2`.
- `wf_42ba5b6453bcc2b6` uat-registration-submit-fix (PRC-M568 blocker). Branch `fix/registration-submit-privilege`.

Then: #633 merge, E1. Do NOT resume `wf_aa1b63dbd8f2916e`, `wf_1b7d4e14875df6de` or `wf_164a58e8bc1de12b`.

The sign-offs for #684 (DB owner, infra owner, security/finance for L135/M532) appear only as text in the PR body. GitHub has no review approval on #684 or any lane PR.

## 0. Already closed (21-27 Oct)

| #   | Step                                                        | Evidence                               | Closed (IST) |
| --- | ----------------------------------------------------------- | -------------------------------------- | ------------ |
| A0  | ~~Restore main to green (PRC-L397, M104, cdn, L246 flake)~~ | #674 `b87e8210`, main CI green         | 27 Oct 17:20 |
| D5  | ~~Strip `.agents/tasks/*` from A1, A2, B1 commits~~         | No `.agents/` paths in any merged diff | 27 Oct 21:39 |
| 0.1 | ~~Wave 0-2 low/medium closures, merge train 3 (10 PRs)~~    | #673                                   | 26 Oct 17:50 |
| 0.2 | ~~Institution batch, 22 findings~~                          | #654                                   | 26 Oct 09:17 |
| 0.3 | ~~Health/PHI batch, 15 findings~~                           | #653                                   | 25 Oct 10:28 |
| 0.4 | ~~Infrastructure backlog and ledger reconcile~~             | #649, #652                             | 25 Oct 14:20 |
| 0.5 | ~~Examination batch, 10 findings~~                          | #648                                   | 24 Oct 14:09 |
| 0.6 | ~~Timetable/attendance schema batch, 15 findings~~          | #647                                   | 24 Oct 08:31 |
| 0.7 | ~~DB module backlog (RLS, audit, atomicity, seeds)~~        | #650                                   | 23 Oct 23:50 |
| 0.8 | ~~App-mobile batch, 19 findings~~                           | #651                                   | 21 Oct 20:07 |
| 0.9 | ~~Security deps: Next.js and zod CVEs~~                     | #655, #658                             | 24 Oct 12:30 |

## A-C. Merged in train 5 (#684, `26f42428`, 27 Oct 21:39 IST): cross out once main CI run 40538162964 is green

| #   | Step                                    | Source PR (closed as superseded) | Result                                            |
| --- | --------------------------------------- | -------------------------------- | ------------------------------------------------- |
| A1  | web-portals lane, 8 ids                 | #675                             | Review APPROVED                                   |
| A2  | tooling-shared lane, 16 ids             | #676                             | Review APPROVED                                   |
| A3  | backend-domains lane, 30 ids            | #677                             | 8 FIXED, 16 PARTIAL, 2 STALE, 4 BLOCKED           |
| A4  | Push lanes, open PRs, CI green          | #675-#683                        | Done                                              |
| A5  | Merge train                             | #683 inside #684                 | Merged                                            |
| B1  | Ledger reconcile + owner decision brief | #679                             | Ledger 389 / 202 / 161 / 6 on main                |
| C2  | Schema set A, migrations 254-261        | #680                             | 10 FIXED, 5 PARTIAL                               |
| C3  | Schema set B, migrations 262-273        | #681                             | 8 FIXED, 6 PARTIAL (L576, M396 owner decisions)   |
| C4  | Infra/CI, 18 ids                        | #682                             | 11 FIXED, 5 PARTIAL, M568 BLOCKED, L263 DUPLICATE |
| C5  | Parent-portal batch 2, migration 290    | #678                             | M533 PARTIAL; M536/M319 BLOCKED                   |
| D1  | Parent-portal batch 1 (carried by C5)   | #678                             | Merged                                            |

## Still open

| #   | Step                                        | Status         | Next action                                                                                              |
| --- | ------------------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------- |
| C1  | PR #633 role catalogue (PRC-M015 + 6)       | WAITING ON YOU | Updated from main to `401c42b1`, CI running. Needs RBAC/IdP owner approval; merge alone, not in a train  |
| B2  | Owner decision brief (245 items, 25 topics) | WAITING ON YOU | `docs/audits/remediation/OWNER_DECISIONS_2026-10-26.md`, now on main. Drives section F                   |
| B3  | PR #630 (stale ledger, conflicting)         | WAITING ON YOU | Still open. Recommendation: close as superseded                                                          |
| D2  | Remove merged worktrees                     | WAITING ON YOU | Remove the wave 3/4 worktrees after main CI is green. Old `ProctiraErp-*` worktrees need per-tree checks |
| D3  | 12 Dependabot PRs                           | WAITING ON YOU | Merge #671, #672, #636, #643; see `.agents/tasks/dependabot-triage-2026-10-26/report.md`                 |
| D4  | 16 findings no lane covered                 | WAITING ON YOU | 13 decisions, 2 approvals, M262 for Wave 5. `.agents/tasks/wave5-triage-2026-10-26/report.md`            |

New UAT blocker from C4: the live harness found that public registration submit fails with a permission error (PRC-M568, BLOCKED). It needs its own fix before UAT.

## E. UAT certification

| #   | Step                                         | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Next action                                                                                                                                                                                                                             |
| --- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1  | Full suites on `main`                        | PASSED on 3e961b23 (wave w3-3e961b23): API 16/16 PASS, DB 14/14 PASS (4 owner-accepted Q6 skips: 3 API, 1 DB); unit/typecheck/lint from CI run 43811209169; E2E shards and live gate from nightly run 43869358656; open findings UAT-API-001, UAT-ENV-006; results docs/testing/uat/results/w3-3e961b23.json                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Owner reviews residuals                                                                                                                                                                                                                 |
| E2  | Live cross-tenant/RLS proof on the UAT stack | PASSED on 3e961b23 (wave w3-3e961b23): api.tenant-isolation-* 7/7, spec 46 cross-tenant in the e2e-backend-ready shards, db.strict-tenant-fks-live, db.runtime-table-privileges, db.runtime-role-gate PASS; runtime and migrator roles NOSUPERUSER NOBYPASSRLS verified in every provisioning run and in db.apply-scratch; CI run 43811209169                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | -                                                                                                                                                                                                                                       |
| E3  | Deploy to UAT and smoke test                 | PARTIAL on f7e06695 (27 Nov 2026, EC2 host, compose project proctira-uatenv, 12 core + 4 secondary apps, 16/16 containers healthy; docs/testing/uat/UAT_ENVIRONMENT.md). E3 items met 2 of 8: (4) screen-level cross-tenant A->B 10/10, B->A 9/9, positive controls 4/4, 0 INCONCLUSIVE; (5) session survives the 5-minute access token, active 15/15 and idle 15/15 (on b57cd037; the session path is unchanged since). Unmet: (1) right home screen 12/15 users (D19 registrar, D09 two tenant-B users; owner); password form 200; (2) render pass 188 PASS / 3 FAIL / 15 SKIP / 3 BLOCKED of 209 routes (15 SKIP D17 and 3 BLOCKED health routes, owner; 2 FAIL harness role choice; 1 expected `/__tests/error-boundary` 404); (3) Playwright nightly: first-run 59 specs 7 pass / 52 incompatible / 0 fail, 17 added web specs 0 pass / 17 incompatible, registration live journey 5 of 5 runnable tests (D28 harness HS256 sessions, not owner); (6) secondary apps 4/4 deployed and healthy, 34 routes 19 PASS / 0 FAIL / 11 BLOCKED / 4 SKIP (D23 platform-operator identity, owner); (7) payments not testable without Razorpay test keys (owner); (8) tenant-B users land on the Sunrise host after Keycloak login (D09, owner). Smoke: health 42/42 probes, loopback-only ports, 15/15 Keycloak logins, cross-tenant gateway A->B 7/7 and B->A 6/6, backup and restore drill met. Awaiting post-merge re-check, counted unmet: D32 (admin tab title shows the product name; fix in this PR). Non-owner items left: item 2 (2 harness role-choice FAILs) and item 3 (D28). Evidence: host task folder `redeploy-main/evidence/smoke-summary.md`, `defects.md` | Merge the D32 fix, redeploy and re-check the admin tab titles; D28 harness sessions and the 2 render-pass role choices (separate tasks); E3 Track 3 applies #798 tooling (D17, D23, D26); owner: D09, D17, D19, D23, Razorpay test keys |
| E4  | UAT sign-off                                 | NOT STARTED                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Owner sign-off                                                                                                                                                                                                                          |

Owner decision labels used in section E and in `docs/audits/remediation/UAT_FINDINGS.csv` (not the D1-D5 plan steps above): owner D1/D6 = path-filtered CI jobs accepted when a commit touches no `apps/`; owner D7 = ledger promotion counts only suites that run on main; owner Q6 = the four accepted single-test skips; owner Q10 A = UAT unit-suite env profile.

## F. Closing the 363 pending findings

Detail and id lists: `.agents/tasks/AUDIT_363_CLOSURE_PLAN.md`. Every track starts only after its decision. Target: all 363 merged and closed by 4 Nov 18:00 IST, UAT deploy 6 Nov.

| #   | Track                              | Findings | Decision by  | Closed by   |
| --- | ---------------------------------- | -------- | ------------ | ----------- |
| F1  | Security and identity              | 87       | 28 Oct 11:00 | 1 Nov 18:00 |
| F2  | Privacy and health data            | 28       | 29 Oct 11:00 | 3 Nov 18:00 |
| F3  | Money and statutory rules          | 25       | 29 Oct 15:00 | 3 Nov 18:00 |
| F4  | API and UI contracts               | 24       | 30 Oct 11:00 | 3 Nov 18:00 |
| F5  | Product rules and surfaces         | 91       | 30 Oct 15:00 | 4 Nov 18:00 |
| F6  | Platform, dependencies, governance | 16       | 28 Oct 15:00 | 1 Nov 18:00 |
| F7  | Schema/migration batch             | 42       | with F1-F5   | 4 Nov 18:00 |
| F8  | Infra/CI batch                     | 30       | with F6      | 3 Nov 18:00 |
| F9  | Residual steps of fixed findings   | 20       | with F1-F5   | 4 Nov 18:00 |

## Merge order (remaining)

1. Confirm main CI green on `26f42428`. Then cross out A1-C5, D1 and remove the wave 3/4 worktrees.
2. #633 (RBAC/IdP owner).
3. Close #630. Dependabot per D3.
4. Fix the registration submit permission error (M568).
5. E1 on the resulting `main`.

## Change log

- 26 Oct 19:03 IST: plan created from git, `gh` and lane plan state.
- 26 Oct 19:10 IST: findings workbook built (758 rows, mapped to steps). Added D4 for 74 unscheduled findings.
- 26 Oct 20:19 IST: aligned with the two running workflows. Added A0 (main CI red), D5 (.agents files in commits). D1 folded into C5. C2-C5 now in progress. D4 down to 64.
- 26 Oct 22:09 IST: both workflows found paused since 20:03 IST (agent restart); no work since. A0 detail corrected from plan-claimed Part 3.
- 26 Oct ~22:40 IST: D4 triage done. The 74/64 counts were taken from main's unreconciled ledger; against the B1 ledger only 16 are open. D4 now waiting on owner decisions.
- 26 Oct ~22:50 IST: D3 Dependabot triage done; waiting on owner approval to merge/close. Closeout run `wf_2df0e42fb8890a33` plan accepted (3 parallel chains, then ledger, publish, train, CI loop, report).
- 26 Oct late IST: A1, A2 and C1 reviews APPROVED (unpushed). .agents files stripped from A1, A2 and B1 (D5 done). A3 M631 committed f8f48239 (7/30). C1 Unit Tests failure was a pre-existing flake, fixed by e7d211ca (PRC-L246). A0: 3 commits; review CHANGES_REQUESTED (regex in the cdn fix), second pass running.
- 27 Oct ~06:35 IST: A0 run done; PR #674 opened. First CI red only on the staff-import flake, so the C1 fix e7d211ca was cherry-picked as bdbafce2 and pushed. A3 done: 13 commits, review APPROVED (8 FIXED, 16 PARTIAL, 2 STALE, 4 BLOCKED).
- 27 Oct 08:20 IST: PR #674: 28 pass, Type Check pending, no failures. C2 code done (13 commits; 10 FIXED, 5 PARTIAL), review running. C4 coding (11 commits). C5 coding (14 commits). C3 not started. Nothing pushed except #674.
- 27 Oct IST: C2, C4 (pass 2) and C5 (pass 2) reviews APPROVED. C3 coded (15 commits); L576 and M396 held PARTIAL by the orchestrator's conservative default, now owner decisions (L576 failed-row read semantics; M396 denormalise academic_period_id for an EXCLUDE). C4: M568 BLOCKED (live harness found registration submit permission error), L263 DUPLICATE of M568; the lane has 18 ids, not 19.
- 27 Oct 17:05 IST: all 9 lanes published (#675-#682, #633 updated) and train 4 opened as #683. Latest CI green on #674, #675, #678, #680, #681, #682, #683; re-running on #633, #676, #677. #679 can never get its E2E check (docs-only), so it lands through #683. B1 ledger refreshed to 389 / 202 / 161 / 6. Counts re-based: 10 closed, 5 agent working, 13 waiting on you, 4 not started.
- 27 Oct ~17:40 IST: A0 CLOSED, #674 merged 11:50Z as b87e8210 (17:20 IST). All lanes published: #675-#683, #633 updated. C3 approved. B1 refresh: 141 rows. Another session opened train 5 #684 (all of #680-#683, owner approval claimed in its body), currently BLOCKED on checks. B1 #679 will land via the train, close it after #684 merges.
- 27 Oct IST: closeout ci-loop ended on owner instruction after 2 passes. The CI review stays CHANGES_REQUESTED on a single finding: #679's required E2E never reports on a docs-only PR, so it lands via train #684 instead. Report step is running.
- 27 Oct 22:05 IST: train 5 #684 merged by dbn1972 at 21:39 IST as 26f42428. #675-#683 closed as superseded. Main CI run 40538162964 queued; DoD, Helm, Observability and Workflow Lint green. #633 updated from main (401c42b1): clean merge, web typecheck and auth/staff tests 170/170 pass, pushed.- 27 Oct 22:15 IST: closeout run completed and its report is written. Tracker rebased on main `26f42428`: A0 and D5 closed; 11 steps merged and waiting on main CI; #630 still open.
- 27/28 Oct IST: main CI on 26f42428 failed in 3 jobs from one cause. The registration live-gate spec fails on every main push (it was already failing on 329aba6d, so it predates train 5). Orchestrator chose A2: keep main fail-closed, with an explicit opt-out for the two backend-less lanes. Registration submit fix: PR #690 (afde213a). Failing-first test 7 fail → 9/9 pass, review APPROVED, live journey 5/5, CI watching.
- 28 Oct IST: PR #690 (registration submit fix, PRC-M568 stays PARTIAL) is green and CLEAN at 85c202c0, ready for owner merge. uat-main-green-2 is still on its A2 fix.
- 28 Oct ~04:40 IST: PR #691 (fix/main-green-ci-2 @ 86855227, A2 live-gate opt-out) is green: 44 pass, 1 push-only skip, review APPROVED. #690 and #691 share no files and merge cleanly together. Both await owner merge by 28 Oct 18:00. Branch protection requires up-to-date branches, so the second merge needs a rebase and one CI cycle.
- 18 Nov 2026: UAT API/DB test closure (spec uat-api-db-test-closure). Wave w3-3e961b23 on main 3e961b23: every inventory suite PASS on attempt 1; CI run 43811209169, E2E push 43811209105, nightly E2E 43869358656. Findings in docs/audits/remediation/UAT_FINDINGS.csv. E1 PASSED, E2 PASSED; E3/E4 unchanged.
- 23 Nov 2026: E3 PARTIAL on 219093a4. UAT stack deployed on the EC2 host (compose project proctira-uatenv, loopback ports 29000-29099, SSH tunnel access) and smoke-tested on 21 Nov; environment guide docs/testing/uat/UAT_ENVIRONMENT.md. Code defects found by the smoke run are fixed on main by #753-#757; a redeploy and smoke re-run are needed before E3 can be PASSED.
- 27 Nov 2026: E3 PARTIAL on f7e06695 (redeploys after batches b1-b8 fixed D18, D20, D22, D24, D25, D27, D29, D30, D31 and the web side of D26; D23 PARTIAL). E3 items met 2 of 8; the remaining non-owner items are D28 and 2 render-pass harness role choices; the rest wait for owner input. D32 is fixed in the PR that carries this entry and is unmet until the post-merge re-check.
