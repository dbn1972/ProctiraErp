# Enterprise product / IA — Warehouse · ETL · lineage (P2-WH)

**Module / slice:** Insights data-warehouse UI · mounted ETL · thin run lineage  
**Branch / tip:** `cursor/warehouse-etl-lineage-56c3`  
**Date (UTC):** 2026-09-12  
**Owner / agent:** Cloud agent (P2-WH honesty close)  
**Paired gap:** `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md` · **P2-WH** (this file is the PRODUCT audit — **do not edit TASKS** from this slice)  
**Prior evidence:** Wave 10 Option C thin ETL un-park (`PRODUCT_WAVE10_HEALTH_DW_UX.md`, P0-10 PG + probes); mount matrix (`GATEWAY_MOUNT_MATRIX.md`); Insights DW honesty banners (`ScaffoldModeBanner` on `/data-warehouse*`)  
**Peers:** Governed enterprise DW (DevInfo / OpenEMIS-class catalog, lineage graph, connector admin CP)  
**Honesty:** Do **not** claim a full governed warehouse. Insights `/data-warehouse` ≠ mounted `backend/data-warehouse`.

Copy of `docs/audits/templates/ENTERPRISE_PRODUCT_IA_CHECKLIST.md`.

---

## 1. Capability statement

BI / tenant operators can browse **Insights** indicator surfaces at `/data-warehouse*` (demo/scaffold when offline), run **thin mounted ETL** pipelines at `/pipelines` with durable PG metadata when `DATABASE_URL` is set (**P0-10** / Wave 10 Option C), and inspect **thin lineage fields** on each pipeline run (source/destination type + short labels + field-mapping count). The separate `backend/data-warehouse` package remains **PARKED** (superseded path ownership). A **full governed warehouse** (catalog governance, column-level lineage graph, live connector admin CP, unpark of `backend/data-warehouse`) is a **dated NON-GOAL (2026-09-12)** until funded (**PRD-018**).

---

## 2. Personas & jobs

| Persona                   | Job-to-be-done                                      | Success looks like                                                                 |
| ------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| BI / tenant admin         | Configure and run CSV/import-style pipelines        | Mounted `/pipelines` CRUD + execute; PG when `DATABASE_URL`                        |
| BI / tenant admin         | Know what a run touched (thin lineage)              | Execution API returns `lineage` (source/dest type + labels + mapping count)          |
| Board / insights operator | Browse demo indicators without false “live DW” claim | Honesty banners on `/data-warehouse*`; PARKED package called out                   |
| Platform SRE              | Health of ETL process                               | `/health/live` + `/ready` hit same process (**P0-10**)                             |
| Data steward (peer DW)    | Governed catalog, column lineage, connector CP      | **NON-GOAL (dated 2026-09-12)** — **PRD-018**                                      |

---

## 3. Scope

| In scope (already shipped / this honesty close)                                                                 | Non-goals / deferred                                                                 |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Insights UI owns `/data-warehouse*` (G-209) with scaffold / honesty banners                                     | Unpark `backend/data-warehouse` (`/warehouses`)                                      |
| Mounted `backend/etl` at `/pipelines` + `db/sql/046` document store (Wave 10 Option C; P0-10 probes)            | Full DevInfo / OpenEMIS-class governed warehouse                                     |
| **Thin lineage** on ETL runs: sourceType, destinationType, sourceLabel, destinationLabel, fieldMappingCount     | Column-level / graph lineage; data catalog; quality rules; CDC                       |
| Mount-matrix honesty: DW package **PARKED — superseded**; ETL **mounted**                                       | Live DW connectors / admin control plane (**PRD-015** remains)                       |
| Dated NON-GOAL for **full governed warehouse** (**PRD-018**, 2026-09-12)                                        | Claiming peer “enterprise data warehouse” parity                                     |

### Explicit product decisions

