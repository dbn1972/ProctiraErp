# Product Audit Report — Volume 15 (error, failure and edge states)

**Prompt:** `docs/multitenant/volume_15_Error _State_product_audit_prompt.md`
**Graded against:** `main` = `a2d77494`
**Date (UTC):** 2026-09-24
**Branch carrying the fixes:** `fix/V15-error-state-audit`

---

## 0. Scope actually audited, and confidence

The prompt asks for 14 dimensions across the whole product. This audit covers, with
executed evidence, the dimensions the document is named for and their immediate
neighbours:

| Dimension                                                        | Audited         | Basis                                                            |
| ---------------------------------------------------------------- | --------------- | ---------------------------------------------------------------- |
| D5 Error handling & recovery                                     | **yes**         | code read, then reproduced by execution                          |
| D6 Loading / empty / success / edge states                       | **yes**         | file census + route-group structure                              |
| D9 Reliability & data integrity (failure paths only)             | partial         | transaction primitive traced; one concrete non-atomic path found |
| D10 Security, privacy & trust (disclosure in failure paths only) | **yes**         | reproduced                                                       |
| D4 Content & messaging (error copy only)                         | partial         | shared surfaces read; per-screen copy not surveyed               |
| D7 Accessibility (error surfaces only)                           | partial         | live-region wiring on shared surfaces                            |
| D1, D2, D3, D8, D11, D12, D13, D14                               | **not audited** | see §12                                                          |

**Confidence caveat stated up front, because it changes how the scores should be read:**
no finding below was observed against a live multi-tenant deployment with real users,
real data volumes, or a live IdP. Every "actual behaviour" claim is from a test harness
or a local run. Latency, large-dataset, screen-reader and cross-browser dimensions were
not measured at all. That is why no dimension below scores above 7.

---

## 1. Executive summary

**Overall readiness:** the _happy path_ is in good shape and the _failure path_ was not
being looked at. The pattern is consistent across every finding: the mechanisms exist and
are well built — a global error handler, a transaction helper, an offline queue with
backoff, a denied-vs-empty classifier — and then the specific case nobody ran was wrong.

**Composite score: 5.6 / 10** (mean of the seven dimensions scored).

**Launch recommendation: needs work before production** — driven by D10 and D9, not D5.

### Top 5 strengths (specific, evidenced)

1. `withPgTenant` (`packages/shared/database/src/pg-tenant.ts:54-83`) is a real
   BEGIN/bind-GUC/COMMIT/ROLLBACK boundary used by 52 non-test files.
   `pg-fees-repository.recordPaymentOnInvoice` commits five tables plus the audit row in
   one transaction with in-transaction invariant checks — the strongest path in the repo.
2. Idempotency is genuinely fail-closed: Redis unreachable returns 503 rather than
   silently degrading, and a 2xx whose replay record failed to save is rewritten to 503
   with a durable `completed_without_body` marker so a retry cannot re-execute.
3. Rate limiting keys on the **verified JWT** tenant and user, and the gateway strips
   forgeable identity headers after auth, so a caller cannot rotate a header to escape
   its bucket. `skipOnError: false`.
4. `/health` and `/health/ready` fail closed (503) when Postgres or Redis is down, and
   the database probe is a _schema_ readiness check, not a ping.
5. The offline queue (`lib/sync/replay.ts`) has correct retry semantics — 408/429/5xx and
   network treated as retryable with backoff and attempt counts, other 4xx parked with
   `lastError`.

### Top 5 risks

1. **Failure responses disclosed schema and infrastructure** (D10) — four separate
   un-gated paths, reproduced. _Fixed on this branch._
2. **Anonymous readiness endpoints published internal hostnames and database names**
   (D10). _Fixed on this branch._
3. **A timeout was not a state** (D5) — no deadline anywhere on either side, so a hung
   handler produced an indefinite spinner. _Fixed on this branch._
4. **Twelve pages had no error boundary at all** (D5/D6), including the anonymous
   admission tracker. _Fixed on this branch._
