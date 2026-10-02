import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  ArtifactIdParamsSchema,
  CreateCatalogueScheduleSchema,
  DashboardQuerySchema,
  GenerateCatalogueReportSchema,
  ListRunsQuerySchema,
  PatchCatalogueScheduleSchema,
  ScheduleIdParamsSchema,
} from './catalogue-schemas.js';
import type { CatalogueService } from './catalogue-service.js';
import { formatApiLabel, resolveReportKey, type CatalogueReportKey } from './catalogue.js';
import { canAccessReport, isReportManager, isReportStaff } from './report-access.js';
import { createReportDownloadToken, verifyReportDownloadToken } from './signed-download.js';

export interface CatalogueRoutesOptions {
  service: CatalogueService;
  prefix?: string;
}

function resolveTenantId(request: FastifyRequest): string | undefined {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const header = request.headers['x-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  return user?.tenantId;
}

function resolveUserId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
  return user?.sub ?? user?.userId ?? 'system';
}

function resolveRoles(request: FastifyRequest): Array<{ roleId?: string; roleName?: string }> {
  const user = (
    request as FastifyRequest & {
      user?: { roles?: Array<{ roleId?: string; roleName?: string }> };
    }
  ).user;
  return user?.roles ?? [];
}

function tenantMissing(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

/**
 * PRC-C009: the report catalogue is a staff surface. Deny parent/guardian/student (who hold
 * gateway report:read) before any tenant-wide report data is produced or listed.
 */
function requireReportStaff(request: FastifyRequest, reply: FastifyReply): boolean {
  if (isReportStaff(resolveRoles(request))) return true;
  void reply.status(403).send({
    code: 'FORBIDDEN',
    message: 'Report catalogue access is restricted to staff',
    statusCode: 403,
  });
  return false;
}

/**
 * PRC-C009: a report artifact may be read/downloaded by a report manager (admin), or by a
 * staff member who (a) is entitled to the artifact's report and (b) requested it. This stops a
 * finance clerk downloading an exam-results artifact another user generated, etc.
 */
function mayAccessArtifact(
  request: FastifyRequest,
  artifact: { reportKey: CatalogueReportKey; requestedBy: string },
): boolean {
  const roles = resolveRoles(request);
  if (isReportManager(roles)) return true;
  if (!canAccessReport(roles, artifact.reportKey)) return false;
  return artifact.requestedBy === resolveUserId(request);
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function formatSchedule(record: {
  id: string;
  tenantId: string;
  reportKey: string;
  format: string;
  cadence: string;
  hour: number;
  nextRunAt: Date;
  recipients: string[];
  enabled: boolean;
  createdBy: string;
  lastRunAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: record.id,
    tenantId: record.tenantId,
    reportKey: record.reportKey,
    format: record.format,
    cadence: record.cadence,
    hour: record.hour,
    nextRunAt: record.nextRunAt.toISOString(),
    recipients: record.recipients,
    enabled: record.enabled,
    createdBy: record.createdBy,
    lastRunAt: record.lastRunAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function registerCatalogueRoutes(
  fastify: FastifyInstance,
  options: CatalogueRoutesOptions,
): void {
  const { service } = options;
  const prefix = options.prefix ?? '/reports';

  fastify.get(`${prefix}/catalogue`, async (_request, reply) => {
    return reply.send({ data: service.listCatalogue() });
  });

  fastify.get(`${prefix}/templates`, async (_request, reply) => {
    return reply.send({ data: service.listCatalogue() });
  });

  fastify.get<{ Params: { id: string } }>(`${prefix}/templates/:id`, async (request, reply) => {
    const entry = service.getCatalogueEntry(request.params.id);
    if (!entry) {
      return reply.status(404).send({
        code: 'NOT_FOUND',
        message: 'Report template not found',
        statusCode: 404,
      });
    }
    return reply.send(entry);
  });

  fastify.post(`${prefix}/generate`, async (request, reply) => {
    const parsed = validate(GenerateCatalogueReportSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return;
    // PRC-C009: per-report entitlement — the caller must be allowed to run THIS report.
    const reportKey = resolveReportKey({
      reportKey: (parsed.data as { reportKey?: string }).reportKey,
      templateId: (parsed.data as { templateId?: string }).templateId,
    });
    if (reportKey && !canAccessReport(resolveRoles(request), reportKey)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Your role is not entitled to this report',
        statusCode: 403,
      });
    }
    try {
      const result = await service.generate(tenantId, resolveUserId(request), parsed.data);
      return reply.status(201).send(service.toInsightsRun(result, resolveUserId(request)));
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/runs`, async (request, reply) => {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return;
    const query = validate(ListRunsQuerySchema, request.query ?? {});
    if (!query.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: query.errors,
      });
    }
    try {
      const runs = await service.listRuns(tenantId, query.data);
      // PRC-C009: non-managers only see runs for reports their role is entitled to (a finance
      // clerk should not see exam-result runs, etc.). Managers/admins see all.
      const roles = resolveRoles(request);
      const manager = isReportManager(roles);
      const visibleRuns = manager
        ? runs
        : runs.filter((run) => canAccessReport(roles, run.reportKey));
      const payload = await Promise.all(
        visibleRuns.map(async (run) => {
          const artifact = run.artifactId
            ? await service.getArtifact(tenantId, run.artifactId).catch(() => null)
            : null;
          return service.toInsightsRunFromRecords(run, artifact, resolveUserId(request));
        }),
      );
      return reply.send({ data: payload });
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  fastify.get<{ Params: { id: string } }>(`${prefix}/artifacts/:id`, async (request, reply) => {
    const params = validate(ArtifactIdParamsSchema, request.params);
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: params.errors,
      });
    }
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return;
    try {
      const artifact = await service.getArtifact(tenantId, params.data.id);
      if (!mayAccessArtifact(request, artifact)) {
        // 404 (not 403) so a non-owner cannot probe which artifact ids exist.
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Report artifact '${params.data.id}' not found`,
          statusCode: 404,
        });
      }
      const signed = createReportDownloadToken(tenantId, artifact.id);
      return reply.send({
        ...artifact,
        createdAt: artifact.createdAt.toISOString(),
        formatLabel: formatApiLabel(artifact.format),
        downloadUrl: `/api/v1/reports/artifacts/${artifact.id}/download?token=${signed.token}`,
      });
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  fastify.get<{ Params: { id: string }; Querystring: { token?: string } }>(
    `${prefix}/artifacts/:id/download`,
    async (request, reply) => {
      const params = validate(ArtifactIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = resolveTenantId(request);
      if (!tenantId) return tenantMissing(reply);
      if (!requireReportStaff(request, reply)) return;
      // PRC-C009: the signed download token is mandatory (was optional/decorative), and must
      // match this artifact + tenant.
      const token = request.query.token;
      if (!token) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'A signed download token is required',
          statusCode: 403,
        });
      }
      const check = verifyReportDownloadToken(tenantId, params.data.id, token);
      if (!check.ok) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: check.reason,
          statusCode: 403,
        });
      }
      try {
        const artifact = await service.getArtifact(tenantId, params.data.id);
        if (!mayAccessArtifact(request, artifact)) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: `Report artifact '${params.data.id}' not found`,
            statusCode: 404,
          });
        }
        const file = await service.downloadBytes(tenantId, params.data.id);
        return reply
          .status(200)
          .header('Content-Type', file.contentType)
          .header('Content-Disposition', `attachment; filename="${file.filename}"`)
          .header('X-Artifact-Sha256', file.artifact.sha256)
          .send(file.bytes);
      } catch (error: unknown) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/schedules`, async (request, reply) => {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return; // PRC-C009: staff-only
    const schedules = await service.listSchedules(tenantId);
    return reply.send({ data: schedules.map(formatSchedule) });
  });

  fastify.post(`${prefix}/schedules`, async (request, reply) => {
    const parsed = validate(CreateCatalogueScheduleSchema, request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: parsed.errors,
      });
    }
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return;
    const scheduleKey = resolveReportKey({
      reportKey: (parsed.data as { reportKey?: string }).reportKey,
    });
    if (scheduleKey && !canAccessReport(resolveRoles(request), scheduleKey)) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Your role is not entitled to schedule this report',
        statusCode: 403,
      });
    }
    try {
      const schedule = await service.createSchedule(tenantId, resolveUserId(request), parsed.data);
      return reply.status(201).send(formatSchedule(schedule));
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/schedules/run-due`, async (request, reply) => {
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    if (!requireReportStaff(request, reply)) return; // PRC-C009: staff-only
    try {
      const result = await service.runDue(new Date());
      return reply.send(result);
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });

  fastify.delete<{ Params: { scheduleId: string } }>(
    `${prefix}/schedules/:scheduleId`,
    async (request, reply) => {
      const params = validate(ScheduleIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
        });
      }
      const tenantId = resolveTenantId(request);
      if (!tenantId) return tenantMissing(reply);
      if (!requireReportStaff(request, reply)) return; // PRC-C009: staff-only
      try {
        await service.deleteSchedule(tenantId, params.data.scheduleId);
        return reply.status(204).send();
      } catch (error: unknown) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch<{ Params: { scheduleId: string } }>(
    `${prefix}/schedules/:scheduleId`,
    async (request, reply) => {
      const params = validate(ScheduleIdParamsSchema, request.params);
      const body = validate(PatchCatalogueScheduleSchema, request.body ?? {});
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
        });
      }
      const tenantId = resolveTenantId(request);
      if (!tenantId) return tenantMissing(reply);
      if (!requireReportStaff(request, reply)) return; // PRC-C009: staff-only
      if (typeof body.data.enabled !== 'boolean') {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'enabled is required',
          statusCode: 400,
        });
      }
      try {
        const schedule = await service.setScheduleEnabled(
          tenantId,
          params.data.scheduleId,
          body.data.enabled,
        );
        return reply.send(formatSchedule(schedule));
      } catch (error: unknown) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post<{ Params: { scheduleId: string } }>(
    `${prefix}/schedules/:scheduleId/run`,
    async (request, reply) => {
      const params = validate(ScheduleIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
        });
      }
      const tenantId = resolveTenantId(request);
      if (!tenantId) return tenantMissing(reply);
      if (!requireReportStaff(request, reply)) return; // PRC-C009: staff-only
      try {
        const schedule = (await service.listSchedules(tenantId)).find(
          (s) => s.id === params.data.scheduleId,
        );
        if (!schedule) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Schedule not found',
            statusCode: 404,
          });
        }
        if (!canAccessReport(resolveRoles(request), schedule.reportKey)) {
          return reply.status(403).send({
            code: 'FORBIDDEN',
            message: 'Your role is not entitled to run this report',
            statusCode: 403,
          });
        }
        const result = await service.generate(
          tenantId,
          resolveUserId(request),
          { reportKey: schedule.reportKey, format: schedule.format },
          { source: 'schedule', scheduleId: schedule.id },
        );
        return reply.status(201).send(service.toInsightsRun(result, resolveUserId(request)));
      } catch (error: unknown) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/dashboard`, async (request, reply) => {
    const query = validate(DashboardQuerySchema, request.query ?? {});
    const role = query.success ? query.data.role : undefined;
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    try {
      const dashboard = await service.dashboard(tenantId, resolveRoles(request), role ?? null);
      return reply.send(dashboard);
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });
}
