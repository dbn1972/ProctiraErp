/**
 * Fastify helpers for transport domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertTransportAccess, type TransportAction } from './transport-access.js';

export function transportRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireTransportAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: TransportAction,
): boolean {
  try {
    assertTransportAccess(transportRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/** Map HTTP method to a coarse transport action. */
export function transportActionForMethod(method: string): TransportAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'transport.read';
  }
  return 'transport.write';
}
