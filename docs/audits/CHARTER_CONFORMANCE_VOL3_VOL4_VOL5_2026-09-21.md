# Charter conformance — Volumes 3, 4 and 5

**Audited tip:** `main` = `12705129`
**Specifications:**

- `docs/multitenant/volume_03_system_design_specification.md` (System Design)
- `docs/multitenant/volume_04_api_and_developer_platform_specification.md` (API and Developer Platform)
- `docs/multitenant/volume_05_security_and_compliance_control_matrix.md` (Security and Compliance Control Matrix)

Companion to `CHARTER_CONFORMANCE_VOL1_VOL2_2026-09-21.md`. Volume 3 §7 restates
Volume 1 §19, so findings V1, V2 and V4 in that report apply here unchanged and are
not repeated.

---

## V7 — None of the 22 named tables exist

**Violates:** Volume 3 §7 and Table 2; Volume 2 Table 7; Volume 1 §19.2
**Status:** `absent` · **Severity: high**

Volume 3 Table 2 does not merely require a naming convention — it names the tables
each service owns. Resolved individually against the live catalogue with
`to_regclass`:

| Service  | Named in Volume 3 Table 2                                          | Exists |
| -------- | ------------------------------------------------------------------ | ------ |
| identity | `identity_users`, `identity_sessions`, `identity_service_accounts` | 0 of 3 |
| tenant   | `tenant_tenants`, `tenant_org_units`, `tenant_settings`            | 0 of 3 |
| billing  | `billing_subscriptions`, `billing_entitlements`                    | 0 of 2 |
| audit    | `audit_events`, `audit_exports`                                    | 0 of 2 |
| policy   | `policy_policies`, `policy_bindings`                               | 0 of 2 |
| plugin   | `plugin_plugins`, `plugin_installs`, `plugin_permissions`          | 0 of 3 |
| theme    | `theme_themes`, `theme_revisions`                                  | 0 of 2 |
| queue    | `queue_messages`, `queue_consumers`, `queue_dead_letters`          | 0 of 3 |
| install  | `install_bootstrap_runs`, `install_adapter_configs`                | 0 of 2 |

**Total: 0 of 22.**

This is a sharper statement of V1. Several of these capabilities do exist — audit,
themes and billing have working implementations — but none is persisted under the
specified ownership model. (**Correction:** this sentence previously included
`plugins`. It does not have a working implementation; see V10 defect 8 — no tables, no
importers, package parked, and the mounted `/plugins` is a `ui-seed` scaffold.) The identity and billing cases are the most
consequential: their records are documents inside the shared
`control_plane_documents` table rather than service-owned tables, which is the same
defect as V2 and the open P0.

Note `queue_*` and `install_*`: Volume 3 expects messaging delivery control and
bootstrap state to be persisted and therefore inspectable. Neither has a table, so
queue delivery state and install adapter configuration are not durable product
state in the way the specification assumes.

---

## V8 — No first-party SDK

**Violates:** Volume 4 §9; Volume 1 §22.2 ("SDK docs")
**Status:** `absent` · **Severity: medium**

Volume 4 §9 requires first-party SDKs providing auth helpers, pagination helpers,
retry guidance, error parsing and webhook verification utilities.

No SDK package exists. `tools/install-cli` is the only CLI-shaped artefact, and it
addresses installation rather than the API surface. Volume 4 §9's CLI requirements —
credential management, health checks, debugging paths — are not met by it.

Consequence for Volume 4 §2: "time-to-first-success" cannot be measured because
there is no supported client path to succeed with.

---

## V9 — Error envelope standard is not applied consistently

**Violates:** Volume 4 §6
**Status:** `partial` · **Severity: medium**

Volume 4 §6 specifies a single error envelope: `code`, `message`, `detail`,
`correlationId`, `retryable`, `fieldErrors[]`.

Field presence across `apps/api-gateway/src` and `packages/shared`:

| Field           | Files |
| --------------- | ----- |
| `correlationId` | 16    |
| `fieldErrors`   | 3     |
| `retryable`     | **1** |

