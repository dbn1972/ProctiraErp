# P0 — `control_plane_documents` provides no tenant isolation via `PgDocumentCollection`

**Audited SHA:** `3b6210a6d8dc9add0393c2f591de30e62ca47daa`
**Date:** 2026-09-20
**Status:** `OPEN` — verified live, not remediated
**Found by:** `docs/audits/templates/MODULE_DEEP_EVALUATION_PROMPT.md`, whose
"claims that are not permitted" table already warned of this. This document
confirms the warning still holds at tip and quantifies the exposure.

---

## Finding

`control_plane_documents` has RLS enabled **and forced**, but its policy carries an
unconditional escape hatch:

```sql
tenant_isolation USING (
  (tenant_id = NULLIF(current_setting('app.tenant_id', true), ''))
  OR (current_setting('app.platform_admin', true) = '1')
)
```

`withPlatformScope` in `packages/shared/database/src/pg-document-store.ts:40` binds
that escape on **every** call:

```ts
await client.query(`SELECT set_config('app.platform_admin', '1', true)`);
```

Every read and write performed through `PgDocumentCollection` therefore takes the
escape branch. For this table, `FORCE ROW LEVEL SECURITY` is decorative: the policy
is satisfied before `tenant_id` is ever compared.

## Live reproduction

Executed as `proctira_app` (`rolsuper=false`, `rolbypassrls=false`) against a
migrated database.

```sql
-- two documents, two tenants
INSERT INTO control_plane_documents (collection,id,tenant_id,data,created_at,updated_at)
VALUES ('billing.plans','probe-a','...aa','{"secret":"TENANT_A_DATA"}',now(),now()),
       ('billing.plans','probe-b','...bb','{"secret":"TENANT_B_DATA"}',now(),now());

SET ROLE proctira_app;

-- scoped to tenant B only
SELECT set_config('app.tenant_id','...bb',false);
SELECT count(*) FROM control_plane_documents WHERE id='probe-a';   -- 0   correct

-- same session, plus what PgDocumentCollection always binds
SELECT set_config('app.platform_admin','1',false);
SELECT data->>'secret' FROM control_plane_documents WHERE id='probe-a';
--  TENANT_A_DATA      <-- cross-tenant read
```

| Probe                                      | Result                               |
| ------------------------------------------ | ------------------------------------ |
| Tenant B, tenant GUC only                  | `0` rows — isolation holds           |
| Tenant B **plus** `app.platform_admin='1'` | reads tenant A's row; leaks its data |
| Total rows visible under the escape        | **21 rows across 13 tenants**        |

The third row is the blast radius on a small evaluation database. In production it
is every document of every tenant.

## Affected data

Both modules store tenant-owned records as logical collections in this one table.
Note the collection keys are **not** real relations — `to_regclass('auth.otp_challenges')`
returns NULL and no `auth` schema exists, so a reader looking for dedicated tables
finds nothing and may wrongly conclude the data is not persisted.

| Module    | Collection keys                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------- |
| `auth`    | `auth.keycloak_identities`, `auth.users`, `auth.tenants`, `auth.otp_challenges`, `auth.invites` |
| `billing` | `billing.plans`, `billing.subscriptions`, `billing.entitlements`, `billing.usage`               |

Identity records and billing entitlements are exactly the data where cross-tenant
read is most damaging.

## Why this was easy to miss

Three separate signals point away from it:

1. **`mount-matrix.ts` labels both modules `persistence: 'in-memory'`** — so the
   matrix implies no tenant data is persisted at all. Corrected in the same change
   as this document.
2. **`relrowsecurity` and `relforcerowsecurity` are both `true`**, so any check that
   asserts "RLS enabled" passes. The defect is in the policy predicate, not the flag.
3. **The collection names look like tables but are not**, so a table-oriented audit
   finds no `auth_*` tables and moves on.

## Contrast: tables that do isolate

Verified live in the same session, for comparison:

- `admission_form_configurations` and the 16 `fee_*` / `parent_fee_*` tables use a
  plain `tenant_id = current_setting('app.tenant_id')` policy with **no**
  `platform_admin` branch. Cross-tenant read returns 0, cross-tenant `UPDATE`
  affects 0 rows, and an explicit `app.platform_admin='1'` attempt still returns 0.

So the pattern is sound elsewhere; the defect is specific to this shared table and
the helper that always escapes it.

## The methods have no tenant predicate — this is worse than the policy alone

Re-examined 2026-09-20 after the first draft of this document. The exposure is not
only that the policy can be escaped; it is that most `PgDocumentCollection` methods
**never filter by tenant in SQL at all**:

| Method                       | Tenant predicate in SQL             |
| ---------------------------- | ----------------------------------- |
| `get(id)`                    | **none** — `collection` + `id` only |
| `delete(id)`                 | **none**                            |
| `all()`                      | **none**                            |
| `count()`                    | **none**                            |
| `byTenant(tenantId)`         | yes                                 |
| `where(criteria, tenantId?)` | only when `tenantId` is passed      |

