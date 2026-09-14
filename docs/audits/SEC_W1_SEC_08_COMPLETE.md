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

## Follow-up (receiver wire-up)

Tip follow-up closed the PARTIAL residual where `verifyWebhookSignatureSecure` /
`createWebhookReplayStoreFromEnv` existed only as a library + outbound signer:

- `POST /developer/webhooks/verify` — inbound reference receiver (skew + nonce replay)
- `POST /developer/webhooks/verify-self-test` — sign → accept → replay HTTP self-check
- Gateway injects Redis-backed replay store when `REDIS_URL` is set; otherwise
  memory in non-prod / `null` (fail-closed) in production

Evidence: `webhook-inbound-verify.test.ts`; gateway `domain-plugins.ts` developer mount.

