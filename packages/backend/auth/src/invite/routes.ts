/**
 * Admin / tenant invite routes + current-user tenant directory alias.
 *
 * POST /admin/users/invite
 * POST /tenant/users/invite
 * GET  /tenants/mine
 *
 * Note: GET /auth/tenants is registered by Keycloak auth routes.
 */
import { AppError } from '@proctira/common';
import { getPrismaClient } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { InviteService } from './invite-service.js';
import { validateInviteUserInput, type InviteUserInput } from './schemas.js';

export interface InviteRoutesOptions {
  inviteService: InviteService;
  /** Optional prisma for tenant directory lookups. */
  prisma?: PrismaClient;
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

function getUserEmail(request: FastifyRequest): string | undefined {
  const user = request.user as { email?: string } | undefined;
  return user?.email?.trim().toLowerCase();
}

async function handleInvite(
  inviteService: InviteService,
  request: FastifyRequest<{ Body: InviteUserInput }>,
  reply: FastifyReply,
): Promise<void> {
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
    const invite = await inviteService.inviteUser(tenantId, result.data, getUserId(request) ?? null);
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
 * List tenants the current user can access via auth.users / identities /
 * user_role_assignments, then resolve platform.tenants by bare UUID (no join).
 */
async function listMyTenants(
  prisma: PrismaClient | undefined,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const userId = getUserId(request);
  const email = getUserEmail(request);
  if (!userId && !email) {
    reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authenticated user context is required',
      statusCode: 401,
    });
    return;
  }

  if (!prisma) {
    // Without DB, return the current request tenant only when present.
    const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
    reply.status(200).send({
      data: tenantId
        ? [{ id: tenantId, name: null, slug: null, status: 'active' }]
        : [],
    });
    return;
  }

  const tenantIds = new Set<string>();

  if (userId) {
    const [users, identities, assignments] = await Promise.all([
      prisma.user.findMany({ where: { id: userId }, select: { tenantId: true } }),
      prisma.userIdentity.findMany({ where: { userId }, select: { tenantId: true } }),
      prisma.userRoleAssignment.findMany({ where: { userId }, select: { tenantId: true } }),
    ]);
    for (const row of users) tenantIds.add(row.tenantId);
    for (const row of identities) tenantIds.add(row.tenantId);
    for (const row of assignments) tenantIds.add(row.tenantId);
  }

  if (email) {
    const [usersByEmail, identitiesByEmail] = await Promise.all([
      prisma.user.findMany({ where: { email }, select: { tenantId: true } }),
      prisma.userIdentity.findMany({ where: { email }, select: { tenantId: true } }),
    ]);
    for (const row of usersByEmail) tenantIds.add(row.tenantId);
    for (const row of identitiesByEmail) tenantIds.add(row.tenantId);
  }

  const ids = [...tenantIds];
  if (ids.length === 0) {
    reply.status(200).send({ data: [] });
    return;
  }

  // Sequential platform-schema lookup by bare UUID (no cross-schema SQL join).
  const tenants = await prisma.tenant.findMany({
    where: { id: { in: ids }, deletedAt: null },
    select: { id: true, name: true, slug: true, status: true },
    orderBy: { name: 'asc' },
  });

  reply.status(200).send({
    data: tenants.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status,
    })),
  });
}

export async function registerInviteAndTenantDirectoryRoutes(
  fastify: FastifyInstance,
  options: InviteRoutesOptions,
): Promise<void> {
  const { inviteService } = options;
  const prisma =
    options.prisma ?? (process.env['DATABASE_URL'] ? getPrismaClient() : undefined);

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

  // GET /auth/tenants is registered by Keycloak auth routes (same handler shape).
  // Keep /tenants/mine here as the alternate path for mobile/web clients.
  fastify.get('/tenants/mine', async (request, reply) => {
    await listMyTenants(prisma, request, reply);
  });
}
