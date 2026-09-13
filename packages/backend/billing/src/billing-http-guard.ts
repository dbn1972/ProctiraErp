/**
 * Fastify helpers for billing domain RBAC (W1-SEC-02 D1).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertBillingAccess, type BillingAction } from './billing-access.js';

export function billingRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireBillingAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: BillingAction,
): boolean {
  try {
    assertBillingAccess(billingRequestRoles(request), action);
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
 */
export function billingWritePreHandler(
  request: FastifyRequest,
  reply: FastifyReply,
  action: BillingAction = 'billing.manage',
): void {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  requireBillingAction(request, reply, action);
}
