# Database table ownership notes

Canonical location for notes about tables whose **file location or name prefix does
not match the service that owns them**.

## Why these notes do not live in `db/sql/*.sql`

`tools/scripts/apply-sql.sh` records a SHA-256 checksum per migration in
`schema_migrations` (W1-DATA-05) and **fail-closes on any drift**:

```text
error: W1-DATA-05 checksum mismatch for <name>
  Refusing to re-apply a drifted migration. Restore the original file or add a
  new numbered forward migration.
```

Editing an already-applied migration file — **even to add a comment** — changes its
checksum. Every database provisioned before the edit then refuses further schema
updates. CI does not catch this, because CI provisions a fresh database on each run
and therefore computes checksums from current file content; the mismatch only
appears on long-lived environments such as staging, production, and developer
databases.

This happened once already. PR #324 (`3d045325`, titled `docs(db)`) added the two
notes below as SQL comments inside `003_sis_timetable_schedule_schema.sql` and
`024_wave7_domain_persistence_schema.sql`. Both files were already applied
everywhere, so `apply-sql.sh` began refusing to run against any pre-#324 database.
The notes have been moved here and the migration files restored to their original
bytes.

**Rule:** applied migrations are immutable. Ownership and intent notes belong in
this document. Schema changes belong in a new numbered forward migration.

---

## `transcript_issuances`

- **Declared in:** `db/sql/003_sis_timetable_schedule_schema.sql`
- **Actually owned by:** `@proctira/backend-gradebook`
  (`packages/backend/gradebook/src/pg-transcript-repository.ts`)
- **Not owned by:** `@proctira/backend-timetable`

The table lives in the timetable/schedule schema file for historical reasons only.
Verified by grep at the time the note was written: no other backend package
references this table. Do not add a second writer without updating this note.

## `report_card_*`

- **Declared in:** `db/sql/024_wave7_domain_persistence_schema.sql`
- **Actually owned by:** `@proctira/backend-assessment`
  (`packages/backend/assessment/src/pg-report-card-repository.ts`)
- **Not owned by:** `@proctira/backend-report`

The `report_card_` prefix does not match the owning service. Applies to all four
tables:

- `report_card_templates`
- `report_card_teacher_comments`
- `report_card_institution_branding`
- `report_card_jobs`

Verified by grep at the time the note was written: no other backend package
references them. Do not add a second writer without updating this note.

---

## Adding a note here

State the table, the file that declares it, the package that actually reads and
writes it, the package a reader would wrongly assume owns it, and how ownership was
verified. These mismatches are a known high-yield defect class in this repository —
`docs/audits/templates/UAT_READINESS_VERIFICATION_PROMPT.md` lists filename-versus-owner
and prefix-versus-owner drift among the declarations most likely to mislead an
auditor.
