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
 * When these respond, ScaffoldModeBanner hides (source=gateway).
 */
import { randomUUID } from 'node:crypto';

import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  module: string;
  format: Array<'PDF' | 'XLSX' | 'CSV'>;
  filters: Array<{
    key: string;
    label: string;
    type: 'text' | 'date' | 'select' | 'number';
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }>;
}

interface ReportRun {
  id: string;
  templateId: string;
  templateName: string;
  generatedAt: string;
  generatedBy: string;
  format: 'PDF' | 'XLSX' | 'CSV';
  fileSizeKb: number;
  status: 'QUEUED' | 'RUNNING' | 'READY' | 'FAILED';
  downloadUrl: string | null;
}

interface DwIndicator {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  latestValue: number | null;
  trend: 'UP' | 'DOWN' | 'FLAT' | null;
  lastUpdated: string | null;
}

interface DwImportJob {
  id: string;
  source: 'EXCEL' | 'CSV' | 'DATABASE';
  filename: string;
  submittedAt: string;
  rows: number;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';
  errorMessage?: string | null;
}

interface DwGeoFeature {
  institutionId: string;
  name: string;
  latitude: number;
  longitude: number;
  type: string;
  enrolment: number;
}

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

function seedTemplates(): ReportTemplate[] {
  return [
    {
      id: 'tpl-enrolment-summary',
      name: 'Enrolment summary',
      description: 'Headcount by grade and gender for the selected period.',
      module: 'students',
      format: ['PDF', 'XLSX', 'CSV'],
      filters: [
        { key: 'academicPeriodId', label: 'Academic period', type: 'text', required: true },
        {
          key: 'gender',
          label: 'Gender',
          type: 'select',
          options: [
            { value: 'all', label: 'All' },
            { value: 'F', label: 'Female' },
            { value: 'M', label: 'Male' },
          ],
        },
      ],
    },
    {
      id: 'tpl-attendance-daily',
      name: 'Daily attendance',
      description: 'Present / absent counts for a single school day.',
      module: 'attendance',
      format: ['PDF', 'CSV'],
      filters: [{ key: 'date', label: 'Date', type: 'date', required: true }],
    },
  ];
}

export const insightsUiPlugin = fp(
  async function insightsUiPluginImpl(fastify: FastifyInstance) {
    const templates = new Map<string, ReportTemplate>(
      seedTemplates().map((tpl) => [tpl.id, tpl]),
    );
    const runsByTenant = new Map<string, ReportRun[]>();
    const jobsByTenant = new Map<string, DwImportJob[]>();

    const indicators: DwIndicator[] = [
      {
        id: 'ind-ger',
        code: 'GER',
        name: 'Gross enrolment ratio',
        category: 'Access',
        unit: '%',
        latestValue: 98.2,
        trend: 'UP',
        lastUpdated: new Date().toISOString(),
      },
      {
        id: 'ind-ptr',
        code: 'PTR',
        name: 'Pupil–teacher ratio',
        category: 'Quality',
        unit: 'ratio',
        latestValue: 28.4,
        trend: 'FLAT',
        lastUpdated: new Date().toISOString(),
      },
    ];

    const geoFeatures: DwGeoFeature[] = [
      {
        institutionId: 'inst-demo-1',
        name: 'Demo Primary School',
        latitude: 19.076,
        longitude: 72.8777,
        type: 'primary',
        enrolment: 420,
      },
    ];

    fastify.get('/reports/templates', async (_request, reply) => {
      return reply.send({ data: Array.from(templates.values()) });
    });

    fastify.get<{ Params: { id: string } }>(
      '/reports/templates/:id',
      async (request, reply) => {
        const tpl = templates.get(request.params.id);
        if (!tpl) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Report template not found',
            statusCode: 404,
          });
        }
        return reply.send(tpl);
      },
    );

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
      templates.set(tpl.id, tpl);
      return reply.status(201).send(tpl);
    });

    fastify.get('/reports/runs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      const query = request.query as { templateId?: string };
      let runs = runsByTenant.get(tenantId) ?? [];
      if (query.templateId) {
        runs = runs.filter((run) => run.templateId === query.templateId);
      }
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
      const tpl = templates.get(body.templateId);
      if (!tpl) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report template not found',
          statusCode: 404,
        });
      }
      const format = body.format ?? tpl.format[0] ?? 'PDF';
      const run: ReportRun = {
        id: randomUUID(),
        templateId: tpl.id,
        templateName: tpl.name,
        generatedAt: new Date().toISOString(),
        generatedBy: resolveUserId(request),
        format,
        fileSizeKb: 12,
        status: 'READY',
        downloadUrl: `/api/v1/reports/runs/${randomUUID()}/download`,
      };
      const list = runsByTenant.get(tenantId) ?? [];
      list.unshift(run);
      runsByTenant.set(tenantId, list);
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
      const tpl = templates.get(body.templateId);
      if (!tpl) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report template not found',
          statusCode: 404,
        });
      }
      const run: ReportRun = {
        id: randomUUID(),
        templateId: tpl.id,
        templateName: tpl.name,
        generatedAt: new Date().toISOString(),
        generatedBy: resolveUserId(request),
        format: body.format ?? 'PDF',
        fileSizeKb: 8,
        status: 'QUEUED',
        downloadUrl: null,
      };
      const list = runsByTenant.get(tenantId) ?? [];
      list.unshift(run);
      runsByTenant.set(tenantId, list);
      return reply.status(201).send(run);
    });

    fastify.get('/data-warehouse/indicators', async (_request, reply) => {
      return reply.send({ data: indicators });
    });

    fastify.get('/data-warehouse/import/jobs', async (request, reply) => {
      const tenantId = resolveTenantId(request);
      return reply.send({ data: jobsByTenant.get(tenantId) ?? [] });
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
      const job: DwImportJob = {
        id: randomUUID(),
        source: body.source,
        filename: body.filename,
        submittedAt: new Date().toISOString(),
        rows: body.rows ?? 0,
        status: 'QUEUED',
        errorMessage: null,
      };
      const list = jobsByTenant.get(tenantId) ?? [];
      list.unshift(job);
      jobsByTenant.set(tenantId, list);
      return reply.status(201).send(job);
    });

    fastify.get('/data-warehouse/map/features', async (_request, reply) => {
      return reply.send({ data: geoFeatures });
    });
  },
  { name: 'insights-ui-aggregates', fastify: '4.x' },
);
