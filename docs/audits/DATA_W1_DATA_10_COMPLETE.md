# W1-DATA-10 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-DATA-10 |
| Title | Fresh installation still depends on externally pre-created database roles. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `db/bootstrap/01_runtime_roles.sql` + `bootstrap-db-roles.sh` wired into apply/CI/compose init
- Audit: `DATA_W1_DATA_10_DB_BOOTSTRAP.md`
- Prior merge: #210

## Honest residuals

- One-time CREATEROLE/superuser still required to create roles (accepted)
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
