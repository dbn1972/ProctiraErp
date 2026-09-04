# Phase 2 — ProctiraERP Auth sign-off

**Status:** Complete in repo; EC3 schema/API + AuthShell `/login` validation passed (2026-09-04).

## Delivered

| Stream | Result |
|--------|--------|
| Branding | Redesign auth HTML + live `/login` use **ProctiraERP** (`P` + Proctira**ERP**); no CivitasOne in user flow |
| Auth UI | Shared `AuthShell` on login; forgot-password notes IdP-managed passwords; MFA authenticator chip (SMS deferred) |
| Schemas | Prisma `platform` / `auth` / `public`; tenants+themes → `platform`; users/identities/sessions/tokens → `auth` with bare `tenant_id` (no Tenant FK) |
| Tests | `@proctira/backend-auth` vitest (incl. schema-boundary); login branding smoke; `tools/scripts/validate-phase2-auth-ec3.sh` |

## EC3 (cloudsphere-ec3)

Applied migration `20260904_platform_auth_schemas`. Checklist results:

- `platform.tenants` = 1; `auth.users` = 1 (`admin@proctira.in`); Keycloak identities present
- FKs from `auth` → `platform.tenants` / domain tables = 0
- Keycloak password grant, `POST /api/v1/auth/password`, `GET /api/v1/auth/me`, web `POST /api/auth/login` → success
- `/login` branding: ProctiraERP; no CivitasOne / Keycloak chrome

**AuthShell sync (2026-09-04):** Copied login/`AuthShell`, forgot-password, MFA, redesign auth HTML, and validate script onto EC3 `~/ProctiraErp`. Live `/login` now serves the ProctiraERP `AuthShell` hero; web login cookies and gateway password/`/me` re-verified OK.

## Explicitly out of scope

- Splitting institution/student/attendance schemas
- Removing attendance `include: { student }` (Phase 5)
- Live SMS / mobile OTP

## Next

Phase 3+ can reuse the same pattern: domain schema, bare UUID refs, no cross-schema FKs/joins.
