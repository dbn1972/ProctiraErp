# Phase 2 — Auth / Keycloak IdP

**Status:** Keycloak is the **platform IdP** ([ADR-001](./architecture/ADR-001-KEYCLOAK-IDP.md)).  
Phase-2 salvage landed the gateway/web wiring; full multi-schema Prisma `platform`/`auth`
migration from mega PR #1 is **not** merged (would regress peer-gap `db/sql` surfaces).

## What landed

| Stream                                    | Result                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Keycloak verify / roles / routes / plugin | In `@proctira/backend-auth` under `src/keycloak/`                                                                    |
| Gateway wiring                            | **Product path:** `KEYCLOAK_ISSUER` + `KEYCLOAK_CLIENT_ID` → Keycloak RS256/JWKS. **CI fallback:** local HS-JWT only |
| Identity / invites / OTP                  | Postgres when `DATABASE_URL` is set (G-704); otherwise in-memory                                                     |
| SMS OTP                                   | Console provider by default; Twilio when `TWILIO_*` set (not claimed live without secrets)                           |
| Web BFF                                   | `GET /api/auth/keycloak` + `GET /api/auth/callback` ticket redeem                                                    |
| Realm export                              | `infra/keycloak/proctira-realm.json` (imported by Compose Keycloak service)                                          |

## Explicit waivers / non-claims

- **Keycloak is not optional as a product decision** — omitting env is a **headless/CI fallback**, not an alternate IdP strategy
- Tip CI may still **WAIVE live login evidence** (G-107) until staging realm secrets exist; that is an evidence gap, not a redesign
- Live Twilio SMS is **not** claimed without `TWILIO_*`
- Mega PR #1 wholesale Prisma multi-schema + domain scaffold deletions are **superseded**

## Validate (ops)

`tools/scripts/validate-phase2-auth-ec3.sh` is the checklist against Keycloak + gateway.
Default unit/e2e CI may omit Keycloak secrets and use HS-JWT; local/staging stacks should run Keycloak.