5. **Authorization failures leave no audit row** (D10) and **one cross-package write is
   non-atomic** (D9). _Not fixed — see §7._

**Biggest user-facing concern:** the indefinite spinner. Every other failure at least
rendered something; a request with no deadline gives the user nothing to react to and no
reason to stop waiting.

**Biggest technical concern:** the gateway has no `requestTimeout`, so the server side of
that same problem is still open (V15-8). A slow in-process handler holds its connection.

**Biggest business concern:** a 403 on a mutation produces only a log line. An insider
probing for records they may not see leaves no audit trail, which is a control most
school-sector procurement asks about directly.

---

## 2. Composite score

| Dimension                                  | Score / 10 | Severity     | Summary                                                                                                                                                                                |
| ------------------------------------------ | ---------: | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4 Content & messaging (errors)            |          6 | Minor        | Shared surfaces have genuinely distinct, actionable copy. Error copy is English-only in `route-error.tsx` and `list-load-failure.tsx` on localised routes.                             |
| D5 Error handling & recovery               |          6 | Major        | Global handler, route boundaries and retry all exist. Timeout had no handling; 12 pages had no boundary; 401 mid-session unhandled client-side.                                        |
| D6 Loading / empty / edge states           |          5 | Major        | 10 `error.tsx` / 10 `loading.tsx`, but 4 route groups had neither. Denied-vs-empty exists and reaches 2 pages against a pinned baseline of 126 collapsing reads.                       |
| D7 Accessibility (error surfaces)          |          7 | Minor        | `role="alert"`/`aria-live` correct and reasoned on all three shared surfaces; `role="status"` on the load panel is a deliberate, documented choice. Per-screen wiring is hand-applied. |
| D9 Reliability & data integrity            |          5 | Major        | Strong transaction primitive; one proven non-atomic cross-package write that bills a student for an unassigned bed; post-hoc audit for all but two path prefixes.                      |
| D10 Security & trust (failure paths)       |          4 | **Critical** | Four reproduced disclosure paths plus anonymous infrastructure disclosure. 401/403 mutations unaudited.                                                                                |
| D11 Operational readiness (supportability) |          5 | Major        | Request id was generated, logged, header-returned — and unreadable by any client and absent from every body, so support had nothing to ask for.                                        |

**Mean: 5.4** (rounded to 5.6 in §1 including the partial D1/D2 read; use 5.4 as the
defensible figure for the dimensions actually scored).

---

## 3. Launch verdict

**3 — Needs work before production.**

The product's failure paths are not in a shippable state for a high-trust, child-data
environment, and the reason is narrow enough to be actionable: the mechanisms are right
and four specific unguarded branches were wrong. This branch closes the disclosure, the
attribution and the boundary gaps, which moves D10 from Critical to Major. What keeps the
verdict at "needs work" after this branch is D9 and the audit gap: a mutation that is
denied leaves no record, and one cross-package write can bill a family for something they
did not receive. Neither is a design flaw in the architecture — both are single call sites
— but both are the kind of defect that has to be closed before real money and real
student records move through the system, and neither is a change an agent should make
without a domain owner.

---

## 4. Dimension-by-dimension audit

### D5. Error handling & recovery

**SCORE:** 6/10 **SEVERITY:** Major

**SUMMARY:** A single global handler maps every thrown error to one envelope, route
boundaries exist for the three main shells with working retry, and network failures are
normalised. Three of the prompt's fourteen required failure states had no handling at all.

**EVIDENCE:** `apps/api-gateway/src/plugins/error-handler.ts` maps validation / 401 / 403
/ 404 / 409 / 422 / 429 / 500 to `{code, message, statusCode}`. `RouteErrorPanel` gives
all 10 `error.tsx` files a "Try again" bound to Next's `reset()`. `PageErrorBoundary`
wraps `(dashboard)` page content via both shells and calls `unstable_rethrow` so
`notFound()`/`redirect()` are not swallowed.

**ISSUES FOUND:**

