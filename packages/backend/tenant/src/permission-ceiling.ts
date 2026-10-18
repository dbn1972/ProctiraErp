/**
 * PRC-L170: delegated-permission ceiling.
 *
 * Prevents privilege escalation when an actor creates or assigns a role: the
 * actor can never grant a permission that is not already covered by their own
 * effective permission set. In particular a non-superadmin actor can never
 * mint `*:*`, `*:manage`, or any `(resource, action)` they lack.
 *
 * Coverage semantics mirror `roleHasPermission` in
 * `@proctira/shared/auth` `rbac.ts` exactly:
 *   actor perm `(pr, pa)` covers needed `(r, a)`
 *     iff (pr === r || pr === '*') && (pa === a || pa === 'manage')
 *
 * The predicate is reproduced locally rather than importing `@proctira/auth`
 * so `@proctira/backend-tenant` does not grow a new cross-package edge for a
 * single rule (the same reasoning the repo already applies for the
 * status/uuid helpers in `pg-tenant-repository.ts`).
 */

import { ValidationError } from '@proctira/common';

import type { PermissionRef } from './roles-repository.js';

/**
 * Does the actor's effective permission set cover a single needed permission?
 *
 * A `manage` action covers every action on the same (or wildcard) resource; a
 * `*` resource covers every resource. Any other actor entry only covers the
 * exact `(resource, action)` pair.
 */
export function permissionCovers(actor: PermissionRef[], needed: PermissionRef): boolean {
  return actor.some(
    (p) =>
      (p.resource === needed.resource || p.resource === '*') &&
      (p.action === needed.action || p.action === 'manage'),
  );
}

/**
 * Throw a `ValidationError` when any requested permission exceeds the actor's
 * effective permission ceiling. The error lists every over-grant under the
 * `permissions` field, matching the field-error style the roles service
 * already uses for invalid permission payloads.
 *
 * @param actor      the actor's effective permission set (from their roles)
 * @param requested  the permissions the actor is trying to grant
 * @param context    short label used in the error message (e.g. the operation)
 */
export function assertWithinPermissionCeiling(
  actor: PermissionRef[],
  requested: PermissionRef[],
  context = 'role',
): void {
  const overGrants = requested.filter((needed) => !permissionCovers(actor, needed));
  if (overGrants.length === 0) return;

  throw new ValidationError(
    `Cannot grant permissions beyond your own (${context})`,
    overGrants.map((p) => ({
      field: 'permissions',
      rule: 'permission_ceiling',
      message: `You do not hold '${p.resource}:${p.action}' and cannot grant it`,
    })),
  );
}
