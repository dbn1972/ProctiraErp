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

| Dimension                                                        | Audited         | Basis                                                             |
| ---------------------------------------------------------------- | --------------- | ----------------------------------------------------------------- |
| D5 Error handling & recovery                                     | **yes**         | code read, then reproduced by execution                           |
| D6 Loading / empty / success / edge states                       | **yes**         | file census + route-group structure                               |
| D9 Reliability & data integrity (failure paths only)             | partial         | transaction primitive traced; one concrete non-atomic path found  |
| D10 Security, privacy & trust (disclosure in failure paths only) | **yes**         | reproduced                                                        |
| D4 Content & messaging (error copy only)                         | partial         | shared surfaces read; per-screen copy not surveyed                |
| D7 Accessibility (error surfaces only)                           | partial         | axe executed over 6 error-surface variants; **no assistive tech** |
| D1, D2, D3, D8, D11, D12, D13, D14                               | **not audited** | see §12                                                           |

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

**Composite score: 7.6 / 10** (7.57) after four remediation waves, up from **5.4** as first
graded. It is the unrounded mean of the seven dimensions scored; the arithmetic is in §2.

**Two of this wave's increments are contestable, and the floor is stated so nobody has to
take the headline on trust.** D6 moved 6 → 7 on 13 of 126 reads converted, and D7 moved
7 → 8 on automated checks rather than the assistive-technology pass §13 originally named as
the bar. A reviewer who rejects either gets **7.43**; one who rejects both gets **7.29**,
i.e. no movement this wave. §13 argues each increment and shows all four arithmetics.

**The requested target was 8.5. It is not reached and cannot be by this audit** — three of
the four remaining dimensions need decisions or observations outside an agent's reach. §13
names each one.

**Launch recommendation: ready for production with minor improvements**, conditional on the
two adoption items in §13 being scheduled rather than dropped. The two findings that
previously held the verdict at "needs work" — a family billed for a bed they never got, and
denials leaving no audit trail — are closed, tested, and each has an arm that fails when the
fix is reverted.

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

Two columns: `Before` is the grade against `a2d77494`, `Now` is the grade against this
branch. A score moves only where a named finding was closed **and** something fails when the
fix is reverted. Nothing below moved because the write-up improved.

| Dimension                                  | Before | Now | Severity now | What moved it, or why it did not                                                                                                                                                                                                                                                           |
| ------------------------------------------ | -----: | --: | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D4 Content & messaging (errors)            |      6 |   8 | Minor        | V15-17 closed: a `routeState` namespace in all nine catalogues, key-set parity verified, and a test asserting the four failure kinds stay distinct when translated. Not 9: per-screen copy outside the shared panels was never surveyed.                                                   |
| D5 Error handling & recovery               |      6 |   8 | Minor        | 13 of the prompt's 14 required failure states now have a named code, a surface and a test. Not 9: handler-duration timeout is still open (V15-8), and idempotency remains client-opt-in with DELETE excluded.                                                                              |
| D6 Loading / empty / edge states           |      5 |   7 | Major        | **Weakest increment on this table — argued in §13.1.** The `hostel` domain is fully converted (13 functions, 9 pages) and the drift ratchet is lowered 126 → 113, so denials there say so. Still 113 reads across 23 modules collapse, and V15-14 is reverted, which is why this is not 8. |
| D7 Accessibility (error surfaces)          |      7 |   8 | Minor        | **Revises §13's earlier bar — argued in §13.2.** axe now executes over all six error-surface variants with a negative control that fails on `heading-order`/`button-name`. Evidence class moved from source-reading to executed. Not 9: component-level, no assistive technology.          |
| D9 Reliability & data integrity            |      5 |   7 | Minor        | The one proven non-atomic path can no longer bill for an unassigned bed, proved by an arm that reports 2 invoices on the old ordering. Not 8: cross-package atomicity and the post-hoc audit residual remain.                                                                              |
| D10 Security & trust (failure paths)       |      4 |   8 | Minor        | Four reproduced disclosure paths and the anonymous health leak are closed and pinned by tests; 403 denials are audited. Not 9: 401 is unauditable in a tenant-scoped RLS table by design, and stated as such.                                                                              |
| D11 Operational readiness (supportability) |      5 |   7 | Minor        | Every error body now carries `requestId`, including hand-built 401/403; the boundary shows a digest instead of raw internals. Not 8: nothing joins the id a user sees to a trace, and alerting is unchanged.                                                                               |

