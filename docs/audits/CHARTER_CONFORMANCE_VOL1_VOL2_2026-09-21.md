# Charter conformance — Volumes 1 and 2

**Audited tip:** `main` = `12705129`
**Specifications:** `docs/multitenant/vol1_multi_tenant_product_platform_charter_world_class_v2.md`
(Charter v2.0) and `docs/multitenant/vol2_multi_tenant_product_platform_full_product_spec_volume_2.md`

Volume 1 §1 states it "is not optional guidance" and §46 lists the mandatory
non-negotiables. Volume 2 Appendix A confirms Volume 1 remains binding. Findings
below are graded against those two documents only.

## Method, and what it does not cover

Read both volumes in full, then verified the testable mandates against code and
against a live PostgreSQL instance (244 base tables).

**Verified by execution:** table naming against Volume 2 Table 7, shared-table
ownership via live collection prefixes, queue adapter set, database adapter
reality, cross-service FK presence, adapter inventory for Volume 2 Table 6.

**Not covered, and not guessed at:** §28 performance and availability NFRs, §38
SLO/SLI/runbook coverage, §39 isolation verification across cache, search, queue
and analytics layers, §35 threat model and abuse case catalog, §42 compliance
control mapping, §11.4 WCAG 2.1 AA conformance, and every §13/§14 public page.
These need either a running deployment, screen review, or document review that this
pass did not perform. They are `unverified`, not compliant.

**A structural limit on everything below.** Volume 1 §16 and §43 make installation
and upgrade first-class surfaces, and Volume 2 §22 requires post-install
verification. Assessment is limited by T1: no container image has ever been published, because
registry credentials are absent.

**Correction.** An earlier version of this paragraph also cited T11, claiming `db/sql`
could not be applied to an empty database. That was wrong and is withdrawn — the
chain completes (111 files, 0 errors) when the documented order in `db/README.md:28`
is followed, Prisma then apply-sql. See the T11 entry in `CHARTER_GAP_TASKS.md`.

---

## V1 — Service-prefixed table names: 5 of 8 mandated prefixes have zero tables

**Violates:** §19.2, §46 ("service-prefixed table names"), Volume 2 Table 7
**Status:** `absent` · **Severity: high** · systemic

Volume 2 Table 7 names the expected prefix per service. Measured against the live
catalogue:

| Mandated prefix | Tables present |
| --------------- | -------------- |
| `identity_*`    | **0**          |
| `policy_*`      | **0**          |
| `theme_*`       | **0**          |
| `plugin_*`      | **0**          |
| `queue_*`       | **0**          |
| `tenant_*`      | 2              |
| `audit_*`       | 4              |
| `developer_*`   | 4              |

Ten tables in total carry a mandated prefix, out of **244 base tables**.

The identity service is the clearest case. §19.2 gives `identity_users` and
`identity_sessions` as the worked example. Neither exists: sessions are
`user_sessions`, and users are not a table at all — they live as
`auth.keycloak_users` documents inside `control_plane_documents`.

**Remediation is not a rename.** §19.1 makes the prefix a consequence of service
table ownership, so the naming gap is a symptom of the ownership model, not a
cosmetic defect. Renaming 234 tables without settling ownership would satisfy the
letter of §19.2 and none of its intent.

---

## V2 — A shared mutable table owned by three services

**Violates:** §19.4, §46 ("no shared mutable table ownership")
**Status:** `absent` · **Severity: high**

§19.4: _"Two or more services must not jointly own the same mutable table."_

`control_plane_documents` is jointly owned by **auth, billing and tenant**,
confirmed from live collection prefixes (`auth.*`, `billing.*`, `tenant.*`).

This is also the root of the open P0 in
`SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md`, and the two findings are causally
linked rather than coincidental. Because the table is shared, its key is
`PRIMARY KEY (collection, id)` with no `tenant_id` — so document ids form one
global namespace and an unscoped read returns another tenant's row. Per §19.1 each
service would own its own tables; had it done so, the global key could not exist.

§36.8 additionally requires a documented owner for every table. A table with three
owners cannot satisfy it.

---

## V3 — The MySQL option is offered and cannot work

