# Charter gap tasks — tracking file

Single tracker for the gaps found by grading `main` against the five specification
volumes in `docs/multitenant/`. Findings and evidence live in:

- `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`
- `CHARTER_CONFORMANCE_VOL3_VOL4_VOL5_2026-09-21.md`
- `TASKLIST_GAP_CLOSURE_2026-09-21.md` (pre-existing T-items)

**Baseline tip:** `main` = `12705129`

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

| ID  | Gap                                                 | Spec                        | Status         | Branch                               | PR   |
| --- | --------------------------------------------------- | --------------------------- | -------------- | ------------------------------------ | ---- |
| V10 | 7 defects behind Table 2; DLQ redrive absent is #1  | V5 §6; V3 §12; V4 §4 §8     | `OPEN`         | —                                    | —    |
| V7a | Re-audit V7's 22-table count — method now in doubt  | V3 §7                       | `OPEN`         | —                                    | —    |
| V9  | Error envelope inconsistent (`retryable` in 1 file) | V4 §6                       | `OPEN`         | —                                    | —    |
| V3  | MySQL offered but cannot work                       | V1 §17.1 §14.4 §33.3; V2 T6 | `FULLY_CLOSED` | fix/V3-postgres-only-install         | #363 |
| V8  | No first-party SDK                                  | V4 §9; V1 §22.2             | `OPEN`         | —                                    | —    |
| V5  | Hardcoded UI copy, 8 of 9 fees pages                | V1 §11.5 §46                | `OPEN`         | —                                    | —    |
| V6  | No email/notification delivery adapter              | V2 T6; V3 T3                | `OPEN`         | —                                    | —    |
| T6  | `VALIDATE CONSTRAINT` under FORCE RLS needs a gate  | —                           | `FULLY_CLOSED` | fix/T6-validate-under-force-rls-gate | #362 |
| T4  | Zero statutory/interop implementation               | —                           | `OPEN`         | —                                    | —    |

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

### V10 — CORRECTED TWICE. Rescoped.

**Revision 1 said "6 API domains absent". Revision 2 said "4 of 6 exist, 2 absent".
Both were wrong. Graded correctly, zero of the nine Table 2 domains are absent.**

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

| #   | Defect                                                                      | Kind              | Spec          | Fixable by an agent?                                    |
| --- | --------------------------------------------------------------------------- | ----------------- | ------------- | ------------------------------------------------------- |
| 1   | No DLQ redrive or replay anywhere; outbox `failed` is terminal              | absent capability | V5 §6         | Yes. The only true absence.                             |
| 2   | Queue operator surface unreachable — `admin-dashboard` parked               | unmounted         | V3 §12, V5 §6 | Needs a ruling: unpark, or rebuild under a live package |
| 3   | `slo_queue_lag_messages` never `.set()`; no Kafka/RabbitMQ exporter scraped | declared, unwired | V3 §12        | Yes                                                     |
| 4   | API-key `scopes` stored but enforced nowhere; no gateway API-key auth path  | unenforced        | V4 §4, V5 §3  | Yes, but it is a security surface — needs review        |
| 5   | `/areas` routes unmounted though `geographic_areas` is RBAC-consumed        | unmounted         | V4 Table 2    | Yes. `institutionPlugin` needs `areaHierarchyDb`.       |
| 6   | Webhook deliveries have no producer; no event catalog or replay contract    | no producer       | V4 §8         | Partly — the catalog is a design decision               |
| 7   | Sandbox provisioning is a shell; no non-production credential issued        | shell             | V4 §11        | No — the repo already waived live key mint              |

**Item 1 first.** It is the only confirmed absent capability and the only one with
operational risk beyond conformance: a stuck DLQ has no recovery path today, and
`outbox/store.ts` has the same shape — `markFailed` without `availableAt` is terminal
`failed`, and `claimPending` reads only `pending`.

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
A  platform_admin=1, no tenant GUC  (the getApiKeyByHash path) -> rows_visible = 1
B  platform_admin cleared, no tenant GUC  (control)            -> rows_visible = 0
```

B confirms A's visibility comes from that policy, not from inactive RLS. Recorded
because reading `055` alone would have produced a fourth false claim — in the opposite
direction this time.

### Knock-on: V7 needs re-auditing

V7 ("none of the 22 named tables exist") was produced by the same name-matching method
that got `org-units` wrong. Its count should not be trusted until each of the 22 is
checked for a differently-named equivalent. Flagged rather than silently corrected,
because checking 22 tables is its own task.

### Method note

Three revisions, two wrong in opposite directions. What works, in order: read the
specification table's structure before grading rows against it; search for the
_behaviour_ — a nested-set hierarchy, a hashed credential — not the noun; then check
**gateway mount state**, because in this repository a package having routes does not
mean the routes are reachable. `apps/api-gateway/src/mount-matrix.ts` is the authority
and it parks several packages outright.

## Needs a decision before work can start

| ID     | Question                                                              | Why it cannot be an engineering call                                                                                                                                                                                                                   | Status            |
| ------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------- |
| **V4** | Do cross-service FKs stay, or does W1-DATA-06 go?                     | V3 §7 and V1 §19.6 forbid shared FK coupling; W1-DATA-06 requires a validated `tenant_id` FK on every tenant table. #342 added 23 at explicit request, live-proved.                                                                                    | `NEEDS DECISION`  |
| V1     | Table naming and ownership — 5 of 8 prefixes have zero tables         | Remediation direction depends entirely on V4                                                                                                                                                                                                           | `BLOCKED` by V4   |
| V7     | 0 of 22 named tables exist — **count now in doubt**                   | Remediation is blocked by V4 either way. But the count came from the same name-matching that wrongly declared `org-units` absent, so re-audit it as V7a before acting on it.                                                                           | `BLOCKED` by V4   |
| V2     | `control_plane_documents` owned by three services                     | The P0 fix is partly independent and can proceed; full ownership split depends on V4                                                                                                                                                                   | `PARTIAL`         |
| V10b   | Is Volume 4 Table 2 a binding route contract or a capability list?    | **Largely answered by the table itself** — its columns are `Domain \| Examples`, so the paths are illustrative and all nine domains are served. Retained only so the charter owner can confirm that reading before V10's route-name items are dropped. | `LIKELY RESOLVED` |
| V10c   | WITHDRAWN — `org-units` and `compliance` are not absent               | `org-units` is `geographic_areas`, implemented and wired into gateway RBAC; its `/areas` routes are merely unmounted, which is V10 item 5. `compliance` behaviour is mounted under `/privacy`. Neither is a scope question.                            | `NOT_A_DEFECT`    |
| V10d   | Unpark `admin-dashboard`, or rebuild the queue ops surface elsewhere? | `mount-matrix.ts` parks the package as superseded by the platform-admin UI. Reviving a deliberately parked package is a product-ownership call, not an agent call. Blocks V10 item 2.                                                                  | `NEEDS DECISION`  |

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