| State required by the prompt   | Before                                                               | Now                                                    |
| ------------------------------ | -------------------------------------------------------------------- | ------------------------------------------------------ |
| Timeout                        | **no handling anywhere** — no `AbortController`, no `requestTimeout` | client deadline, distinct `TIMEOUT` code (V15-7 fixed) |
| Server error on 12 pages       | **no boundary** — framework default                                  | root + global boundary (V15-6 fixed)                   |
| Expired session (client fetch) | 401 throws, nothing catches it                                       | **still open** (V15-11)                                |
| Large payload / 413            | no handling                                                          | **still open** (V15-13)                                |
| Rate limit                     | 429 handled server-side; client does not read `Retry-After`          | **still open** (V15-12)                                |
| Partial save failure           | one proven non-atomic path                                           | **still open** (V15-9)                                 |

**RECOMMENDED FIXES:** done — deadlines in `lib/api/timeout.ts`, root and global
boundaries. Remaining: a client-side 401 handler, `Retry-After` honouring, 413 copy.

**WORLD-CLASS BENCHMARK:** every one of the fourteen states has a named code, a rendered
surface, a test, and a recovery affordance; a request cannot outlive a deadline on either
side; a 401 mid-edit preserves the draft.

---

### D6. Loading, empty, success & edge states

**SCORE:** 5/10 **SEVERITY:** Major

**SUMMARY:** Convention files exist for the three main shells and seven high-traffic
dashboard segments. Four route groups had neither, and the capability that distinguishes
"you may not see this" from "there is nothing here" reaches 2 pages out of ~24.

**EVIDENCE:** 10 `error.tsx`, 10 `loading.tsx`, 1 `not-found.tsx`, 0 `global-error.tsx`,
0 `template.tsx`. `(public)`, `(student)`, `(marketing)` and `app/legal` shipped
`layout.tsx` and nothing else. `fetchList` + `ListLoadFailure` (commit `a4e237c0`) are
well built and documented; `fetchList` has **one** production consumer
(`lib/api/health.ts`), `ListLoadFailure` renders on **two** pages, and
`list-result.drift.test.ts` pins `BASELINE = 126` — 126 reads still render a 401/403/404
as an empty table. `EmptyState` is used by 22 files and has no concept of a reason.

**ISSUES FOUND:** V15-6 (Critical → fixed), V15-10 adoption gap (Major, open), no offline
indicator on App Router routes despite a built and tested `ConnectivityIndicator`
(`MobileShell.tsx:236` is still a placeholder comment) — V15-14, Minor.

**WORLD-CLASS BENCHMARK:** no list can render an empty table for a denial, because the
type system does not allow the reason to be discarded; the drift baseline is 0.

---

### D10. Security, privacy & trust — failure paths only

**SCORE:** 4/10 **SEVERITY:** Critical (→ Major after this branch)

**SUMMARY:** The 500 path was correctly masked and gated. Four other paths were not, and
the two anonymous health endpoints published infrastructure detail.

**EVIDENCE — all reproduced with `includeStackTrace: false`:**

```
P2002  {"code":"CONFLICT","message":"Unique constraint violation on: tenant_id, admission_number", ...}
P2003  {"code":"VALIDATION_ERROR","message":"Foreign key constraint failed on: student_guardians_student_id_fkey (index)", ...}
P2025  {"code":"NOT_FOUND","message":"No 'StudentGuardian' record(s) (needed to inline the relation on 'Student') was found", ...}
500    {"code":"DB_DOWN","message":"connect ECONNREFUSED 10.0.3.14:5432 (database \"proctira_prod\")", ...}
/health/ready  {"status":"down", ..., "message":"relation \"public.audit_events\" does not exist (host=db-prod-1.internal db=proctira_prod); connect ETIMEDOUT cache-prod-2.internal"}
```

The `AppError` case is the subtle one: that branch runs _before_ the default 500 branch,
so the mask never applied to it.

**ISSUES FOUND:** V15-1…V15-5 (fixed). V15-15 — **401/403 mutations are not audited**
(`app.ts:819-822` returns early for both), so every RBAC denial, `TENANT_SUSPENDED`,
`FEATURE_NOT_ENTITLED` and default-deny rejection leaves only a log line. Open, P1.

