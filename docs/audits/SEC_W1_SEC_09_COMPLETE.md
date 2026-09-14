# Security — W1-SEC-09 COMPLETE (shared access-token revocation)

**Module / slice:** `@proctira/backend-auth` + `apps/api-gateway` access-token denylist  
**Branch / tip:** `cursor/w1-sec-09-revoke-complete-56c3`  
**Date (UTC):** 2026-09-14  
**Prior status:** PARTIAL (`docs/audits/SEC_W1_SEC_09_TOKEN_REVOKE.md`) — jti/sid checks existed but factory could default to per-process memory  
**Data classes:** authentication / session (access JWT denylist)  
**Paired test audit:** unit — `packages/backend/auth/src/access-token-revocation.test.ts`

---

## 0. Inventory

| Route / API | AuthN | AuthZ | Data class | Notes |
| ----------- | ----- | ------ | ---------- | ----- |
| Gateway boot → `createAccessTokenRevocationStore` | N/A | ops | session | Production requires shared Redis; fails closed without it |
| Gateway `onRequest` JWT verify | Bearer | Global | session | Checks jti/sid denylist after verify |
| `authPlugin` / `keycloakAuthPlugin` | Bearer | Route | session | Same denylist; DI must inject shared store in prod |
| `POST /auth/logout` | Authenticated | Self | session | Writes jti+sid into shared denylist |

---

## 1. Controls

| Check | Pass | Evidence |
| ----- | ---- | -------- |
| Access-token jti/sid denylist enforced | ☑ | Prior PARTIAL + unchanged `assertAccessTokenNotRevoked` |
| Production refuses silent per-process memory | ☑ | `decideAccessTokenRevocationStore` / `createAccessTokenRevocationStore` throw without redis |
| Explicit single-replica emergency only | ☑ | `ALLOW_IN_MEMORY_ACCESS_TOKEN_REVOCATION=1` |
| Fail closed when store unavailable (prod) | ☑ | `store_unavailable` on missing/throwing store |
| Multi-replica logout with shared store | ☑ | Two Fastify “replicas” + shared memory / Redis mock — B rejects after A revoke |
| Process-local inconsistency documented | ☑ | Test proves separate memory stores do not share logout |

---

## 2. Findings

### Closed this slice

| ID | Was | Fix |
| --- | --- | --- |
| W1-SEC-09 residual | Factory defaulted to process-local memory → inconsistent logout across replicas | Production requires shared Redis (or emergency allow); gateway wires rate-limit Redis into revocation store |

### Residuals (P2, out of scope)

| ID | Sev | Finding | Fix / waiver |
| --- | --- | ------- | ------------ |
| residual | P2 | Keycloak admin / backchannel logout does not push sid into Proctira denylist unless logout hits `/auth/logout` | Wire IdP backchannel when admin events enabled |
| residual | P2 | Access cookie remains SameSite=Lax (CSRF + Strict refresh mitigate) | Optional later Strict access if OAuth UX allows |

---

## 3. Sign-off

| Claim | Status |
| ----- | ------ |
| PARTIAL → COMPLETE | ☑ |
| P0 cleared | ☑ |
| Multi-replica logout proven (shared store mock/redis) | ☑ |
| Safe to merge from security view | ☑ |

**Residual risks:** IdP remote logout backchannel not yet wired; emergency `ALLOW_IN_MEMORY_ACCESS_TOKEN_REVOCATION` must never be set on multi-replica prod.