`correlationId` is reasonably established. `retryable` appearing in a single file
means the retryability hint is effectively absent from the API contract, so clients
cannot distinguish a transient failure from a permanent one — which Volume 4 §7 and
§9 both assume they can.

Not verified: whether the envelope is centrally enforced or reimplemented per
route. That distinction matters for remediation and was not established.

---

## V10 — Volume 4 Table 2 API domains

**Violates:** Volume 4 §5, §4, §8, §11; Volume 3 §12; Volume 5 §6
**Status:** `partial` · **Severity:** medium, but for entirely different reasons than
the first two revisions gave

### Fourth revision. The first three were all wrong.

Revision 1 grepped for literal `/api/v1/<domain>` and called six paths absent.
Revision 2 used the registered prefix list and still called six absent. Revision 3
read Table 2 correctly, graded per domain, and then over-rotated: it marked
"Themes and plugins" Present on a stub. Revision 4, below, adds the mount **and
persistence tier** to the test, which is what separates a served domain from a
scaffold.

**The reading error underneath both.** Table 2's columns are `Domain | Examples`.
It lists **nine domains**, and the paths are illustrative examples inside them:

```
| Domain                   | Examples                                           |
| Auth and identity        | /api/v1/auth/*, /api/v1/service-accounts/*         |
| Tenant and org           | /api/v1/tenants/*, /api/v1/org-units/*             |
...
```

Grading the example paths as a route contract produced the first two errors. Graded
per domain, **no domain is wholly absent** — but that is not the same as conformant.
Two domains are only partly served, and one half of one is a scaffold. The real
defects are of four different kinds, and one is worse than anything V10 previously
alleged.

**Why revision 3 still got it wrong.** It stopped at "a prefix is registered". In this
repository `mount-matrix.ts` carries a `persistence` field, and `persistence:
'ui-seed'` with `notes: 'stub/scaffold APIs'` is not a served domain. The test has to
be prefix **and** mount state **and** persistence tier.

### Per-domain grading

| Table 2 domain               | Where it is served                                                                               | Verdict                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| **Auth and identity**        | `/api/v1/auth`; machine identity via `/developer/accounts/:accountId/keys`                       | Present, but **scopes are stored and never enforced** — defect 4                           |
| **Tenant and org**           | `/api/v1/tenant-lifecycle`, `/tenant`; org hierarchy is `geographic_areas`                       | Capability present, **`/areas` route surface unmounted** — defect 5                        |
| **Users, groups, roles**     | `/tenant/{roles,permissions,users,:userId/roles}` (`roles-routes.ts`), `/scim/v2/{Users,Groups}` | Present, durable                                                                           |
| **Billing and entitlements** | `/api/v1/billing/{plans,subscriptions/*,entitlements/check,usage/*}`                             | Present, durable. (The `/plans` under `platform-admin-ui` is a hardcoded stub — not this.) |
| **Configuration**            | `/tenant/settings`; `/api/v1/tenant-lifecycle/:id/config`. **`/install/*` parked**               | **Half-served.** Settings present across two stores; install parked — defect 9             |
| **Themes and plugins**       | Themes: `/tenant/branding` (draft/publish/versions/preview). **Plugins: stub only**              | **Half-served.** Plugins is a scaffold — defect 8                                          |
| **Audit and compliance**     | `/api/v1/audit-logs`; compliance behaviour under `/privacy`                                      | Present; no route domain _named_ `compliance`, capability is distributed                   |
| **Webhooks and events**      | `/developer/accounts/:accountId/webhooks` + delivery log                                         | Subscription and delivery plumbing present, **no event producer** — defect 6               |
| **Queue/ops surfaces**       | `/health` mounted; `/admin/scalability` **parked and unmounted**                                 | **Operator surface is zero**, not partial — defects 1, 2, 3                                |

Two citations from revision 3 were wrong and are corrected above. `themes` resolved to
`platform-admin-ui-plugin.ts:394`, a hardcoded one-item literal
(`{ id: 'theme_default', name: 'Default', status: 'published' }`); the real durable
theming surface is `/tenant/branding` at `tenant-admin-plugin.ts:102`, which revision 3
never found. `plans` likewise resolved to a two-item literal at
`platform-admin-ui-plugin.ts:384` rather than the real `/billing` routes. Both are the
same name-over-behaviour error the method note warns about, made while writing the
method note.

