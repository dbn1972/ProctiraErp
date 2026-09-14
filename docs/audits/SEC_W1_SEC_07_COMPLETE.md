# W1-SEC-07 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-SEC-07 |
| Title | Metrics endpoint lacks an application guard and exposes raw tenant labels with unbounded cardinality risk. |
| Status | **COMPLETE** (code Done-when met on `origin/main`) |
| Tip SHA |  (short ) |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- Guard: `packages/shared/observability/src/metrics-access.ts` + Fastify `GET /metrics`
- Labels: service/method/route/status (no `tenant_id` on default HTTP series)
- Tests: `metrics-access.test.ts`
- Prior merge: #177

## Honest residuals

- In-cluster Prometheus must supply bearer/allowlist; scrape config may still omit auth
- `METRICS_PUBLIC=1` must never be set in production
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`.
