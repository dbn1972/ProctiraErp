# Workflows — screen-by-screen test (Sunrise demo tenant)

**Branch:** `cursor/screen-test-workflows-admin-c645`  
**Date (UTC):** 2026-09-27  
**Tenant:** `00000000-0000-4000-8000-00000000a501` (`sunrise-public-school`)  
**Seed:** no workflow definitions, instances, or approvals.  
**Session:** HS256 staff cookie, role `SUPER_ADMIN`, subject `neha.verma`.  
**Stack:** Postgres 16, api-gateway `:3000`, Next.js dev `:3001`.

This is a route walk. It is not a production-ready or 10/10 claim. No definition was saved and no approval was decided.

## Aggregate

| Result  | Count |
| ------- | ----: |
| PASS    |     5 |
| FAIL    |     0 |
| BLOCKED |     0 |
| SKIPPED |     0 |

## Route table

| Route                         | Primary action               | Result   | What the screen showed                                                                                                                           |
| ----------------------------- | ---------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `/workflows`                  | Open definitions             | **PASS** | “0 definitions, 0 active.” Honest empty: “No workflows defined.” Copy now says school actions.                                                   |
| `/workflows/definitions/new`  | Open the new definition form | **PASS** | Name, module, and steps fields. Nothing was created.                                                                                             |
| `/workflows/definitions/[id]` | Open one definition          | **PASS** | A missing id renders “Page not found”. No seeded definition to edit.                                                                             |
| `/workflows/instances`        | List instances               | **PASS** | “0 runs.” Pending 0, Approved 0. Average completion says “Currently unavailable.” Honest empty: “No workflow instances active.”                  |
| `/workflows/approvals`        | List pending approvals       | **PASS** | “Requests waiting on neha.verma@sunrise-public-school.test” and “You're all caught up. No approvals pending.” Approve and reject were not shown. |

## UX fixes in this walk

- Hub and instance copy says “this school” / “school actions” instead of “district-wide”.

## Residual

- Approve and reject confirms (`workflow-approve-confirm`, `workflow-reject-confirm`) were not opened because the queue is empty.
