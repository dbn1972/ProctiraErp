/**
 * Fastify helpers for staff domain RBAC (not gateway rbacPlugin).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertStaffAccess, type StaffAction } from './staff-access.js';

export function staffRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
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
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/**
 * Skip GET/HEAD/OPTIONS; assert `action` on mutating methods.
 * When denied, reply is sent and Fastify skips the route because `reply.sent`.
 */
export function staffWritePreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  action: StaffAction,
): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  if (!requireStaffAction(request, reply, action)) {
    return;
  }
}
