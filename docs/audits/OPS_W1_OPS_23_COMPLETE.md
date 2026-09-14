# W1-OPS-23 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-OPS-23 |
| Title | Manual release workflow bypasses the successful same-SHA CI gate. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `require-same-sha-ci.mjs` on release `workflow_dispatch`
- Audit: `OPS_W1_OPS_23_RELEASE.md`
- Prior merge: #215

## Honest residuals

- Deploy workflow dispatch remains separate scope
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
