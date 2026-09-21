# Tenancy invariant: board is the tenant, one identity belongs to one tenant

**Decided:** 2026-09-20, by the repository owner
**Status:** foundational — this settles the isolation model
**Applies to:** every authorization, RLS and multi-school design decision

`docs/audits/templates/UAT_READINESS_VERIFICATION_PROMPT.md` Part B says to
"determine whether a school is a tenant or a row — this decides the entire
isolation model". It is now decided, and the second half of the rule matters as
much as the first.

## The invariant

1. **A board (or district) is the tenant.** A school is a row: `institutions` has
   a `uuid tenant_id`, and 8 of 18 tenants already own more than one institution
   (max 3) in the evaluation database.
2. **One person cannot belong to two boards.** Therefore **one identity belongs to
   exactly one tenant, always.** There is no such thing as a cross-tenant user.

## What follows from it

### Additional charge is an intra-tenant concern

A government headmaster holding additional charge of a second school is a **single
identity, single tenant, multiple institutions**. The existing institution-scope
machinery already expresses this — `apps/api-gateway/src/institution-scope.test.ts`
encodes exactly this case:

```ts
const schoolPrincipal = {
  institutions: ['school-a', 'school-b'], // additional charge
  roles: [{ roleId: 'principal' }],
};
```

| Caller             | Request                | Decision                        |
| ------------------ | ---------------------- | ------------------------------- |
| principal of a + b | list students, no id   | **inject** `school-a` (primary) |
| principal of a + b | fees for `school-z`    | **deny**                        |
| board admin        | students in any school | **allow**                       |

No cross-tenant access is involved, so **additional charge is not a reason to relax
tenant isolation**. Anyone proposing a cross-tenant mechanism to serve it has
misread the model.

### No user-facing code path needs a cross-tenant escape

This is the consequence that matters for
`docs/audits/SEC_CONTROL_PLANE_DOCUMENT_ISOLATION.md`. Because no identity spans
tenants, the `app.platform_admin='1'` escape on `control_plane_documents` has **no
legitimate user-facing use at all**. Its only defensible use is platform
operations performed by the ProctiraERP operator — a distinct actor tier from any
board or school user — and that use must be explicit rather than ambient.

### Collection classification (the input step 2 of the P0 was waiting on)

With the invariant settled, every collection resolves:

| Collection                                                                                                                            | Owner            |
| ------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `auth.keycloak_identities`, `auth.users`, `auth.otp_challenges`, `auth.invites`                                                       | **tenant-owned** |
| `auth.tenants` — "personal tenant directory for the signed-in user" (`keycloak/routes.ts:498`); one identity → one tenant, so one row | **tenant-owned** |
| `billing.plans`, `billing.subscriptions`, `billing.entitlements`, `billing.usage`                                                     | **tenant-owned** |
| platform-admin console state, tenant-lifecycle records                                                                                | platform-owned   |

So step 2 routes all `auth.*` and `billing.*` call sites to `{ tenantId }`, and only
genuine platform-operator paths to `{ platform: true }`.

## Known gap this exposes

`packages/backend/auth/src/keycloak/verify.ts:164` hardcodes:

```ts
institutions: [],
```

Under Keycloak the claim is therefore **always empty**, so the additional-charge
model cannot express anything today — every principal is effectively unscoped or
falls through. The authorization logic exists and is tested; the data that should
drive it never arrives.

`staff_assignments` already has the right shape to supply it: `staff_id`,
`institution_id`, `role`, `allocation_percentage`, `start_date`, `end_date`,
`status`. Additional charge is naturally a second row with its own dates and
allocation, which also makes the charge **time-bounded** — it lapses on its end
date instead of persisting in a long-lived token.

### Acceptance criteria for closing that gap

1. `verify.ts` populates `institutions[]` from active `staff_assignments`
   (`status` active, `now()` within `start_date`/`end_date`), scoped to the
   identity's tenant.
2. A live test asserts a principal with two active assignments sees both schools
   and is denied a third.
3. A live test asserts an assignment past its `end_date` no longer grants access.
4. `grep -n "institutions: \[\]" packages/backend/auth/src/keycloak/verify.ts`
   returns nothing.

## What this invariant forbids

Recorded so it is not re-litigated:

- A user record reachable from two tenants.
- Any RLS policy granting a **user** cross-tenant read. Platform-operator paths are
  the sole exception and must be explicit.
- Using additional charge, board oversight or "ministry view" as justification for
  relaxing `tenant_id` predicates. Board oversight is served by a board-admin role
  **inside** the tenant, not by crossing tenants.
