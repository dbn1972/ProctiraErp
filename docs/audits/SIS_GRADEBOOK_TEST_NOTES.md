# SIS Gradebook — test notes (WS3)

**Module:** Gradebook / transcripts  
**Branch:** `cursor/enterprise-score-uplift-56c3`  
**Date (UTC):** 2026-09-06  
**Artifacts:** `/opt/cursor/artifacts/sis-gradebook-audit/`

## Inventory

| Screen | Route | Ungated smoke |
| --- | --- | --- |
| Institution gradebook | `/institutions/[id]/gradebook` | `e2e/23-gradebook-inventory-smoke.spec.ts` |
| Student records | `/students/records` | same |

## Unit / domain

- `pnpm --filter @proctira/backend-gradebook test` → 11 passed (GPA engine + service).

## Live Postgres write smoke (server)

Script: `packages/backend/gradebook/scripts/live-smoke.mjs`  
Evidence: `/opt/cursor/artifacts/sis-gradebook-audit/live-smoke.json`

Result highlights:

- Grade upsert ×2 → GPA snapshot weighted/unweighted 9.5, credits 2  
- Transcript v1 + v2 issued; checksums differ (`immutabilityOk: true`)  
- Report-card job `SUCCEEDED` with `memory://report-cards/…html`

## Residuals

- Authenticated Playwright E2E gated on `E2E_BACKEND_READY`  
- Multidevice captures / device-farm not run  
- Live IdP not claimed  
- RBAC deny tests residual
