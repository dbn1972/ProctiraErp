# Charter gap tasks — tracking file

Single tracker for the gaps found by grading `main` against the specification volumes in
`docs/multitenant/`. Findings and evidence live in:

- `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`
- `CHARTER_CONFORMANCE_VOL3_VOL4_VOL5_2026-09-21.md`
- `VOLUME_12_QA_CONFORMANCE_2026-09-24.md` (Volume 12 — QA / release readiness)
- `TASKLIST_GAP_CLOSURE_2026-09-21.md` (pre-existing T-items)

**Baseline tip:** `main` = `12705129` for the V1–V5 items; `a2d77494` for the V12-\* items.

## Working rules

One gap, one branch, one PR, reviewed and merged before the next is started. Update
the Status and PR columns in the same PR that does the work, so this file never
claims something the branch has not delivered.

Status vocabulary: `OPEN` · `IN PROGRESS` · `PARTIAL` · `FULLY_CLOSED` ·
`BLOCKED` · `NEEDS DECISION` · `EXTERNALLY_UNVERIFIED`

A `TBD` in the PR column means the branch is pushed and the pull request is not open yet.
Do not guess the number — an earlier draft of the V12 rows wrote `#377`, which by then
belonged to an unrelated pull request.

A gap moves to `FULLY_CLOSED` only with executable evidence — a command, a named
test, or an observed runtime behaviour. Not "looks right".

## Agent-fixable, unblocked

Ordered by leverage, not by size.

| ID    | Gap                                                 | Spec                        | Status         | Branch                               | PR   |
| ----- | --------------------------------------------------- | --------------------------- | -------------- | ------------------------------------ | ---- |
| V12-1 | §3/§5/§10 coverage declared but never executed      | V12 §3 §5 §10 §13           | `FULLY_CLOSED` | test/V12-qa-matrix-coverage          | TBD  |
| V12-2 | `setTheme()` no-op — `[dark]` scans measured light  | V12 §10                     | `FULLY_CLOSED` | test/V12-qa-matrix-coverage          | TBD  |
| V12-3 | `check:contrast` grades an unrendered stylesheet    | V12 §10; V1 §11.4           | `OPEN`         | —                                    | —    |
| V12-4 | §13: 4 of 11 exit criteria have no mechanism        | V12 §13 §7.2                | `PARTIAL`      | —                                    | —    |
| V12-5 | §9 per-module QA checklists unfilled                | V12 §9                      | `PARTIAL`      | test/V12-qa-matrix-coverage          | TBD  |
| V10   | 9 defects behind Table 2; 1a partial, 8 open        | V5 §6; V3 §12; V4 §4 §8 §11 | `PARTIAL`      | fix/V10-outbox-failed-requeue        | #365 |
| V9    | Error envelope inconsistent (`retryable` in 1 file) | V4 §6                       | `OPEN`         | —                                    | —    |
| V3    | MySQL offered but cannot work                       | V1 §17.1 §14.4 §33.3; V2 T6 | `FULLY_CLOSED` | fix/V3-postgres-only-install         | #363 |
| V8    | No first-party SDK                                  | V4 §9; V1 §22.2             | `OPEN`         | —                                    | —    |
| V5    | Hardcoded UI copy, 8 of 9 fees pages                | V1 §11.5 §46                | `OPEN`         | —                                    | —    |
| V6    | No email/notification delivery adapter              | V2 T6; V3 T3                | `OPEN`         | —                                    | —    |
| T6    | `VALIDATE CONSTRAINT` under FORCE RLS needs a gate  | —                           | `FULLY_CLOSED` | fix/T6-validate-under-force-rls-gate | #362 |
| T4    | Zero statutory/interop implementation               | —                           | `OPEN`         | —                                    | —    |

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

### V12 — Volume 12 QA, validation and release readiness

Full evidence in `VOLUME_12_QA_CONFORMANCE_2026-09-24.md`. Graded against `a2d77494`.

Volume 12's weak spot is not missing tests. It is **tests that exist and do not run**, and
**gates pointed at the wrong artefact**. Three of the five items are that shape, and a file
census finds none of them.

