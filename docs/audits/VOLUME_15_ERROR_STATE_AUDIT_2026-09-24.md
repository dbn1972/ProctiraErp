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

**Composite score: 7.7 / 10** (7.71) after five remediation waves, up from **5.4** as first
graded. It is the unrounded mean of the seven dimensions scored; the arithmetic is in §2.

**All 21 findings are now addressed: 18 closed, 3 partial, none untouched.** Wave 5 closed
V15-14, closed most of V15-16, and converted a second V15-10 domain.

**The contestable increments and the floor are stated so nobody has to take the headline on
trust.** The two points a reviewer is most likely to dispute are D6's (awarded across waves 4
and 5 while 107 of 126 collapsing reads remain) and D7's (awarded for automated checks rather
than the assistive-technology pass §13 originally named as the bar). Rejecting either gives
**7.57**; rejecting both wave-5 points gives 7.43; rejecting every D6/D7 point from both waves
gives **7.29**. §2 has the full table and §13 argues each one.

**The requested target was 8.5. It is not reached and cannot be by this audit** — three of
the four remaining dimensions need decisions or observations outside an agent's reach. §13
names each one.

**Launch recommendation: ready for production with minor improvements**, conditional on the
remaining adoption item in §13 being scheduled rather than dropped. The two findings that
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

| Dimension                                  | Before | Now | Severity now | What moved it, or why it did not                                                                                                                                                                                                                                                  |
| ------------------------------------------ | -----: | --: | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D4 Content & messaging (errors)            |      6 |   8 | Minor        | V15-17 closed: a `routeState` namespace in all nine catalogues, key-set parity verified, and a test asserting the four failure kinds stay distinct when translated. Not 9: per-screen copy outside the shared panels was never surveyed.                                          |
| D5 Error handling & recovery               |      6 |   8 | Minor        | 13 of the prompt's 14 required failure states now have a named code, a surface and a test. Not 9: handler-duration timeout is still open (V15-8), and idempotency remains client-opt-in with DELETE excluded.                                                                     |
| D6 Loading / empty / edge states           |      5 |   8 | Minor        | Wave 5 closed the _other_ D6 gap: **V15-14 is fixed**, so the connectivity state is visible in both shells instead of being a built-but-unmounted widget. `library` joins `hostel` as a converted domain (ratchet 126 → 107). Not 9: 107 reads still collapse. Argued in §13.1.   |
| D7 Accessibility (error surfaces)          |      7 |   8 | Minor        | **Revises §13's earlier bar — argued in §13.2.** axe now executes over all six error-surface variants with a negative control that fails on `heading-order`/`button-name`. Evidence class moved from source-reading to executed. Not 9: component-level, no assistive technology. |
| D9 Reliability & data integrity            |      5 |   7 | Minor        | The one proven non-atomic path can no longer bill for an unassigned bed, proved by an arm that reports 2 invoices on the old ordering. Not 8: cross-package atomicity and the post-hoc audit residual remain.                                                                     |
| D10 Security & trust (failure paths)       |      4 |   8 | Minor        | Four reproduced disclosure paths and the anonymous health leak are closed and pinned by tests; 403 denials are audited. Not 9: 401 is unauditable in a tenant-scoped RLS table by design, and stated as such.                                                                     |
| D11 Operational readiness (supportability) |      5 |   7 | Minor        | Every error body now carries `requestId`, including hand-built 401/403; the boundary shows a digest instead of raw internals. Not 8: nothing joins the id a user sees to a trace, and alerting is unchanged.                                                                      |

**Mean now: (8 + 8 + 8 + 8 + 7 + 8 + 7) ÷ 7 = 54 ÷ 7 = 7.71.** Before: 5.4.

### Wave 5 moved one dimension, and it is worth saying what earned nothing

Wave 5 closed V15-14 and most of V15-16, and converted a second V15-10 domain. Only **D6**
moved. Three deliberate non-movements:

- **D5 stays 8.** V15-16 made the `AUDIT_UNAVAILABLE` 503 truthful and not-retryable, which is
  a real error-handling fix. But the stated bar for 9 — handler-duration timeouts (V15-8) and
  idempotency covering DELETE — is untouched, and a score is against the bar, not the delta.
- **D10 stays 8.** The post-hoc mutation-audit residual is now _enumerated and gated_ rather
  than described in prose. Nothing became atomic. A governance improvement is not a security
  fix, and 166 of 170 security-sensitive mutating routes still audit after the write commits.
- **D11 stays 7.** The 503 was the last error body without a `requestId`, so that thread is
  finished — but the blocker recorded for 8 was joining the id a user quotes to a trace, plus
  alerting. Both unchanged.

