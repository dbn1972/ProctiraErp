/**
 * Fastify helpers for LMS domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  assertLmsAccess,
  lmsActionForRequest,
  type LmsAction,
} from './lms-access.js';

export function lmsRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

export function lmsHasUser(request: FastifyRequest): boolean {
  const user = (request as FastifyRequest & {
    user?: { sub?: string; userId?: string; id?: string };
  }).user;
  if (!user) return false;
  return Boolean(user.sub ?? user.userId ?? user.id);
}

export function requireLmsAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: LmsAction,
): boolean {
  try {
    assertLmsAccess(lmsRequestRoles(request), action, { hasUser: lmsHasUser(request) });
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

export function enforceLmsRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  const action = lmsActionForRequest(request.method, path);
  return requireLmsAction(request, reply, action);
}
