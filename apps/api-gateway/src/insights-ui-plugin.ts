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
  clearBoardSummariesForTests,
  emptyBoardSummary,
  getBoardSummary,
  seedBoardSummaryForTests,
  type BoardSummary,
} from './board-summary.js';
import { createInsightsUiStore, type InsightsUiStore } from './insights-ui-pg-store.js';

export type { BoardSummary };
export { clearBoardSummariesForTests, emptyBoardSummary, seedBoardSummaryForTests };

function resolveTenantId(request: FastifyRequest): string {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId ?? 'default';
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
        const user = request.user as
          | {
              roles?: Array<{
                roleId?: string;
                roleName?: string;
                areaId?: string | null;
                institutionId?: string;
              }>;
            }
          | undefined;
        const roles = user?.roles ?? [];
        const isPrivileged = roles.some((r) => {
          const n = `${r.roleId ?? ''} ${r.roleName ?? ''}`.toLowerCase();
          return (
            n.includes('system_admin') ||
            n.includes('administrator') ||
            n.includes('board') ||
            n.includes('platform')
          );
        });
        if (!isPrivileged) {
          const scoped = roles
            .map((r) => r.areaId || r.institutionId)
            .filter((id): id is string => Boolean(id));
          if (scoped.length > 0 && !scoped.includes(boardId)) {
            return reply.status(403).send({
              code: 'BOARD_FORBIDDEN',
              message: 'You cannot load rollups for another board or area.',
              statusCode: 403,
            });
          }
        }
        const summary = await getBoardSummary(boardId, tenantId, {
          forceMemory: options.forceMemory,
        });
        return reply.send(summary);
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
