# Platform gap analysis — ProctiraERP

| Field            | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Audited SHA      | `cdd58da1952a0c1935b8c1f05bc635b88211a697`                            |
| Date             | 2026-09-18                                                            |
| Evidence DB      | PostgreSQL 16, 113 domain SQL files, `APPLY_STRICT_FKS=1`, 243 tables |
| Runtime role     | `proctira_app` — NOSUPERUSER, NOBYPASSRLS (verified)                  |
| Supporting infra | Keycloak 25 realm `proctira`, Redis 7, MinIO (S3 API verified)        |
| Method           | `docs/audits/templates/MODULE_DEEP_EVALUATION_PROMPT.md`              |

## Corrections to previously merged reports

Recorded first because both are now on `main` and wrong.

1. **`auth` and `tenant` reports claim no runbook exists.** Both
   `docs/runbooks/auth.md` and `docs/runbooks/tenant.md` are present, among 34
   runbooks. The claim was produced by not looking. Operability for those two
   modules should read `partial`, not `absent`.
2. **`auth` report initially rated the RLS bypass P0.** Corrected to P1 before
   merge after reading the post-fetch ownership checks. Noted here so the
   downgrade is not mistaken for minimisation.

## What is genuinely strong

Established by direct measurement, not documentation.

| Control                          | Evidence                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tenant isolation at the database | 234 tenant-scoped tables, **237/243 with RLS enabled and FORCED**, zero tenant-scoped tables without RLS           |
| Referential integrity            | **211 validated** tenant FKs, **zero unvalidated**                                                                 |
| Runtime role posture             | app role is NOSUPERUSER and NOBYPASSRLS, so RLS assertions are real                                                |
| Fail-closed persistence          | `assertInMemoryFallbackAllowed` throws when `DATABASE_URL` is set or `NODE_ENV=production`                         |
| Observability                    | 6 alert rule groups (availability, latency, error rate, queue lag, saturation, critical journeys), **34 runbooks** |
| Queue abstraction                | real Kafka, RabbitMQ and SQS adapters plus a PG outbox with a relay                                                |
| Deployment assets                | 2 Helm charts, 16 k8s base manifests, deploy workflow, cosign in 3 workflows                                       |
| Honesty engineering              | stubs refuse to fake success; `PROVIDER_MODE=live` throws rather than returning OK                                 |
| Code hygiene                     | **1** TODO across all backend source                                                                               |

This is a well-disciplined codebase. The gaps below are not sloppiness; they are
unfinished integration and unverified breadth.

## P0 — blocks production

### 1. The product cannot transact

| Channel  | State                                                                 |
| -------- | --------------------------------------------------------------------- |
| Payments | `payment-adapter.ts` sandbox stub, "G-202 waived for live PSP"        |
| SMS      | sandbox; "Live SMS adapter not implemented — refusing silent success" |
| Email    | sandbox; same refusal                                                 |
| Push     | sandbox; same refusal                                                 |

**No provider SDK exists in any `package.json`** — searched for razorpay, stripe,
payu, paytm, twilio, sendgrid, firebase-admin, nodemailer. All absent.

Consequence: fees cannot collect money, MFA-over-SMS cannot deliver a code, and no
parent can be notified. Three flagship SIS workflows are demo-only.

### 2. Tenant suspension does not take effect

`isRequestTenantSuspended` (`tenant-entitlement.ts:30`) consults a JWT claim and a
module-level `Set<string>` seeded only from `TENANT_SUSPENDED_IDS` at import.
`tenants.status` is never read. The Set is process-local and cleared on restart.

`/api/v1/tenant-lifecycle` writes a document collection that is **empty** for
provisioned tenants — verified live: 3 rows in `tenants`, 0 documents. Suspension
is the control that stops a non-paying or compromised tenant from mutating data.

### 3. Three representations of a tenant

`tenants` table (authoritative, 211 FKs point at it) · `tenant.tenants` documents
(what lifecycle uses) · `platform-admin-ui` owning `/api/v1/tenants` as `ui-seed`.
No reconciliation. Scope is bounded: I checked every document collection against
the live catalogue and **`tenant.tenants` is the only one that shadows a real
table**.

### 4. Nothing is deployed

No application process listens on any port on this host. Helm and k8s assets exist
but are unexercised against a cluster. Every runtime claim in this report is from a
locally assembled environment, not a running system.

## P1 — integrity and verification

### 5. 28 of 39 source modules have no live database proof

694 test files, but only **23** are DB-backed. Modules with live proof: `assessment`,
`attendance`, `examination`, `fees`, `gradebook`, `institution`, `parent-portal`,
`staff`, `student`, `timetable`, `workflow`.

Highest risk without it: **`health`** (7 PG stores holding PHI) and **`auth`** (the
trust boundary for everything else).

### 6. RLS is bypassed for all document-store state

`PgDocumentCollection` binds `app.platform_admin='1'` on every call
(`pg-document-store.ts:40`), which the policy accepts as a full escape. Proven live:
tenant B reads tenant A's row with the GUC set, 0 rows without it.

Isolation currently holds through application controls — bearer tokens,
tenant-prefixed keys, and post-fetch `doc.tenantId === tenantId` checks present at
every call site reviewed. So this is a **missing backstop**, not a live leak. It
covers 14 collections across `auth` (5), `tenant` (6), `billing` (3).