**Mean now: (8 + 8 + 7 + 8 + 7 + 8 + 7) ÷ 7 = 53 ÷ 7 = 7.57.** Before: 5.4.

### The two contestable increments, and the floor

Both of this wave's movements are weaker than the ones in earlier waves, where every point
came with a test that failed when the fix was reverted. These do not, quite: D6's fix is real
but covers a tenth of the defect, and D7's is a change of evidence class rather than a closed
finding. Rather than argue the reader into a number, here is every arithmetic:

| Position                  |  D6 |  D7 | Sum | Mean     |
| ------------------------- | --: | --: | --: | -------- |
| As graded above           |   7 |   8 |  53 | **7.57** |
| Reject D7's increment     |   7 |   7 |  52 | 7.43     |
| Reject D6's increment     |   6 |   8 |  52 | 7.43     |
| Reject both (no movement) |   6 |   7 |  51 | 7.29     |

**7.29 is the floor and it is the honest fallback.** The previous wave's 7.3 stands if a
reviewer disallows both. Nothing in waves 1–3 depends on this paragraph.

The target set for this wave was **8.5**. It is not reached, and §13 states why it is not
reachable by an agent rather than treating it as remaining work.

---

## 3. Launch verdict

**2 — Ready for production with minor improvements.** Revised from **3 — needs work**, which
was the verdict against `a2d77494`.

The original verdict rested on two things: a cross-package write that could bill a family for
a bed they were never assigned, and denials on mutating routes leaving no audit trail. Both
are closed on this branch, both are tested, and both have an arm that fails when the fix is
reverted — reinstating the old invoice ordering produces two invoices where one is correct,
and the denial rules are asserted directly rather than inferred from a passing boot.

That is what moves the verdict, and it is worth being precise about what it does _not_ mean.
One adoption item remains and it is real: **113 list reads still render "you may not see
this" as an empty table** (down from 126 — the `hostel` domain now says so properly). The
English-only error copy that used to sit alongside it is closed. This cannot lose or corrupt
data, it is not a disclosure, and it does not block a release — but a teacher denied access to
a roster is still told it is empty on most of the product. "Minor improvements" is accurate only if
they are scheduled. If they are dropped, the honest verdict reverts to 3.

The confidence limits in §0 still apply and still bound this verdict: no live deployment, no
real tenant data, no load, no assistive technology, no browser other than Chromium.

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
`list-result.drift.test.ts` pinned `BASELINE = 126` — 126 reads rendered a 401/403/404
as an empty table. `EmptyState` is used by 22 files and has no concept of a reason.

**As of wave 4:** the ratchet is `BASELINE = 113`. The `hostel` domain's 13 reads and 9 pages
are converted, so `ListLoadFailure` now renders on 11 pages rather than two. The other 113
reads across 23 modules are unchanged — see §13.1 and §13.3.

**ISSUES FOUND:** V15-6 (Critical → fixed), V15-10 adoption gap (Major, now partial), no offline
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
- **D7 (8/10):** `role="alert" aria-live="assertive"` on `RouteErrorPanel`,
  `PageErrorBoundary`; deliberate `role="status"` on `ListLoadFailure` with a written
  rationale (an assertive region during page load interrupts a screen-reader user). As of
  wave 4 these are **executed, not just read**: `error-surfaces.a11y.test.tsx` runs axe over
  all four failure kinds plus the dense retry/reference and sign-in variants, and asserts the
  two live-region choices directly. The panels are scanned inside `<main><h1>` because
  `heading-order` only fires once the page heading is present — scanning them bare would have
  hidden the likeliest violation. **Still not verified with an actual screen reader**, and
  component-level scanning sees no tenant CSS and no real contrast.
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

**STATUS:** Fail → Partial **SEVERITY:** Major

**EXPECTED:** "you do not have access", distinct from "there are no records".
**ACTUAL:** correct across the whole `hostel` domain (11 pages) as of wave 4; **113 other reads
still render an empty table.** The capability was already built and proven — this is an adoption
gap, tracked as V15-10. A tenth of it is closed, with a ratchet to stop it regrowing.

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

**Twenty-one findings: 17 closed, 2 partial, 2 open**, across four waves. Every `FIXED` row
has a test that fails when the fix is reverted; that is the bar for the word, not "the code
changed".

