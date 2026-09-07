---
name: enterprise-data-sql-certification
description: >-
  Enterprise data-plane / raw SQL certification for ProctiraERP (migrations,
  constraints, multi-board multi-school seeds, apply/verify without Prisma for
  cert paths). Use for schema design, live Postgres onboarding, board packs,
  or certification-grade data proofs.
---

# Enterprise Data / SQL Certification (Definition of Data)

This skill is the **Definition of Data**. Prefer **raw SQL** under `db/sql/` for certification-grade paths.

## When this skill applies

Trigger on: migration, schema, seed, multi-board, multi-school, live Postgres, board export data, SQL cert, “do not use Prisma” paths, onboarding proof.

## Required workflow

1. Copy `docs/audits/templates/ENTERPRISE_DATA_SQL_CHECKLIST.md` → `docs/audits/DATA_<MODULE>.md`.
2. Versioned SQL with FKs, uniques, indexes; document invariants.
3. Seed profile: default **3 boards × ≥2 schools** when board rules differ.
4. Apply with `psql`/`pg` (not Prisma) for cert evidence; record commands + row counts.
5. Property/unit tests for pure domain rules (GPA, clashes, etc.) when applicable.
6. Tenant columns / RLS or service scoping documented.
7. Rollback / forward-fix note for destructive changes.

## Honesty rules

- Demo in-memory store ≠ certified data plane.
- Do not claim multi-board ready from single-tenant seed.
- Never commit production dumps with real student PII.

## Related

- Development skill domain pillar
- Production-ready multi-board section
- `db/sql/`