**And two of V15-16's three defects were mine.** The registry's `retryable: true` and the test
that pinned it were both added by this audit in wave 3. Correcting an error introduced during
remediation restores the baseline; it does not advance past it, and it is not scored as though
it did.

### The two contestable increments, and the floor

Both of this wave's movements are weaker than the ones in earlier waves, where every point
came with a test that failed when the fix was reverted. These do not, quite: D6's fix is real
but covers a tenth of the defect, and D7's is a change of evidence class rather than a closed
finding. Rather than argue the reader into a number, here is every arithmetic:

| Position                          |  D6 |  D7 | Sum | Mean     |
| --------------------------------- | --: | --: | --: | -------- |
| As graded above                   |   8 |   8 |  54 | **7.71** |
| Reject D7's increment             |   8 |   7 |  53 | 7.57     |
| Reject D6's wave-5 point          |   7 |   8 |  53 | 7.57     |
| Reject both wave-5 points         |   7 |   7 |  52 | 7.43     |
| Reject every wave-4/5 D6+D7 point |   6 |   7 |  51 | 7.29     |

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
One adoption item remains and it is real: **107 list reads still render "you may not see
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

**As of wave 5:** the ratchet is `BASELINE = 107`. `hostel` (13 reads, 9 pages) and `library`
(6 reads, 8 call sites) are converted, so `ListLoadFailure` renders on 17 pages rather than
two, and the parent and student portals report denial through `AcademicFrame`. The other 107
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
**ACTUAL:** correct across the `hostel` and `library` domains as of wave 5; **107 other reads
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

**Twenty-one findings: 18 closed, 3 partial, none untouched**, across five waves. Every
`FIXED` row has a test that fails when the fix is reverted; that is the bar for the word, not
"the code changed".

**V15-16 was re-graded from Minor to Major in wave 5**, because measuring it changed what it
was. Filed as "post-hoc audit for all but two path prefixes", it is really **166 of 170
security-sensitive mutating routes**, and the 503 they produce on an audit failure was telling
callers the opposite of the truth — see §6.1. A P2 Minor was the wrong label for a response
that invited a client to duplicate a committed write.

Two corrections to earlier revisions of this table, recorded rather than silently applied:
it previously said "twenty findings … sixteen closed, three open", which was a miscount (the
rows total 21), and it left **V15-17 marked `OPEN` after wave 3 had closed it** — `routeState`
carries 15 keys in all nine catalogues, verified by counting them, so the D4 row in §2 and
this table contradicted each other. The row is now `FIXED`. A register that disagrees with its
own score table is the kind of thing that turns into a false completion claim later.

| ID     | Pri | Sev      | Issue                                                                    | Where                           | Root cause | Status                                                                  |
| ------ | --- | -------- | ------------------------------------------------------------------------ | ------------------------------- | ---------- | ----------------------------------------------------------------------- |
| V15-4  | P0  | Critical | `AppError` at 500 bypassed the 500 mask                                  | `error-handler.ts`              | Backend    | **FIXED**                                                               |
| V15-1  | P1  | Critical | P2002 disclosed unique-index columns                                     | `error-handler.ts`              | Backend    | **FIXED**                                                               |
| V15-2  | P1  | Critical | P2003 disclosed the FK constraint identifier                             | `error-handler.ts`              | Backend    | **FIXED**                                                               |
| V15-3  | P2  | Major    | P2025 returned Prisma-generated prose                                    | `error-handler.ts`              | Backend    | **FIXED**                                                               |
| V15-5  | P1  | Critical | Anonymous health endpoints published probe text                          | `health.ts`                     | Backend    | **FIXED**                                                               |
| V15-6  | P1  | Critical | 12 pages had no error boundary                                           | `app/(public,student,…)`        | Frontend   | **FIXED**                                                               |
| V15-7  | P1  | Critical | No request deadline in either client                                     | `lib/api/*.ts`                  | Frontend   | **FIXED**                                                               |
| V15-9  | P1  | Critical | Non-atomic write billed for an unassigned bed                            | `hostel-service.ts`             | Data       | **FIXED** — ordering; full atomicity still open                         |
| V15-15 | P1  | Major    | Denied mutations left no audit row                                       | `app.ts`                        | Security   | **FIXED** — 401 unauditable by design                                   |
| V15-11 | P1  | Major    | No client-side 401 handler                                               | `browser-gateway.ts`            | Frontend   | **FIXED** — typed event; shell subscriber open                          |
| V15-19 | P2  | Minor    | 41 wire codes against a 10-entry registry                                | repo-wide                       | Process    | **FIXED** — all 41 registered, CI gate added                            |
| V15-12 | P2  | Minor    | Client ignored `Retry-After` on 429                                      | `lib/api/*.ts`                  | Frontend   | **FIXED**                                                               |
| V15-13 | P2  | Minor    | No 413 handling                                                          | `lib/api/*.ts`                  | Frontend   | **FIXED**                                                               |
| V15-18 | P2  | Minor    | Raw `error.message` shown to every user                                  | `PageErrorBoundary.tsx`         | Frontend   | **FIXED**                                                               |
| V15-20 | P2  | Minor    | No request id a user could quote                                         | envelope + UI                   | Ops        | **FIXED**                                                               |
| V15-21 | P2  | Minor    | Failed load offered no retry control                                     | `list-load-failure.tsx`         | UX         | **FIXED**                                                               |
| V15-17 | P2  | Minor    | Error copy English-only on localised routes                              | `route-error`, `list-load-…`    | Content    | **FIXED** — `routeState`, 15 keys × 9 locales                           |
| V15-8  | P1  | Minor    | No socket timeouts; handler preemption still absent                      | `app.ts`                        | Backend    | PARTIAL — needs a per-route budget ruling                               |
| V15-10 | P1  | Major    | Denied-vs-empty reaches 2 of ~24 lists (baseline 126)                    | 107 call sites remain           | Frontend   | PARTIAL — `hostel` + `library` done (126 → 107); largest remaining item |
| V15-14 | P2  | Minor    | Offline indicator never rendered                                         | `MobileShell.tsx`, `header.tsx` | Frontend   | **FIXED** — mounted in both shells; wave-4 revert explained below       |
| V15-16 | P2  | Major    | Post-hoc audit for all but two path prefixes; the 503 it produced misled | `mutation-audit.ts`, registry   | Data       | PARTIAL — 503 truthful + residual gated (166/170 still post-hoc)        |

