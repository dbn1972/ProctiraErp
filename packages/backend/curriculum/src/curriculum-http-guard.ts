/**
 * Fastify helpers for curriculum domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertCurriculumAccess, type CurriculumAction } from './curriculum-access.js';

export function curriculumRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

export function requireCurriculumAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: CurriculumAction,
): boolean {
  try {
    assertCurriculumAccess(curriculumRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

export function curriculumActionForMethod(method: string): CurriculumAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') return 'curriculum.read';
  return 'curriculum.write';
}

export function enforceCurriculumRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  return requireCurriculumAction(request, reply, curriculumActionForMethod(request.method));
}
