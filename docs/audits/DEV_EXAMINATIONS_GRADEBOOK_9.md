# DEV — Examinations / Gradebook ≥9.0 (2026-09-10)

## Capability
Registrars/exam officers create examinations with academic-period Select, register candidates, publish results, and generate documents. Teachers are denied mutations (403). Gradebook workflows + report-card HTML persist on PG; CA-sealed transcript PDF is **NON-GOAL (PRD-011)**.

## Non-goals
- CA-sealed / nationally certified transcript PDFs
- Live IdP write-path (G-107)

## Evidence
- `packages/backend/examination/src/examination-access.ts` + HTTP guard on CRUD/ops/docs/results
- Unit: `examination-access.test.ts`, `routes.test.ts` teacher 403
- UI: academic period Select on `/examinations/new`
- E2E: `19-examinations-inventory-smoke.spec.ts` (Select-aware)
- Assessment report-cards: PG factory when `DATABASE_URL` (PRD-008)
- Waiver: PRD-011

## Status
**PROD_WAIVED @ 9.1** — tip CI still independent (PRD-001).
