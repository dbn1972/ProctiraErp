import type { FastifyRequest } from 'fastify';

import type { TransferActor } from './state-machine.js';

interface JwtLike {
  sub?: string;
  userId?: string;
  displayName?: string;
  roles?: Array<{ roleId?: string; institutionId?: string }>;
  institutions?: string[];
}

export function actorFromRequest(request: FastifyRequest): TransferActor {
  const user = (request as FastifyRequest & { user?: JwtLike }).user;
  const roleIds = (user?.roles ?? [])
    .map((role) => role.roleId)
    .filter((roleId): roleId is string => Boolean(roleId));
  const institutionIds = [
    ...(user?.institutions ?? []),
    ...(user?.roles ?? [])
      .map((role) => role.institutionId)
      .filter((id): id is string => Boolean(id)),
  ];
  return {
    userId: user?.sub ?? user?.userId ?? 'unknown',
    displayName: user?.displayName?.trim() || 'User',
    roleIds,
    institutionIds: [...new Set(institutionIds)],
    ipAddress: request.ip || '0.0.0.0',
  };
}