### 6.1 V15-16 — what measuring it changed

Filed from source reading as "post-hoc audit for all but two path prefixes", P2 Minor.
Enumerating `app.mutatingRouteAuthzRegistry.getRegistered()` gives the real shape:

|                                                                 |   count |
| --------------------------------------------------------------- | ------: |
| registered mutating routes                                      |     451 |
| subject to mutation audit                                       |     447 |
| **security-sensitive** (PHI, money, custody, privacy, identity) | **170** |
| of those, audited atomically                                    |   **4** |
| of those, audited _after_ the write commits                     | **166** |

The four atomic routes are the `health/measurements` trio and `fees/payments`.
`SEC_W1_SEC_10_COMPLETE.md` listed the residual as "allergies, privacy, billing, student,
scholarship, …" — the ellipsis was carrying almost the whole finding.

**Three defects on the response this produces.** `AUDIT_UNAVAILABLE` is emitted _only_ by the
post-hoc hook, which runs after the handler committed, so it always means "your write landed
and we could not record it". All three made it say something else:

1. **No `requestId`.** Reproduced before fixing. The `onSend` hook that stamps every other
   error envelope is registered at `app.ts:222`; the audit hook is at `app.ts:838`. Fastify
   runs `onSend` in registration order, so the stamping hook had already run — and seen a
   2xx — when this body was built. It went out bare, on the one response where a user must
   ask whether their payment saved.
2. **The message claimed rejection.** "Refusing to acknowledge security-sensitive mutation"
   reads as "nothing was applied".
3. **The published contract said `retryable: true`.** `plugins/api-contract.ts` serves
   `ERROR_CODE_REGISTRY` to clients, so it instructed integrators to repeat a write that had
   already succeeded.

**(2) and (3) were introduced by this audit in wave 3**, along with the test that pinned (3).
That test had grouped `AUDIT_UNAVAILABLE` with `CIRCUIT_OPEN` because both are 503 — but
`CIRCUIT_OPEN` is raised _before_ anything is attempted. Status code alone does not decide
retryability; who committed what does. The mirror image is worth keeping in view: treating
`IDEMPOTENCY_REPLAY_PENDING` as terminal **drops** a mutation, treating `AUDIT_UNAVAILABLE` as
retryable **duplicates** one.

**What is fixed, and what is not.** The 503 is truthful, carries a request id, and sends no
`Retry-After`. The residual is now enumerated in `POST_HOC_MUTATION_AUDIT_WAIVERS` (15
prefixes with reasons and counts) and gated: a security-sensitive mutating route that is
neither atomic nor waived fails the build, and a waiver that matches no route or whose count
drifts also fails. **Nothing became atomic.** That is per-handler transaction work across the
gateway and it stays `PARTIAL`.

### 6.2 V15-14 — closed in wave 5, after being reverted in wave 3

The widget was built, tested and localised in task 54.3 and mounted by exactly one screen
(`SchoolDashboard`). The desktop header had nothing; the mobile header had an `aria-hidden`
grey dot that never changed colour.

