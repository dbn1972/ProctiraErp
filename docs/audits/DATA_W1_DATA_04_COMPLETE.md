# DATA — W1-DATA-04 Prisma ↔ SQL schema drift (COMPLETE)

**Module / slice:** Schema authority + catalog drift gate  
**Branch / tip:** `cursor/w1-data-04-drift-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Environment:** static SQL corpus gate (always-on CI; no Postgres required for the gate)

## Finding (PARTIAL → COMPLETE)

The initial W1-DATA-04 gate (`#190`) only checked:

- Prisma `@@map` tables have *some* `CREATE TABLE` in migrations or `db/sql`
- Critical auth session models keep columns in numbered SQL

It did **not** enforce column/type/nullability/default/PK/unique/check/FK/index
parity, nor a single declared schema authority per table. Fresh-DB CI could
therefore converge on a catalog that still drifted from `schema.prisma`
(missing indexes, `search_vector`, dual CREATE without ownership).

## Scope (this PR)

| Artifact | Path | Notes |
| -------- | ---- | ----- |
| Gate | `tools/scripts/check-prisma-sql-drift.mjs` | Full catalog parity + authority |
| Authority | `tools/scripts/prisma-sql-schema-authority.json` | One DDL owner per Prisma-mapped table |
| Tests | `tools/scripts/check-prisma-sql-drift.test.mjs` | Unit + on-disk fixture |
| Additive SQL | `db/sql/081_prisma_sql_catalog_parity.sql` | Missing indexes + `search_vector` |
| CI | `.github/workflows/ci.yml` job `prisma-sql-drift` | Always-on; aggregate skip fails closed |
| Docs | `db/README.md`, `tools/scripts/README.md` | Operator + script index |

## Invariants

1. **Authority:** every Prisma-mapped table is listed in
   `prisma-sql-schema-authority.json` with `authority: "prisma" | "sql"`.
   Dual `CREATE TABLE` fails unless `mirrorOk: true`.
2. **Critical auth:** `refresh_tokens` / `user_sessions` must remain
   `authority: sql` with CREATE + columns under `db/sql/`.
3. **Catalog parity (fail-closed, practical type families):** for every Prisma
   model, SQL corpus must match columns, types, nullability, defaults, PK,
   UNIQUE, CHECK (SQL-recorded + enum types), FK, and INDEX (including GIN).
4. **Apply order:** Prisma migrate deploy before `apply-sql.sh` (documented +
   gated).

## Residuals closed by `081_prisma_sql_catalog_parity.sql`

| Gap | Fix |
| --- | --- |
| `geographic_areas` missing `(tenant_id,parent_id)` / `(tenant_id,lft,rgt)` | indexes |
| `institutions` missing `(tenant_id,area_id)` + GIN(`custom_data`) | indexes |
| `students` / `staff` missing `search_vector` + GIN indexes | columns + indexes |
| `staff` missing name index | index |
| `enrollments` / `academic_periods` / `grades` missing status/order indexes | indexes |

## Apply / verify

```bash
# static (CI — always on)
pnpm check:prisma-sql-drift:test
pnpm check:prisma-sql-drift

# fresh DB inherits the same corpus via migrate + apply-sql
pnpm --filter @proctira/database run prisma:migrate:deploy
bash tools/scripts/apply-sql.sh
```

## Non-goals / residuals (honesty)

| Residual | Status |
| -------- | ------ |
| Gate is static SQL text analysis, not live `information_schema` introspection | **Accepted** — same posture as W1-DATA-06/16; CI apply order uses this corpus |
| `timestamp` ↔ `timestamptz` treated as compatible | **Practical** — Prisma often omits `@db.Timestamptz` |
| SQL-only CHECKs / indexes beyond Prisma declarations | **Allowed** (SQL may be stricter) |
| Domain-only tables not in Prisma | **Out of scope** for this gate |

## Rollback

Forward-fix only: dropping `076_*` indexes/columns re-opens the CI gate.
Do not remove authority entries without replacing CREATE ownership.

## Sign-off

**Data claim:** Certified (static catalog parity + authority manifest + always-on CI).  
**Status:** W1-DATA-04 **COMPLETE** (PARTIAL cleared).
