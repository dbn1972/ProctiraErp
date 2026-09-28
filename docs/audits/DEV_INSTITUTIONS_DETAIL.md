# Enterprise module development checklist

**Module / slice:** Institutions detail (five screens)  
**Branch:** `cursor/institutions-detail-parity-0b3f`  
**Date (UTC):** 2026-09-28

## 0. Product contract

See `docs/audits/PRODUCT_INSTITUTIONS_DETAIL.md`. Disposition of the slice: **PARTIAL** until tip CI is green. UI is wired to live APIs.

## 1. Domain model (SQL-first)

- `db/sql/103_class_section_profile.sql` adds `classes.class_teacher_staff_id` (FK to staff) and `classes.room_name`.
- Prisma `Class` model matches those columns.
- Sunrise seed `006` sets Mayur Vihar profile facts, class teachers, rooms, bell, meetings (including one teacher clash), and audit activity. Idempotent `ON CONFLICT` / `generate_series`.
- Disposition: **PARTIAL** — applied on this VM (ledger includes 103). Not re-certified on a clean CI database in this session.

## 2. API / services

- `GET /api/v1/institutions/:id/overview` in `apps/api-gateway/src/institution-overview.ts`. Missing tables yield nulls, not fabricated counts. Cross-tenant 404. Role without `institution:read` → 403. No pool → 503.
- Class create/update/list return `classTeacherName` and `roomName`. Cross-tenant teacher is not found (`class-service.test.ts`).
- Authed web fetches use `cache: 'no-store'`.
- Disposition: **FULLY_CLOSED** for the overview route tests (3) and class service tests (16).

## 3. UI (redesign)

Hero meta reads medium from the overview snapshot because `GET /institutions/:id` does not return user `custom_data`. Classes period filter is `?period=`. Grades utilization uses overview enrollment ÷ section capacity. Schedule and section pages label people via `formatPersonLabel` / `resolveEntityLabel`.

## 4. Cross-module integration

Roster eye-link goes to `/students?institutionId&gradeId`. School report prints the same overview snapshot. No attendance module edits.

## 5. Observability & audit

Overview activity reads `audit_log_entries` for the institution. Failures surface as error banners, not silent zeros (`*Available` flags).

## 6. Security & compliance

See `SEC_INSTITUTIONS_DETAIL.md`.

## 7. Hand-off to production-ready test skill

`apps/web/e2e/16d-institutions-detail-live.spec.ts` and `docs/testing/PAGE_REGRESSION_MATRIX.md`.

## Exit — capability 10/10

Not claimed. Test evidence on this VM is not a product score.