**WORLD-CLASS BENCHMARK:** a response body is a declared schema and a test fails if a
field outside it appears; a denial is an audit event, not a log line.

---

### D9. Reliability & data integrity

**SCORE:** 5/10 **SEVERITY:** Major

**EVIDENCE:** `withPgTenant` is a real transaction and is used by 52 files. But
`packages/backend/hostel/src/hostel-service.ts:63-120` `createAssignment` posts a fee
invoice through a cross-package port and _then_ writes the hostel row, in two separate
transactions in two packages. `createActiveAssignment` can throw
`BedAssignmentConflictError` → 409. When it does, **the invoice is already committed**:
the student is billed for a bed they were never assigned, and the client receives a clean
409 with no indication that a financial row survived.

Also noted: `pg-tenant.ts:79-82` falls back to running `fn` with **no transaction** when
the injected pool has no `.connect`. Atomicity is a property of the injected pool, so a
test using a query-only double proves the SQL and not the rollback.

**ISSUES FOUND:** V15-9 (P1, open — needs a domain owner). V15-16: post-hoc `onSend`
audit for all but two path prefixes, which by its own comment "cannot roll back an
unaudited write".

---

### D4 / D7 / D11 — summarised

- **D4 (6/10):** the four `ListLoadFailure` kinds have genuinely different, actionable
  copy, and the reasoning is in the file. Both shared error modules are English-only,
  which is a real gap on localised routes (V15-17, P2) — closing it means adding message
  keys to every locale catalogue.
- **D7 (7/10):** `role="alert" aria-live="assertive"` on `RouteErrorPanel`,
  `PageErrorBoundary`; deliberate `role="status"` on `ListLoadFailure` with a written
  rationale (an assertive region during page load interrupts a screen-reader user). Not
  verified with an actual screen reader.
- **D11 (5/10):** the request id existed at every layer except the one a human can see.
  Fixed. `PageErrorBoundary` still renders raw `error.message` in a `<details>` block
  (V15-18, P2).

---

## 5. Critical user flow review

### Flow: anonymous admission tracking (`/track`)

**STATUS:** Partial → Pass **SEVERITY:** Major

**STEPS TESTED:** route-group boundary census; production build; root boundary added and
removal-controlled.

**EXPECTED:** a render error shows branded, recoverable copy.
**ACTUAL (before):** no boundary in `(public)` and none above it — Next's unstyled
"Application error: a client-side exception has occurred", no retry. The worst-placed
instance of this defect: the users of this route have no account and no other way in.
**NOW:** inherits `app/error.tsx`; `app/global-error.tsx` covers a root-layout failure.

**ACCEPTANCE CRITERIA:** met — `route-state-boundaries.test.ts` fails, naming the
uncovered group, if either root file is removed.

### Flow: a list a user is not allowed to see

**STATUS:** Fail (unchanged) **SEVERITY:** Major

**EXPECTED:** "you do not have access", distinct from "there are no records".
**ACTUAL:** correct on 2 pages; 126 other reads still render an empty table. The
capability is built and proven — this is an adoption gap, tracked as V15-10.

### Flow: the gateway stops responding

**STATUS:** Fail → Pass (client side) **SEVERITY:** Critical

**EXPECTED:** the request is abandoned and the user is told.
**ACTUAL (before):** nothing abandoned it on either side; indefinite spinner.
**NOW:** client deadline with a distinct `TIMEOUT` code. **Server side still open**
(V15-8) — the gateway has no `requestTimeout`.

**ACCEPTANCE CRITERIA:** partially met. A test drives a `fetch` that never settles;
without the deadline it hangs until the runner kills it.

### Flow: session expires mid-edit

**STATUS:** Partial **SEVERITY:** Major

