# PRODUCT residual — Survey remains PARKED (P2-SURVEY)

**Date (UTC):** 2026-09-12  
**Register:** `P2-SURVEY` in `docs/plans/TASKS_ENTERPRISE_P0_P1_P2_GAPS.md`  
**Waiver board:** `docs/audits/WAIVER_BOARD_P1_P2_2026-09-12.md`  
**Mount matrix:** `docs/audits/GATEWAY_MOUNT_MATRIX.md` — `backend/survey` **PARKED (G-605)**  
**Backlog:** `docs/backlog/PRODUCT_CAPABILITY_BACKLOG.md` BL-010 **Parked**

## Decision

**P2-SURVEY** closes as **DONE-with-dated-PARKED (2026-09-12)**. Survey authoring / analytics stay **PARKED**: plugin code may exist under `packages/backend/survey`, but there is **no** gateway mount, redesign UI, or tip E2E product surface. Do **not** un-park or claim survey product complete.

## Tip proves

| Path                      | Meaning                                         |
| ------------------------- | ----------------------------------------------- |
| `GATEWAY_MOUNT_MATRIX.md` | `parked: true` + G-605 rationale for survey     |
| BL-010                    | Capability backlog already marks Surveys parked |

## Forbidden claims

Survey authoring complete · analytics dashboard shipped · peer survey-tool parity.