| ID         | Topic                                      | Decision                                                                                                                                                                                                 | Effective  |
| ---------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **WH-1**   | Insights UI vs `backend/data-warehouse`    | **Honesty split:** staff path `/data-warehouse*` is **Insights** (indicators / demo import / field-mapping). `backend/data-warehouse` stays **PARKED** (G-924). Do not narrate them as one product.     | 2026-09-12 |
| **WH-2**   | Thin ETL                                   | **DONE** via Wave 10 Option C + P0-10 — pipelines mounted + PG/probes. No remount of DW package required for P2-WH close.                                                                                | 2026-09-10 |
| **WH-3**   | Thin run lineage                           | **In scope this slice:** optional structured `lineage` on `PipelineExecution` / API responses. Not a catalog or graph.                                                                                    | 2026-09-12 |
| **WH-4**   | Full governed warehouse                    | **Dated NON-GOAL (2026-09-12)** until funded. Record as **PRD-018**. Extends / supersedes breadth of **PRD-015** (live connectors / admin CP) for the P2-WH tracking row. Re-open only when product funds the epic. | 2026-09-12 |

---

## 4. Peer parity

| Peer capability                                      | Our target this slice                                      |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| Indicator browse / board rollups                     | **Met** via Insights (demo when scaffold)                  |
| Scheduled / on-demand extract pipelines              | **Met** thin (`backend/etl` `/pipelines`)                  |
| Run-level source → destination breadcrumb            | **Met** as thin `lineage` fields                           |
| Governed semantic catalog + column lineage graph     | **NON-GOAL (PRD-018)** — no parity claim                   |
| Live connector admin control plane                   | **NON-GOAL (PRD-015 / PRD-018)** — no parity claim         |
| Unparked DevInfo warehouse API (`/warehouses`)       | **NON-GOAL (PRD-018)** — package remains PARKED            |

---

## 5. Surface map

| Nav label              | Route / process                 | API / package                                      | Tables / stores                         | Shell |
| ---------------------- | ------------------------------- | -------------------------------------------------- | --------------------------------------- | ----- |
| Data warehouse         | `/data-warehouse`               | Gateway `insights-ui` `/data-warehouse`            | Insights `020` (else scaffold)          | Staff |
| Field mapping / import | `/data-warehouse/field-mapping`, `/import`, `/map` | Insights client demos                          | Client-side until connectors funded     | Staff |
| ETL pipelines          | `/pipelines` (UI may deep-link) | `backend/etl` `/pipelines*`                        | `etl_pipelines`, `etl_pipeline_runs` (`046`) | Staff / ops |
| PARKED warehouse pkg   | n/a                             | `backend/data-warehouse` `/warehouses` (**unmounted**) | n/a                                  | —     |

---

## 6. Roles & tenancy (high level)

| Role                         | Can                                              | Cannot                                      |
| ---------------------------- | ------------------------------------------------ | ------------------------------------------- |
| Tenant admin / BI (`etl` RBAC) | Pipeline CRUD + execute for own tenant         | Other tenants' pipelines / runs             |
| Insights reader              | Browse `/data-warehouse*` when permitted         | Treat scaffold as live governed DW          |
| Cross-tenant                 | —                                                | Any warehouse or pipeline row               |

Tenant boundary: ETL rows keyed by `tenant_id` with RLS when PG; Insights DW paths remain tenant-scoped via gateway.

---

## 7. Success metrics / DoD

- [x] Honesty audit: Insights UI vs PARKED `backend/data-warehouse` documented (this file + mount matrix)
- [x] Thin ETL already mounted (Wave 10 / P0-10) — no remount required
- [x] Thin lineage fields on ETL runs (schema + service populate + API response)
- [x] Dated NON-GOAL for full governed warehouse (**PRD-018**, 2026-09-12)
- [x] No TASKS plan edits in this slice
- [x] No claim of peer enterprise-DW / column-lineage parity

---

## 8. Handoff

| Next skill | Audit path                                      |
| ---------- | ----------------------------------------------- |
| Build      | `DEV_WAREHOUSE_ETL_LINEAGE.md` (minimal lineage) |
| Test       | ETL unit tests for lineage on execute            |
| Release    | Waiver board **PRD-018**                         |

**Conclusion (2026-09-12):** Close **P2-WH** product honesty: Insights DW UI + thin mounted ETL **exist**; thin run lineage is the only new capability; **full governed warehouse** is **dated NON-GOAL**.
