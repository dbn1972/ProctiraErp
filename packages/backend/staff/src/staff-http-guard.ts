/**
 * Fastify helpers for staff domain RBAC (not gateway rbacPlugin).
 */
import {
  AppError,
  isSchoolBoundPrincipal,
  principalInstitutions,
  type InstitutionScopePrincipal,
} from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertStaffAccess, type StaffAction } from './staff-access.js';
import type { StaffService } from './staff-service.js';

export function staffRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * PRC-H090: the caller's institution scope from the verified JWT (never from args/headers).
 *
 * Returns `undefined` for tenant-wide / board principals (admins who may cross schools), and the
 * principal's institution id list for school-bound principals. The scope is passed to
 * {@link StaffService.assertStaffWritableInInstitutions} so a school-bound HR officer cannot
 * mutate (update/delete/offboard/contract/leave/payroll) staff of another school by UUID.
 */
export function callerInstitutionScope(request: FastifyRequest): readonly string[] | undefined {
  const user = (request as FastifyRequest & { user?: InstitutionScopePrincipal }).user;
  if (!isSchoolBoundPrincipal(user)) return undefined; // tenant-wide / board admin
  return principalInstitutions(user);
}

/**
 * PRC-H090: assert a school-bound caller may write to `staffId`; otherwise send a 404 (not 403, so
 * another school's staff existence is not disclosed) and return false. A no-op for tenant-wide
 * callers. On any {@link AppError} (e.g. NotFoundError) the mapped JSON is written and false is
 * returned; the caller must then `return reply`.
 */
export async function assertStaffWritableOr404(
  request: FastifyRequest,
  reply: FastifyReply,
  staffService: StaffService,
  tenantId: string,
  staffId: string,
): Promise<boolean> {
  try {
    await staffService.assertStaffWritableInInstitutions(
      tenantId,
      staffId,
      callerInstitutionScope(request),
    );
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireStaffAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: StaffAction,
): boolean {
  try {
    assertStaffAccess(staffRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/**
 * Skip GET/HEAD/OPTIONS; assert `action` on mutating methods.
 * @returns true when the request may proceed; false when a 403 was sent. Async hooks must then
 * `return reply` (PRC-L363) so Fastify treats the hook as having responded rather than relying
 * on `reply.sent` side effects.
 */
export function staffWritePreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  action: StaffAction,
): boolean {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true;
  return requireStaffAction(request, reply, action);
}