### The defect revision 2 got backwards: `org-units`

_(Revision 2 = commit 63bb8171 on this branch. Retained because the correction is the
evidence, not just the conclusion.)_

Revision 2 recorded "`/api/v1/org-units/*` — Absent, 0 tables, 0 routes, 0 types".
The grep behind that is reproducible, and it is the wrong grep. The capability exists
under a different name, which is precisely the failure mode revision 2 claimed to have
learned from.

`packages/shared/database/prisma/schema.prisma:191` `model GeographicArea` →
`geographic_areas`, documented as "Country → State → District → Sub-District → Block →
Village": `tenantId`, `name`, `code`, `level`, self-relation `parentId`
(`"AreaHierarchy"`), materialized `path`, nested-set `lft`/`rgt`, and
`institutions Institution[]`. Listed as a contract table in
`packages/shared/database/src/schema-contracts.ts`.

`packages/backend/institution/src/area-hierarchy/` carries the service, schemas,
routes (`POST /areas`, `PUT /areas/:areaId`, `POST /areas/:areaId/move`,
`GET /areas/tree`, `GET /areas/:areaId{,/descendants,/institutions}`), a resolver, and
four test files including a depth property test.

It is live in authorization: `apps/api-gateway/src/app.ts:767` passes
`createAreaHierarchyResolver()` into `rbacPlugin` as `areaResolver`, and
`evaluatePermission` consumes it (`app.ts:951`). The org hierarchy is already an
authorization input on every permission check.

**The accurate defect is narrower and different.** The `/areas` routes are unmounted.
`institution-plugin.ts:113` registers them only `if (areaHierarchyDb)`, and the
gateway's registration (`domain-plugins.ts:615`) passes `academics: true` without
`areaHierarchyDb`. So the hierarchy can be read for RBAC but cannot be administered
over the API.

### The gap that got understated: queue

Revision 2 credited `GET /api/v1/admin/scalability/queue` as a partial surface. That
route is not reachable. `apps/api-gateway/src/mount-matrix.ts` records:

```ts
package: 'admin-dashboard', mounted: false, prefixes: ['/admin/scalability'],
parked: true,
parkedReason: 'G-924 PARKED (superseded) — platform-admin UI + insights own every
               dashboard surface; package kept only for its aggregation helpers.',
notes: 'Plugin exists; not registered on gateway.',
```

`registerScalabilityRoutes` has no caller outside its own package plugin. **The queue
operator surface is zero, not partial.** Note also that the file's own header comment
advertises "Queue depth, lag, and DLQ count", which matches nothing in the
implementation — a trap for the next auditor who greps comments.

**No redrive exists, and that stands.** `redrive` appears once, in a comment at
`adapters/sqs-adapter.ts:287`. Dead-lettering is configuration only:
`deadLetterExchange` / `x-dead-letter-exchange` in `adapters/rabbitmq-adapter.ts`,
`RABBITMQ_DLX` in `factory.ts`, `deadLetterExchange` in `types.ts`. No DLQ read, list
or replay operation, and no `dead_letter`/`dlq`/`redrive` artefact in `db/sql`.
Messages can enter a DLQ and nothing can take them out, so Volume 5 §6's requirement
that replay and redrive be _audited_ has no operation to audit.

The transactional outbox is a second one-way sink: `outbox/store.ts` `markFailed`
without `availableAt` is terminal `failed`, and `claimPending` reads only `pending`.
Failed outbox rows are unrecoverable by any code path.

**Backlog observability is declared but never populated.** A previous revision claimed
zero matches for `backlog`/`queueDepth`/`messageCount`/`getQueueDepth` in two
directories and concluded the requirement was unmet. The count is right and the method
was again too narrow — it misses `queueLag: { maxLag, unit: 'messages' }` in
`slo-catalog.ts` for four services, `slo_queue_lag_messages` at `slo.ts:184`,
`infra/observability/alerts/queue_lag.yml` (alerting on `kafka_consumergroup_lag`,
`rabbitmq_queue_messages_ready`, and DLQ growth on `.*\.dlx`), and
`GetQueueAttributesCommand ... ApproximateNumberOfMessages` at `sqs-adapter.ts:180`.

