/**
 * Dashboard routes.
 *
 * Exposes the six server-side dashboard endpoints from §G of the design:
 *
 *   GET /api/v1/dashboards/country
 *   GET /api/v1/dashboards/state/:stateId
 *   GET /api/v1/dashboards/board-admin/:boardId
 *   GET /api/v1/dashboards/school/:institutionId
 *   GET /api/v1/dashboards/teacher
 *   GET /api/v1/dashboards/me
 *
 * Every handler:
 *   1. Reads the verified JWT claims attached to the request.
 *   2. Calls the `DashboardService`, which derives the typed scope,
 *      expands the Area_Hierarchy, and runs the repository query with
 *      that scope as a SQL `WHERE … IN (…)` filter.
 *   3. Maps the service result to the canonical HTTP response: 200 on
 *      success, 403 when the scope is mismatched, 404 when the resource
 *      doesn't exist, 401 if the JWT is missing.
 */

import type { JwtPayload } from '@proctira/auth';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { DashboardService } from './dashboard-service.js';

export interface DashboardRoutesOptions {
  service: DashboardService;
  /** Route prefix (default: '/dashboards'). */
  prefix?: string;
}

interface StateParams {
  stateId: string;
}

interface BoardParams {
  boardId: string;
}

interface SchoolParams {
  institutionId: string;
}

/**
 * Mount the dashboard routes on a Fastify instance. Caller is expected
 * to have registered an auth plugin that verifies JWTs and attaches the
 * decoded payload to `request.user`.
 */
export async function registerDashboardRoutes(
  fastify: FastifyInstance,
  options: DashboardRoutesOptions,
): Promise<void> {
  const { service, prefix = '/dashboards' } = options;

  fastify.get(`${prefix}/country`, async (request, reply) => {
    const jwt = requireJwt(request, reply);
    if (!jwt) return;

    const result = await service.getCountryDashboard(jwt);
    return sendResult(reply, result);
  });

  fastify.get<{ Params: StateParams }>(`${prefix}/state/:stateId`, async (request, reply) => {
    const jwt = requireJwt(request, reply);
    if (!jwt) return;

    const result = await service.getStateDashboard(jwt, {
      stateId: request.params.stateId,
    });
    return sendResult(reply, result);
  });

  fastify.get<{ Params: BoardParams }>(`${prefix}/board-admin/:boardId`, async (request, reply) => {
    const jwt = requireJwt(request, reply);
    if (!jwt) return;

    const result = await service.getBoardAdminDashboard(jwt, {
      boardId: request.params.boardId,
    });
    return sendResult(reply, result);
  });

  fastify.get<{ Params: SchoolParams }>(
    `${prefix}/school/:institutionId`,
    async (request, reply) => {
      const jwt = requireJwt(request, reply);
      if (!jwt) return;

      const result = await service.getSchoolDashboard(jwt, {
        institutionId: request.params.institutionId,
      });
      return sendResult(reply, result);
    },
  );

  fastify.get(`${prefix}/teacher`, async (request, reply) => {
    const jwt = requireJwt(request, reply);
    if (!jwt) return;

    const result = await service.getTeacherDashboard(jwt);
    return sendResult(reply, result);
  });

  fastify.get(`${prefix}/me`, async (request, reply) => {
    const jwt = requireJwt(request, reply);
    if (!jwt) return;

    const result = await service.getMeDashboard(jwt);
    return sendResult(reply, result);
  });
}

/**
 * Map a service result onto the Fastify reply.
 */
function sendResult<T>(
  reply: FastifyReply,
  result:
    | { status: 'ok'; data: T }
    | { status: 'forbidden'; reason: string }
    | { status: 'not-found' },
): FastifyReply {
  if (result.status === 'ok') {
    return reply.status(200).send(result.data);
  }
  if (result.status === 'forbidden') {
    return reply.status(403).send({
      code: 'FORBIDDEN',
      message: result.reason,
      statusCode: 403,
    });
  }
  return reply.status(404).send({
    code: 'NOT_FOUND',
    message: 'Dashboard data not found for this scope',
    statusCode: 404,
  });
}

/**
 * Pull the JWT payload off the request, sending a 401 if missing.
 */
function requireJwt(request: FastifyRequest, reply: FastifyReply): JwtPayload | null {
  const user = (request as FastifyRequest & { user?: JwtPayload }).user;
  if (!user) {
    void reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      statusCode: 401,
    });
    return null;
  }
  return user;
}
