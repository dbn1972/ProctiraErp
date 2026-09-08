# Database — canonical apply order

ProctiraERP uses **two** schema layers:

1. **Prisma** (`packages/shared/database`) — shared platform tables and migrations  
2. **Domain SQL** (`db/sql/[0-9]*.sql`) — module schemas (health, SIS, transport, …) that services expect on live Postgres

If only Prisma is applied, raw-SQL modules fall back to in-memory stores in tests (gap **G-002**).

## Apply order (required)

```bash
# 1) Prisma first
export DATABASE_URL=postgresql://USER:PASS@HOST:5432/DB
pnpm --filter @proctira/database run prisma:migrate:deploy

# 2) Domain SQL (001…N, including *b* demo seeds colocated under db/sql/)
bash tools/scripts/apply-sql.sh
```

`tools/scripts/apply-sql.sh`:

- Prefers `DATABASE_URL`; otherwise uses libpq env vars (`PGDATABASE` defaults to `proctira`)
- Applies every `db/sql/[0-9]*.sql` in **`LC_ALL=C` sort order** (so `006_…schema` runs before `006b_…seed`)
- Uses `psql -v ON_ERROR_STOP=1` and exits non-zero on failure
- Supports `--dry-run` to list files without applying

CI Integration Tests run step (2) immediately after `prisma:migrate:deploy`.

## Seeds (`db/seeds/`) — separate, not auto-applied

Files under `db/seeds/` are **demo / certification data** (large enrollments, board scales, schedule demos). They are **not** applied by `apply-sql.sh` because they can be destructive or environment-specific.

Apply explicitly when needed, for example:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/seeds/002_multi_board_schools_500.sql
```

`tools/scripts/setup-live-db-and-onboard.sh` runs `apply-sql.sh` for all numbered domain SQL, then applies the multi-board onboard seed.

Module-local demo seeds that ship next to schema (`006b`, `007b`, …) **are** included in the numbered `db/sql/` apply and run after their schema file.
