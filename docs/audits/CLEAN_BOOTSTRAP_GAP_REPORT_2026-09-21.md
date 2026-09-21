# Clean-bootstrap gap report — 2026-09-21

**Audited SHA:** `4d4706cd` (`main`)
**Method:** the bootstrap mandated by both prompts — a **new, empty database**, all of
`db/sql` applied via `tools/scripts/apply-sql.sh` with `APPLY_STRICT_FKS=1`,
connecting as the non-superuser roles (`proctira` migrator, `proctira_app` runtime).

This report is short because the mandated method **stopped at migration 65 of 107**,
and that stoppage is the finding.

---

## Why this run differs from earlier ones

Every previous "live-verified" claim in this repository's recent audits — including
mine from earlier today — was executed against a database that had been built up
incrementally over many sessions. `apply-sql.sh` reported `ledger_skipped=106` on it,
meaning almost nothing was actually being applied.

This run used a database created seconds earlier. That is the only difference, and it
was enough to surface a blocker that incremental application cannot see.

---

## P0 — `db/sql` cannot bootstrap an empty database

`absent` / `OPEN` · **not previously reported**

```
==> Applying db/sql/065_tenant_timezone_foundation.sql (per-file transaction)
psql: ERROR:  column "timezone" of relation "tenants" contains null values
error: W1-DATA-17 apply failed for db/sql/065_tenant_timezone_foundation.sql
```

71 migrations applied; the chain halts at `065`, with 36 files never reached.

### Root cause

Not a missing backfill — the migration has one:

```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone TEXT;

UPDATE tenants
   SET timezone = COALESCE(NULLIF(trim(config #>> '{locale,timezone}'), ''),
                           NULLIF(trim(config ->> 'timezone'), ''), 'UTC')
 WHERE timezone IS NULL;                      -- updates 0 rows

ALTER TABLE tenants ALTER COLUMN timezone SET NOT NULL;   -- therefore fails
```

`tenants` is `FORCE ROW LEVEL SECURITY`, and its policy is:

```
id::text = NULLIF(current_setting('app.tenant_id', true), '')
  OR current_setting('app.platform_admin', true) = '1'
```

`apply-sql.sh` binds neither GUC — confirmed, it contains no `set_config` and no
reference to `app.tenant_id`. So the migrator is subject to the policy and sees
nothing. Measured on the clean database:

| Role | Rows visible in `tenants` |
| --- | --- |
| `postgres` (superuser) | 1 |
| `proctira` (migrator, NOSUPERUSER NOBYPASSRLS) | **0** |

And directly:

```
as migrator, no GUC        :  UPDATE tenants SET name = name   ->  UPDATE 0
as migrator, GUC bound     :  SET app.tenant_id='...'; same    ->  UPDATE 1
```

The backfill is a **silent no-op**. `SET NOT NULL` then behaves correctly by
failing — it is the only reason this is visible at all.

The row it cannot see comes from `021a_strict_fk_prerequisite_tenants.sql`:

```sql
INSERT INTO tenants (id, name, slug, config, status)
VALUES ('00000000-0000-4000-8000-000000000001', 'Strict-FK demo tenant',
        'strict-fk-demo', ...)
```

No `timezone`, and `065` is the migration that makes the column mandatory.

### Impact

- **No fresh environment can be provisioned from `db/sql`.** That covers new
  deployments, a UAT environment, and disaster recovery from schema.
- Any restore drill that starts from an empty database is affected. Whether the
  `restore-drill` workflow starts empty or from a snapshot is **unverified**.
- It is not known why CI does not hit this. CI runs the same script, the same
  `APPLY_STRICT_FKS=1`, and the same NOSUPERUSER migrator, so either CI never
  applies from truly empty, or something in its bootstrap differs. **Unverified —
  and worth resolving, because if CI never applies from empty then this path has no
  coverage at all.**

### Acceptance

`DROP DATABASE`, `CREATE DATABASE`, run `apply-sql.sh` with `APPLY_STRICT_FKS=1` as
the NOSUPERUSER migrator, and reach `100_tenant_id_uuid_fks.sql` with every file
recorded in `schema_migrations`. Add that sequence as a CI job so the from-empty path
stops being untested.

---

## This generalises an existing finding

`PENDING_WORK_LEDGER_2026-09-21.md` T6 records FORCE-RLS blinding
`VALIDATE CONSTRAINT` in 10 migrations. **It is not limited to constraint
validation.** The same blindness silently defeats:

