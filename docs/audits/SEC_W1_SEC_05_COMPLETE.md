# W1-SEC-05 COMPLETE — Registration session security

**Tip branch:** `cursor/w1-sec-05-session-store-56c3`  
**Finding:** Registration session IDs were process-memory, accepted from `x-session-id`, lacked expiry/binding, and used a 48-bit random suffix. Gateway mount also omitted `sessionStore`, so production either failed closed or never got a working cross-replica session.

## Done criteria

| Criterion | Status |
| --- | --- |
| ≥128-bit entropy session ids | **Met** — `randomBytes(16)` → 32 hex |
| Shared store with TTL | **Met** — `RegistrationSessionStore` + `expiresAtMs`; `RedisRegistrationSessionStore` (SET EX); prod refuses missing injected store **and** refuses memory without durable backend |
| Gateway injection | **Met** — `createRegistrationSessionStore()` wired in `apps/api-gateway/src/domain-plugins.ts` |
| Rotation / server-mint only | **Met** — client-supplied ids reused only if present in store |
| Applicant/client binding | **Met** — UA / `x-client-binding` SHA-256 must match |
| Expiry / mismatch tests | **Met** — forged id + binding mismatch cases in `routes.test.ts` |
| Restart / replica survival | **Met (unit)** — shared mock Redis: writer store `set`, new store instance `get` same key (`create-registration-session-store.test.ts`) |

## Factory policy

`createRegistrationSessionStore()`:

1. Injected `redis` → `RedisRegistrationSessionStore`
2. `REDIS_URL` → ioredis client + `RedisRegistrationSessionStore`
3. Else → `InMemorySessionStore` after `assertInMemoryFallbackAllowed('registration-session')` (refuses `NODE_ENV=production` and `REQUIRE_DATABASE`)

Language sessions are Redis-backed, not Postgres: `DATABASE_URL` alone does not select a PG session store (no registration-session table pattern). Production without Redis still fails closed.

Production refuse for missing `sessionStore` on `registerRegistrationRoutes` is unchanged.

## Residuals (honest)

1. Unit proof uses a shared in-process Redis mock (serialize → new store instance), not a live multi-pod Redis cluster.
2. Cookie-based HttpOnly delivery not added (header `x-session-id` still used); binding mitigates blind replay across UAs.
3. Gateway creates its own Redis client from `REDIS_URL` for sessions (separate from rate-limit client); sharing one client is a follow-up.

## Files

- `packages/backend/registration/src/routes.ts`
- `packages/backend/registration/src/registration-plugin.ts`
- `packages/backend/registration/src/create-registration-session-store.ts`
- `packages/backend/registration/src/create-registration-session-store.test.ts`
- `packages/backend/registration/src/index.ts`
- `packages/backend/registration/src/routes.test.ts`
- `apps/api-gateway/src/domain-plugins.ts`