**Violates:** §17.1, §46 ("first-run setup for CDN, MySQL or PostgreSQL, S3, Redis,
and queue adapter"), Volume 2 Table 6; and §14.4 / §33.3 on unsupported claims
**Status:** `partial` · **Severity: high** — a false capability, not an absence

Volume 2 Table 6 lists Database providers as "MySQL, PostgreSQL" with "install-time
selection". The product accepts the choice:

- `apps/install-wizard/src/lib/database-validation.ts:57` — rejects any provider
  that is not `postgresql` or `mysql`
- `packages/backend/install/` carries MySQL validators and types

But the platform cannot run on MySQL:

- Prisma's datasource provider is hardcoded `postgresql`
- `db/sql` is PostgreSQL-specific — **57 files use `ROW LEVEL SECURITY`**, 40 use
  `jsonb`, 9 require `uuid-ossp`

`ROW LEVEL SECURITY` is the mechanism the entire §6.4 isolation model rests on and
has no MySQL equivalent. An operator selecting MySQL passes validation and then
fails during migration.

§33.3 prohibits launching with "unsupported trust claims" and §14.4 requires claims
be "accurate, reviewable, and approved". Offering a database that cannot work is
worse than supporting one, because it fails after the operator has committed.

**Two honest routes:** implement MySQL properly, including an isolation mechanism
that replaces RLS, or remove it from the wizard and from Table 6. The second is far
cheaper and should be the default assumption.

---

## V4 — Cross-service foreign keys: the charter and this repository's own gate disagree

**Relates to:** §19.3, §19.6, §46 ("no cross-service SQL joins"), §17 of Volume 2
**Status:** `Contradiction: yes` · **requires an owner decision, not a fix**

§19.6 says cross-service foreign keys "should be avoided", and a referencing
service "should store the external identifier as a value, not a tightly coupled
relational dependency". Volume 2 §17 repeats it.

This repository does the opposite, deliberately and under gate enforcement:

- `071_cross_domain_fk_constraints.sql`,
  `085_cross_domain_fk_staff_ops.sql`,
  `087_cross_domain_fk_prisma_not_valid.sql`
- `cross-domain-fks.live.test.ts` asserts they exist
- the **W1-DATA-06 gate requires** a validated `tenant_id → tenants(id)` FK on
  every tenant-owned table, and fails the build without it

Most relevant: **#342 added 23 such foreign keys**, migrating `tenant_id` from
`text` to `uuid` specifically so the constraint could exist. That work satisfied
W1-DATA-06 and moved the codebase further from §19.6 in the same commit.

This cannot be resolved by an engineer choosing a side. Either §19.6 is relaxed for
the `tenants` reference — defensible, since tenant identity is arguably platform
infrastructure rather than a peer service — or W1-DATA-06 has to be withdrawn and
23 constraints reverted, which would remove referential integrity that was added at
explicit request and proved live.

**Recommendation:** amend §19.6 to exempt the tenant reference and state the
exemption, rather than unwind the gate. But that is a charter amendment and needs
the charter's owner.

---

## V5 — Hardcoded UI strings

**Violates:** §11.5 ("no hardcoded UI strings"), §46 ("localization readiness")
**Status:** `partial` · **Severity: medium**

8 of 9 fees pages carry hardcoded display copy. Currency formatting was fixed in
#337 — it now resolves from locale rather than a hardcoded `en-IN` — but the copy
itself was not.

Scope beyond fees is **unverified**; only that module was examined.

---

## V6 — No email or notification adapter

**Violates:** Volume 2 Table 6 ("Email/notification — SMTP, SES, vendor adapters")
**Status:** `absent` pending confirmation · **Severity: medium**

A search for `nodemailer` and `@aws-sdk/client-ses` across `packages` and `apps`
returns **0 files**. A `notification` service package exists, so the gap may be a
missing delivery adapter behind a present abstraction rather than an absent
capability. Confirm before acting — this is the weakest-evidenced item here.

---

## Compliant, verified

Stated because under-reporting is as inaccurate as over-reporting.

**§21.2 and §46 queue adapter choice — implemented.** All three mandated adapters
exist as real files, `sqs-adapter.ts`, `kafka-adapter.ts` and
`rabbitmq-adapter.ts`, and `packages/shared/queue-abstraction/src/factory.ts`
selects between them on `QUEUE_BACKEND: 'kafka' | 'rabbitmq' | 'sqs'`. Declared
dependencies match: `@aws-sdk/client-sqs`, `kafkajs`, `amqplib`. §21.4's
abstraction requirement is satisfied by the factory: services publish through the
abstraction rather than binding to a provider.

I expected a stub here and was wrong.

**Adapters present for other Table 6 rows** — object storage (S3), search
(OpenSearch/Elasticsearch), SCIM, SAML, KMS/Vault, and OpenTelemetry all have
files. Presence is not conformance: none was tested for the §10 requirements of
config schema, health checks, contract tests and failure behaviour.

---

## Priority

1. **V2** — shared table ownership. Highest value: it is the structural cause of
   the open P0, so fixing ownership and fixing the isolation defect are the same
   work.
2. **V3** — remove MySQL from the wizard, or commit to implementing it. Currently
   an operator-facing trap.
3. **V4** — charter decision on the tenant FK exemption. Blocks knowing whether
   V1's remediation direction is even correct.
4. **V1** — table ownership and naming. Large, and should follow V4 so it is not
   done twice.
5. **V5**, **V6**.

## What would make this report complete

An environment that deploys and a database that migrates from empty (T1, T11).
Until both exist, every Volume 1 claim about installation, upgrade, operability,
SLOs and isolation verification remains `unverified` — which is most of §16, §28,
§38, §39 and §43.
