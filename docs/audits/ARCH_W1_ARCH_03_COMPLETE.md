# W1-ARCH-03 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-ARCH-03 |
| Title | Idempotency can silently degrade to single-process memory when Redis is absent or fails; post-mutation Redis save failure must not return bare 2xx. |
| Status | **COMPLETE** (code Done-when met on this branch; tip Aggregate CI not claimed) |
| Tip SHA | (fill on merge) |
| Closure mode | Code + unit tests; no invented production evidence |

## Done-when evidence

- Idempotency store defaults to Redis in prod; missing client throws; store errors before mutation → 503 (`IDEMPOTENCY_STORE_UNAVAILABLE`)
- Post-mutation Redis response save failure → **not** bare 2xx: rewrite to 503 (`IDEMPOTENCY_REPLAY_PENDING`) and prefer durable `completed_without_body` marker so retry does not re-execute
- If marker write also fails, in-flight lock is retained/refreshed so retry gets 409 while the lock lives (not a silent success that invites duplicate mutation)
- Happy-path replay unchanged: durable cached body → `x-idempotency-replay: true` with original status/body
- Tests: `idempotency-store.test.ts`, `idempotency.test.ts` (incl. post-mutation save-fail + marker replay + total-write-fail lock retain)
- Prior merge: #182 (fail-closed before mutation / no silent memory)

## Honest residuals

- If Redis stays unavailable after mutation **and** both response + marker writes fail **and** the in-flight lock TTL expires, a later retry can still re-execute (no out-of-band durable ledger outside Redis). Clients must treat `IDEMPOTENCY_REPLAY_PENDING` / prolonged 409 as reconcile-needed, not safe-to-blind-retry forever.
- Tip Aggregate CI green not claimed by this pack alone

## Sign-off

Repository Done-when for W1-ARCH-03 post-mutation atomicity/recoverability is met in code + unit tests on this branch. Tip CI Aggregate green is **not** claimed by this pack alone.