So those four methods delegate isolation entirely to RLS, and then the helper
defeats RLS on the same connection. Verified live through the exact query `get()`
issues, as `proctira_app` scoped to tenant B:

```
row_owner                              | leaked
aaaaaaaa-0000-4000-8000-0000000000aa   | TENANT_A     <-- tenant B called get()

rows_visible_without_escape = 0                        <-- same query, escape removed
```

Two consequences:

1. **The exposure is reachable through the normal API**, not just raw SQL. Any caller
   holding a document id reads that document regardless of which tenant owns it.
   Collection + id is effectively a global key.
2. **Removing the escape alone is not a fix — it is an outage.** With no tenant
   predicate to fall back on, `get()` would start returning `null` for every
   tenant-owned document. The second line above shows exactly that: 0 rows.

## Classification resolved (2026-09-20)

Step 2 was blocked on deciding which collections are tenant-owned. The repository
owner has settled the underlying invariant — see
`docs/audits/TENANCY_IDENTITY_INVARIANT.md`:

> A board is the tenant. One person cannot belong to two boards, therefore **one
> identity belongs to exactly one tenant, always.**

Consequently **no user-facing code path requires a cross-tenant escape**, and every
affected collection is tenant-owned:

| Collection                                                                        | Scope for step 2     |
| --------------------------------------------------------------------------------- | -------------------- |
| `auth.keycloak_identities`, `auth.users`, `auth.otp_challenges`, `auth.invites`   | `{ tenantId }`       |
| `auth.tenants` (personal directory for the signed-in user; one row per identity)  | `{ tenantId }`       |
| `billing.plans`, `billing.subscriptions`, `billing.entitlements`, `billing.usage` | `{ tenantId }`       |
| platform-admin console state, tenant-lifecycle records                            | `{ platform: true }` |

Multi-school access — a headmaster with additional charge of a second school — is
served **inside** one tenant by the existing `institutions[]` claim and
`decideInstitutionScope`. It is not a reason to relax tenant isolation, so it does
not constrain this fix.

## Remediation options

The escape's only defensible use is platform operations by the ProctiraERP
operator, a distinct actor tier from any board or school user, and that use must be
explicit rather than ambient.

**Correction to an earlier recommendation.** Option 2 below was initially proposed as
"the smallest fail-closed step". That was wrong on its own: making the escape
explicit without also adding tenant predicates to `get`/`delete`/`all`/`count` would
break every tenant-scoped read. Option 2 is necessary but not sufficient — it must
be paired with Option 1 or 3.

1. **Split the predicate by intent.** Keep the escape for a genuinely
   platform-scoped collection set, and require a tenant match for tenant-owned
   collections. Needs a per-collection classification first.
2. **Stop binding the escape by default.** Make `withPlatformScope` require an
   explicit `platformScoped: true` argument, so a tenant-scoped read cannot silently
   obtain it. This is the smallest change that removes the "every call escapes"
   property.
3. **Give tenant-owned collections real tables** with the standard policy, leaving
   `control_plane_documents` for genuinely platform-level documents. Largest change,
   best end state, and it would also make the data visible to table-oriented audits.

**Recommended: Option 2 paired with Option 1.** Option 2 stops every call escaping by
default and forces intent to be declared; Option 1 gives the tenant-scoped methods a
real `tenant_id = $n` predicate so they still work once the escape is gone. Neither
alone is safe: Option 2 by itself is an outage, Option 1 by itself leaves the escape
available to any future call site.

Sequencing that avoids a broken intermediate state:

1. Add the tenant predicate to `get`/`delete`/`all`/`count` (they gain a required
   `tenantId`, or an explicit platform-scoped variant). Behaviour is unchanged while
   the escape is still bound, so this ships safely on its own.
2. Classify each collection as tenant-owned or platform-owned, and route call sites
   to the matching method. `auth.*` and `billing.*` are tenant-owned.
3. Only then make the escape explicit in `withPlatformScope`. By this point nothing
   tenant-scoped depends on it, so the change is inert for correct callers and
   fail-closed for any that were missed.

Step 1 is the useful first commit and carries no behavioural risk.

## Acceptance criteria

1. A committed `.live.test.ts` asserts that, as `proctira_app` scoped to tenant B, a
   read of a tenant-A document returns 0 rows **through the same code path the
   application uses** (`PgDocumentCollection`, not raw SQL).
2. `grep -n "set_config('app.platform_admin'" packages/shared/database/src/pg-document-store.ts`
   shows the bind is conditional, not unconditional.
3. Every call site that legitimately needs platform scope passes the explicit flag,
   and the list of such call sites is enumerated in review.
4. `auth` and `billing` entries in `mount-matrix.ts` continue to state their real
   persistence so the exposure is not re-hidden.