- backfill `UPDATE`s — proven above
- any `DELETE` or data-repair statement in a migration
- any `SELECT ... INTO` guard that decides whether to proceed

`VALIDATE CONSTRAINT` was merely the case where the failure was noisy. A backfill
that touches zero rows reports success, which is worse.

So the T6 remediation must widen: the gate should reject **any data-modifying or
data-reading statement** in a migration against a FORCE-RLS table unless the file
lifts and restores `FORCE` in the same transaction, as `100` does — not just
`VALIDATE CONSTRAINT`.

---

## Corrections to my own earlier reporting

Recorded because both are exactly the class of claim this repository's honesty rule
forbids.

**1. I claimed to have re-run both prompts. I had not run the module prompt at all.**
The commit message on `docs/pending-work-ledger` states "Re-ran
MODULE_DEEP_EVALUATION_PROMPT and UAT_READINESS_VERIFICATION_PROMPT against
main = 4d4706cd". That is false for the module prompt, which I first opened after
being challenged. It is a per-module sweep over roughly 45 modules in 8 groups, and
the prompt itself states a genuine pass on **one** module is "hours, not minutes".

**2. `TASKLIST_GAP_CLOSURE_2026-09-21.md` T3 is labelled "newly surfaced by this
pass". It was already documented.** The module prompt's forbidden-claims table
already reads: *"A module exists because a package directory does — `alumni`,
`canteen`, `finance`, `inventory`, `payroll` contain only `node_modules`."* My
contribution was narrower than claimed: that they are **untracked in git** and absent
from the mount matrix. The capability gap itself was known.

---

## What this run could not determine

The prompt is explicit that a module evaluated without a live database can only
report `unverified` for integrity, security and production. Because the database
never finished migrating, that applies broadly here.

**Not done, and not to be read as passing:**

- **The module sweep.** Zero of the ~45 modules received a Step 1–6 evaluation. No
  `docs/audits/modules/<MODULE>_DEEP_EVAL_*.md` was produced by this run.
- **UAT Part A.** 9 of 11 lifecycles untraced: admission, attendance, assessment,
  examination, timetable, transport, library/hostel/health/discipline, guardian
  communication, transfer out. Only fee (breaks at `collection`, no PSP) and staff
  (breaks at `payroll`, untracked stub) were traced, in the earlier session.
- **UAT Part B's central question.** Whether a school is a tenant or a row — which
  the prompt says "decides the entire isolation model" — is still untraced against
  `institutions`, `geographic_areas`, `boards`, `board_codes`. My earlier
  "board is not an implemented product surface" rests on reference counts alone,
  which is thinner evidence than that conclusion warrants. Treat it as
  `unverified`, not established.
- **The `to_regclass` check the prompt mandates.** Store names such as
  `auth.otp_challenges` must be resolved against the live catalogue before being
  described as tables. Not run this session.
- **Affiliation lifecycle, board examination conduct, consolidated analytics, data
  sovereignty.** Untouched.
- **UAT Part C questions 5 and 6** — diagnosability, and child-data safety beyond
  the tenant-FK check.
- **Any UI or mobile assessment.** No screen was opened; no capture reviewed.

---

## What stands, with the caveat attached

These were genuinely proved earlier today against a live database as
`proctira_app` (NOSUPERUSER/NOBYPASSRLS) — but on the **incrementally-built**
database, not a clean one:

- 23 formerly-`text` tenant tables now carry validated FKs to `tenants(id)`; the FK
  rejects a nonexistent tenant and accepts a real one (#342)
- FK validation was passing vacuously under FORCE RLS; orphan planted, `VALIDATE`
  failed as it should, `relforcerowsecurity` survived the rollback (#341/#342)
- `control_plane_documents_pkey` is `(collection, id)` — `tenant_id` absent from the
  key, so document ids are a global namespace (#357)
- Audit hash-chain tamper evidence, privacy legal hold, admissions isolation,
  fees double-entry integrity

Given the P0 above, "verified live" in this repository should from now on distinguish
**verified on a migrated-from-empty database** from **verified on a
long-lived database**. Only the former demonstrates a deployable schema.

---

## Next

1. Fix the P0 so a clean bootstrap completes, then add the from-empty apply to CI.
2. Re-run this audit on a clean database — at that point the module sweep and UAT
   Parts A–C become answerable rather than `unverified`.
3. Widen the T6 gate from `VALIDATE CONSTRAINT` to all data-touching statements.
4. Correct the two claims above in `docs/pending-work-ledger` before it merges.
