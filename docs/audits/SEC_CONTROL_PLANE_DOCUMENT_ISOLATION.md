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

## Remediation options

Not applied here. This needs a decision from a tenancy/security owner, because
some control-plane reads are legitimately cross-tenant (platform admin listing
tenants, for instance) and a naive tightening would break them.

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

Option 2 is the smallest step that closes the hole without reclassifying data, and
it fails closed: any call site that needs platform scope must now say so.

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
