/**
 * Fastify helpers for registration / admissions domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  admissionsStaffActionForMethod,
  assertRegistrationAccess,
  isPublicRegistrationPath,
  registrationStaffActionForMethod,
  type RegistrationAction,
} from './registration-access.js';

export function registrationRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireRegistrationAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: RegistrationAction,
): boolean {
  try {
    assertRegistrationAccess(registrationRequestRoles(request), action);
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
 * Registration route preHandler: public apply/tracking skip RBAC;
 * staff CRM paths require registrar/admissions/admin.
 */
export function enforceRegistrationRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  if (isPublicRegistrationPath(path)) {
    return true;
  }
  const action = registrationStaffActionForMethod(request.method);
  return requireRegistrationAction(request, reply, action);
}

/** Admissions CRM: all routes require admissions/registrar staff. */
export function enforceAdmissionsRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const action = admissionsStaffActionForMethod(request.method);
  return requireRegistrationAction(request, reply, action);
}