The conclusion survives for a better reason: `slo_queue_lag_messages` is **never
`.set()`** — only the `slo_queue_lag_max` target is — and `prometheus.yml` scrapes 11
application jobs plus `prometheus` and `kubernetes-pods`, with **no Kafka or RabbitMQ
exporter**. Every alert expression above evaluates against a metric nothing produces.
Volume 3 §12 is unmet because the pipeline is unwired, not because nobody declared it.

### Plugins: a scaffold graded Present by revision 3

This is revision 3's own over-correction, found by independent review and confirmed.
Volume 4 Table 2's "Themes and plugins" row was marked Present on the evidence
"`themes`, `plugins` registered". The plugins half does not survive that.

- **No persistence.** Zero plugin tables in `db/sql` and zero Prisma plugin models;
  `plugin_plugins` has 0 occurrences anywhere. `packages/backend/plugin/src/` has
  `in-memory-repository.ts` and no PG store.
- **No consumers.** `@proctira/backend-plugin` has zero importers outside its own
  package.
- **Unmounted and parked.** `mount-matrix.ts:507` — `plugin` is `mounted: false,
parked: true`, `'G-924 PARKED (superseded) — /plugins served by platform-admin UI;
marketplace runtime deferred.'`
- **What is mounted is a stub.** The only live `/plugins` comes from
  `platform-admin-ui`, whose matrix entry reads `persistence: 'ui-seed'` and
  `notes: 'platformAdminUiPlugin stub/scaffold APIs'` — list, get and status flips over
  demo-seeded `control_plane_documents` rows.

That is strictly weaker than three defects this report already records, so grading it
Present was inconsistent as well as wrong. Logged as defect 8.

Volume 7 is the plugin and theme extension specification, so the conformance surface
here is larger than Table 2 alone. This report does not grade Volume 7; the point here
is only that Table 2's plugins row must not be scored Present.

### Configuration: half-served, not served

Table 2's Configuration row has two examples, `/api/v1/settings/*` and
`/api/v1/install/*`. Revision 3 graded only the first. The second is parked:
`mount-matrix.ts:499` records `install` as `mounted: false, parked: true`,
`'G-924 PARKED (out of scope for gateway) — install wizard is portal/demo scoped and
must never be reachable on a live tenant gateway.'`, with no `install_*` tables.

Whether that is a defect or a deliberate architectural boundary is a charter question,
not an engineering one — the parked reason is a security argument, and it is a
reasonable one. Logged as defect 9 so it stops being invisible, not because the parking
is obviously wrong.

### Machine identity: storage without enforcement

Revision 2 claimed Volume 4 §4 and Volume 5 §3 were "met in substance". Too strong.

The storage layer does support the description. `db/sql/055` gives
`developer_portal_api_keys` a hashed key with a global unique index, `key_prefix`,
`scopes jsonb`, a `status` CHECK over `active|revoked|expired`, `expires_at`,
`tenant_id`, and `ENABLE` + `FORCE ROW LEVEL SECURITY`.

Enforcement is absent. There is no `requireScope`/`hasScope` equivalent, nothing reads
`scopes` for an authorization decision, `POST /developer/validate-key` has **no
consumer anywhere** in `packages` or `apps`, and the gateway has no API-key credential
path. The scope vocabulary is unconstrained — `schemas.ts:43` types it as
`Type.Array(Type.String({ minLength: 1, maxLength: 128 }))`, so any string is a scope.
V4 §4 requires least privilege with explicit scopes; a store no decision point reads
cannot satisfy that. **Accurate verdict: a scoped credential store exists; scope
enforcement does not.**

