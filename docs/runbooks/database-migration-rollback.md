# Runbook — Database migration & rollback

**Owner:** platform / data (`#proctira-platform`)
**Applies to:** every environment that runs `prisma migrate deploy` and
`tools/scripts/apply-sql.sh` (staging, production, restore drills).
**Related:** [BACKUP_RESTORE.md](../BACKUP_RESTORE.md),
[SECRETS_ROTATION.md](../SECRETS_ROTATION.md), `restore-drill.yml`.

ProctiraERP has **two schema tracks** that must move together:

| Track  | Source                                        | Applier                      | Ledger                            |
| ------ | --------------------------------------------- | ---------------------------- | --------------------------------- |
| Prisma | `packages/shared/database/prisma/migrations/` | `prisma migrate deploy`      | `_prisma_migrations`              |
| Raw    | `db/sql/NNN_*.sql` (LC_ALL=C order)           | `tools/scripts/apply-sql.sh` | `schema_migrations` (file+sha256) |

Neither applier ever runs a destructive statement on its own: every file is
additive (`CREATE ... IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`,
`DROP POLICY IF EXISTS` + `CREATE POLICY`). **Rollback therefore means either a
forward "revert" migration or a point-in-time restore — never `prisma migrate
reset` and never hand-editing `_prisma_migrations`.**

---

## 1. Pre-flight (every migration, every environment)

1. **Fresh logical backup** with the BYPASSRLS role (FORCE RLS makes app-role
   dumps empty; the script refuses with exit 2):

   ```bash
   DATABASE_URL="$BACKUP_DATABASE_URL" BACKUP_DIR=/backups/pre-migrate \
     bash tools/scripts/pg-backup.sh
   ```

   Keep the printed dump path — it is the rollback target for §4.

2. **Dry-run the raw track** to see exactly which files are pending:

   ```bash
   bash tools/scripts/apply-sql.sh --dry-run
   ```

   `APPLY_SEEDS` must be unset (demo seeds never reach production);
   `APPLY_STRICT_FKS=1` is expected in staging/production.

3. **Prisma diff** (read-only) against the target:

   ```bash
   pnpm --filter @proctira/database exec prisma migrate status
   ```

   Anything other than "Database schema is up to date" / a list of pending
   migrations (no "failed" entries) blocks the deploy.

4. **Long-lock review.** Any migration that `ALTER TABLE ... ADD CONSTRAINT`
   without `NOT VALID`, adds an index without `CONCURRENTLY`, or rewrites a
   table (type change, `SET NOT NULL` on a large table) needs a maintenance
   window. `021b_tenant_fk_constraints.sql` uses `NOT VALID` for this reason;
   validate later with `ALTER TABLE <t> VALIDATE CONSTRAINT <t>_tenant_fk;`.

---

## 2. Apply (order matters)

```bash
# 1) Prisma first — core tables the raw SQL references (tenants, students…)
pnpm --filter @proctira/database run prisma:migrate:deploy

# 2) Raw domain SQL, RLS policies, indexes, FKs
APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh
```

In Kubernetes run both as a one-shot `Job` from the `api-gateway` image with
the **migration role** (`DATABASE_URL` of a role that owns the schema), not
the runtime app role. Roll the Deployments only after the Job exits 0.

Post-apply checks:

```sql
SELECT migration_name, finished_at FROM _prisma_migrations
 WHERE rolled_back_at IS NULL ORDER BY finished_at DESC LIMIT 5;
SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;
-- RLS still enforced on every tenant table:
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity
   AND EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = c.relname AND column_name = 'tenant_id');
```

The last query must return **zero rows** (the `definition-of-done.yml`
workflow runs the same check).

---

## 3. Rollback — decision tree

| Situation                                                           | Action                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------- |
| App bug, schema is fine                                             | Roll back the **image** (`helm rollback proctira-<svc> <rev>`) |
| Migration applied cleanly but the change is wrong                   | **Forward revert migration** (§3.1)                            |
| Migration failed midway (Prisma marks it failed; raw track aborted) | **Resolve + re-run** (§3.2)                                    |
| Data corrupted / dropped by a migration                             | **Point-in-time restore** from §1 dump (§4)                    |

### 3.1 Forward revert migration

Write a new migration that undoes the change (drop the new column/index,
restore the previous policy body, etc.). Never delete or edit the migration
that shipped — both ledgers hash their inputs and a drifted checksum blocks
every future deploy.

- Prisma: `pnpm --filter @proctira/database exec prisma migrate dev --name revert_<name>`
  in a dev database, review the generated SQL, commit, deploy with §2.
- Raw: add `db/sql/NNN_revert_<name>.sql` (next free number); the applier
  records it like any other file.

### 3.2 Failed Prisma migration

```bash
# Inspect
pnpm --filter @proctira/database exec prisma migrate status
# If the partial statements were NOT applied (transactional DDL rolled back):
pnpm --filter @proctira/database exec prisma migrate resolve --rolled-back <migration_name>
# If they WERE applied (e.g. CREATE INDEX CONCURRENTLY outside a tx), fix the DB
# by hand to match the migration, then:
pnpm --filter @proctira/database exec prisma migrate resolve --applied <migration_name>
pnpm --filter @proctira/database run prisma:migrate:deploy
```

For the raw track, `apply-sql.sh` stops at the first failing file and does not
record it; fix the file (or the data it trips over) and re-run — earlier files
are skipped via `schema_migrations`.

---

## 4. Point-in-time restore

Only when data is lost. Restores into a **new** database, verifies, then
switches the app — the original stays untouched for forensics.

```bash
# 1) Create the target DB and restore the pre-migration dump into it
#    (pg-restore.sh restores into whatever DATABASE_URL points at: --clean --if-exists --no-owner)
psql "$BACKUP_DATABASE_URL" -c 'CREATE DATABASE proctira_rollback'
ROLLBACK_URL="${BACKUP_DATABASE_URL%/*}/proctira_rollback"
DATABASE_URL="$ROLLBACK_URL" bash tools/scripts/pg-restore.sh /backups/pre-migrate/<dump>.dump

# 2) Row parity vs. the source (same tables restore-drill.yml compares)
for url in "$BACKUP_DATABASE_URL" "$ROLLBACK_URL"; do
  psql "$url" -Atc "SELECT 'tenants', count(*) FROM tenants
    UNION ALL SELECT 'boards', count(*) FROM boards
    UNION ALL SELECT 'institutions', count(*) FROM institutions
    UNION ALL SELECT 'students', count(*) FROM students"
done

# 3) Scale writers to zero, repoint DATABASE_URL secrets, scale back up
kubectl -n proctira-production scale deploy -l app.kubernetes.io/part-of=proctira-platform --replicas=0
# update the Secret / ExternalSecret source → proctira_rollback
kubectl -n proctira-production scale deploy -l app.kubernetes.io/part-of=proctira-platform --replicas=3
```

Writes between the dump and the restore are lost; announce the window in the
incident channel and reconcile from the audit trail (`audit_log_entries`) where
possible.

---

## 5. Verification after any rollback

- `GET /health` and `GET /api/v1/services` on the gateway return 200.
- `e2e-backend-ready.yml` (`workflow_dispatch`, `require_live=true`) against
  staging is green.
- RLS query from §2 returns zero rows.
- `restore-drill.yml` next scheduled run passes (or dispatch it now).

## 6. Escalation

1. Platform on-call (`#proctira-platform`) — owns both schema tracks.
2. Data-protection officer if PHI tables (`health_*`, `counselling_*`) were
   part of the rollback window (see [DATA_RETENTION.md](../DATA_RETENTION.md)).
