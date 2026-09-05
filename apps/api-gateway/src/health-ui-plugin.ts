/**
 * Health redesign UI aggregate routes + access-context bridge.
 *
 * Mounts under `/api/v1` alongside the domain health plugin:
 *  - Aggregate list/detail endpoints consumed by App Router pages
 *  - onRequest hook that maps JWT roles → request.healthAccessContext
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  createHealthUiSeed,
  type HealthUiSeed,
} from './health-ui-seed.js';

/** Roles allowed to view health PII (UI + domain). */
const HEALTH_UI_ROLES = new Set([
  'HEALTH_OFFICER',
  'health_officer',
  'NURSE',
  'school_nurse',
  'HEALTH_ADMIN',
  'health_admin',
  'ADMIN',
  'SUPER_ADMIN',
  'system_admin',
  'SYSTEM_ADMIN',
  'PRINCIPAL',
  'counsellor',
  'COUNSELLOR',
]);

interface JwtUserLike {
  sub?: string;
  userId?: string;
  roles?: Array<{ roleName?: string; roleId?: string } | string>;
}

function extractRoleNames(user: JwtUserLike | undefined): string[] {
  if (!user?.roles) return [];
  return user.roles.map((role) => {
    if (typeof role === 'string') return role;
    return role.roleName ?? role.roleId ?? '';
  }).filter(Boolean);
}

function hasHealthUiAccess(roles: string[]): boolean {
  return roles.some((role) => HEALTH_UI_ROLES.has(role) || HEALTH_UI_ROLES.has(role.toUpperCase()));
}

function deny(reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  return reply.status(403).send({
    code: 'HEALTH_ACCESS_DENIED',
    message: 'Not authorized to access health records',
    statusCode: 403,
  });
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
    fastify.addHook('onRequest', async (request) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      const roles = extractRoleNames(user).map((role) => {
        // Domain service expects snake_case health roles.
        const map: Record<string, string> = {
          HEALTH_OFFICER: 'health_officer',
          NURSE: 'school_nurse',
          HEALTH_ADMIN: 'health_admin',
          SUPER_ADMIN: 'system_admin',
          SYSTEM_ADMIN: 'system_admin',
          ADMIN: 'system_admin',
          PRINCIPAL: 'health_admin',
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
        guardianOfStudentIds: [],
      };
    });

    fastify.get('/health/records', async (request, reply) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      if (!hasHealthUiAccess(extractRoleNames(user))) return deny(reply);
      return reply.send({ data: seed.records });
    });

    fastify.get<{ Params: { studentId: string } }>(
      '/health/records/:studentId',
      async (request, reply) => {
        const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
        if (!hasHealthUiAccess(extractRoleNames(user))) return deny(reply);
        const record = seed.records.find((r) => r.studentId === request.params.studentId);
        if (!record) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Health record not found',
            statusCode: 404,
          });
        }
        return reply.send(record);
      },
    );

    fastify.get('/health/special-needs', async (request, reply) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      if (!hasHealthUiAccess(extractRoleNames(user))) return deny(reply);
      return reply.send({ data: seed.specialNeeds });
    });

    fastify.get('/health/counselling', async (request, reply) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      if (!hasHealthUiAccess(extractRoleNames(user))) return deny(reply);
      return reply.send({ data: seed.counselling });
    });

    fastify.get('/health/screenings', async (request, reply) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      if (!hasHealthUiAccess(extractRoleNames(user))) return deny(reply);
      return reply.send({ data: seed.screenings });
    });
  },
  { name: 'health-ui-aggregates', fastify: '4.x' },
);