The wave-3 attempt made `useConnectivity` provider-tolerant, broke 26 tests, and in its first
form let a missing provider unmount the whole shell. It was also **solving the wrong problem**:
the root layout already mounts `LanguageProvider` and then `AppProviders` →
`ConnectivityProvider`, so both providers are in scope on every App Router route. The strict
hook was never the obstacle — the shell _tests_ mounted less than production does.

So wave 5 fixed the harness instead: `renderShell` wraps the real providers, and
`useConnectivity` stays strict because throwing outside its provider is correct behaviour.

**A test had been pinning the absence.** `MobileShell.test.tsx` asserted the _placeholder_
existed, so it passed for exactly as long as the feature was missing. That is worth naming as
a class: a test can hold a to-do in place as if it were a contract.

### V15-14 — the wave-3 attempt, kept for the reasoning

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
production). Composite **7.7 / 10** (7.71), up from 5.4 — with **7.29 as the floor** if a
reviewer rejects every contestable D6/D7 point in §2. The requested 8.5 is not reached and §13
explains why it is not reachable by an agent.

**All 21 findings are addressed: 18 closed, 3 partial, none untouched.**

**Must fix before launch:** nothing outstanding. The two items that previously blocked —
V15-9 and V15-15 — are closed and each has a reverting arm.

**Should fix soon after launch:** V15-10 (the remaining 107 collapsing list reads — `hostel`
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
catch. The D6 and D7 increments are argued below, both honestly weaker than waves 1–3.

### 13.1 D6, 5 → 8 across waves 4 and 5 — the most contestable line on the table

What landed, in order:

- **Wave 4:** `hostel` converted end to end — 13 data functions from `T[]` to `ListResult<T>`,
  all 9 pages rendering the failure rather than an empty table, `BASELINE` 126 → 113 in the
  same commit, pinned by `denied-not-empty.test.ts` with an arm that names `mess/page.tsx`.
- **Wave 5:** `library` converted — 6 functions, 8 call sites, `BASELINE` 113 → 107, plus its
  own 11-test suite. And **V15-14 closed**, which was the other named D6 gap.

**The case against the point:** 19 of 126 is ~15%. 107 reads across 22 modules still show a
denied list as an empty one, so for most of the product this defect is fully present. A
reviewer may reasonably say a dimension cannot reach 8 with its largest finding 85% open, and
§2 gives that arithmetic.

**The case for 8:** D6 covers loading, empty, success _and edge_ states, not only this one
finding. The root and global error boundaries closed 12 uncovered pages; a retry control
landed; the connectivity edge state is now actually rendered rather than being a built widget
nobody mounted. On the denied-vs-empty finding specifically, what changed is not only the 19:
there was no worked example, no enforcement, and no proof the conversion was tractable — the
"~175 call sites" figure was a projection. Two domains are now done, the per-screen judgement
is demonstrated twice (including a portal that needed a different panel), and the ratchet makes
regression a test failure rather than a review catch.

**Recorded honestly:** V15-10 is `PARTIAL` in the tracker, not closed. The remaining 107 are
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

`BASELINE = 107`, distributed as: `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9),
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
to the remaining 107 gives roughly 107 signature changes and 120–170 call sites.

There is a much cheaper way to make the number go down, and it must be named so nobody reaches
for it later: convert the data functions and wrap every call site in `itemsOrEmpty(...)`. The
ratchet would fall to near zero and **not one user-visible behaviour would change** — the
collapse would simply have moved from the data layer to the page. That is gaming the metric
this audit exists to defend, and it would make the tracker say `FULLY_CLOSED` about a defect
still fully present.

One counter artefact worth recording for whoever does the work: `getLibraryItem` is counted
although it is a single-object read returning `null`. The counter's eight-line window catches
the `?? []` belonging to the next function. Expect a handful of similar false positives, so the
true figure is slightly under 107 — and the ratchet should not be lowered for those without
also fixing the counter, or the next person inherits a number nobody can reproduce.

**Recommended shape for that branch:** one domain per commit, data functions and their pages
together, `BASELINE` lowered in the same commit, and a test per converted domain showing a
denial rendering as a denial. That is what `hostel` did and it was reviewable. The single
all-modules codemod was tried and abandoned — see §13.3.

---

**Stated plainly:** **7.71 is what the evidence supports, and 7.29 is the floor if every
contestable D6/D7 point is rejected.** 8.5 was the number asked for; it is not available to an
agent, because D5, D9 and D10 need product and domain decisions and D7 → 9 needs a human with a
screen reader. The honest remaining work is unglamorous and specific: 107 list reads that still
tell a user a table is empty when they were actually denied.
