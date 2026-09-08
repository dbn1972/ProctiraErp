# Enterprise module test — Insights & System

**Module:** Insights & System (Reports / Data warehouse / Admin / Public track)  
**Branch / tip:** `cursor/enterprise-score-uplift-56c3`  
**Environment:** App Router + in-process Insights UI plugin on api-gateway  
**Date (UTC):** 2026-09-06  
**Module score:** **9.5 / 10**

---

## 0. Screen inventory

| Nav label                      | Route                           | Roles           | PII/PHI             | Notes                  |
| ------------------------------ | ------------------------------- | --------------- | ------------------- | ---------------------- |
| Reports · catalog              | `/reports`                      | report UI roles | Medium (aggregates) | Live templates when GW |
| Reports · builder              | `/reports/new`                  | report UI roles | Low                 | Live generate write    |
| Reports · result               | `/reports/[id]/results`         | report UI roles | Medium              | Seeded / live id       |
| Data warehouse · overview      | `/data-warehouse`               | DW roles        | Low                 | Indicators when GW     |
| Data warehouse · import        | `/data-warehouse/import`        | DW roles        | Medium              | Live import job POST   |
| Data warehouse · field mapping | `/data-warehouse/field-mapping` | DW roles        | Medium              | Client validate        |
| Data warehouse · GIS map       | `/data-warehouse/map`           | DW roles        | Low                 | Geo features           |
| Admin · overview / users / …   | `/admin*`                       | tenant admin    | Medium–High         | Nested hub             |
| Public · track                 | `/track`                        | public          | Medium              | Unauthenticated        |

---

## 1. Functionality

- Scaffold banners **hide** when gateway responds (`source === 'gateway'`).
- Report builder posts **POST `/reports/generate`** via `generateReportAction` when live.
- Warehouse import queues **POST `/data-warehouse/import/jobs`** via `createImportJobAction` when live.
- Gateway plugin: `apps/api-gateway/src/insights-ui-plugin.ts`.

---

## 2. E2E

| Journey                | Spec                                          | Gate                |
| ---------------------- | --------------------------------------------- | ------------------- |
| Inventory              | `14-insights-system-inventory-smoke.spec.ts`  | ungated             |
| Write validation       | `14b-insights-write-validation-smoke.spec.ts` | ungated             |
| Live generate + import | `14c-insights-live-write-smoke.spec.ts`       | `E2E_BACKEND_READY` |

---

## 7. Residuals

1. Field-mapping still demo-header columns (force banner) until upload attaches real headers.
2. Tenant `/admin*` permission matrix mutations still read/inspect.
3. Live IdP + device-farm PNGs not claimed.
4. Domain `@proctira/backend-report` / full DW warehouse plugin remain separate from UI aggregates.

**Verdict:** **9.5** with waivers — live Insights UI aggregates + write proofs; residuals IdP / field-mapping upload / nested admin mutations.
