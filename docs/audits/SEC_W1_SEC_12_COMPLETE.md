# W1-SEC-12 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-SEC-12 |
| Title | ALLOW_IN_MEMORY_IN_PRODUCTION permits non-durable production persistence. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `packages/shared/database/src/persistence-policy.ts` throws in production; obsolete flag ignored
- Readiness requires Postgres in prod
- Tests: persistence-policy + readiness/gateway health tests
- Prior merge: #198

## Honest residuals

- `ALLOW_IN_MEMORY_RATE_LIMIT` / `ALLOW_IN_MEMORY_IDEMPOTENCY` are separate emergency flags (ARCH-02/03)
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`.
