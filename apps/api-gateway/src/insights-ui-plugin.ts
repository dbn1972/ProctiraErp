/**
 * Insights & System redesign UI aggregates + write proofs.
 *
 * Serves App Router shapes under `/api/v1`:
 *   GET/POST /reports/templates
 *   GET      /reports/templates/:id
 *   GET/POST /reports/runs
 *   POST     /reports/generate
 *   GET      /data-warehouse/indicators
 *   GET/POST /data-warehouse/import/jobs
 *   GET      /data-warehouse/map/features
 *
 * Persistence (G-209): when DATABASE_URL is set, uses Postgres-backed
 * insights-ui store so report runs / import jobs survive restart.
 * Otherwise falls back to in-memory seed. Full `@proctira/backend-report` /
 * `data-warehouse` packages remain separately mountable.
 *
 * When these respond, ScaffoldModeBanner hides (source=gateway).
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { createInsightsUiStore, type InsightsUiStore } from './insights-ui-pg-store.js';
import type { ReportTemplate } from './insights-ui-types.js';

function resolveTenantId(request: FastifyRequest): string {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const header = request.headers['x-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId ?? 'default';
}

function resolveUserId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
  return user?.sub ?? user?.userId ?? 'system';
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

    fastify.get('/reports/templates', async (_request, reply) => {
      return reply.send({ data: await store.listTemplates() });
    });

    fastify.get<{ Params: { id: string } }>('/reports/templates/:id', async (request, reply) => {
      const tpl = await store.getTemplate(request.params.id);
      if (!tpl) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report template not found',
          statusCode: 404,
        });
      }
      return reply.send(tpl);
    });

    fastify.post('/reports/templates', async (request, reply) => {
      const body = (request.body ?? {}) as Partial<ReportTemplate>;
      if (!body.name || !body.module) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'name and module are required',
          statusCode: 400,
        });
      }
      const tpl: ReportTemplate = {
        id: body.id ?? randomUUID(),
        name: body.name,
        description: body.description ?? '',
        module: body.module,
        format: body.format ?? ['PDF'],
        filters: body.filters ?? [],
      };
      await store.createTemplate(tpl);
      return reply.status(201).send(tpl);
    });

    fastify.get('/reports/runs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const query = request.query as { templateId?: string };
      const runs = await store.listRuns(tenantId, query.templateId);
      return reply.send({ data: runs });
    });

    fastify.post('/reports/generate', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const body = (request.body ?? {}) as {
        templateId?: string;
        format?: 'PDF' | 'XLSX' | 'CSV';
        filters?: Record<string, unknown>;
      };
      if (!body.templateId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'templateId is required',
          statusCode: 400,
        });
      }
      const tpl = await store.getTemplate(body.templateId);
      if (!tpl) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report template not found',
          statusCode: 404,
        });
      }
      const format = body.format ?? tpl.format[0] ?? 'PDF';
      const run = await store.createRun(tenantId, {
        id: randomUUID(),
        templateId: tpl.id,
        templateName: tpl.name,
        generatedAt: new Date().toISOString(),
        generatedBy: resolveUserId(request),
        format,
        fileSizeKb: 12,
        status: 'READY',
        downloadUrl: `/api/v1/reports/runs/${randomUUID()}/download`,
      });
      return reply.status(201).send(run);
    });

    // Alias used by some FE clients
    fastify.post('/reports/runs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const body = (request.body ?? {}) as {
        templateId?: string;
        format?: 'PDF' | 'XLSX' | 'CSV';
      };
      if (!body.templateId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'templateId is required',
          statusCode: 400,
        });
      }
      const tpl = await store.getTemplate(body.templateId);
      if (!tpl) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report template not found',
          statusCode: 404,
        });
      }
      const run = await store.createRun(tenantId, {
        id: randomUUID(),
        templateId: tpl.id,
        templateName: tpl.name,
        generatedAt: new Date().toISOString(),
        generatedBy: resolveUserId(request),
        format: body.format ?? 'PDF',
        fileSizeKb: 8,
        status: 'QUEUED',
        downloadUrl: null,
      });
      return reply.status(201).send(run);
    });

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
  { name: 'insights-ui-aggregates', fastify: '4.x' },
);
