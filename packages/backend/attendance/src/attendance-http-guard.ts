/**
 * Fastify helpers for attendance domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
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
  const path = url.split('?')[0] ?? url;
  if (path.endsWith('/ingest') || path.includes('/ingest')) {
    return null;
  }
  const upper = method.toUpperCase();
  if (upper === 'GET' || upper === 'HEAD' || upper === 'OPTIONS') {
    return 'attendance.read';
  }
  if (
    path.includes('/approve') ||
    path.includes('/reject') ||
    path.endsWith('/devices') ||
    path.includes('/devices')
  ) {
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
  const action = attendanceActionForRequest(request.method, request.url);
  if (action == null) return true;
  return requireAttendanceAction(request, reply, action);
}