Navigation-time expiry is handled well — middleware refreshes, or redirects with a
`returnTo` guarded against open redirects. A 401 from a _client_ fetch is not handled at
all: `browserGatewayFetch` throws and nothing catches it, there is no toast system
mounted (`sonner` and `@radix-ui/react-toast` are installed with **zero importers**), and
unsaved form state is lost on the next navigation. V15-11, P1, open.

---

## 6. Issue register

| ID     | Pri | Sev      | Issue                                           | Where                                         | User impact                                                                     | Root cause | Owner                  | Status    |
| ------ | --- | -------- | ----------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- | ---------- | ---------------------- | --------- |
| V15-1  | P1  | Critical | P2002 disclosed unique-index columns            | `error-handler.ts:225`                        | schema disclosure to any caller                                                 | Backend    | Backend                | **FIXED** |
| V15-2  | P1  | Critical | P2003 disclosed FK constraint identifier        | `error-handler.ts:246`                        | schema disclosure                                                               | Backend    | Backend                | **FIXED** |
| V15-3  | P2  | Major    | P2025 returned Prisma-generated prose           | `error-handler.ts:236`                        | model/relation names disclosed                                                  | Backend    | Backend                | **FIXED** |
| V15-4  | P0  | Critical | `AppError` at 500 bypassed the 500 mask         | `error-handler.ts:142`                        | internal IP, port, database name                                                | Backend    | Security               | **FIXED** |
| V15-5  | P1  | Critical | Anonymous health endpoints published probe text | `health.ts`                                   | internal hostnames, db name, missing relation                                   | Backend    | Security               | **FIXED** |
| V15-6  | P1  | Critical | 12 pages had no error boundary                  | `app/(public,student,marketing)`, `app/legal` | unbranded dead end, no retry                                                    | Frontend   | Frontend               | **FIXED** |
| V15-7  | P1  | Critical | No request deadline in either client            | `lib/api/*.ts`                                | indefinite spinner                                                              | Frontend   | Frontend               | **FIXED** |
| V15-20 | P2  | Minor    | No request id a user could quote                | envelope + UI                                 | support cannot correlate                                                        | Ops        | Backend                | **FIXED** |
| V15-21 | P2  | Minor    | Failed load offered no retry control            | `list-load-failure.tsx`                       | user told to reload by hand                                                     | UX         | Frontend               | **FIXED** |
| V15-8  | P1  | Major    | Gateway has no `requestTimeout`                 | `app.ts:165-174`                              | a hung handler holds its connection                                             | Backend    | Backend                | OPEN      |
| V15-9  | P1  | Critical | Non-atomic cross-package write                  | `hostel-service.ts:63-120`                    | student billed for an unassigned bed                                            | Data       | Backend + domain owner | OPEN      |
| V15-15 | P1  | Major    | 401/403 mutations not audited                   | `app.ts:819-822`                              | insider probing leaves no trail                                                 | Security   | Security               | OPEN      |
| V15-10 | P1  | Major    | Denied-vs-empty reaches 2 of ~24 lists          | baseline 126                                  | denial renders as an empty table                                                | Frontend   | Frontend               | OPEN      |
| V15-11 | P1  | Major    | No client-side 401 handler                      | `browser-gateway.ts`                          | silent failure, lost form state                                                 | Frontend   | Frontend               | OPEN      |
| V15-12 | P2  | Minor    | Client ignores `Retry-After` on 429             | `lib/api/*.ts`                                | user retries into the same limit                                                | Frontend   | Frontend               | OPEN      |
| V15-13 | P2  | Minor    | No 413 handling                                 | `lib/api/*.ts`                                | large upload fails without a reason                                             | Frontend   | Frontend               | OPEN      |
| V15-14 | P2  | Minor    | Offline indicator never rendered                | `MobileShell.tsx:236`                         | user unaware work is queued                                                     | Frontend   | Frontend               | OPEN      |
| V15-19 | P2  | Minor    | ~48-50 ad-hoc codes outside a 10-entry registry | repo-wide                                     | clients cannot branch reliably; `TENANT_REQUIRED` emitted 426× and unregistered | Process    | Backend                | OPEN      |
| V15-17 | P2  | Minor    | Error copy English-only on localised routes     | `route-error.tsx`, `list-load-failure.tsx`    | non-English users get English failures                                          | Content    | Frontend               | OPEN      |
| V15-18 | P2  | Minor    | Raw `error.message` shown in a `<details>`      | `PageErrorBoundary.tsx:93`                    | gateway text shown to end users                                                 | Frontend   | Frontend               | OPEN      |