Two corrections to earlier revisions of this table, recorded rather than silently applied:
it previously said "twenty findings … sixteen closed, three open", which was a miscount (the
rows total 21), and it left **V15-17 marked `OPEN` after wave 3 had closed it** — `routeState`
carries 15 keys in all nine catalogues, verified by counting them, so the D4 row in §2 and
this table contradicted each other. The row is now `FIXED`. A register that disagrees with its
own score table is the kind of thing that turns into a false completion claim later.

| ID     | Pri | Sev      | Issue                                                 | Where                        | Root cause | Status                                                      |
| ------ | --- | -------- | ----------------------------------------------------- | ---------------------------- | ---------- | ----------------------------------------------------------- |
| V15-4  | P0  | Critical | `AppError` at 500 bypassed the 500 mask               | `error-handler.ts`           | Backend    | **FIXED**                                                   |
| V15-1  | P1  | Critical | P2002 disclosed unique-index columns                  | `error-handler.ts`           | Backend    | **FIXED**                                                   |
| V15-2  | P1  | Critical | P2003 disclosed the FK constraint identifier          | `error-handler.ts`           | Backend    | **FIXED**                                                   |
| V15-3  | P2  | Major    | P2025 returned Prisma-generated prose                 | `error-handler.ts`           | Backend    | **FIXED**                                                   |
| V15-5  | P1  | Critical | Anonymous health endpoints published probe text       | `health.ts`                  | Backend    | **FIXED**                                                   |
| V15-6  | P1  | Critical | 12 pages had no error boundary                        | `app/(public,student,…)`     | Frontend   | **FIXED**                                                   |
| V15-7  | P1  | Critical | No request deadline in either client                  | `lib/api/*.ts`               | Frontend   | **FIXED**                                                   |
| V15-9  | P1  | Critical | Non-atomic write billed for an unassigned bed         | `hostel-service.ts`          | Data       | **FIXED** — ordering; full atomicity still open             |
| V15-15 | P1  | Major    | Denied mutations left no audit row                    | `app.ts`                     | Security   | **FIXED** — 401 unauditable by design                       |
| V15-11 | P1  | Major    | No client-side 401 handler                            | `browser-gateway.ts`         | Frontend   | **FIXED** — typed event; shell subscriber open              |
| V15-19 | P2  | Minor    | 41 wire codes against a 10-entry registry             | repo-wide                    | Process    | **FIXED** — all 41 registered, CI gate added                |
| V15-12 | P2  | Minor    | Client ignored `Retry-After` on 429                   | `lib/api/*.ts`               | Frontend   | **FIXED**                                                   |
| V15-13 | P2  | Minor    | No 413 handling                                       | `lib/api/*.ts`               | Frontend   | **FIXED**                                                   |
| V15-18 | P2  | Minor    | Raw `error.message` shown to every user               | `PageErrorBoundary.tsx`      | Frontend   | **FIXED**                                                   |
| V15-20 | P2  | Minor    | No request id a user could quote                      | envelope + UI                | Ops        | **FIXED**                                                   |
| V15-21 | P2  | Minor    | Failed load offered no retry control                  | `list-load-failure.tsx`      | UX         | **FIXED**                                                   |
| V15-17 | P2  | Minor    | Error copy English-only on localised routes           | `route-error`, `list-load-…` | Content    | **FIXED** — `routeState`, 15 keys × 9 locales               |
| V15-8  | P1  | Minor    | No socket timeouts; handler preemption still absent   | `app.ts`                     | Backend    | PARTIAL — needs a per-route budget ruling                   |
| V15-10 | P1  | Major    | Denied-vs-empty reaches 2 of ~24 lists (baseline 126) | 113 call sites remain        | Frontend   | PARTIAL — `hostel` done (126 → 113); largest remaining item |
| V15-14 | P2  | Minor    | Offline indicator never rendered                      | `MobileShell.tsx:236`        | Frontend   | OPEN — attempted and reverted, see below                    |
| V15-16 | P2  | Minor    | Post-hoc audit for all but two path prefixes          | `mutation-audit.ts`          | Data       | OPEN — untouched                                            |

### V15-14 — attempted, reverted, and why that is the right call

Rendering `<ConnectivityIndicator>` in the shells needs `ConnectivityProvider` _and_
`NextIntlClientProvider`, neither of which the shell tests mount. Making the indicator
provider-tolerant — the version I tried — invalidated the mocking strategy of its own test
file and broke **26 existing tests** across three files.

