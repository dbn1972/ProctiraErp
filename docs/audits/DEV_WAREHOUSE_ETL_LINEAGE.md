# DEV — Warehouse · ETL · lineage (P2-WH)

**Capability / module:** Insights DW honesty · thin ETL · thin run lineage  
**Branch / tip:** `cursor/warehouse-etl-lineage-56c3`  
**Date (UTC):** 2026-09-12  
**Product contract:** `docs/audits/PRODUCT_WAREHOUSE_ETL_LINEAGE.md`  
**Waiver board:** `docs/audits/WAIVER_BOARD_20260912.md` (**PRD-018**)  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P2-WH** (DEV audit only — **do not edit TASKS**)

---

## Honesty

| Item                   | Content                                                                                                                                  |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Decision               | **P2-WH** closes as **shipped thin stack + dated NON-GOAL** — not a greenfield governed warehouse                                        |
| What already ships     | Insights `/data-warehouse*` (G-209) with honesty banners; mounted `backend/etl` `/pipelines` + PG `046` (Wave 10 Option C); P0-10 probes |
| What this slice adds   | **Thin lineage** on `PipelineExecution`: `sourceType`, `destinationType`, `sourceLabel`, `destinationLabel`, `fieldMappingCount`         |
| What does **not** ship | Unparked `backend/data-warehouse`; governed catalog; column/graph lineage; live connector admin CP                                       |
| Claims forbidden       | Peer enterprise data-warehouse parity; “Insights page = live DevInfo warehouse”                                                          |
| Re-open when           | Product funds governed warehouse epic; then reverse **PRD-018** and replace this note with a real DEV pack                               |

**Minimal code this slice:** lineage helper + populate on execute + API response field. No new SQL migration (JSONB document already stores execution payload). No Insights UI remount. No TASKS edits.

---

## 0. Audit — capabilities that exist

| Capability                       | Status | Evidence                                                                                                 |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------- |
| Insights owns `/data-warehouse*` | ☑      | `GATEWAY_MOUNT_MATRIX.md` insights-ui row; `apps/web/.../data-warehouse/page.tsx` + `ScaffoldModeBanner` |
| `backend/data-warehouse` PARKED  | ☑      | Mount matrix **PARKED — superseded (G-924)**                                                             |
| ETL mounted + PG document store  | ☑      | `backend/etl`; `db/sql/046_health_incidents_etl_schema.sql`; Wave 10 PRODUCT                             |
| ETL health probes (same process) | ☑      | P0-10 / `DEV` etl persist probes                                                                         |
| Thin run lineage                 | ☑      | `packages/backend/etl/src/lineage.ts` + `PipelineExecution.lineage` + `formatExecutionResponse`          |

---

## 1. Dated NON-GOAL residuals (PRD-018)

| Residual                           | Status (2026-09-12) | Notes                                                              |
| ---------------------------------- | ------------------- | ------------------------------------------------------------------ |
| Full governed warehouse / catalog  | **NON-GOAL**        | No semantic layer, quality rules, or DW package mount              |
| Column-level / graph lineage       | **NON-GOAL**        | Thin run breadcrumb only                                           |
| Live connector admin control plane | **NON-GOAL**        | Also covered by **PRD-015**; P2-WH closes tracking via **PRD-018** |
| Unpark `backend/data-warehouse`    | **NON-GOAL**        | Insights path remains the staff surface                            |

---

## 2. Thin lineage shape

```ts
lineage: {
  sourceType: 'csv' | 'excel' | 'postgresql' | 'rest_api';
  destinationType: 'postgresql' | 'rest_api';
  sourceLabel: string; // path, inline marker, truncated query, or URL
  destinationLabel: string; // table or URL
  fieldMappingCount: number;
}
```

Persisted inside existing `etl_pipeline_runs.document` JSONB — no schema migration.

---

## 3. How to verify

```bash
pnpm --filter @proctira/backend-etl test -- src/etl-service.test.ts src/lineage.test.ts
```

---

## Status

**P2-WH honesty close @ 2026-09-12** — Insights DW + thin ETL **exist**; thin lineage **ships**; full governed warehouse = **PRD-018 NON-GOAL**. Tip CI independent of this docs-first slice beyond ETL unit tests.
