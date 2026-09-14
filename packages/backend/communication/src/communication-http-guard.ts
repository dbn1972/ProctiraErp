/**
 * Fastify helpers for communication domain RBAC (W1-SEC-02 residual).
 */
import { AppError } from '@proctira/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  assertCommunicationAccess,
  communicationActionForPath,
  type CommunicationAction,
} from './communication-access.js';

export function communicationRequestRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

export function communicationHasUser(request: FastifyRequest): boolean {
  const user = (request as FastifyRequest & {
    user?: { sub?: string; userId?: string; id?: string };
  }).user;
  if (!user) return false;
  return Boolean(user.sub ?? user.userId ?? user.id);
}

export function requireCommunicationAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: CommunicationAction,
): boolean {
  try {
    assertCommunicationAccess(communicationRequestRoles(request), action, {
      hasUser: communicationHasUser(request),
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

export function enforceCommunicationRouteAccess(
  request: FastifyRequest,
  reply: FastifyReply,
): boolean {
  const path = request.url.split('?')[0] ?? request.url;
  const action = communicationActionForPath(path);
  return requireCommunicationAction(request, reply, action);
}