Changing a provider contract and rewriting two dozen tests is disproportionate for a P2
Minor, and doing it under time pressure is how a cosmetic fix becomes an outage: the first
version of my change made a missing provider able to unmount the entire shell, which is a
worse failure than showing no indicator. Reverted, with the requirement recorded: either the
shell tests gain provider wrappers, or the indicator gets a tolerant variant _and_ its test
file migrates off mocking the strict hook.

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

**Verdict: ready for production with minor improvements** (was: needs work before
production). Composite **7.6 / 10** (7.57), up from 5.4 — with **7.29 as the floor** if a
reviewer rejects both contestable increments in §2. The requested 8.5 is not reached and §13
explains why it is not reachable by an agent.

**Must fix before launch:** nothing outstanding. The two items that previously blocked —
V15-9 and V15-15 — are closed and each has a reverting arm.

**Should fix soon after launch:** V15-10 (the remaining 113 collapsing list reads — `hostel`
is done and is the worked example), V15-8 (handler-duration budget, once a per-route figure is
agreed).

**Can fix later:** V15-14, V15-16.

**Out of scope, found while validating, not fixed here:**
`apps/web/src/providers/ThemeProvider.tsx:169` calls `useBrand()` inside a `try/catch`, which
eslint reports as `react-hooks/rules-of-hooks` — a hard error, byte-identical to the base
commit, and the same conditional-hook pattern eslint rejected in this branch's own
`useSafeRouteStateTranslations` (fixed properly there). CI lints only the files in a change
range, so it is invisible on any PR that does not touch that file. It belongs on its own
branch; it is recorded here so it is not lost.

**Assessment.** This codebase did the hard parts well and had not looked at the easy parts.
Two waves later the failure path is closed where it mattered: nothing discloses schema or
infrastructure, every error body is attributable, a refused mutation is recorded, a request
cannot hang forever, no route group is without a boundary, the one path that could bill for
nothing no longer can, and the published error contract matches what the wire carries and is
gated so it cannot drift back. What remains is adoption work on patterns that already exist
and already work.

---

## 13. Why 8.5 is not reachable, and the two contestable increments

The target set for this wave was **8.5**. Reaching it would need a mean of 59.5/7, i.e. roughly
three dimensions at 9 and none below 8. That is not a matter of more effort:

| To reach 8.5, this must happen | Why an agent cannot do it                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D5 → 9                         | Needs handler-duration timeouts (V15-8 full) and idempotency covering DELETE. Both change the request contract for every existing client; that is a product decision.           |
| D9 → 9                         | Needs cross-package write atomicity. The bed-release and invoice-credit semantics are domain rulings — whether a released bed is billable, whether an invoice voids or credits. |
| D10 → 9                        | Needs 401 to be auditable. `audit_events` is tenant-scoped under RLS and a 401 has no principal, so there is no tenant to write. Changing that is a schema and policy decision. |
| D7 → 9                         | Needs a real assistive-technology pass. No agent can operate a screen reader and report what a user heard.                                                                      |

**So the reachable ceiling for this branch is the high 7s.** Claiming 8.5 would mean scoring
dimensions on intent rather than evidence, which is the failure mode this audit exists to
catch. The two increments taken this wave are argued below, both of them honestly weaker than
waves 1–3.

### 13.1 D6, 6 → 7: a tenth of the defect, but the pattern and the ratchet now exist

What landed: the `hostel` domain converted end to end — 13 data functions from `T[]` to
`ListResult<T>`, all 9 pages updated to render the failure rather than an empty table, and
`BASELINE` in `list-result.drift.test.ts` lowered 126 → 113 in the same commit.
`denied-not-empty.test.ts` pins it, with a negative control that names `mess/page.tsx` when the
pattern is reverted.

**The case against 7:** 13 of 126 is ~10%. 113 reads across 23 modules still show a denied list
as an empty one, so for most of the product the defect this finding describes is fully present.

**The case for 7:** what changed is not only the 13. Before this wave there was no worked
example, no enforcement, and no proof the conversion was even tractable — the earlier estimate
of "~175 call sites" was a projection. Now one domain is done, the per-screen decision is
demonstrated, and the ratchet makes regression a test failure rather than a review catch. That
is a different state from zero, but it is one point, not two.