**One suspected defect here was tested and refuted.** `db/sql/055`'s `tenant_isolation`
policy has no `app.platform_admin` disjunct, while `pg-api-key-store.ts:114`
`getApiKeyByHash` runs under `withPlatformScope`, which sets `app.platform_admin='1'`
and binds no tenant GUC. That looks like it must return zero rows under FORCE RLS. It
does not: `db/sql/094_developer_portal_api_key_lookup.sql` adds a second permissive
policy `platform_api_key_lookup` `FOR SELECT USING (app.platform_admin = '1')`, which
OR-combines with `tenant_isolation`. Proved live as the runtime role `proctira_app`:

```
A  platform_admin=1, no tenant GUC, policy present   -> rows_visible = 1
B  platform_admin cleared, no tenant GUC  (control)  -> rows_visible = 0
C  platform_admin=1, no tenant GUC, policy DROPPED   -> rows_visible = 0
```

Arm B only rules out RLS being inactive. **Arm C is the attribution arm**: same GUCs as
A, with `platform_api_key_lookup` dropped inside the transaction, and the row
disappears. That is what ties A's visibility to `094` rather than to anything else. The
transaction was rolled back and the policy confirmed still present afterwards. `094`
also carries its own `pg_policies` assertion that raises if the policy is missing.

Two follow-on concerns were checked and can be retired. A database migrated only as far
as `055` is not silently broken: `094_developer_portal_api_key_lookup.sql` is listed in
`schema-readiness.ts` `PERMANENT_RUNTIME_INTEGRITY_MIGRATIONS:23`, so readiness fails
loudly. And the policy's `FOR SELECT` scope breaks no management path: every mutating
method in `pg-api-key-store.ts` runs under `withPgTenant`, and the only other
`withPlatformScope` caller is a test helper doing a `SELECT`.

**The cost is worth stating, since the finding is a refutation.** `094` grants
tenant-unscoped `SELECT` on a credential table to any caller that sets
`app.platform_admin='1'`. That is the minimum needed for hash-first authentication —
the tenant is unknown until the key resolves — but it means the blast radius of an
erroneous `withPlatformScope` on this table is every tenant's key metadata. Narrowing
the policy to the single-row hash lookup would be tighter. Not raised as a defect here
because it is a deliberate, documented trade-off with a stated reason.

Recording all of this because reading `055` alone would have produced a fourth false
claim, in the opposite direction from the first three.

### Webhooks and events: plumbing without producers

Subscription by event type genuinely exists — a webhook carries an `events[]` list and
`developer-portal-service.ts:490` rejects delivery for unsubscribed events — alongside
signing, retry, and a durable delivery log.

What is missing is any producer. `createDelivery` has **no caller outside the
developer-portal package and its own tests**: the only references are the repository
interface, the service method, the hybrid/in-memory implementations, and two test
files. No route triggers a delivery; the only webhook delivery route is the read-side
`GET .../deliveries`. Event names are free-form strings with no catalog, trigger
registry, payload schema, ordering guarantee or replay contract of the kind V4 §8
describes.

### Sandbox: a shell, not a credential path

Revision 2 claimed V4 §11's sandbox and non-production credential path was "served by
`.../sandboxes`". `developer-portal-service.ts:647` `createSandbox` mints a `uuidv4()`
and calls it `tenantId` without creating any tenant, string-formats
`${sandboxBaseUrl}/tenants/<uuid>` as the endpoint, sets `status: 'active'` directly
rather than provisioning, and silently discards the `seedData` the request schema
accepts (`SandboxEntity` has no such field). `hybrid-repository.ts:180` routes every
sandbox call to `this.memory` — "in-memory residual" — so sandboxes do not survive a
restart even with `DATABASE_URL` set. Nothing is provisioned and no credential is
issued. Consistent with the repo's own `DEV_DEVPORTAL_CRYPTO_KEYS.md`, which lists
live key mint as an explicit non-goal.

### Configuration: the cited path was wrong