One path has no ownership assertion anywhere:
`billing/pg-billing-repository.ts:204` `deleteEntitlementsBySubscription` takes no
tenant and queries across all tenants.

### 7. 23 tables have no referential integrity to `tenants`

13 PHI tables, 4 audit tables, `control_plane_documents`, 5 UI projections. Their
`tenant_id` is `text`, so an FK to a `uuid` column is impossible without a type
migration. **Now tracked** by the allowlist added in #322, and the gate fails on any
new occurrence. The 23 migrations remain open.

### 8. Report artefacts default to local disk

`report` writes "local-disk blobs unless `S3_*` is set". Not durable, not
multi-replica safe. MinIO is now proven to work, so this is configuration, not
capability.

## P2 — breadth

### 9. Nine modules are not mounted

`admin-dashboard`, `custom-field`, `dashboards`, `data-warehouse`, `install`,
`plugin`, `policy`, `survey`, `theme` — `persistence: n/a`, `rbacWired: false`.
Because the fail-closed guard throws in production, these cannot run there at all.

### 10. Five packages contain no source

`alumni`, `canteen`, `finance`, `inventory`, `payroll` — no `src/` directory, zero
`.ts` files, absent from the mount matrix. Re-confirmed at this SHA. `payroll` is
notable: `staff` is one of the best-verified modules, so HR exists without payroll.

### 11. The mount matrix misreports persistence

Labels `auth`, `billing`, `developer-portal` as `in-memory`; all three select
Postgres at runtime (`create-billing-repository.ts:20`,
`create-developer-portal-repository.ts:50`, `pg-otp-store.ts:61`). An audit trusting
the matrix reaches the wrong conclusion.

### 12. `docker compose up minio` fails

`docker-compose.yml:112` specifies `minio/minio`, which Docker Hub refuses.
`quay.io/minio/minio` works. Blocks local object-storage setup.

## Gap matrix

| #   | Capability                       | Evidence status | Gap                       | Impact                 | Priority | Effort |
| --- | -------------------------------- | --------------- | ------------------------- | ---------------------- | -------- | ------ |
| 1   | Fee collection                   | absent          | sandbox PSP only, no SDK  | no revenue             | P0       | M      |
| 2   | Parent/guardian messaging        | absent          | sandbox SMS/email/push    | core SIS channel dead  | P0       | M      |
| 3   | Tenant suspension                | partial         | gate reads in-process Set | control ineffective    | P0       | M      |
| 4   | Tenant source of truth           | partial         | 3 unsynchronised stores   | silent drift           | P0       | L      |
| 5   | Deployment                       | unverified      | nothing running           | no production evidence | P0       | L      |
| 6   | Live DB verification             | absent          | 28/39 modules unproven    | regressions undetected | P1       | L      |
| 7   | RLS backstop for documents       | partial         | platform_admin escape     | latent leak surface    | P1       | M      |
| 8   | Referential integrity, 23 tables | partial         | text tenant_id            | orphan rows            | P1       | L      |
| 9   | Durable report artefacts         | partial         | local disk default        | data loss              | P1       | S      |
| 10  | Nine unmounted modules           | absent          | no PG, no RBAC            | capability absent      | P2       | L      |
| 11  | Five empty packages              | absent          | no source                 | roadmap inflation      | P2       | XL     |
| 12  | Mount matrix accuracy            | partial         | 3 stale labels            | misleads audits        | P2       | S      |
| 13  | Compose object storage           | partial         | wrong registry            | local setup blocked    | P2       | S      |

## Recommended sequence

1. **One PSP, one SMS, one email provider, end to end.** Until then the platform
   demonstrates rather than operates.
2. **Fix tenant suspension** to read `tenants.status`, and point lifecycle at the
   authoritative table.
3. **Live DB tests for `health` and `auth`** — highest unproven risk.
4. **Deploy to one environment** with the existing Helm charts and measure against
   the 6 alert groups.
5. **Add tenant-scoped read methods** to `PgDocumentCollection` and stop binding
   `platform_admin` for tenant-owned collections.
6. Then breadth: the 23 type migrations, the nine unmounted modules, and a decision
   on the five empty packages.

## Honest scope of this audit

**Verified by execution:** database posture, RLS and FK counts, role attributes,
cross-tenant probes, provider stub state, dependency absence, file and test counts,
mount matrix parsing, S3 round-trip, gate behaviour.

**Not verified at all:**

- UX and accessibility across 202 web pages, 17 admin-console pages, 8 registration
  pages, 28 Flutter screens. No screen was opened.
- Performance, load, or concurrency beyond what existing tests assert.
- The five external IdP providers (Google, Microsoft, OAuth2, OIDC, SAML) — no
  credentials.
- Multi-replica behaviour for anything.
- Business-logic correctness of academic, fee or statutory calculations.
- 37 of 39 modules at the depth applied to `auth` and `tenant`.

Two modules of 39 have had a genuine deep evaluation. The P0 and P1 items above are
platform-level and I expect them to hold, but per-module functional gaps are
largely undiscovered. Treat module-level dispositions here as **provisional** except
for `auth` and `tenant`.