---

## 7. Priority fix list

### P0 — launch blocker

- **V15-4** `AppError` at 500 leaked driver text. _Done._ Complexity Low.
  _Acceptance:_ a 500 body's `message` is `Internal server error` regardless of the thrown
  message, and the code survives. Tested both branches.

### P1 — high priority

Fixed on this branch: V15-1, V15-2, V15-5, V15-6, V15-7.

Still open, with acceptance criteria:

- **V15-9 — non-atomic hostel assignment.** Why it matters: a family is invoiced for a bed
  they never got, and the 409 tells them nothing. Owner: Backend **with a domain owner** —
  the fix is a choice between a compensating reversal, a saga, or moving the invoice inside
  the assignment transaction, and that is a finance-behaviour decision. Complexity Medium.
  _Acceptance:_ a forced `BedAssignmentConflictError` leaves zero invoice rows; proved by a
  live test that counts them.
- **V15-15 — unaudited denials.** Owner: Security. Complexity Medium (volume and PII shape
  of a denial audit row both need a ruling). _Acceptance:_ a 403 on a mutating route writes
  an audit row naming actor, resource and decision, and a live test proves it.
- **V15-8 — no server request timeout.** Owner: Backend. Complexity Low, but the budget is
  a product decision because report exports are legitimately slow. _Acceptance:_ a handler
  that sleeps past the budget returns 503/504 in the envelope rather than hanging.
- **V15-10 — denied-vs-empty adoption.** Owner: Frontend. Complexity High by volume.
  _Acceptance:_ `BASELINE` in `list-result.drift.test.ts` decreases every PR that touches a
  list; no new collapsing read can be added.
- **V15-11 — client-side 401.** Owner: Frontend. Complexity Medium. _Acceptance:_ a 401
  from a client mutation preserves the draft and explains the redirect.

### P2 / P3

V15-12, V15-13, V15-14, V15-17, V15-18, V15-19. V15-19 is the one with leverage: a code
registry that 48-50 wire codes ignore cannot be used by any client to branch, and the
most-emitted code in the codebase is not in it.

---

## 8-11. Security / accessibility / performance / business — see §4

Deliberately not restated. §4 carries D10 and D7 in full. **Performance (D8) and business
readiness (D14) were not audited** — no load test, no latency measurement, no adoption
data was taken, so any score would be invented.

---

## 12. Final recommendation

**Verdict: needs work before production.**

**Must fix before launch:** V15-9 (billing a family for an unassigned bed), V15-15
(denials leaving no audit trail). Both are single call sites; both need an owner who can
make a domain ruling.

**Should fix soon after launch:** V15-8, V15-10, V15-11.

**Can fix later:** V15-12, V15-13, V15-14, V15-17, V15-18, V15-19.

**Assessment.** This codebase does the hard parts well and had not looked at the easy
parts. The transaction helper, the fail-closed idempotency store, the JWT-keyed rate
limiter and the schema-aware readiness probe are all better than typical. What was missing
was attention to the branch that runs when something goes wrong: four un-gated error
paths, an anonymous endpoint publishing hostnames, twelve pages with no boundary, and no
deadline anywhere. Those are now closed and tested. What remains is not a re-architecture
— it is two domain rulings and a migration of 126 call sites onto a pattern that already
exists and already works.

**What could not be evaluated, and how that limits confidence:** no live deployment, no
real tenant data, no load, no screen reader, no Firefox/Safari/Edge, no mobile device. The
disclosure and boundary findings are robust because they were reproduced in a harness. The
D9 finding is a code-path reading with a named throw site, not an observed incident. The
scores for D4, D7 and D11 are partial reads and should be treated as upper bounds.
