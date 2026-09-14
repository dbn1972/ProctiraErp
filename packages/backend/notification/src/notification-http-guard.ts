/**
 * Fastify helpers for notification domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  assertNotificationAccess,
  notificationActionForPath,
  type NotificationAction,
} from './notification-access.js';

export function notificationRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

export function notificationHasUser(request: FastifyRequest): boolean {
  const user = (request as FastifyRequest & {
    user?: { sub?: string; userId?: string; id?: string };
  }).user;
  if (!user) return false;
  return Boolean(user.sub ?? user.userId ?? user.id);
}

export function requireNotificationAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: NotificationAction,
): boolean {
  try {
    assertNotificationAccess(notificationRequestRoles(request), action, {
      hasUser: notificationHasUser(request),
    });
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      void reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

export function enforceNotificationRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  const action = notificationActionForPath(path);
  return requireNotificationAction(request, reply, action);
}
