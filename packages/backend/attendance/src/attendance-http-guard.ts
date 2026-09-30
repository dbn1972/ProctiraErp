/**
 * Fastify helpers for attendance domain RBAC (W1-SEC-02 residual).
 */
import { AppError, routePathForAuthz } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import { assertAttendanceAccess, type AttendanceAction } from './attendance-access.js';

export function attendanceRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Asserts domain RBAC and writes 403 JSON when denied.
 * @returns true when allowed; false when the reply was already sent.
 */
export function requireAttendanceAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: AttendanceAction,
): boolean {
  try {
    assertAttendanceAccess(attendanceRequestRoles(request), action);
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
 * Map HTTP method + path to a coarse attendance action.
 * Returns null for device ingest (authenticated via device API key, not staff roles).
 */
export function attendanceActionForRequest(
  method: string,
  url: string,
): AttendanceAction | null {
  // Callers must pass the matched route pattern (routePathForAuthz), not the raw request target:
  // Fastify routes on the decoded path, so `/leave-requests/:id/%61pprove` reaches the approve
  // handler while a raw-URL check would see no `/approve` and downgrade to attendance.write.
  const path = (url.split('?')[0] ?? url).replace(/\/+$/, '');
  // Device ingest authenticates with x-device-api-key in the handler. Only the exact ingest route
  // skips user RBAC — a substring match let e.g. `/leave-requests/ingest/approve` skip it too.
  if (/(?:^|\/)attendance\/ingest$/.test(path) && method.toUpperCase() === 'POST') {
    return null;
  }
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'attendance.read';
  }
  if (/\/(?:approve|reject)(?:\/|$)/.test(path) || /\/devices(?:\/|$)/.test(path)) {
    return 'attendance.approve';
  }
  return 'attendance.write';
}

/**
 * Enforce attendance package RBAC for a request.
 * @returns true when allowed; false when reply already sent.
 */
export function enforceAttendanceRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const action = attendanceActionForRequest(request.method, routePathForAuthz(request));
  if (action == null) return true;
  return requireAttendanceAction(request, reply, action);
}