**Recorded honestly:** V15-10 is `PARTIAL` in the tracker, not closed. The remaining 113 are
enumerated in §13.3 by module so the next branch starts from a count, not a re-survey.

### 13.2 D7, 7 → 8: revising the bar this document set earlier

An earlier revision of this section said D7 → 8 "requires a screen-reader pass" and marked it
**cannot be done by this audit**. That was wrong in one specific way, and it is corrected here
rather than quietly dropped: it conflated the bar for 8 with the bar for 9.

The 7 was awarded for `role`, `aria-live` and heading levels **read in source**. The objection
recorded at the time was precise — "scoring it 8 from source reading would be exactly the kind
of claim this audit was written to catch." Wave 4 does not score 8 from source reading. axe
executes against the rendered DOM of all six error-surface variants, and the matcher is proven
to fail: injecting a skipped heading level and an unnamed button produces `heading-order` and
`button-name` failures by name.

**What is still not established, and why this is 8 and not 9:** axe covers a minority of WCAG
criteria and cannot judge whether a screen-reader user actually _learns the list was denied
rather than empty_. That was the observation named earlier, it remains an observation, and it
is now correctly filed as the path to 9. Component-level rendering also has no tenant CSS, so
this contributes nothing to contrast evidence.

**A reviewer may reasonably hold D7 at 7** on the grounds that the finding was never open —
the wiring was already correct, so this wave added verification rather than fixing a defect.
§2 gives that arithmetic (7.43).

### 13.3 What the next branch inherits

`BASELINE = 113`, distributed as: `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9),
`staff.ts` (9), `health.ts` (8), `parent-portal.ts` (8), `lib/transport/api.ts` (8),
`library.ts` (7), `institutions.ts` (6), and the remainder spread across 14 further modules.

A codemod over all 23 at once was attempted during this wave and **abandoned**: it produced 411
call-site type errors, and two silent corruptions worth knowing about before anyone retries it
— it retyped a neighbouring signature in `fees.ts:205` and left dangling `result` references in
`students.ts`. The 18 partially-converted modules were reverted so the branch stays green. The
domain-at-a-time shape below is the one that worked.

### Why V15-10 was not completed in one pass, in detail

Measured precisely rather than estimated: the collapsing reads are **not** spread through
pages. They were 126 functions in **24 modules under `src/lib/api/`**, led by `hostel.ts` (13,
now converted), `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9) and `staff.ts` (9). Each is
the same shape — `gatewayFetch(..., { throwOnError: false })` followed by `?? []`.

Converting one means changing its return type from `T[]` to `ListResult<T>` and updating every
caller to handle `ok: false`. The `hostel` pass measured this for real rather than sampling it:
13 functions and 9 pages, and the per-screen decision — what this particular table should say
when the read was denied — was the slow part, not the type change. Scaling that observed ratio
to the remaining 113 gives roughly 113 signature changes and 130–180 call sites.

There is a much cheaper way to make the number go down, and it must be named so nobody reaches
for it later: convert the data functions and wrap every call site in `itemsOrEmpty(...)`. The
ratchet would fall to near zero and **not one user-visible behaviour would change** — the
collapse would simply have moved from the data layer to the page. That is gaming the metric
this audit exists to defend, and it would make the tracker say `FULLY_CLOSED` about a defect
still fully present.

One counter artefact worth recording for whoever does the work: `getLibraryItem` is counted
although it is a single-object read returning `null`. The counter's eight-line window catches
the `?? []` belonging to the next function. Expect a handful of similar false positives, so the
true figure is slightly under 113 — and the ratchet should not be lowered for those without
also fixing the counter, or the next person inherits a number nobody can reproduce.

**Recommended shape for that branch:** one domain per commit, data functions and their pages
together, `BASELINE` lowered in the same commit, and a test per converted domain showing a
denial rendering as a denial. That is what `hostel` did and it was reviewable. The single
all-modules codemod was tried and abandoned — see §13.3.

---

**Stated plainly:** **7.57 is what this wave's evidence supports, and 7.29 is the floor if both
contestable increments are rejected.** 8.5 was the number asked for; it is not available to an
agent, because D5, D9 and D10 need product and domain decisions and D7 → 9 needs a human with a
screen reader. The honest remaining work is unglamorous and specific: 113 list reads that still
tell a user a table is empty when they were actually denied.
