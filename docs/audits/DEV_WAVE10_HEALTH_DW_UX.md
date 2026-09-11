# Module development checklist — Wave 10 Health / ETL / B3 UX

**Slice:** Option B Health · Option C ETL thin un-park · Batch-3 UX leftovers  
**Branch:** `cursor/w10-health-dw-ux-56c3`  
**Date (UTC):** 2026-09-10  
**Product lock:** `docs/audits/PRODUCT_WAVE10_HEALTH_DW_UX.md`

## 0. Product contract

- [x] Capability statement + personas in product lock
- [x] Non-goals: full DW package un-park, Flutter health, med admin
- [x] Surface map: allergies / vaccinations / PHI / incidents / pipelines / board 403

## 1. Domain / SQL

- [x] `db/sql/046_health_incidents_etl_schema.sql` — `health_nurse_incidents`, `etl_pipelines`, `etl_pipeline_runs` + RLS
- [x] Nurse incidents PG store: `packages/backend/health/src/pg-nurse-incident-store.ts`
- [x] ETL PG repo: `packages/backend/etl/src/pg-pipeline-repository.ts`

## 2. API

- [x] Health: allergies/vaccinations CRUD (prior) + `GET /health/vaccinations`, `GET /health/phi-access`, `POST/GET /health/incidents`
- [x] ETL mounted at `/pipelines` (gateway registrar `etl`)
- [x] G-809: cross-board `BOARD_FORBIDDEN` in `insights-ui-plugin.ts`
- [x] Unit: health-service Wave 10B cases; insights board 403 cases

## 3. UI

- [x] `/health/allergies`, `/vaccinations`, `/incidents`, `/phi-access` (+ `/new` where needed)
- [x] `/pipelines` create + list; link from `/data-warehouse`
- [x] B3-006…B3-011 code; B3-012 waived in `WAVE9_BATCH3_UX_REVIEW.md`

## 4. Honesty

- `data-warehouse` package remains PARKED; insights owns `/data-warehouse`
- Tip CI evidence tracked on the PR tip (not claimed green until tip checks pass)
