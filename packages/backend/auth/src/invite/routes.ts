/**
 * Admin / tenant invite routes + current-user tenant directory alias.
 *
 * POST /admin/users/invite
 * POST /tenant/users/invite
 * GET  /tenants/mine
 *
 * Tenant directory resolves name/slug/status via the tenant repository when
 * wired (PRC-L084); otherwise it falls back to the JWT claim.
 */
import { AppError } from '@proctira/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { resolveTenantDirectory, type TenantDirectoryReader } from '../tenant-directory.js';

import type { InviteService } from './invite-service.js';
import { validateInviteUserInput, type InviteUserInput } from './schemas.js';

export interface InviteRoutesOptions {
  inviteService: InviteService;
  /** Tenant repository used to report real name/slug/status (PRC-L084). */
  tenantDirectory?: TenantDirectoryReader;
}

function requireTenant(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (!tenantId) {
    reply.status(400).send({
      code: 'TENANT_REQUIRED',
      message: 'Tenant context is required',
      statusCode: 400,
    });
    return undefined;
  }
  return tenantId;
}

function getUserId(request: FastifyRequest): string | undefined {
  const user = request.user as { sub?: string; userId?: string } | undefined;
  return user?.sub ?? user?.userId;
}

const INVITE_ADMIN_ROLE_IDS = new Set([
  'admin',
  'super-admin',
  'tenant-admin',
  'tenant_admin',
  'administrator',
  'super_admin',
]);

/**
 * Invite endpoints are privileged. Require an admin-class role on the JWT
 * before creating invites (security: privilege escalation).
 */
function requireInviteAdmin(request: FastifyRequest, reply: FastifyReply): boolean {
  const user = request.user as
    | {
        roles?: Array<string | { roleId?: string; roleName?: string }>;
      }
    | undefined;
  if (!user) {
    reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      statusCode: 401,
    });
    return false;
  }

  const roles = user.roles ?? [];
  const allowed = roles.some((role) => {
    if (typeof role === 'string') {
      return INVITE_ADMIN_ROLE_IDS.has(role.toLowerCase());
    }
    const id = (role.roleId ?? '').toLowerCase();
    const name = (role.roleName ?? '').toLowerCase().replace(/\s+/g, '-');
    return INVITE_ADMIN_ROLE_IDS.has(id) || INVITE_ADMIN_ROLE_IDS.has(name);
  });

  if (!allowed) {
    reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Administrator role required to invite users',
      statusCode: 403,
    });
    return false;
  }
  return true;
}

async function handleInvite(
  inviteService: InviteService,
  request: FastifyRequest<{ Body: InviteUserInput }>,
  reply: FastifyReply,
): Promise<void> {
  if (!requireInviteAdmin(request, reply)) return;

  const result = validateInviteUserInput(request.body);
  if (!result.success) {
    reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      statusCode: 400,
      errors: result.errors,
    });
    return;
  }

  const tenantId = requireTenant(request, reply);
  if (!tenantId) return;

  try {
    const invite = await inviteService.inviteUser(
      tenantId,
      result.data,
      getUserId(request) ?? null,
    );
    reply.status(201).send(invite);
  } catch (error: unknown) {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return;
    }
    throw error;
  }
}

/**
 * Claim-based tenant directory (no Prisma User / UserIdentity on main).
 */
async function listMyTenants(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantDirectory: TenantDirectoryReader | undefined,
): Promise<void> {
  const user = request.user as { sub?: string; email?: string; tenantId?: string } | undefined;
  if (!user?.sub && !user?.email && !user?.tenantId) {
    reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user context is required',
      statusCode: 401,
    });
    return;
  }

  const tenantId = user.tenantId ?? (request as FastifyRequest & { tenantId?: string }).tenantId;
  reply.status(200).send({ data: await resolveTenantDirectory(tenantId, tenantDirectory) });
}

export async function registerInviteAndTenantDirectoryRoutes(
  fastify: FastifyInstance,
  options: InviteRoutesOptions,
): Promise<void> {
  const { inviteService } = options;

  fastify.post(
    '/admin/users/invite',
    async (request: FastifyRequest<{ Body: InviteUserInput }>, reply) => {
      await handleInvite(inviteService, request, reply);
    },
  );

  fastify.post(
    '/tenant/users/invite',
    async (request: FastifyRequest<{ Body: InviteUserInput }>, reply) => {
      await handleInvite(inviteService, request, reply);
    },
  );

  fastify.get('/tenants/mine', async (request, reply) => {
    await listMyTenants(request, reply, options.tenantDirectory);
  });
}
