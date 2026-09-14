# W1-DATA-12 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-DATA-12 |
| Title | RLS policies depend on two tenant GUC names that every caller must bind correctly. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- Canonical dual-bind helpers + SQL `071_tenant_guc_canonical.sql`
- Audit: `DATA_W1_DATA_12_GUC.md`
- Prior merge: #223

## Honest residuals

- Legacy GUC alias retained for compatibility
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
