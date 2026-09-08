# Phase 2 — Auth / optional Keycloak (salvage)

**Status:** Slim salvage onto main (optional Keycloak IdP). Full multi-schema Prisma
`platform`/`auth` migration from mega PR #1 is **not** merged (would regress peer-gap
`db/sql` surfaces).

## What landed

| Stream | Result |
|--------|--------|
| Keycloak verify / roles / routes / plugin | In `@proctira/backend-auth` under `src/keycloak/` |
| Gateway wiring | Env-gated: `KEYCLOAK_ISSUER` + `KEYCLOAK_CLIENT_ID` → Keycloak RS256; otherwise local HS JWT unchanged |
| Identity / invites / OTP | **In-memory by default** (no Prisma `User` / `UserIdentity` / `UserInvite` / `OtpChallenge` on main) |
| SMS OTP | Console provider by default; Twilio when `TWILIO_*` set (not claimed live without secrets) |
| Web BFF | `GET /api/auth/keycloak` + `GET /api/auth/callback` ticket redeem |
| Realm export | `infra/keycloak/proctira-realm.json` (ops artifact) |

## Explicit waivers / non-claims

- Live production Keycloak IdP is **optional** and unverified in CI without secrets
- Live Twilio SMS is **not** claimed without `TWILIO_*`
- Mega PR #1 wholesale Prisma multi-schema + domain scaffold deletions are **superseded**

## Validate (optional ops)

`tools/scripts/validate-phase2-auth-ec3.sh` remains an ops checklist against a live
Keycloak + gateway; it is not part of default CI.
