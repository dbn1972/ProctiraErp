# Secrets rotation — JWT dual-key & DB credentials (G-504)

**Status:** Implemented for HS256 gateway secrets. Full IdP (Keycloak) client-secret
rotation remains residual until G-001 merges.

## JWT access-token rotation (HS256)

| Env var                        | Role                                                                 |
| ------------------------------ | -------------------------------------------------------------------- |
| `JWT_SECRET`                   | Current signing + preferred verify secret (`kid=current`)            |
| `JWT_SECRET_PREVIOUS`          | Previous secret still accepted for verify during the rotation window |
| `JWT_KID` / `JWT_PREVIOUS_KID` | Optional kid labels (defaults `current` / `previous`)                |

### Procedure

1. Generate a new secret: `openssl rand -base64 48`
2. Set `JWT_SECRET_PREVIOUS=<old JWT_SECRET>` and `JWT_SECRET=<new>` on all gateway replicas.
3. Rolling restart gateways. New tokens are signed with `JWT_SECRET`.
4. Tokens issued under the previous secret continue to verify until their `exp`
   (access token TTL, default 15m).
5. After ≥ access-token TTL (+ clock skew buffer), clear `JWT_SECRET_PREVIOUS`
   and restart.

### Evidence

- Helpers: `apps/api-gateway/src/jwt-secrets.ts`
- Integration: `apps/api-gateway/src/jwt-rotation-quotas.test.ts` (G-504)

## Database credentials

1. Create a new DB role / password in the provider (RDS/Cloud SQL/local).
2. Update `DATABASE_URL` (and ExternalSecrets / sealed-secrets) for api-gateway
   and workers.
3. Rolling restart; confirm `/health/ready`.
4. Revoke the old role after all pods report healthy.

## Cookie / session secrets

Rotate `COOKIE_SECRET` the same way as JWT (brief dual acceptance is not
required for opaque cookies — expect re-login).

## Residual

- Keycloak realm client secret + JWKS kid rotation: blocked on G-001.
- Automated vault / ExternalSecrets operator wiring: residual (G-501 note).
