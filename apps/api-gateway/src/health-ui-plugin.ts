/**
 * Health redesign UI aggregate routes + access-context bridge.
 *
 * Mounts under `/api/v1` alongside the domain health plugin:
 *  - Aggregate list/detail endpoints consumed by App Router pages
 *  - Tenant-scoped seed filtering (cross-tenant deny)
 *  - onRequest hook that maps JWT roles → request.healthAccessContext
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  HEALTH_DEMO_TENANT_ID,
  createHealthUiSeed,
  type HealthUiSeed,
} from './health-ui-seed.js';

/** Roles allowed to view health PII via UI aggregates. */
const HEALTH_UI_ROLES = new Set([
  'HEALTH_OFFICER',
  'health_officer',
  'NURSE',
  'school_nurse',
  'HEALTH_ADMIN',
  'health_admin',
  'SUPER_ADMIN',
  'system_admin',
  'SYSTEM_ADMIN',
  'COUNSELLOR',
  'counsellor',
]);

interface JwtUserLike {
  sub?: string;
  userId?: string;
  tenantId?: string;
  roles?: Array<{ roleName?: string; roleId?: string } | string>;
  guardianOfStudentIds?: string[];
}

function extractRoleNames(user: JwtUserLike | undefined): string[] {
  if (!user?.roles) return [];
  return user.roles
    .map((role) => {
      if (typeof role === 'string') return role;
      return role.roleName ?? role.roleId ?? '';
    })
    .filter(Boolean);
}

function hasHealthUiAccess(roles: string[]): boolean {
  return roles.some(
    (role) => HEALTH_UI_ROLES.has(role) || HEALTH_UI_ROLES.has(role.toUpperCase()),
  );
}

function resolveTenantId(request: FastifyRequest): string | null {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const header = request.headers['x-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  return user?.tenantId ?? null;
}

function deny(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  code: string,
  message: string,
  statusCode = 403,
) {
  return reply.status(statusCode).send({ code, message, statusCode });
}

function assertHealthAccess(request: FastifyRequest, reply: {
  status: (code: number) => { send: (body: unknown) => unknown };
}): string | null {
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  if (!hasHealthUiAccess(extractRoleNames(user))) {
    deny(reply, 'HEALTH_ACCESS_DENIED', 'Not authorized to access health records');
    return null;
  }
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    deny(reply, 'TENANT_REQUIRED', 'Tenant context is required', 400);
    return null;
  }
  return tenantId;
}

function forTenant<T extends { tenantId: string }>(items: T[], tenantId: string): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}

export interface HealthUiPluginOptions {
  seed?: HealthUiSeed;
}

export const healthUiPlugin = fp(
  async function healthUiPluginImpl(
    fastify: FastifyInstance,
    options: HealthUiPluginOptions = {},
  ) {
    const seed = options.seed ?? createHealthUiSeed();

    // Bridge JWT → domain healthAccessContext for resource-scoped routes.
    // Keep mapping conservative: no PRINCIPAL/ADMIN elevation to full admin.
    fastify.addHook('onRequest', async (request) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      const roles = extractRoleNames(user).map((role) => {
        const map: Record<string, string> = {
          HEALTH_OFFICER: 'health_officer',
          NURSE: 'school_nurse',
          HEALTH_ADMIN: 'health_admin',
          SUPER_ADMIN: 'system_admin',
          SYSTEM_ADMIN: 'system_admin',
          COUNSELLOR: 'counsellor',
        };
        return map[role] ?? map[role.toUpperCase()] ?? role.toLowerCase();
      });
      (request as FastifyRequest & {
        healthAccessContext?: {
          userId: string;
          roles: string[];
          guardianOfStudentIds: string[];
        };
      }).healthAccessContext = {
        userId: user?.sub ?? user?.userId ?? '',
        roles,
        guardianOfStudentIds: user?.guardianOfStudentIds ?? [],
      };
    });

    fastify.get('/health/records', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      return reply.send({ data: forTenant(seed.records, tenantId) });
    });

    fastify.get<{ Params: { studentId: string } }>(
      '/health/records/:studentId',
      async (request, reply) => {
        const tenantId = assertHealthAccess(request, reply);
        if (!tenantId) return;
        const record = forTenant(seed.records, tenantId).find(
          (r) => r.studentId === request.params.studentId,
        );
        if (!record) {
          return deny(reply, 'NOT_FOUND', 'Health record not found', 404);
        }
        return reply.send(record);
      },
    );

    fastify.get('/health/special-needs', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      return reply.send({ data: forTenant(seed.specialNeeds, tenantId) });
    });

    fastify.get('/health/counselling', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      return reply.send({ data: forTenant(seed.counselling, tenantId) });
    });

    fastify.get('/health/screenings', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      return reply.send({ data: forTenant(seed.screenings, tenantId) });
    });
  },
  { name: 'health-ui-aggregates', fastify: '4.x' },
);

export const HEALTH_UI_DEMO_TENANT_ID = HEALTH_DEMO_TENANT_ID;
