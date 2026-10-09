/**
 * Fastify helpers for fees domain RBAC (W1-SEC-02 D1).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertFeesAccess, hasFeesAccess, type FeesAction } from './fees-access.js';

/**
 * Effective fees read scope, derived from the caller's ROLES — never a client query param.
 *  - 'staff': caller holds fees.read → may read tenant-wide (subject to institution scope).
 *  - 'self':  caller holds only fees.read.self (parent/guardian/student) → reads MUST be
 *             filtered to the caller's linked students; staff-only routes must deny.
 */
export type FeesReadScope = 'staff' | 'self';

export function feesRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireFeesAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: FeesAction,
): boolean {
  try {
    assertFeesAccess(feesRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/**
 * PRC-C005: resolve the caller's effective fees read scope from their ROLES.
 *
 * The previous requireFeesRead trusted a `?scope=parent` query param to downgrade the required
 * action to fees.read.self, so any parent/student could add `?scope=parent` to any fees read
 * route and pass the guard — while most handlers ignored the scope and returned tenant-wide
 * data. Scope must be derived from identity, not the request.
 *
 * Returns the scope when allowed; sends 403 and returns null when the caller holds no fees read
 * permission at all. Callers MUST branch on the returned scope: 'self' reads are filtered to the
 * caller's linked students, and staff-only routes must reject 'self' via requireFeesStaffRead.
 */
export function resolveFeesReadScope(
  request: FastifyRequest,
  reply: FastifyReply,
): FeesReadScope | null {
  const roles = feesRequestRoles(request);
  if (hasFeesAccess(roles, 'fees.read')) return 'staff';
  if (hasFeesAccess(roles, 'fees.read.self')) return 'self';
  void reply
    .status(403)
    .send(new AppError('Forbidden: role cannot read fees', 'FORBIDDEN', 403).toJSON());
  return null;
}

/**
 * PRC-M511: a self-pay caller (parent/guardian/student) holds fees.read.self but not the staff
 * fees.read permission. Such callers may only pay invoices of their own linked students, with the
 * payer identity taken from the JWT (never a client-supplied payerUserId), and may not record
 * staff-only tender types (e.g. cash) on the pay path.
 */
export function isSelfPayCaller(request: FastifyRequest): boolean {
  const roles = feesRequestRoles(request);
  return !hasFeesAccess(roles, 'fees.read') && hasFeesAccess(roles, 'fees.read.self');
}

/**
 * Staff-only fees read: rejects self-scope callers (parent/guardian/student) even if they hold
 * fees.read.self. Use on routes that cannot be meaningfully self-scoped (tenant-wide ledgers,
 * trial balance, reconciliation, dues reports).
 */
export function requireFeesStaffRead(request: FastifyRequest, reply: FastifyReply): boolean {
  return requireFeesAction(request, reply, 'fees.read');
}
