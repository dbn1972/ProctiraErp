# Enterprise module development — Auth shell unstub (P0-02)

**Capability / module:** Web authentication shell — real cookie session gate  
**Branch / tip:** `cursor/auth-shell-unstub-56c3`  
**Owner / agent:** cloud agent  
**Date (UTC):** 2026-09-12  
**Peer parity target:** Staff/parent chrome hydrates from the same httpOnly session cookies middleware already gates (Keycloak / auth-service BFF — ADR-001); no stub `signIn` no-op in production builds  
**Dev session:** P0-02 `auth-shell-unstub`  
**Paired test audit:** unit evidence below (live IdP e2e remains dated residual)

Copied from `docs/audits/templates/ENTERPRISE_MODULE_DEV_CHECKLIST.md`.

---

## 0. Product contract

| Item                   | Content                                                                                                                                 |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Capability statement   | After sign-in (password, OAuth, or Keycloak SSO), `useAuth()` reflects the cookie session used by middleware / server `getSession()`. |
| In scope (peer parity) | Unstub `AuthProvider`; `GET /api/auth/session`; Keycloak SSO entry on `/login`; demo banner gated by explicit env                     |
| Explicit non-goals     | Live Keycloak IdP proof in this agent; inventing a new IdP; TASKS file edits; full Auth enterprise re-score                             |
| Roles (RBAC)           | JWT role claims → `AuthUser.roles` / coarse `scope` for dashboard routing only; server RBAC unchanged                                   |
| Boards impacted        | CBSE ☐ ICSE ☐ State ☐ Other: N/A (identity shell)                                                                                       |

Screen / API inventory:

| Nav / surface     | Route                 | API                         | Tables | PII        |
| ----------------- | --------------------- | --------------------------- | ------ | ---------- |
| Login             | `/login`              | `POST /api/auth/login`      | —      | email/pw   |
| Keycloak SSO      | `/api/auth/keycloak`  | gateway `/api/v1/auth/login`| —      | OIDC       |
| Session hydrate   | (client)              | `GET /api/auth/session`     | —      | claims     |
| Auth provider     | AppProviders / App    | session + refresh + logout  | —      | session    |

---

## 1. Domain model (SQL-first)

| Check                         | Done | Evidence                                      |
| ----------------------------- | ---- | --------------------------------------------- |
| Versioned SQL under `db/sql/` | ☐    | N/A — no schema change                        |
| Constraints / indexes / FKs   | ☐    | N/A                                           |
| Multi-board seed fixtures     | ☐    | N/A                                           |
| Domain unit/property tests    | ☑    | `auth-user.test.ts`                           |
| Invariants documented         | ☑    | Tokens httpOnly; client never sees access JWT |

---

## 2. API / services

| Check                              | Done | Evidence                                              |
| ---------------------------------- | ---- | ----------------------------------------------------- |
| Tenant middleware on all routes    | ☑    | Existing middleware + cookie gate unchanged           |
| Validation + typed errors          | ☑    | Session route returns authenticated / expired shapes  |
| RBAC enforced                      | ☑    | Server-side only; client mapping is UX                |
| Conflict / rule failures → 409/422 | ☐    | N/A                                                   |
| Idempotent writes where needed     | ☐    | N/A                                                   |
| Cross-tenant deny test             | ☐    | Residual — covered by gateway JWT tenancy elsewhere   |

---

## 3. UI (redesign)

| Screen | Empty/loading/error | Write works | Board-aware | Evidence |
| ------ | ------------------- | ----------- | ----------- | -------- |
| AuthProvider hydrate | ☑ loading → authed/unauthed | signIn/signOut/refresh via BFF | N/A | `AuthProvider.test.tsx` |
| `/login` | ☑ | existing LoginForm + Keycloak link | N/A | `login-form.tsx` |
| Demo banner | ☑ only when env set | N/A | N/A | `auth-demo-mode-banner.tsx` |

---

## 4. Cross-module integration

| Dependency                     | Integrated | Evidence                                      |
| ------------------------------ | ---------- | --------------------------------------------- |
| Middleware cookie gate         | ☑          | Same `access_token` / `getSession()`          |
| `/api/auth/login|refresh|logout` | ☑        | AuthProvider calls session helpers            |
| Keycloak (ADR-001)             | ☑          | `/api/auth/keycloak` linked from login        |
| Dashboard RoleRouter           | ☑          | Still consumes `useAuth().user`               |

---

## 5. Observability & audit

| Check                               | Done | Evidence |
| ----------------------------------- | ---- | -------- |
| Auth failures surface messages      | ☑    | Existing login form + AuthProvider throw     |
| Demo mode honesty                   | ☑    | `NEXT_PUBLIC_AUTH_DEMO_MODE` + banner        |

---

## 6. Security / tenancy notes

- **What was stubbed:** `apps/web/src/providers/AuthProvider.tsx` — `signIn` always ended `unauthenticated`, `refreshToken` no-op, no cookie hydration ("task 49.x" placeholder).
- **How fixed:** Hydrate via `GET /api/auth/session` → `getSession()` → `authUserFromTokenPayload`; wire `signIn` / `signOut` / `refresh` to `@/lib/auth/session` BFF; keep `accessToken` null on client (httpOnly).
- **Prod stub path:** None. Demo mode is banner-only behind `NEXT_PUBLIC_AUTH_DEMO_MODE=1` (documented in `.env.example`).
- **Residual:** Live Keycloak browser login not exercised in this agent; e2e suites continue to mint cookies via `e2e/fixtures/fake-session.ts` for headless CI.

---

## 7. Test evidence (Definition of Test — minimal)

| Check                    | Done | Evidence |
| ------------------------ | ---- | -------- |
| Unit: token → AuthUser   | ☑    | `apps/web/src/lib/auth/auth-user.test.ts` |
| Unit: session route      | ☑    | `apps/web/src/app/api/auth/session/route.test.ts` |
| Unit: AuthProvider       | ☑    | `apps/web/src/providers/AuthProvider.test.tsx` |
| Live IdP e2e             | ☐    | Dated residual — no Keycloak secrets in agent |

---

## Exit criteria (P0-02 DoD)

| Criterion                                              | Status |
| ------------------------------------------------------ | ------ |
| Stubbed web auth shell identified                      | ☑ AuthProvider |
| Wired to real session/auth gate already in repo        | ☑ |
| Prod does not ship stub login as primary shell         | ☑ |
| Demo (if any) behind explicit env + banner             | ☑ banner-only |
| Minimal unit proof + this DEV doc                      | ☑ |
