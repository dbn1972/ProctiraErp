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
import type { ReportArtifactRecord } from './report-store.js';
import { createReportDownloadToken, verifyReportDownloadToken } from './signed-download.js';

export interface CatalogueRoutesOptions {
  service: CatalogueService;
  prefix?: string;
  /**
   * PRC-L338 (topic 1): trusted public API base used to build ABSOLUTE report
   * download links (e.g. `https://app.example`). It comes from deployment
   * configuration — never from the request (Host / X-Forwarded-Host) — so an
   * unauthenticated follower is pointed at the real absolute auth page, not an
   * attacker-chosen host. When omitted, the resolver falls back to
   * `PUBLIC_API_BASE_URL` then `PUBLIC_BASE_URL`; when none is configured the
   * link stays a relative `/api/v1/...` path (still never request-derived).
   */
  publicApiBaseUrl?: string;
}

/**
 * PRC-L338: resolve the trusted public API base from configuration only.
 * Returns the normalised origin+path prefix with no trailing slash, or
 * `undefined` when nothing trustworthy is configured (then links stay
 * relative). The request is never consulted, so a spoofed Host cannot change
 * the link target.
 */
function resolveTrustedApiBase(
  explicit: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const candidate = (explicit ?? env.PUBLIC_API_BASE_URL ?? env.PUBLIC_BASE_URL)?.trim();
  if (!candidate) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    // A misconfigured base must not silently fall back to a request-derived
    // host; treat it as "no trusted base" so links stay relative.
    return undefined;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return undefined;
  const path = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${path}`;
}

/**
 * PRC-L338: build the report download link. With a trusted base configured the
 * link is an ABSOLUTE URL; otherwise a relative `/api/v1` path (never derived
 * from the request). The token is always freshly minted by the caller.
 */
function buildReportDownloadUrl(
  trustedApiBase: string | undefined,
  artifactId: string,
  token: string,
): string {
  const relativePath = `/api/v1/reports/artifacts/${artifactId}/download`;
  const query = `token=${encodeURIComponent(token)}`;
  if (trustedApiBase) {
    return `${trustedApiBase}${relativePath}?${query}`;
  }
  return `${relativePath}?${query}`;
}

/**
 * PRC-L339 (topic 4): the caller tenant is taken ONLY from the verified
 * principal — the gateway's decorated `request.tenantId` (set from the verified
 * JWT/credential) or, failing that, the principal's own `tenantId` claim. A
 * client-supplied `x-tenant-id` header is never trusted here; the gateway
 * strips inbound tenant headers before domain plugins run, and honouring it as
 * a fallback would let a verified tenant-B caller spoof tenant A.
 */
function resolveTenantId(request: FastifyRequest): string | undefined {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
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
  // PRC-L338: resolved once from configuration (option > PUBLIC_API_BASE_URL >
  // PUBLIC_BASE_URL). Never read from the request, so Host spoofing cannot
  // repoint a download link.
  const trustedApiBase = resolveTrustedApiBase(options.publicApiBaseUrl);

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
      // PRC-L143: one batched artifact lookup instead of one tenant transaction per run.
      // A failed lookup is logged and degrades to "no artifact" for the listed runs.
      const artifactIds = visibleRuns
        .map((run) => run.artifactId)
        .filter((id): id is string => Boolean(id));
      const artifacts = await service
        .getArtifactsByIds(tenantId, artifactIds)
        .catch((err: unknown): ReportArtifactRecord[] => {
          request.log.warn({ err }, 'report runs: batched artifact lookup failed');
          return [];
        });
      const artifactById = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
      const payload = visibleRuns.map((run) =>
        service.toInsightsRunFromRecords(
          run,
          run.artifactId ? (artifactById.get(run.artifactId) ?? null) : null,
          resolveUserId(request),
        ),
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
      const signed = createReportDownloadToken(tenantId, artifact.id, artifact.requestedBy);
      return reply.send({
        ...artifact,
        createdAt: artifact.createdAt.toISOString(),
        formatLabel: formatApiLabel(artifact.format),
        // PRC-L338: fresh token (minted above) + absolute, trusted-base URL
        // when configured (never request-derived).
        downloadUrl: buildReportDownloadUrl(trustedApiBase, artifact.id, signed.token),
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
      // PRC-C009: the signed download token is mandatory (was optional/decorative).
      const token = request.query.token;
      if (!token) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'A signed download token is required',
          statusCode: 403,
        });
      }
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
        // PRC-L337: the token binds tenant + artifact + the artifact OWNER
        // (requestedBy), not the presenting caller. This keeps the signed URL
        // usable by any caller role authorisation already allows (PRC-M631:
        // owner + report manager), while binding the link to a specific user
        // context so it cannot be forged or replayed against another artifact.
        const check = verifyReportDownloadToken(
          tenantId,
          params.data.id,
          artifact.requestedBy,
          token,
        );
        if (!check.ok) {
          return reply.status(403).send({
            code: 'FORBIDDEN',
            message: check.reason,
            statusCode: 403,
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
      const result = await service.runDue(tenantId, new Date()); // PRC-M340
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
    // PRC-L343: an explicitly supplied but invalid role is a client error, not
    // a silent fall-through to the actor's default dashboard.
    if (!query.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid dashboard role',
        statusCode: 400,
        errors: query.errors,
      });
    }
    const role = query.data.role;
    const tenantId = resolveTenantId(request);
    if (!tenantId) return tenantMissing(reply);
    try {
      // PRC-M344: pass the real caller id (no 'system' fallback) so parent
      // aggregates are scoped to their own linked children.
      const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
      const dashboard = await service.dashboard(
        tenantId,
        resolveRoles(request),
        role ?? null,
        user?.sub ?? user?.userId ?? null,
      );
      return reply.send(dashboard);
    } catch (error: unknown) {
      return sendError(reply, error);
    }
  });
}