Revision 2 attributed `packages/backend/tenant/src/tenant-settings.ts` to
`/tenants/:id/config`. It registers `GET/PUT ${prefix}/settings`, mounted by
`tenantAdminPlugin` at `/tenant/settings`. The `:id/config` pair is a different module
(`routes.ts:372,404`, over the tenant entity's `config`), mounted at
`/api/v1/tenant-lifecycle/:id/config` because the platform-admin UI owns
`/api/v1/tenants`. Two stores with different field sets, not one.

### What V10 should actually track

| #   | Defect                                                                     | Kind              | Spec               |
| --- | -------------------------------------------------------------------------- | ----------------- | ------------------ |
| 1   | No DLQ redrive or replay anywhere; outbox `failed` is terminal             | absent capability | V5 §6              |
| 2   | Queue operator surface unreachable (`admin-dashboard` parked)              | unmounted         | V3 §12, V5 §6      |
| 3   | `slo_queue_lag_messages` never set; no Kafka/RabbitMQ exporter deployed    | declared, unwired | V3 §12             |
| 4   | API-key `scopes` stored but enforced nowhere; no gateway API-key auth path | unenforced        | V4 §4, V5 §3       |
| 5   | `/areas` routes unmounted though `geographic_areas` is RBAC-consumed       | unmounted         | V4 Table 2, V1 §19 |
| 6   | Webhook deliveries have no producer; no event catalog or replay contract   | no producer       | V4 §8              |
| 7   | Sandbox provisioning is a shell; no non-production credential issued       | shell             | V4 §11             |
| 8   | Plugins is a scaffold: no tables, no importers, parked, `/plugins` ui-seed | shell             | V4 Table 2, V7     |
| 9   | `install` parked with no `install_*` tables — Configuration half-served    | parked            | V4 Table 2, V5 §6  |

Item 1 is the only true absence, and it carries operational risk beyond conformance: a
stuck DLQ has no recovery path today. Items 2, 5 and 9 are mount or configuration
sized, and 9 may be a deliberate boundary rather than a defect. Items 4, 6, 7 and 8 are
real functional gaps behind surfaces that look complete — 4 is the one with security
consequence.

On item 3, two precision notes. `prometheus.yml`'s `kubernetes-pods` job is
annotation-based pod discovery, so the accurate statement is that no Kafka or RabbitMQ
**exporter is deployed**, not that one exists unscraped. And `sqs-adapter.ts:178` does
request `ApproximateNumberOfMessages` but discards the response — it is a liveness
probe, not a depth reading, which strengthens the defect rather than softening it.

### Method note, recorded deliberately

Four revisions of one finding, wrong three times in three different ways. Revisions 1
and 2 searched for the specification's _name_ for a capability. Revision 2 wrote down
the lesson "look for the table and column that would have to exist" and then failed to
apply it to `org-units`, where `geographic_areas` was one grep away. Revision 3 applied
it, wrote a method note about it, and in the same pass graded `themes` on a hardcoded
literal and `plugins` on a parked package — the same error again.

What survives as a usable procedure, in order:

1. Read the specification table's **structure** before grading rows against it. Table 2
   is `Domain | Examples`; treating examples as a contract caused revisions 1 and 2.
2. Search for the **behaviour**, not the noun. A nested-set hierarchy, a hashed
   credential, a draft/publish version chain.
3. Check **mount state**. `apps/api-gateway/src/mount-matrix.ts` is the authority, and
   it parks `admin-dashboard`, `plugin`, `install` and others outright. Routes in a
   package are not reachable routes.
4. Check the **persistence tier**. `persistence: 'ui-seed'` plus `notes: 'stub/scaffold
APIs'` is a scaffold. This is the step revision 3 skipped.
5. Check there is a **producer or a caller**. `createDelivery` and `validate-key` both
   exist with no caller; `scopes` is stored with no reader. A surface with no consumer
   is not a working capability.

Steps 3 to 5 are the ones that distinguish this codebase's real state from its apparent
state, and all three were needed to get V10 right.

## V11 — Security control matrix: largely unverified, with two confirmed gaps

**Volume 5 status:** mostly `unverified` · two confirmed items below

Volume 5 is a control matrix whose satisfaction depends on operational evidence —
Table 1 requires named owners and evidence artefacts per control family. This pass
examined code, not evidence artefacts, so most of Volume 5 cannot be graded here.
Recording it as `unverified` rather than compliant.

**Confirmed gaps:**

_§6 audit coverage._ Volume 5 §6 requires audit records for install/bootstrap
actions and for queue replays or redrive. Both halves are settled. No replay or redrive
operation exists in any adapter (V10 defect 1), so there is nothing to audit. And
`install_*` has no table (V7, resolved by `to_regclass`) while the `install` package is
parked and unmounted (V10 defect 9), so bootstrap actions are not durable product state
either.
The hash-chained audit trail itself is real and was proved tamper-evident live
(#331), so this is a coverage gap rather than an absent capability.

_§4 tenant boundary breadth._ Volume 5 §4 requires tenant boundaries preserved "in
storage, cache, search, queues, analytics, backups, and exports". Storage isolation
is proved live. The other six layers were not tested and Volume 1 §39.2 requires
each of them independently. Unverified, and it is a large surface.

**Cannot be assessed at all:** §7 operational resilience — backups, restore tests,
DR drills, SLOs — because no environment is deployed (T1). The
earlier claim that `db/sql` could not migrate an empty database is withdrawn; see the
T11 entry in `CHARTER_GAP_TASKS.md`. Volume 5 §7 also requires published upgrade, rollback
and compatibility boundaries for self-hosted editions, which depends on the same
blockers.

**Break-glass:** a `break-glass` prefix is registered, so the capability exists.
Whether it satisfies §3's approval, time-boxing and post-use review requirements was
not examined.

---

## Where the implementation is ahead of the specification

Stated to keep the report calibrated.

Volume 3 §8 requires adapters behind stable internal contracts with schema, health
check, retry policy and contract tests. The queue abstraction meets the structural
part of this well: three real adapters behind
`packages/shared/queue-abstraction/src/factory.ts`, selected by `QUEUE_BACKEND`,
with domain services publishing through the abstraction rather than binding to a
provider. Volume 3 §9's requirement that "queue adapter selection must not change
core service business semantics" is satisfied by that design.

Adapters also exist for object storage, search, SCIM, SAML, KMS/Vault and
OpenTelemetry. Presence is not conformance — none was tested against §8's contract
test and failure-behaviour requirements.

---

## Consolidated priority across all five volumes

1. **V10 item 1** — DLQ redrive. Promoted to the top because it is the only confirmed
   absent capability in V10 and it carries operational risk, not just conformance
   risk: a stuck DLQ has no recovery path, and the transactional outbox has the same
   shape. Everything else in V10 is unmounted, unenforced or unwired rather than
   missing.
2. **V2 / V7** — service table ownership. One piece of work closes the shared-table
   violation, the naming violation and the open P0.

   **A claim made in revision 3 of V10 and now withdrawn:** that V7's count was
   produced by the same name-matching method that got `org-units` wrong, and needed
   re-auditing. It was not. V7 resolved each of the 22 names individually against the
   live catalogue with `to_regclass`, and its body already distinguishes
   capability-exists from ownership-model-conformance. V7's question is about table
   names and service ownership, not about whether a capability is present.

   The `org-units` finding in fact **supports** V7 rather than undermining it. Volume 3
   Table 2 assigns `tenant_org_units` to the **tenant** service, alongside
   `tenant_settings`; `geographic_areas` is owned by `institution`. So the capability
   exists and sits under the wrong service — which is precisely V7's and V1's point.

3. **V4** — the cross-service FK contradiction. Needs the charter owner. Blocks
   knowing whether V7's remediation direction is correct.
4. **V3** — remove the MySQL option or implement it. Closed PostgreSQL-only in #363.
5. **V8**, **V9** — SDK and error envelope.
6. **V11** — requires T1 before most of it can be measured. T11 is withdrawn.

## Honest limits of this report

Grading covers what is inspectable in code and in a live database. It does not cover
performance and availability NFRs, SLO and runbook coverage, the threat model and
abuse case catalog, compliance evidence artefacts, WCAG conformance, public legal
pages, or isolation in the cache, search, queue, analytics, backup and export layers.

Those are `unverified`. Several are large enough that they could change the overall
picture materially, and none should be read as compliant.
