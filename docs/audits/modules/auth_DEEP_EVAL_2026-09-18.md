# Deep evaluation — `auth`

| Field         | Value                                                                 |
| ------------- | --------------------------------------------------------------------- |
| Audited SHA   | `0f463640c8fbee6331bf622402f4ae70bdba2b1b`                            |
| Date          | 2026-09-18                                                            |
| Evidence DB   | PostgreSQL 16, 113 domain SQL files, `APPLY_STRICT_FKS=1`             |
| Runtime role  | `proctira_app` — NOSUPERUSER, NOBYPASSRLS (verified)                  |
| External deps | Keycloak 25.0 realm `proctira` reachable (HTTP 200); Redis 7 responds |
| Mount status  | Mounted, registered directly in `app.ts` (not `DOMAIN_REGISTRARS`)    |
| Disposition   | **PARTIAL**                                                           |

## Step 1 — Real surface

40 source files, considerably more than the top-level listing suggests. A prior
pass that globbed only `src/*.ts` missed the `keycloak/`, `invite/` and
`external-providers/` subtrees and understated this module.

| Area          | Files               | Notes                                                                                                    |
| ------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| Core tokens   | 6                   | `token-service`, `session-service/store`, `refresh-token-store`, `access-token-revocation`, `local-auth` |
| Keycloak      | 6                   | `identity`, `pg-identity-store`, `plugin`, `roles`, `routes`, `verify`                                   |
| External IdPs | 8                   | Google, Microsoft, OAuth2, OIDC, SAML, registry, handler, routes                                         |
| Invite        | 6                   | PG + in-memory repositories, service, routes, schemas                                                    |
| MFA / lockout | 5                   | `mfa-routes`, `otp-service`, `pg-otp-store`, `lockout-service/store`                                     |
| RBAC          | 2                   | `rbac-evaluator`, `rbac-plugin`                                                                          |
| Tests         | 23 unit, **0 live** |                                                                                                          |

**Contradiction: yes.** `mount-matrix.ts` records `persistence: 'in-memory'`.
Tip code selects Postgres in `pg-otp-store.ts:61`, `keycloak/pg-identity-store.ts`
and `invite/pg-invite-repository.ts`. Prefer the code; the matrix is stale.

## Step 2 — Vertical trace

`actor → UI → API → authz → service → repository → persistence → audit → tests → runbook`

Chain is continuous through repository. It breaks at two links:

1. **Persistence is a document store, not relational tables.** The logical names
   `auth.otp_challenges`, `auth.keycloak_identities`, `auth.keycloak_tenants`,
   `auth.keycloak_users`, `auth.invites` are **not tables**. `to_regclass` returns
   NULL for all of them. They are `collection` keys inside the single JSONB table
   `control_plane_documents`. There is no `auth` schema in the database.
2. **No live verification.** 0 live tests for the module that is the trust
   boundary for every other module.

## Step 3 — Five dimensions

### 1. UX design — `unverified`

No screens were opened. `auth` serves API routes plus MFA and invite flows; the
consuming surfaces live in `apps/web` and `apps/admin-console`. Not assessed:
empty/error/permission-denied states, keyboard reachability, 320px behaviour,
i18n resolution of auth error copy. Requires the UX and accessibility checklists
against running screens.

### 2. Functionality — `partial`