**V12-1 `FULLY_CLOSED`.** `playwright.config.ts` claimed `// Volume 12 §3.3 — Chrome, Edge,
Safari, Firefox` above a project list with no Edge in it (`--list` returned six projects,
none Edge; `grep msedge` repo-wide returned nothing). §3.1's seven viewport classes resolved
to three widths. §5's seven named responsive failure classes had zero automation — nothing
between 390px and 1280px had ever been rendered by a test. And `dark-mode-parity.spec.ts`,
~250 route/theme scans, was referenced by **no workflow**: absent from both spec sets in
`e2e-backend-ready.yml`, and `ci.yml`'s turbo path does not set `E2E_BACKEND_READY`, so it
self-skipped. Closed by `qa-matrix.ts` (the matrix as data, self-asserting), `55-responsive-
layout.spec.ts` (sweeps all seven classes in one project), and workflow wiring. 35/35 across
six projects, six consecutive `CI=1 --retries=0` runs, actionlint clean.

**V12-2 `FULLY_CLOSED`.** `setTheme()` wrote `data-theme` onto `<html>` and `ThemeProvider`'s
mount effect overwrote it from `prefers-color-scheme` (light by default). Measured: after
`setTheme(page,'dark')` the attribute read back `light`, was still `light` 3s later, body at
`rgb(248,250,252)`. Five always-on tests were green while scanning the wrong theme. Now
driven by `emulateMedia` and the switch is asserted before the scan. Arming it exposed a real
defect: three `bg-white`/`bg-slate-50` literals on the anonymous auth surfaces put tokenised
near-white text on a fixed light panel — 1.19:1 settled. Attribution arm: reverting them
fails all five auth routes' dark scan, restoring them passes all five.

**V12-3 `OPEN`, needs a design-system ruling.** `ci.yml:210` runs `check:contrast` on every
lint against `packages/ui/styles/theme.css`. `apps/web` imports
`src/styles/globals.css`, which declares its own `--primary` family with **different values**
(dark: `234 89% 74%` / `242 47% 14%` versus `hsl(222,47%,52%)` / white). `grep globals.css
tools/scripts/` returns nothing. The gate has never read the stylesheet the product renders,
so it cannot fail on a regression there, and its ten baselined waivers may describe tokens
that are not on screen. The rendered values happen to be better for this pair — luck, not a
control. Ruling needed: make `theme.css` authoritative and have `globals.css` consume it, or
re-point the gate and recompute all ten baseline entries.

**V12-4 `PARTIAL`.** Of §13's eleven exit criteria, four have no enforcing mechanism: API
contract regressions (no committed OpenAPI document anywhere — `git ls-files | grep -Ei
'openapi|swagger'` is empty, and the runtime spec has no drift gate), install/upgrade
regressions, and documentation/evidence attachment (no pull-request template exists).
Separately, release and deploy gate only on CI's overall conclusion for the SHA, so path-
filter skip windows propagate to release, and `e2e-backend-ready.yml` — which carries the
journey gate §13's first criterion depends on — is referenced by neither `ci-gate`.

**V12-5 `PARTIAL`.** §9 requires a per-module QA checklist. Eleven templates existed and none
carried a browser or theme column, so §3.3 and §3.4 had nowhere to be recorded.
`VOLUME_12_MODULE_QA_CHECKLIST.md` adds them plus the Appendix A fields. Filling it per
module is not done and is not claimed.

#### Claim retracted — dark `--primary` was not a WCAG failure

The first revision of V12-2 reported dark `--primary` / `--primary-foreground` at **3.34:1**
and shipped `test.fail()` on two routes for it. Wrong, and withdrawn.

`globals.css` puts 150ms `transition-colors` on themed surfaces. Sampling one node after a
theme switch gave `#ffffff` on `#5048e5` at t+0, `#5c5b72` on `#7278f2` (1.78:1, neither
theme) at t+50ms, and `#141334` on `#828df8` (**6.15:1**, passes AA) at t+150ms, with
`getAnimations()` draining 22 → 0 across the window. Every ratio in the 1.3–3.4 range this
spec produced while being wired up was an interpolated sample. The scans now freeze
transitions and the exemption list is gone.

**Lesson recorded deliberately:** three of the first four "violations" found by arming a
visual gate were artefacts of the gate's own sampling; the fourth was real. The signal was
two runs disagreeing on the _colour_ of a node, not merely the verdict — that makes the
measurement the variable, not the product. Checking `document.getAnimations()` before filing
anything would have caught it, and the same check belongs in any future colour assertion here.

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
