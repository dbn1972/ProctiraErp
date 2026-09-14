# W1-SEC-08 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-SEC-08 |
| Title | Webhook HMAC signatures lack timestamp, tolerance-window and nonce-based replay protection. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `packages/backend/developer-portal/src/webhook-signature.ts`: timestamp + nonce + skew + replay store
- Prod fail-closed without replay store; Redis SET NX EX path
- Tests: `webhook-signature.test.ts`
- Prior merge: #197

## Honest residuals

- Partners must verify `timestamp.nonce.body` and run a multi-replica replay store
- No live Redis/partner receiver proof claimed
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`.