Breadth is real: local auth, Keycloak OIDC, five external IdP providers, MFA with
OTP, lockout, invites, refresh tokens, RBAC evaluation, and access-token
revocation hardened earlier today (#319).

Unverified lifecycles: no test proves an actor completes login → MFA → session →
refresh → logout → revocation end to end against production adapters. `sms-provider.ts`
depends on the notification sandbox, so **OTP delivery by SMS does not work** —
MFA is unusable in production over that channel.

### 3. Integrity — `partial`, P1

`control_plane_documents` holds all auth identity, OTP, invite and Keycloak
mapping state:

| Property     | Value                                                               |
| ------------ | ------------------------------------------------------------------- |
| `tenant_id`  | `text`, **nullable**                                                |
| Foreign keys | **0**                                                               |
| Constraints  | PK on `(collection, id)` only                                       |
| Indexes      | `(tenant_id, collection)`, `(collection, tenant_id)`, GIN on `data` |
| RLS          | enabled and **forced**                                              |

Consequences:

- No referential integrity between an auth identity and `tenants`. An identity
  can reference a deleted or non-existent tenant.
- No column or shape constraints; `data` is unconstrained JSONB.
- **The strict tenant FK gate does not cover this table.**
  `tools/scripts/check-strict-tenant-fks.mjs:77` filters `col.data_type = 'uuid'`.
  Because `tenant_id` is `text`, the table never enters the check. W1-DATA-06
  reports **pass** while auth data sits outside the guarantee. This is a gap in
  the gate, not just in the table.

### 4. Security — `partial`, **P0**

RLS works. Proven on the live database as `proctira_app` (NOBYPASSRLS):

| Probe | Session                                 | Rows  | Meaning                     |
| ----- | --------------------------------------- | ----- | --------------------------- |
| 1     | `app.tenant_id = <tenant B>`            | 0     | cross-tenant read denied    |
| 2     | `app.tenant_id = <tenant A>`            | 1     | not vacuous — owner sees it |
| 3     | tenant B **+ `app.platform_admin='1'`** | **1** | **escape succeeds**         |

The RLS policy is
`tenant_id = NULLIF(current_setting('app.tenant_id'),'') OR current_setting('app.platform_admin') = '1'`.

**Every `PgDocumentCollection` method binds `app.platform_admin = '1'`** via
`withPlatformScope` (`packages/shared/database/src/pg-document-store.ts:40`, used
at lines 111, 122, 136 and beyond). So for all auth state, RLS is bypassed by
construction and isolation depends entirely on application-level key handling:

| Method         | Tenant filter in SQL |
| -------------- | -------------------- |
| `get(id)`      | **none**             |
| `all()`        | **none**             |
| `delete(id)`   | **none**             |
| `where(c, t?)` | **optional**         |
| `byTenant(t)`  | yes                  |

Current auth call sites are individually defensible — `challenges.get(mfaToken)`
relies on a high-entropy bearer token, `users.get(\`${tenantId}:${email}\`)`embeds the tenant in a composite key, and invites use`byTenant`. But there is no
database backstop. A future call site that omits the tenant prefix, or any use of
`all()`, returns cross-tenant auth records and RLS will not stop it.

Also unverified: whether an MFA token issued under tenant A is rejected when
presented in a tenant B request context. `pg-otp-store.ts:34` resolves the token
without a tenant predicate.

### 5. Production — `partial`

Runs under `NODE_ENV=production` with `DATABASE_URL` set. Hardened today by #319:
production now refuses to start without a cluster-visible revocation store, so
multi-replica logout is consistent.

Remaining: sessions and lockout are in-memory unless Redis is wired; SMS OTP
delivery is sandbox-only; no SLOs, alerts or runbook located for auth; no load
evidence for token verification.

## Step 5 — Gap matrix

| Capability                       | Current evidence                                                                               | Evidence status | Contradiction               | Expected enterprise state                                                | Gap                                                                                      | Impact                                                                            | Recommendation                                                                                                               | Priority | Effort | Confidence |
| -------------------------------- | ---------------------------------------------------------------------------------------------- | --------------- | --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- | ------ | ---------- |
| Tenant isolation of auth records | Probe 3: platform_admin escape returns cross-tenant row; `pg-document-store.ts:40`             | partial         | no                          | RLS enforces isolation independent of application code                   | Document store bypasses RLS on every call; `get`/`all`/`delete` have no tenant predicate | Cross-tenant identity/invite/OTP disclosure if any call site omits tenant scoping | Add tenant-scoped variants and stop binding platform_admin for tenant-owned collections; reserve the escape for provisioning | **P0**   | M      | High       |
| Strict FK coverage of auth state | `check-strict-tenant-fks.mjs:77` filters `data_type='uuid'`; table has 0 FKs, `tenant_id text` | partial         | **yes** — gate reports pass | Every tenant-scoped table references `tenants(id)`                       | `text` tenant_id escapes the gate entirely                                               | Silent hole in a control that is believed comprehensive                           | Extend the gate to `text` tenant_id columns; migrate the column to `uuid` with an FK                                         | **P0**   | M      | High       |
| Live verification of auth        | 23 unit tests, 0 `.live.test.ts`                                                               | absent          | no                          | Cross-tenant denial and lifecycle proven against migrated PG as app role | No live proof for the platform trust boundary                                            | Regressions in isolation reach production undetected                              | Add live suites: cross-tenant denial, MFA token tenant binding, invite scoping                                               | **P0**   | M      | High       |
| MFA OTP delivery                 | `sms-provider.ts` → notification sandbox; live SMS "not implemented"                           | absent          | no                          | OTP reaches a real phone                                                 | No live SMS adapter                                                                      | MFA unusable in production; 2FA effectively unavailable                           | Wire one SMS provider behind the existing registry                                                                           | **P0**   | M      | High       |
| MFA token tenant binding         | `pg-otp-store.ts:34` `get(mfaToken)`, no tenant predicate                                      | unverified      | no                          | Token valid only within issuing tenant                                   | Unproven whether cross-tenant presentation is rejected                                   | Possible MFA replay across tenants                                                | Add a live test presenting a tenant-A token in a tenant-B context                                                            | P1       | S      | Medium     |
| Auth state integrity             | JSONB `data`, no constraints, nullable `tenant_id`                                             | partial         | no                          | Typed columns or validated shape, non-null tenant                        | Unconstrained document rows                                                              | Malformed identity rows accepted silently                                         | Add a JSONB shape CHECK, or promote to relational tables                                                                     | P1       | L      | High       |
| Session / lockout durability     | `session-store.ts`, `lockout-store.ts` in-memory unless Redis                                  | partial         | no                          | Shared store across replicas                                             | Lockout counters reset per replica                                                       | Brute-force throttling bypassable by hitting another replica                      | Apply the #319 shared-store pattern to lockout and sessions                                                                  | P1       | M      | Medium     |
| Persistence label accuracy       | Matrix says `in-memory`; code selects PG                                                       | partial         | **yes**                     | Matrix reflects runtime                                                  | Stale label                                                                              | Audits reach wrong conclusions                                                    | Refresh matrix for `auth`, `billing`, `developer-portal`                                                                     | P2       | S      | High       |
| UX / accessibility of auth flows | Not opened                                                                                     | unverified      | no                          | Reviewed against both checklists                                         | Not assessed                                                                             | Unknown                                                                           | Run UX + a11y checklists on login, MFA, invite screens                                                                       | P2       | M      | Low        |
| Operability                      | No SLO/alert/runbook found                                                                     | absent          | no                          | SLOs, alerts, runbook                                                    | Missing                                                                                  | Slow incident response on the trust boundary                                      | Add auth SLOs and a runbook                                                                                                  | P2       | S      | Medium     |

## Step 6 — Acceptance criteria

**P0-1 — RLS is the isolation mechanism.** A live test asserts that, as
`proctira_app` bound to tenant B with no `platform_admin`, reading a tenant-A
`auth.keycloak_users` document returns 0 rows through the _application_ path, not
just raw SQL. `withPlatformScope` no longer appears in read paths for
tenant-owned collections.

**P0-2 — Gate covers text tenant_id.** `check-strict-tenant-fks.mjs` fails on a
fixture table with `tenant_id text` and no FK. `control_plane_documents` either
has a validated FK to `tenants(id)` or an explicit, documented allowlist entry.

**P0-3 — Live proof exists.** `packages/backend/auth/src/*.live.test.ts` executes
in the live gate with a non-zero executed count, covering cross-tenant denial,
MFA tenant binding, and invite scoping.

**P0-4 — MFA works.** With one SMS provider configured, an OTP is delivered and
verified end to end; `PROVIDER_MODE=live` no longer throws for SMS.

**P1-1 — Lockout is shared.** Ten failed logins spread across two gateway
replicas trigger lockout, proven against Redis.

## What I could not verify

- Any UX or accessibility dimension; no screens were opened.
- Token-verification performance or behaviour under load.
- Whether the five external IdP providers work against real Google, Microsoft,
  SAML or generic OIDC endpoints; no credentials were available.
- SAML assertion signature validation correctness, which needs a signed fixture.
- Behaviour under a real multi-replica rollout.

## Reproduction

```bash
DATABASE_URL=postgresql://proctira_app:proctira_app_eval@127.0.0.1:55440/proctira_eval
MIGRATOR_DATABASE_URL=postgresql://proctira:proctira_eval@127.0.0.1:55440/proctira_eval
```

Probe 3, the P0 evidence:

```sql
SELECT set_config('app.tenant_id','<tenant B>',false);
SELECT set_config('app.platform_admin','1',false);
SELECT count(*) FROM control_plane_documents
 WHERE collection='auth.keycloak_users' AND id='<tenant A doc>';
-- returns 1
```
