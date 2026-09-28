# Enterprise data / SQL checklist

**Module:** Institutions detail seed + class profile  
**Date (UTC):** 2026-09-28

## 1. Schema

`db/sql/103_class_section_profile.sql`: nullable `class_teacher_staff_id` UUID FK to staff, `room_name` varchar(120), index, `schema_migrations` insert. Prisma model updated to match.

## 2. Apply / verify (no Prisma for cert)

On this VM, `prisma migrate deploy` then `APPLY_STRICT_FKS=1 bash tools/scripts/apply-sql.sh` recorded 103. Seed `db/seeds/006_sunrise_public_school_demo.sql` applied. Gateway health 200 after 082 and 100 were validated. This is a local apply, not a clean cert database. Disposition: **PARTIAL**.

## 3. Tenancy & constraints

Class teacher FK is to staff. Overview queries include `tenant_id`. Seed uses fixed UUIDs under tenant `…a501` and `ON CONFLICT`.

## 4. Rollback

Drop the two columns and the migration ledger row. No backfill of historical teachers (columns start null).

## 5. Sign-off

Not certification-grade. Seed is deterministic and was applied here.
