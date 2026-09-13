/**
 * Fastify helpers for fees domain RBAC (W1-SEC-02 D1).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertFeesAccess, type FeesAction } from './fees-access.js';

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
 * Staff-wide reads vs parent/guardian self-scope reads.
 */
export function requireFeesRead(request: FastifyRequest, reply: FastifyReply): boolean {
  const scope = String((request.query as { scope?: string }).scope ?? '').toLowerCase();
  const action: FeesAction = scope === 'parent' ? 'fees.read.self' : 'fees.read';
  return requireFeesAction(request, reply, action);
}
