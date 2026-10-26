/**
 * Fastify helpers for assessment domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

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
  return requireAssessmentAction(request, reply, assessmentActionForMethod(request.method));
}

const guardedInstances = new WeakSet<FastifyInstance>();

/**
 * PRC-L083: install the package-level RBAC preHandler (W1-SEC-02) once per
 * Fastify instance. The grading, result and report-card route groups each call
 * this so they stay guarded when registered alone; under the fp-wrapped
 * assessment plugin they share one instance and the hook no longer stacks.
 */
export function installAssessmentRouteGuard(fastify: FastifyInstance): void {
  if (guardedInstances.has(fastify)) return;
  guardedInstances.add(fastify);
  fastify.addHook('preHandler', async (request, reply) => {
    if (!enforceAssessmentRouteAccess(request, reply)) {
      return reply;
    }
  });
}
