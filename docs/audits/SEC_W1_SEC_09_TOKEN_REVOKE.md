# Security — Access-token jti/sid revocation + refresh SameSite (W1-SEC-09)

**Module / slice:** `@proctira/backend-auth` + `apps/api-gateway` + `apps/web` auth cookies  
**Branch / tip:** `cursor/aud-w1-sec-09-token-revoke-56c3`  
**Date (UTC):** 2026-09-14  
**Data classes:** authentication / session (access JWT, refresh cookie)  
**Paired test audit:** unit — `access-token-revocation.test.ts`, `cookies.test.ts`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ----- | ---------- | ----- |
| Gateway `onRequest` JWT verify | Bearer access JWT | Global | session | Now checks jti/sid denylist after verify |
| `authPlugin` / `keycloakAuthPlugin` `authenticate` | Bearer | Route preHandler | session | Same denylist check |
| `POST /auth/logout` | Authenticated | Self | session | Invalidates session + refresh + denylists jti/sid |
| Web refresh cookie | httpOnly | N/A | session | SameSite=Strict (W1-SEC-09) |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Access-token jti denylist enforced | ☑ | `assertAccessTokenNotRevoked` + auth-plugin / gateway hook |
| Access-token sid denylist enforced | ☑ | Same; logout / `revokeAllSessionTokens` writes sid |
| Fail closed when revoked | ☑ | `401 TOKEN_REVOKED` with `revoked_jti` / `revoked_sid` |
| Fail closed when store unavailable (prod) | ☑ | `store_unavailable` when `requireStore` / production |
| Refresh cookie SameSite=Strict | ☑ | `refreshTokenCookieOptions` + clear twin |
| CSRF still present for Lax access cookie | ☑ | `csrf.ts` Origin + double-submit |
| No secrets in git | ☑ | Test secrets only |

---

## 2. Findings

### P0 / P1

| ID | Finding | Fix |
| --- | ------- | --- |
| W1-SEC-09 | Access-token jti/sid revocation not enforced; refresh cookies SameSite Lax | Denylist + Strict refresh cookie |

### Residuals

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P2 | ~~Multi-replica denylist needs shared Redis~~ → **CLOSED** in `SEC_W1_SEC_09_COMPLETE.md` | Production fails closed without shared store; multi-replica logout proven |
| residual | P2 | Access cookie remains SameSite=Lax for OAuth top-level returns | Mitigated by CSRF + Strict refresh; optional later Strict access if OAuth UX allows |
| residual | P2 | Keycloak admin logout / remote session kill does not push sid into Proctira denylist unless logout hits our `/auth/logout` path | Wire IdP backchannel logout when Keycloak admin events are enabled |
| residual | P2 | `revokeAllUserTokens` does not enumerate sessions to denylist every sid | Callers that force global logout should invalidate sessions + revoke per sid |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| P0 cleared | ☑ |
| P1 cleared or waived | ☑ (none open for this finding) |
| Safe to merge from security view | ☑ |

**Residual risks:** Redis required for multi-replica consistency; Keycloak remote logout backchannel not yet wired; access cookie remains Lax by design with CSRF mitigations.
