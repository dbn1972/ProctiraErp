# Charter gap tasks — tracking file

Single tracker for the gaps found by grading `main` against the five specification
volumes in `docs/multitenant/`. Findings and evidence live in:

- `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`
- `CHARTER_CONFORMANCE_VOL3_VOL4_VOL5_2026-09-21.md`
- `VOLUME_15_ERROR_STATE_AUDIT_2026-09-24.md` (Volume 15 — error / failure / edge states)
- `TASKLIST_GAP_CLOSURE_2026-09-21.md` (pre-existing T-items)

**Baseline tip:** `main` = `12705129` for the V1–V5 items; `a2d77494` for the V15-\* items.

## Working rules

One gap, one branch, one PR, reviewed and merged before the next is started. Update
the Status and PR columns in the same PR that does the work, so this file never
claims something the branch has not delivered.

Status vocabulary: `OPEN` · `IN PROGRESS` · `PARTIAL` · `FULLY_CLOSED` ·
`BLOCKED` · `NEEDS DECISION` · `EXTERNALLY_UNVERIFIED`

A gap moves to `FULLY_CLOSED` only with executable evidence — a command, a named
test, or an observed runtime behaviour. Not "looks right".

## Agent-fixable, unblocked

Ordered by leverage, not by size.

| ID     | Gap                                                 | Spec                        | Status         | Branch                               | PR   |
| ------ | --------------------------------------------------- | --------------------------- | -------------- | ------------------------------------ | ---- |
| V15-A  | Failure responses disclosed schema + infrastructure | V15 D10; V5 §3              | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-B  | No error body a user could quote; no request id     | V15 D5 D11                  | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-C  | Timeout was not a state — no deadline either side   | V15 D5                      | `PARTIAL`      | fix/V15-error-state-audit            | TBD  |
| V15-D  | 12 pages had no error boundary at all               | V15 D5 D6                   | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-9  | Non-atomic cross-package write bills for nothing    | V15 D9                      | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-15 | Denied mutations left no audit row                  | V15 D10; V5 §6              | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-17 | Error copy English-only on localised routes         | V15 D4                      | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V15-10 | Denied-vs-empty: 113 of 126 reads still collapse    | V15 D6                      | `PARTIAL`      | fix/V15-error-state-audit            | TBD  |
| V15-11 | Client 401 handling; shell subscriber still open    | V15 D5                      | `PARTIAL`      | fix/V15-error-state-audit            | TBD  |
| V15-19 | 41 wire codes against a 10-entry registry           | V15 D5; V4 §6               | `FULLY_CLOSED` | fix/V15-error-state-audit            | TBD  |
| V10    | 9 defects behind Table 2; 1a partial, 8 open        | V5 §6; V3 §12; V4 §4 §8 §11 | `PARTIAL`      | fix/V10-outbox-failed-requeue        | #365 |
| V9     | Error envelope inconsistent (`retryable` in 1 file) | V4 §6                       | `OPEN`         | —                                    | —    |
| V3     | MySQL offered but cannot work                       | V1 §17.1 §14.4 §33.3; V2 T6 | `FULLY_CLOSED` | fix/V3-postgres-only-install         | #363 |
| V8     | No first-party SDK                                  | V4 §9; V1 §22.2             | `OPEN`         | —                                    | —    |
| V5     | Hardcoded UI copy, 8 of 9 fees pages                | V1 §11.5 §46                | `OPEN`         | —                                    | —    |
| V6     | No email/notification delivery adapter              | V2 T6; V3 T3                | `OPEN`         | —                                    | —    |
| T6     | `VALIDATE CONSTRAINT` under FORCE RLS needs a gate  | —                           | `FULLY_CLOSED` | fix/T6-validate-under-force-rls-gate | #362 |
| T4     | Zero statutory/interop implementation               | —                           | `OPEN`         | —                                    | —    |

### T11 — WITHDRAWN, not a defect

**Status:** `NOT_A_DEFECT`. This was my error and is retracted.

I reported that `db/sql` could not be applied to an empty database, having seen the
chain halt at `065_tenant_timezone_foundation.sql`. The cause was that I skipped
`prisma migrate deploy`. `db/README.md:28` mandates the order **Prisma →
apply-sql.sh**, and CI performs exactly that.

Tested on a clean database following the documented order:

