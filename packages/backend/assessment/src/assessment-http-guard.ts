/**
 * Fastify helpers for assessment domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertAssessmentAccess, type AssessmentAction } from './assessment-access.js';

export function assessmentRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

export function requireAssessmentAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: AssessmentAction,
): boolean {
  try {
    assertAssessmentAccess(assessmentRequestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

export function assessmentActionForMethod(method: string): AssessmentAction {
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'assessment.read';
  }
  return 'assessment.write';
}

export function enforceAssessmentRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  return requireAssessmentAction(
    request,
    reply,
    assessmentActionForMethod(request.method),
  );
}
