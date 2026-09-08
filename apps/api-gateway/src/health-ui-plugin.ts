/**
 * Health redesign UI aggregate routes + access-context bridge.
 *
 * Mounts under `/api/v1` alongside the domain health plugin:
 *  - Aggregate list/detail endpoints consumed by App Router pages
 *  - Tenant-scoped seed filtering (cross-tenant deny)
 *  - onRequest hook that maps JWT roles → request.healthAccessContext
 *  - Counselling list merges UI seed with live domain/PG writes
 */
import type { CounsellingSessionEntity, HealthRepository } from '@proctira/backend-health';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  HEALTH_DEMO_TENANT_ID,
  createHealthUiSeed,
  type HealthUiSeed,
  type UiCounsellingSession,
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
  return roles.some((role) => HEALTH_UI_ROLES.has(role) || HEALTH_UI_ROLES.has(role.toUpperCase()));
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

function assertHealthAccess(
  request: FastifyRequest,
  reply: {
    status: (code: number) => { send: (body: unknown) => unknown };
  },
): string | null {
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

function mapDomainCounselling(entity: CounsellingSessionEntity): UiCounsellingSession {
  const statusMap: Record<string, UiCounsellingSession['status']> = {
    scheduled: 'SCHEDULED',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
    'no-show': 'CANCELLED',
  };
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    studentName: entity.studentId.slice(0, 8),
    counsellorName: entity.counsellorId.slice(0, 8),
    sessionDate: entity.sessionDate,
    topic: entity.reason,
    status: statusMap[entity.status] ?? 'SCHEDULED',
  };
}

export interface HealthUiPluginOptions {
  seed?: HealthUiSeed;
  /** When provided, counselling list merges seed + live domain/PG sessions. */
  repository?: HealthRepository;
}

export const healthUiPlugin = fp(
  async function healthUiPluginImpl(fastify: FastifyInstance, options: HealthUiPluginOptions = {}) {
    const seed = options.seed ?? createHealthUiSeed();
    const repository = options.repository;

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
      (
        request as FastifyRequest & {
          healthAccessContext?: {
            userId: string;
            roles: string[];
            guardianOfStudentIds: string[];
          };
        }
      ).healthAccessContext = {
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
      const seeded = forTenant(seed.counselling, tenantId);
      let live: UiCounsellingSession[] = [];
      if (repository?.listAllCounsellingSessions) {
        const entities = await repository.listAllCounsellingSessions(tenantId);
        live = entities.map(mapDomainCounselling);
      }
      const byId = new Map<string, UiCounsellingSession>();
      for (const row of seeded) byId.set(row.id, row);
      for (const row of live) byId.set(row.id, row);
      const data = Array.from(byId.values()).sort((a, b) =>
        b.sessionDate.localeCompare(a.sessionDate),
      );
      return reply.send({
        data,
        meta: {
          source: repository ? 'live+seed' : 'seed',
          liveCount: live.length,
          seedCount: seeded.length,
        },
      });
    });

    fastify.get('/health/screenings', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      return reply.send({ data: forTenant(seed.screenings, tenantId) });
    });
  },
  { name: 'health-ui-aggregates', fastify: '5.x' },
);

export const HEALTH_UI_DEMO_TENANT_ID = HEALTH_DEMO_TENANT_ID;
