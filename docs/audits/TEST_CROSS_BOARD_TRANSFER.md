# Test notes — cross-board transfer workflow

**Date:** 2026-09-28

| Check | Evidence | Disposition |
| ----- | -------- | ----------- |
| State machine legal and illegal pairs | `packages/backend/student/src/transfers/state-machine.test.ts` | FULLY_CLOSED when that file passes |
| Marks conversion CBSE→ICSE and CBSE→state 80 | same file | FULLY_CLOSED when that file passes |
| Authz, IDOR, reject comment, equivalency 422 | `routes.test.ts`, `apps/api-gateway/src/transfer-workflow-authz.test.ts` | FULLY_CLOSED when those files pass |
| Names not raw UUIDs | `transfer-labels.test.ts` | FULLY_CLOSED when that file passes |
| Page matrix | `docs/testing/PAGE_REGRESSION_MATRIX.md` regenerated, 0 uncovered | FULLY_CLOSED if the G-804 unit test passes |
| Live submit/approve/complete and reject | `apps/web/e2e/56-cross-board-transfer-workflow.spec.ts` with `E2E_BACKEND_READY=1` | EXTERNALLY_UNVERIFIED until the live gate on this tip is green |
| UX / a11y visual review of captures | not captured in this run | PARTIAL |
| Tip CI aggregate + e2e live gate | not green at authoring time | OPEN until the PR checks succeed |

Do not treat this file as a 10/10 product claim.
