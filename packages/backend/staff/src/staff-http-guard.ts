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
