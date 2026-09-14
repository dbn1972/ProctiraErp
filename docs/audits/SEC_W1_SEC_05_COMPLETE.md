# W1-SEC-05 COMPLETE — Registration session security

**Tip branch:** `cursor/w1-sec-05-session-complete-56c3`  
**Finding:** Registration session IDs were process-memory, accepted from `x-session-id`, lacked expiry/binding, and used a 48-bit random suffix.

## Done criteria

| Criterion | Status |
| --- | --- |
| ≥128-bit entropy session ids | **Met** — `randomBytes(16)` → 32 hex |
| Shared store with TTL | **Met (API)** — `RegistrationSessionStore` + `expiresAtMs`; prod refuses missing injected store |
| Rotation / server-mint only | **Met** — client-supplied ids reused only if present in store |
| Applicant/client binding | **Met** — UA / `x-client-binding` SHA-256 must match |
| Expiry / mismatch tests | **Met** — forged id + binding mismatch cases in `routes.test.ts` |

## Residuals (honest)

1. Default in-memory store remains for non-production; production must inject Redis/DB via `sessionStore` (plugin option). No live Redis proof in this PR.
2. Cookie-based HttpOnly delivery not added (header `x-session-id` still used); binding mitigates blind replay across UAs.

## Files

- `packages/backend/registration/src/routes.ts`
- `packages/backend/registration/src/registration-plugin.ts`
- `packages/backend/registration/src/routes.test.ts`
