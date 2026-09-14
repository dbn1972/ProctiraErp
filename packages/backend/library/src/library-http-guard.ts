/**
 * Fastify helpers for library domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  assertLibraryAccess,
  libraryActionForMethod,
  type LibraryAction,
} from './library-access.js';

export function libraryRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireLibraryAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: LibraryAction,
): boolean {
  try {
    assertLibraryAccess(libraryRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

/** Map HTTP method (+ roles for portal reads) to a coarse library action. */
export function resolveLibraryAction(request: FastifyRequest): LibraryAction {
  return libraryActionForMethod(request.method, libraryRequestRoles(request));
}