```
prisma migrate deploy   -> All migrations have been successfully applied
apply-sql.sh            -> Domain SQL apply complete (applied=111) , 0 errors
```

`065` is a no-op on the supported path. Prisma creates `tenants.timezone` as
`is_nullable=NO DEFAULT 'UTC'`, so its `ADD COLUMN IF NOT EXISTS` skips, no row can
be NULL, and the `SET NOT NULL` is already satisfied. The backfill never needs to see
rows, so the FORCE RLS blindness does not arise here at all.

Confirmed with the fix **disabled**, so the pass is not an artefact of a change.

**What this invalidates.** Anything previously described as "blocked by T11" was not
blocked. The isolation, integrity and resilience items under "cannot be measured yet"
are gated only by T1, and `db/sql` can be applied from empty via the documented path.

**What survives.** The underlying mechanism is still real and independently proved:
a migrator subject to FORCE RLS sees zero rows (`UPDATE 0` versus `UPDATE 1` with a
tenant GUC bound), and a constraint validation scan under it marks a constraint valid
over data it never read — demonstrated with a planted orphan row while fixing 098.
That is T6, which stands on its own evidence and is narrower than T11 claimed.

**Lesson recorded deliberately:** I asserted a migration-chain defect without first
following the repository's own documented apply order, then proposed rewriting the
migration framework to fix it. The check that would have caught this was reading
`db/README.md` before running the chain.

### V10 — CORRECTED THREE TIMES. Rescoped.

**Revision 1: "6 API domains absent". Revision 2: "4 of 6 exist, 2 absent". Revision
3: "zero of nine domains absent". All three were wrong. Revision 4: no domain is
wholly absent, but two are half-served and nine distinct defects sit behind them.**

The reading error underneath both: Volume 4 Table 2's columns are `Domain | Examples`.
It lists **nine domains** and the `/api/v1/...` paths are examples inside them. Grading
the example paths as a route contract produced both errors. This also answers **V10b**
below — Table 2 is a capability list, not a binding route contract, and the header
wording says so.

Revision 2's worst error, found by independent review and confirmed: it declared
`/api/v1/org-units/*` "absent — 0 tables, 0 routes, 0 types" while
`GeographicArea` / `geographic_areas` is a tenant-scoped nested-set hierarchy
(`parentId`, `level`, materialized `path`, `lft`/`rgt`, `institutions`) with a full
`/areas` route module, four test files, and a resolver that
`apps/api-gateway/src/app.ts:767` wires into `rbacPlugin` as `areaResolver`. The org
hierarchy is a live authorization input on every permission check. Revision 2 stated a
lesson about searching for behaviour instead of names, then failed to apply it one
paragraph later.

Revision 2 also **understated** the queue gap by crediting
`GET /api/v1/admin/scalability/queue` as partial. `mount-matrix.ts` records
`admin-dashboard` as `mounted: false, parked: true, 'Plugin exists; not registered on
gateway.'` The queue operator surface is zero, not partial.

### What V10 now tracks

