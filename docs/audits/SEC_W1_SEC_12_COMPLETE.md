# W1-SEC-12 COMPLETE

| Field | Value |
| --- | --- |
| Finding | W1-SEC-12 |
| Title | ALLOW_IN_MEMORY_IN_PRODUCTION permits non-durable production persistence. |
| Status | **COMPLETE** (code Done-when met; residual factories closed) |
| Tip SHA | _(local working tree — not committed)_ |
| Closure mode | Audit pack after code review; no invented production evidence |

## Done-when evidence

- `packages/shared/database/src/persistence-policy.ts` throws in production; obsolete flag ignored
- Readiness requires Postgres in prod
- Tests: persistence-policy + readiness/gateway health tests
- Prior merge: #198
- **Residual closure (this pack):** gateway mounts for `custom-field` and `dashboards` no longer construct `new InMemory*` directly. They use:
  - `createCustomFieldRepositories()` — `@proctira/backend-custom-field`
  - `createDashboardRepository()` — `@proctira/backend-dashboards`
- Both factories call `assertPostgresRepositoryAvailable(..., null)` when `DATABASE_URL` is set (no durable schema yet — honesty over fake Pg) and `assertInMemoryFallbackAllowed` before memory when unset.
- Privacy already used `createPrivacyRepository()` (unchanged).
- Tests: `create-custom-field-repositories.test.ts`, `create-dashboard-repository.test.ts`, gateway `kill-memory-fallback.test.ts` (fail-closed + memory path).

## Honest residuals

- `ALLOW_IN_MEMORY_RATE_LIMIT` / `ALLOW_IN_MEMORY_IDEMPOTENCY` are separate emergency flags (ARCH-02/03)
- Custom-field / dashboards still lack durable SQL schema: with `DATABASE_URL` set, factory **throws** (gateway cannot silently serve memory for those mounts). Product residual: ship Pg schema or park mounts in environments that require Postgres.
- Bonus hardening (same wave): `tenant-admin-plugin` tenant settings store now uses `assertPostgresRepositoryAvailable` / `assertInMemoryFallbackAllowed` instead of bare `pool ? Pg : InMemory`.
- Tip Aggregate CI green not claimed

## Sign-off

PARTIAL → COMPLETE for repository Done-when on tip `7daf039d`; residual domain-plugin direct `InMemory*` mounts for custom-field/dashboards closed via factories (fail-closed when durable path required but unimplemented).
