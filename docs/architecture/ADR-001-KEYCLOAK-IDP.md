# ADR-001 — Keycloak is the platform IdP

**Status:** Accepted (product decision from programme start)  
**Date (UTC):** 2026-09-11  
**Owners:** Platform / Security

## Decision

**Keycloak (OIDC) is the identity provider for ProctiraERP.** Staff, parent, student, and admin login in deployed environments authenticate via Keycloak. The API gateway verifies **Keycloak RS256** access tokens (JWKS) when IdP env is configured.

## Consequences

| Concern                     | Rule                                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Product / architecture docs | Describe Keycloak as the IdP, not as an optional experiment                                                                 |
| Local full stack            | `docker compose` runs Keycloak with `infra/keycloak/proctira-realm.json`                                                    |
| Gateway                     | `KEYCLOAK_ISSUER` + `KEYCLOAK_CLIENT_ID` → Keycloak plugin; invites/OTP attach to that path                                 |
| Web                         | `/api/auth/keycloak` starts the authorization-code flow through the gateway                                                 |
| CI / headless               | Omitting Keycloak env keeps **local HS-JWT** as a **fallback only** (not the product IdP)                                   |
| Live vs sandbox             | Staging/production must run a real Keycloak realm; “G-107 waived” means _CI lacks secrets_, not that Keycloak is deselected |

## Non-goals (unchanged)

- Replacing Keycloak with Auth0/Cognito as the default
- Claiming live Keycloak login green in tip CI without realm secrets/evidence

## References

- Realm export: `infra/keycloak/proctira-realm.json`
- Plugin: `packages/backend/auth/src/keycloak/`
- Gateway wiring: `apps/api-gateway/src/app.ts`
- High-level architecture: `docs/architecture/HIGH_LEVEL.md`
- Phase-2 notes: `docs/PHASE_2_AUTH_SIGNOFF.md`