| #   | Defect                                                                       | Kind              | Spec           | Fixable by an agent?                                                |
| --- | ---------------------------------------------------------------------------- | ----------------- | -------------- | ------------------------------------------------------------------- |
| 1a  | Outbox `failed` was terminal — rows permanently unrecoverable                | absent capability | V5 §6          | **`PARTIAL`** (#365) — capability proved; no caller, no audit write |
| 1b  | Broker DLQ (RabbitMQ DLX / SQS / Kafka) has no read or redrive               | absent capability | V5 §6          | Blocked — needs live brokers and an operator surface (V10d)         |
| 2   | Queue operator surface unreachable — `admin-dashboard` parked                | unmounted         | V3 §12, V5 §6  | Needs V10d: unpark, or rebuild under a live package                 |
| 3   | `slo_queue_lag_messages` never `.set()`; no Kafka/RabbitMQ exporter deployed | declared, unwired | V3 §12         | Yes                                                                 |
| 4   | API-key `scopes` stored but enforced nowhere; no gateway API-key auth path   | unenforced        | V4 §4, V5 §3   | Yes, but it is a security surface — needs review                    |
| 5   | `/areas` routes unmounted though `geographic_areas` is RBAC-consumed         | unmounted         | V4 Table 2     | Yes. `institutionPlugin` needs `areaHierarchyDb`.                   |
| 6   | Webhook deliveries have no producer; no event catalog or replay contract     | no producer       | V4 §8          | Partly — the catalog is a design decision                           |
| 7   | Sandbox provisioning is a shell; no non-production credential issued         | shell             | V4 §11         | No — the repo already waived live key mint                          |
| 8   | Plugins is a scaffold: no tables, no importers, parked, `/plugins` ui-seed   | shell             | V4 Table 2, V7 | No — marketplace runtime is deliberately deferred                   |
| 9   | `install` parked with no `install_*` tables — Configuration half-served      | parked            | V4 Table 2     | No — parked for a stated security reason; needs a ruling            |

**Item 1 split into 1a and 1b after implementation.** The original entry conflated two
sinks with different fix costs. 1a — the transactional outbox — was entirely in-repo. 1b —
the brokers' own dead-letter queues — needs a live RabbitMQ/SQS/Kafka to verify against
and somewhere to mount the operator action, so it stays blocked on V10d. Splitting rather
than claiming item 1 closed, because "DLQ redrive exists" would be false.

**1a is `PARTIAL`, not closed.** The recovery capability exists and is proved live, but
nothing calls it: `requeueFailed` and `listFailed` have zero callers repo-wide, there is
no operator route (blocked on V10d), and the hash-chained audit entry is not written. An
unreachable capability does not close a V5 §6 requirement that an operation be _audited_.
An earlier version of this entry said `FULLY_CLOSED` while the conformance report in the
same commit said "partly met" — caught in review, and `PARTIAL` is the consistent reading.

**What was wrong and what the branch delivers.** `OutboxRelay.tick` calls
`markFailed(id, err)` with no `availableAt` once `attempts >= maxAttempts`, which sets
`status='failed'`; `claimPending` reads only `status='pending'`. Nothing moved a row
back, so a permanently failed row was both invisible and unrecoverable while the domain
write it accompanied had already committed.

Closed by `OutboxStore.listFailed` + `requeueFailed` on both the PG and in-memory
stores, with `db/sql/101_outbox_redrive.sql` (a `redrive_history` jsonb audit column)
and `db/sql/102_outbox_failed_index.sql` (partial index, built `CONCURRENTLY`).

Three details that carry the correctness:

- **`attempts` resets to 0.** Not hygiene — `tick` re-fails a row immediately when
  `attempts >= maxAttempts`, so a requeue preserving the exhausted counter would look
  like it worked and change nothing. There is a dedicated regression test, and removing
  the reset makes it fail.
- **`WHERE status = 'failed'`** makes redrive idempotent and stops an operator from
  redriving rows the relay is already going to retry on backoff (those stay `pending`).
- **`redrive_history` is append-only** (`||`, not assignment) and lives in its own
  column rather than `metadata`, because `relay.ts` spreads `metadata` into the
  published `QueueMessage` and would otherwise leak operator audit data to the broker.
  A test asserts the actor name does not appear in the published message.

`actor` and `reason` are required arguments, so a redrive cannot be anonymous. Writing
the redrive into the hash-chained audit trail is left to the caller: a shared package
must not depend on `@proctira/backend-audit`, and there is no mounted operator surface
to call it from yet. **That means V5 §6's "audited" is only partly met — the durable
trail exists on the row, the hash-chained audit entry does not.**

### Claims retracted

- "6 API domains absent" — wrong, zero are.
- "4 of 6 exist, `compliance` and `org-units` absent" — wrong, `org-units` is
  implemented and RBAC-consumed; `compliance` behaviour is mounted under `/privacy`
  and Table 2's row is "Audit and compliance", with `audit` registered.
- "`service-accounts` … Volume 4 §4 and Volume 5 §3 met in substance" — too strong.
  Scopes are stored and echoed, never read for an authorization decision;
  `POST /developer/validate-key` has no consumer anywhere; the gateway has no API-key
  credential path; `schemas.ts:43` types scopes as unconstrained strings.
- "Volume 4 §11's sandbox … served by `.../sandboxes`" — a shell. `createSandbox`
  mints a UUID it calls `tenantId` without creating a tenant, discards `seedData`, and
  `hybrid-repository.ts:180` routes all sandbox calls to in-memory storage.
- "`settings` … behind `/tenants/:id/config`" — wrong path. `tenant-settings.ts` serves
  `/tenant/settings`; `:id/config` is a different module over a different store at
  `/api/v1/tenant-lifecycle/:id/config`.
- "`events` exists" — half right. Subscription by event type does exist, with signing,
  retry and a durable delivery log. But `createDelivery` has no caller outside the
  package and its tests, so nothing produces an event.
- "DLQ/redrive/lag code in `queue-abstraction`" — retracted in revision 2, still
  retracted. Configuration only.
- **Revision 3's own errors, retracted here.** "Themes and plugins — Present": plugins
  is a scaffold (0 tables, 0 external importers, package parked, mounted `/plugins` is
  `persistence: 'ui-seed'` / `'stub/scaffold APIs'`). Now defect 8. The `themes`
  citation was also wrong — it resolved to a hardcoded one-item literal at
  `platform-admin-ui-plugin.ts:394`; the real surface is `/tenant/branding` with
  draft/publish/versions/preview at `tenant-admin-plugin.ts:102`. Same for the `plans`
  citation under "Billing and entitlements", a two-item literal; the real evidence is
  `/api/v1/billing/{plans,subscriptions/*,entitlements/check,usage/*}`.
- **Revision 3 graded only half of Configuration.** Table 2's other example is
  `/api/v1/install/*`, and `install` is parked with no `install_*` tables. Now defect 9.
- Revision 2's "`roles` (34 files, no prefix)" was also wrong — `/tenant/roles`,
  `/tenant/permissions`, `/tenant/users` and `/tenant/users/:userId/roles` exist in
  `roles-routes.ts`, alongside `/scim/v2/{Users,Groups}`. Superseded by the
  "Users, groups, roles" row rather than silently dropped.
- **Revision 3's V7a flag, withdrawn.** I claimed V7's 22-table count came from the same
  name-matching method that got `org-units` wrong. It did not: V7 resolved each name
  individually with `to_regclass`, and its body already separates capability-exists from
  ownership-conformance. The `org-units` finding actually **supports** V7 — Volume 3
  Table 2 assigns `tenant_org_units` to the **tenant** service while `geographic_areas`
  is `institution`-owned, which is exactly V7's and V1's point about ownership. V7a is
  removed from the task table. I also corrected V7's body, which wrongly listed
  `plugins` among the capabilities with working implementations.
- "queue backlog unmet, 0 grep matches" — conclusion right, evidence too narrow. It
  missed `queueLag` in `slo-catalog.ts`, `slo_queue_lag_messages` in `slo.ts`,
  `infra/observability/alerts/queue_lag.yml`, and `ApproximateNumberOfMessages` in
  `sqs-adapter.ts`. Restated as declared-but-unwired.

### One suspected defect tested and refuted

Review flagged that `db/sql/055`'s `tenant_isolation` policy has no
`app.platform_admin` disjunct while `getApiKeyByHash` runs under `withPlatformScope`
with no tenant GUC, which would make `validate-key` return zero rows under FORCE RLS.
It does not. `db/sql/094_developer_portal_api_key_lookup.sql` adds a second permissive
policy `platform_api_key_lookup FOR SELECT USING (app.platform_admin = '1')` that
OR-combines. Proved live as the runtime role `proctira_app`:

```
A  platform_admin=1, no tenant GUC, policy present   -> rows_visible = 1
B  platform_admin cleared, no tenant GUC  (control)  -> rows_visible = 0
C  platform_admin=1, no tenant GUC, policy DROPPED   -> rows_visible = 0
```

B rules out inactive RLS. **C is the attribution arm** — same GUCs as A with the policy
dropped inside the transaction, and the row disappears. Rolled back; policy confirmed
present afterwards.

Two follow-on concerns checked and retired: a database stopped at `055` fails readiness
loudly rather than breaking silently, because `094` is in `schema-readiness.ts`
`PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS`; and the `FOR SELECT` scope breaks no
management path, because every mutating method in `pg-api-key-store.ts` uses
`withPgTenant`.

Worth stating since this is a refutation: `094` does grant tenant-unscoped `SELECT` on a
credential table to any caller setting `app.platform_admin='1'`. That is the minimum for
hash-first authentication, but it widens the blast radius of a mistaken
`withPlatformScope` on this table. Not logged as a defect — it is a documented trade-off
with a stated reason — but a reviewer of defect 4 should know it.

### Knock-on: V7's body corrected, its count upheld

Revision 3 flagged V7 for re-audit. That flag is withdrawn — see the retraction list
above. V7's count stands.

One sentence inside V7 was wrong and is fixed in the conformance report: it listed
`plugins` among the capabilities that "have working implementations". Defect 8 shows it
does not. Everything else in V7 is unchanged.

### Method note

Three revisions, two wrong in opposite directions. What works, in order: read the
specification table's structure before grading rows against it; search for the
_behaviour_ — a nested-set hierarchy, a hashed credential — not the noun; then check
**gateway mount state**, because in this repository a package having routes does not
mean the routes are reachable. `apps/api-gateway/src/mount-matrix.ts` is the authority
and it parks several packages outright.

### V15 — error, failure and edge states

Full evidence in `VOLUME_15_ERROR_STATE_AUDIT_2026-09-24.md`. Graded against `a2d77494`.

The shape of every finding is the same: the mechanism exists and is well built, and the
one branch nobody ran was wrong. A global error handler, a real transaction helper, a
fail-closed idempotency store, an offline queue with correct backoff — and then four
un-gated disclosure paths, an anonymous endpoint publishing hostnames, twelve pages with
no boundary, and no request deadline anywhere.

**V15-A `FULLY_CLOSED`.** Four reproduced disclosure paths, all under production posture
(`includeStackTrace: false`). Prisma `P2002` emitted `"Unique constraint violation on:
tenant_id, admission_number"`, `P2003` emitted the constraint identifier
`student_guardians_student_id_fkey (index)`, `P2025` forwarded Prisma's generated
`meta.cause` naming models and relations, and an `AppError` at 500 emitted its message
verbatim — reproduced as `"connect ECONNREFUSED 10.0.3.14:5432 (database
\"proctira_prod\")"`. The last is the subtle one: that branch runs _before_ the default
500 branch that masks. Separately, `/health` and `/health/ready` are in
`authExcludePaths` (container probes cannot authenticate) and published the raw probe
text, including `host=db-prod-1.internal db=proctira_prod` and the missing relation name.
All five now generic outside development; per-dependency statuses kept because they are
what a probe consumer needs and they name nothing.

**V15-B `FULLY_CLOSED`.** The gateway generated a request id, logged it, and returned it
as a header — and no client read the header, and nothing put it in the body. A user
reporting a failure had nothing to quote. `requestId` is now stamped by an `onSend` hook,
not in the handler: the auth, RBAC, tenant, idempotency and service-router paths never
throw, they build their own envelope and call `reply.send`, and a denial is the failure
users are most likely to report. Narrow by construction — JSON only, envelope-shaped only,
never overwrites, leaves 2xx and the health body alone, fixes content-length.

**V15-C `PARTIAL`.** Neither web client had any deadline and the gateway sets no
`requestTimeout`, so a hung handler produced an indefinite spinner — the one failure a
person cannot act on. The client half is closed with a shared deadline reporting `TIMEOUT`
distinctly from `NETWORK_ERROR`. **The server half is V15-8 and is open**: the budget is a
product decision because report exports are legitimately slow.

**V15-D `FULLY_CLOSED`.** `(public)`, `(student)`, `(marketing)` and `app/legal` shipped a
`layout.tsx` and nothing else, with no root `error.tsx` or `global-error.tsx` above them —
so 12 pages had no boundary and fell to Next's unstyled default with no retry. Those pages
are `/track` (the anonymous admission tracker, used by people with no account), the nine
student-portal routes, and the two legal documents signup asks users to accept.
`route-state-boundaries.test.ts` could not see it: a recursive "at least 8 error.tsx" floor
was satisfied the whole time, because a count cannot say which subtree is uncovered. It now
walks every route group asking whether a boundary exists at or above it, and removing
`app/error.tsx` makes it fail naming `(marketing)`.

#### As first triaged: "open, and why each needs an owner rather than an agent"

**This heading and the four `OPEN` labels below are the wave-1 triage, kept for the reasoning
they record. Three of the four have since been closed** — the per-finding status lines mark
each one. The summary table at the top of this file is authoritative; where it and this section
disagree, the table wins. The original text is preserved rather than rewritten because the
argument for why each looked un-agentable is worth reading against what actually happened: two
of the three were closed by narrowing the fix to something that needed no ruling (ordering
instead of compensation; `metadata.outcome` instead of a new enum value), not by getting the
ruling.

**V15-9 — now `FULLY_CLOSED`** (ordering fix; full cross-package atomicity still open).
As triaged: `hostel-service.ts:63-120` `createAssignment` posts a fee invoice
through a cross-package port and _then_ writes the hostel row — two transactions in two
packages. `createActiveAssignment` can throw `BedAssignmentConflictError` → 409, and when
it does the invoice is already committed: the student is billed for a bed they were never
assigned, and the 409 says nothing about the surviving financial row. Not fixed here
because the remedy is a choice between a compensating reversal, a saga, and moving the
invoice inside the assignment transaction — a finance-behaviour decision.

**V15-15 — now `FULLY_CLOSED`** for 403; 401 is unauditable in a tenant-scoped RLS table by
design and is stated as such. As triaged: `app.ts:819-822` returns early for 401 and 403, so every RBAC
denial, `TENANT_SUSPENDED`, `FEATURE_NOT_ENTITLED` and default-deny rejection on a
mutation leaves only a log line. An insider probing for records they may not see produces
no audit trail. Not fixed here because the volume and the PII shape of a denial audit row
both need a security ruling.

**V15-10 `PARTIAL`, P1.** The denied-vs-empty classifier (`fetchList` + `ListLoadFailure`) is
correct and proved. As found it reached 2 pages against `BASELINE = 126`. Wave 4 converted the
**`hostel` domain end to end** — 13 data functions and 9 pages — lowering the ratchet to
`BASELINE = 113` in the same commit, with `denied-not-empty.test.ts` pinning it and a negative
control that names `mess/page.tsx` when the pattern is reverted.

**113 reads across 23 modules still render a 401/403/404 as an empty table**, so this is
`PARTIAL`, not closed. An adoption gap, not a defect in the pattern.

**V15-19 — now `FULLY_CLOSED`.** 46 registry entries covering all 41 emitted wire codes, plus a
CI gate (`check:error-codes`) and a unit test for the gate itself. As triaged:
`ERROR_CODE_REGISTRY` has 10 entries and one
runtime consumer, which serves it as documentation. Roughly 48-50 distinct wire codes are
emitted outside it, and the single most-emitted code in the codebase — `TENANT_REQUIRED`,
426 occurrences — is not in it. A registry no client can rely on cannot be used to branch.

_Two numbers in that triage were revised by measurement: the scan found **41** distinct wire
codes, not 48–50, and `TENANT_REQUIRED` has **424** emit sites, not 426. The naive grep matched
111 candidates; requiring a sibling `statusCode` within ±4 lines brought it to 41. Recorded
because a gate built on an unreproducible count is a gate nobody can maintain._

#### V15-10 — one domain done, 113 reads remaining

Measured rather than estimated: the collapsing reads are not spread through pages. They were
126 functions in **24 modules under `apps/web/src/lib/api/`** — `hostel.ts` (13, **now
converted**), `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9), `staff.ts` (9) and 19 more —
each the same `gatewayFetch(..., { throwOnError: false })` followed by `?? []`.

**What the `hostel` pass actually cost**, now that it is measured rather than sampled: 13
signature changes and 9 pages. The slow part was not the type change but deciding, per screen,
what that table should say when the read was denied. Scaling the observed ratio to the remaining
113 gives ~113 signatures and 130–180 call sites.

**Remaining distribution:** `examinations.ts` (10), `fees.ts` (10), `lms.ts` (9), `staff.ts`
(9), `health.ts` (8), `parent-portal.ts` (8), `lib/transport/api.ts` (8), `library.ts` (7),
`institutions.ts` (6), and the rest across 14 further modules.

**A codemod across all 23 at once was tried in wave 4 and abandoned.** It produced 411
call-site type errors and two silent corruptions worth knowing before anyone retries it: it
retyped a neighbouring signature in `fees.ts:205`, and left dangling `result` references in
`students.ts`. The 18 partially-converted modules were reverted so the branch stayed green.
One domain at a time is the shape that worked.

**The cheap way must not be taken.** Converting the data functions and wrapping every call
site in `itemsOrEmpty(...)` would drop the ratchet to near zero and change nothing a user
sees — the collapse would merely move from the data layer to the page. That would make this
tracker say `FULLY_CLOSED` about a defect still fully present, which is the failure mode this
audit exists to catch.

Recommended shape: one domain per commit, data functions together with their pages, `BASELINE`
lowered in the same commit, and evidence per converted screen that a denial now renders as a
denial.

One counter artefact for whoever does the work: `getLibraryItem` is counted although it is a
single-object read returning `null` — the counter's eight-line window catches the next
function's `?? []`. Expect a handful of these, so the true figure is slightly under 113, and
`BASELINE` must not be lowered for them without also fixing the counter.

#### V15-17 — closed

`route-error.tsx` and `list-load-failure.tsx` carried English literals, so eight of the nine
supported locales read English failure copy. A `routeState` namespace now exists in all nine
catalogues with verified key-set parity, and a test asserts the four failure kinds stay
distinct once translated — a translation collapsing "you may not see this" into "nothing
found" would reintroduce the original defect in that locale, silently. Translations are
agent-authored and want native review.

Two wirings, because the two components differ: `ListLoadFailure` is rendered from server
components and takes its copy as a prop from `getListFailureCopy()` (the pattern
`(dashboard)/loading.tsx` already uses for `RouteLoadingPanel`), while `RouteErrorPanel` is a
client component under `NextIntlClientProvider` and translates directly. An earlier revision
wrapped `useTranslations` in try/catch; eslint rejected it as a conditional hook call and was
right twice — it breaks the rules of hooks, and the provider it was defending against is
always present, because `error.tsx` renders inside the root layout.

#### Wave 4, D7 — evidence class changed, no finding closed

`error-surfaces.a11y.test.tsx` runs axe over all six `ListLoadFailure` / `RouteErrorPanel`
variants. **This closes no numbered finding** and is recorded here so it is not later cited as
one: it moves D7's evidence from "`role` and `aria-live` read in source" to "a checker executed
against the rendered DOM", which is why D7 went 7 → 8 in the audit and not because a defect was
repaired. The panels were already wired correctly.

Two things it is not. It is **not** a WCAG pass — axe covers a minority of the criteria, the
scan is component-level so no tenant CSS or real contrast is involved, and no assistive
technology was used. And it does **not** establish the thing D7 actually cares about: whether a
screen-reader user learns a list was _denied_ rather than _empty_. That remains an observation
a human has to make, and it is now filed as the path to 9.

An earlier revision of this document set the bar for D7 → 8 at a screen-reader pass and marked
it un-agentable. That conflated the bar for 8 with the bar for 9 and is corrected in the audit's
§13.2 rather than dropped.

Scanned inside `<main><h1>` deliberately: `heading-order` only fires once the page heading is
present, so scanning the panels bare would have hidden the likeliest violation. Negative
control: a skipped heading level and an unnamed button make the matcher fail naming
`heading-order` and `button-name`.

#### Out of scope, found while validating wave 4 — needs its own branch

`apps/web/src/providers/ThemeProvider.tsx:169` calls `useBrand()` inside a `try/catch`, which
eslint reports as `react-hooks/rules-of-hooks` — a **hard error, not a warning**. Confirmed
byte-identical to base `a2d77494`, so it is pre-existing and not introduced here. It is the same
conditional-hook pattern eslint rejected in this branch's own `useSafeRouteStateTranslations`,
which was fixed properly there.

It stays invisible because CI lints only the files in a change range, so no PR that avoids that
file will ever report it. Not fixed on this branch: unrelated to error states, and the
`try/catch` is load-bearing for mounting `ThemeProvider` standalone, so the fix needs a real
decision (a context default, or a separate non-throwing reader) rather than a deletion.

#### Method note

Every finding above was reproduced before it was filed, and each fix has an attribution
arm: reverting it reproduces the defect. Two worth recording because they changed the fix:

- The containment reference for the deadline test is a `fetch` that never settles. Without
  the deadline that test _hangs_ until the runner kills it rather than failing — which is
  exactly the user-visible behaviour, and a better demonstration than any assertion.
- Four pre-existing `error-handler` tests asserted `toContain('email')`,
  `toContain('institution_id')` and Prisma's `meta.cause` verbatim. They had pinned the
  disclosure as expected behaviour, which is why it survived. Each is updated with a note
  saying so, rather than silently rewritten.

## Needs a decision before work can start

| ID     | Question                                                              | Why it cannot be an engineering call                                                                                                                                                                                                              | Status            |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| **V4** | Do cross-service FKs stay, or does W1-DATA-06 go?                     | V3 §7 and V1 §19.6 forbid shared FK coupling; W1-DATA-06 requires a validated `tenant_id` FK on every tenant table. #342 added 23 at explicit request, live-proved.                                                                               | `NEEDS DECISION`  |
| V1     | Table naming and ownership — 5 of 8 prefixes have zero tables         | Remediation direction depends entirely on V4                                                                                                                                                                                                      | `BLOCKED` by V4   |
| V7     | 0 of 22 named tables exist                                            | Same as V1 — same underlying model. The count is sound: resolved per table with `to_regclass`. A revision-3 claim that it needed re-auditing is withdrawn.                                                                                        | `BLOCKED` by V4   |
| V2     | `control_plane_documents` owned by three services                     | The P0 fix is partly independent and can proceed; full ownership split depends on V4                                                                                                                                                              | `PARTIAL`         |
| V10b   | Is Volume 4 Table 2 a binding route contract or a capability list?    | **Largely answered by the table itself** — its columns are `Domain \| Examples`, so the paths are illustrative. Retained only so the charter owner can confirm that reading before V10's route-name items are dropped.                            | `LIKELY RESOLVED` |
| V10c   | Does `geographic_areas` satisfy `org-units`, or must it move?         | The capability exists and is RBAC-wired, so it is not a build question. But Volume 3 Table 2 assigns `tenant_org_units` to the **tenant** service while `geographic_areas` is `institution`-owned, so whether it counts as served rides on V4/V7. | `BLOCKED` by V4   |
| V10d   | Unpark `admin-dashboard`, or rebuild the queue ops surface elsewhere? | `mount-matrix.ts` parks the package as superseded by the platform-admin UI. Reviving a deliberately parked package is a product-ownership call, not an agent call. Blocks V10 item 2.                                                             | `NEEDS DECISION`  |

**Recommendation on V4:** exempt the tenant reference in §19.6 and record the
exemption. Tenant identity is platform infrastructure rather than a peer service, so
the coupling the clause guards against does not really apply, and it preserves
integrity that is already proven. The alternative — withdrawing the gate and
reverting 23 constraints — removes real referential integrity to satisfy a clause
aimed at a different problem.

**Scale note, stated plainly.** V1, V2 and V7 are not three bugs. They are one
architectural gap: the specifications describe strict per-service table ownership,
and this codebase has a shared-document control plane plus 244 largely unprefixed
tables. Full conformance is a re-platforming of the persistence layer — it would
touch the migration chain, the drift gate and every repository class. The pragmatic
path is to freeze the pattern for new services, fix the one place it actively causes
harm (V2, which is also the P0), and treat full conformance as a roadmap item with
explicit sign-off.

## Not fixable by an agent

| ID  | Gap                                   | Why                                                                                         | Owner                     |
| --- | ------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------- |
| T1  | No container image has ever published | `REGISTRY_USERNAME` / `REGISTRY_PASSWORD` absent. `W1-OPS-15` correctly refuses to skip.    | Whoever owns the registry |
| T7  | `main` has no branch protection       | Merge policy decision, repo-wide                                                            | Repository owner          |
| T2  | Fee collection cannot transact        | Which PSP, on what commercial contract                                                      | Business                  |
| T3  | 5 untracked backend stubs             | On this machine only; may be someone's work in progress                                     | Their author              |
| V3b | Implementing MySQL properly           | Needs a replacement for `ROW LEVEL SECURITY`, which the whole §6.4 isolation model rests on | Architecture              |

On T7: do **not** enable auto-merge while no required checks exist. With none
configured it would merge as soon as conflicts clear, without waiting for any gate —
worse than the current state.

## Cannot be measured yet

| ID  | Area                                                                          | Blocked by                     |
| --- | ----------------------------------------------------------------------------- | ------------------------------ |
| V11 | V5 §7 resilience — backups, restore tests, DR drills, SLOs                    | T1                             |
| V11 | V5 §4 tenant boundaries in cache, search, queues, analytics, backups, exports | not tested                     |
| —   | V1 §28 performance and availability NFRs                                      | T1                             |
| —   | V1 §38 SLO/SLI/runbook coverage                                               | T1                             |
| —   | V1 §35 threat model and abuse case catalog                                    | document review                |
| —   | V1 §42 compliance evidence artefacts                                          | document review                |
| —   | V1 §11.4 WCAG 2.1 AA                                                          | screen review + assistive tech |
| —   | V1 §13 / §14 public legal and trust pages                                     | not examined                   |

These are `unverified`, not compliant. Several are large enough to change the overall
picture, and V5 §4 in particular covers six isolation layers where only storage has
been proved.
