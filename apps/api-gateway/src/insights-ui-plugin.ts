/**
 * Insights & System redesign UI aggregates + write proofs.
 *
 * Serves App Router shapes under `/api/v1`:
 *   GET      /reports/board/:boardId/summary   (G-809 board rollup)
 *   GET      /data-warehouse/indicators
 *   GET/POST /data-warehouse/import/jobs
 *   GET      /data-warehouse/map/features
 *
 * Persistence (G-209): when DATABASE_URL is set, uses Postgres-backed
 * insights-ui store so import jobs survive restart. Otherwise falls back
 * to in-memory seed.
 *
 * G-909: catalogue generate / templates / runs live on backend-report.
 * G-809 board rollups stay here (`backend-dashboards` remains parked).
 *
 * When these respond, ScaffoldModeBanner hides (source=gateway).
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  BoardSummaryUnavailableError,
  clearBoardSummariesForTests,
  emptyBoardSummary,
  getBoardSummary,
  seedBoardSummaryForTests,
  type BoardSummary,
} from './board-summary.js';
import { createInsightsUiStore, type InsightsUiStore } from './insights-ui-pg-store.js';
import { PLATFORM_ADMIN_ROLE_IDS } from './rbac-registry.js';

export type { BoardSummary };
export { clearBoardSummariesForTests, emptyBoardSummary, seedBoardSummaryForTests };

function resolveTenantId(request: FastifyRequest): string {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId ?? 'default';
}

/** PRC-M028: exact role ids allowed to read every board rollup in their tenant. */
export const BOARD_ROLLUP_TENANT_WIDE_ROLE_IDS = new Set([
  ...PLATFORM_ADMIN_ROLE_IDS,
  'super_admin',
  'system_admin',
  'admin',
  'tenant_admin',
  'tenant-admin',
]);

export type BoardRollupPrincipal = {
  roles?: Array<
    | string
    | {
        roleId?: string;
        roleName?: string;
        areaId?: string | null;
        institutionId?: string | null;
      }
  >;
  areas?: Array<{ areaId?: string | null }>;
};

export function decideBoardRollupAccess(
  user: BoardRollupPrincipal,
  boardId: string,
): 'allow' | 'deny' {
  const roles = (user.roles ?? []).map((r) => (typeof r === 'string' ? { roleId: r } : r));
  if (roles.some((r) => BOARD_ROLLUP_TENANT_WIDE_ROLE_IDS.has(String(r.roleId ?? '')))) {
    return 'allow';
  }
  const scoped = new Set<string>();
  for (const r of roles) {
    if (r.areaId && r.areaId !== 'ROOT' && r.areaId !== 'root') scoped.add(r.areaId);
    if (r.institutionId) scoped.add(r.institutionId);
  }
  for (const a of user.areas ?? []) {
    if (a.areaId && a.areaId !== 'ROOT' && a.areaId !== 'root') scoped.add(a.areaId);
  }
  // No scope at all → deny (previously this fell through and returned any board).
  return scoped.has(boardId) ? 'allow' : 'deny';
}

export interface InsightsUiPluginOptions {
  /** Optional store override (tests). */
  store?: InsightsUiStore;
  /** Force in-memory store even when DATABASE_URL is set (unit tests). */
  forceMemory?: boolean;
}

export const insightsUiPlugin = fp(
  async function insightsUiPluginImpl(
    fastify: FastifyInstance,
    options: InsightsUiPluginOptions = {},
  ) {
    const store = options.store ?? createInsightsUiStore({ forceMemory: options.forceMemory });

    // G-809: board rollup (schools, enrolment, attendance, fees, LMS).
    // Unknown boardId → zeros with 200 (never 404).
    fastify.get<{ Params: { boardId: string } }>(
      '/reports/board/:boardId/summary',
      async (request, reply) => {
        const tenantId = resolveTenantId(request);
        const boardId = request.params.boardId;
        const user = request.user as BoardRollupPrincipal | undefined;
        // PRC-M028: fail closed. No principal → 401; tenant-wide admins (exact
        // role ids, no substring matching) may read any board in their tenant;
        // everyone else — board_admin included — needs an explicit area /
        // institution scope that names this board.
        if (!user) {
          return reply.status(401).send({
            code: 'UNAUTHORIZED',
            message: 'Authentication required',
            statusCode: 401,
          });
        }
        const decision = decideBoardRollupAccess(user, boardId);
        if (decision !== 'allow') {
          return reply.status(403).send({
            code: 'BOARD_FORBIDDEN',
            message: 'You cannot load rollups for another board or area.',
            statusCode: 403,
          });
        }
        try {
          const summary = await getBoardSummary(boardId, tenantId, {
            forceMemory: options.forceMemory,
          });
          return reply.send(summary);
        } catch (error) {
          if (!(error instanceof BoardSummaryUnavailableError)) throw error;
          // PRC-M009: log with the request id; never present a DB failure as zeros.
          request.log.error(
            { err: error.cause ?? error, boardId, reqId: request.id },
            'board summary unavailable',
          );
          return reply.status(503).send({
            code: 'BOARD_SUMMARY_UNAVAILABLE',
            message: 'Board summary is temporarily unavailable. Please try again later.',
            statusCode: 503,
          });
        }
      },
    );

    fastify.get('/data-warehouse/indicators', async (_request, reply) => {
      return reply.send({ data: await store.listIndicators() });
    });

    fastify.get('/data-warehouse/import/jobs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      return reply.send({ data: await store.listImportJobs(tenantId) });
    });

    fastify.post('/data-warehouse/import/jobs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const body = (request.body ?? {}) as {
        source?: 'EXCEL' | 'CSV' | 'DATABASE';
        filename?: string;
        rows?: number;
      };
      if (!body.filename || !body.source) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'source and filename are required',
          statusCode: 400,
        });
      }
      const job = await store.createImportJob(tenantId, {
        id: randomUUID(),
        source: body.source,
        filename: body.filename,
        submittedAt: new Date().toISOString(),
        rows: body.rows ?? 0,
        status: 'QUEUED',
        errorMessage: null,
      });
      return reply.status(201).send(job);
    });

    fastify.get('/data-warehouse/map/features', async (_request, reply) => {
      return reply.send({ data: await store.listGeoFeatures() });
    });
  },
  { name: 'insights-ui-aggregates', fastify: '5.x' },
);
