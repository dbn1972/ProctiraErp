# W1-ARCH-02 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-ARCH-02 |
| Title | Rate limiting remains replica-local memory rather than cluster-wide enforcement. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- Redis rate-limit store in api-gateway; prod refuses silent memory without allow flag
- `skipOnError: false`; boot fail-closed when Redis required but missing
- Tests: `rate-limit-store.test.ts`
- Prior merge: #186

## Honest residuals

- Emergency in-memory flag must never be used with >1 replica
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`. Tip CI Aggregate green is **not** claimed by this pack alone.
