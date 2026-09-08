/**
 * Gradebook Fastify routes (WS3).
 *
 * Prefix default: `/gradebook`
 * - Grade entry upsert + section list
 * - GPA compute / snapshots
 * - Report-card job create/status
 * - Official transcript issue (versioned, immutable prior versions)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { isGradeWorkflowAction } from './grade-workflow.js';
import { assertGradebookAccess, type GradebookAction } from './gradebook-access.js';
import {
  isGradebookSchemaMissingError,
  isGradeLockedError,
  isTranscriptImmutableError,
} from './gradebook-errors.js';
import type { GradebookService } from './gradebook-service.js';
import {
  ComputeGpaSchema,
  CreateBoardExportJobSchema,
  CreateCreditRuleSchema,
  CreateReportCardJobSchema,
  IssueTranscriptSchema,
  TransitionGradeEntrySchema,
  UpsertGradeEntrySchema,
} from './schemas.js';

export interface GradebookRoutesOptions {
  service: GradebookService;
  prefix?: string;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId =
    user?.tenantId ??
    (request as FastifyRequest & { tenantId?: string }).tenantId ??
    (request.headers['x-tenant-id'] as string | undefined);
  if (!tenantId) {
    reply.status(401).send({
      code: 'UNAUTHORIZED',
      message: 'Tenant context required (user.tenantId or x-tenant-id)',
      statusCode: 401,
    });
    return undefined;
  }
  return tenantId;
}

function requestUser(request: FastifyRequest): { id?: string; sub?: string } | undefined {
  return (request as FastifyRequest & { user?: { id?: string; sub?: string } }).user;
}

function requestRoles(request: FastifyRequest): unknown {
  const user = (
    request as FastifyRequest & {
      user?: { roles?: unknown };
    }
  ).user;
  return user?.roles ?? [];
}

function requireAction(
  request: FastifyRequest,
  reply: FastifyReply,
  action: GradebookAction,
): boolean {
  try {
    assertGradebookAccess(requestRoles(request), action);
    return true;
  } catch (error) {
    if (error instanceof AppError) {
      reply.status(error.statusCode).send(error.toJSON());
      return false;
    }
    throw error;
  }
}

function sendDomainError(reply: FastifyReply, error: unknown) {
  if (isGradebookSchemaMissingError(error)) {
    return reply.status(503).send(error.toJSON());
  }
  if (isGradeLockedError(error) || isTranscriptImmutableError(error)) {
    return reply.status(409).send(error.toJSON());
  }
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerGradebookRoutes(
  fastify: FastifyInstance,
  options: GradebookRoutesOptions,
): Promise<void> {
  const prefix = options.prefix ?? '/gradebook';
  const { service } = options;

  fastify.get(`${prefix}/sections`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as {
        institutionId?: string;
        academicPeriodId?: string;
      };
      const rows = await service.listSections(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/entries`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { sectionId?: string; studentId?: string };
      const rows = await service.listGradeEntries(tenantId, {
        sectionId: query.sectionId,
        studentId: query.studentId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/entries`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'grade.entry')) return;
    const validated = validate(UpsertGradeEntrySchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.upsertGradeEntry(tenantId, validated.data, requestUser(request));
      return reply.status(200).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  /** G-303 — submit / approve / reject / lock / reopen */
  fastify.post(`${prefix}/entries/:id/transition`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const { id } = request.params as { id: string };
    const validated = validate(TransitionGradeEntrySchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    const action = validated.data.action;
    if (!isGradeWorkflowAction(action)) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid workflow action',
        statusCode: 400,
      });
    }
    // Teachers may submit; moderation/lock/reopen require registrar-class.
    const needed: GradebookAction = action === 'submit' ? 'grade.entry' : 'grade.moderate';
    if (!requireAction(request, reply, needed)) return;
    try {
      const row = await service.transitionGradeEntry(tenantId, id, action, requestUser(request));
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/credit-rules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { boardId?: string };
      const rows = await service.listCreditRules(tenantId, query.boardId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/credit-rules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'credit_rule.write')) return;
    const validated = validate(CreateCreditRuleSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createCreditRule(tenantId, validated.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/grading-scales`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { boardId?: string };
      const rows = await service.listGradingScales(tenantId, query.boardId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/gpa/compute`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'gpa.compute')) return;
    const validated = validate(ComputeGpaSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const result = await service.computeGpa(tenantId, validated.data);
      return reply.status(201).send({
        ...result.snapshot,
        detail: result.detail,
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/gpa`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { studentId?: string };
      if (!query.studentId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'studentId query parameter is required',
          statusCode: 400,
        });
      }
      const rows = await service.listGpaSnapshots(tenantId, query.studentId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/report-cards`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'report_card.create')) return;
    const validated = validate(CreateReportCardJobSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const job = await service.createReportCardJob(tenantId, validated.data, requestUser(request));
      return reply.status(201).send(job);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/report-cards`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const rows = await service.listReportCardJobs(tenantId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/report-cards/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const job = await service.getReportCardJob(tenantId, id);
      if (!job) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Report card job not found',
          statusCode: 404,
        });
      }
      return reply.send(job);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/transcripts`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const query = request.query as { studentId?: string };
      const rows = await service.listTranscripts(tenantId, {
        studentId: query.studentId,
      });
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/transcripts/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const row = await service.getTranscript(tenantId, id);
      if (!row) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Transcript not found',
          statusCode: 404,
        });
      }
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/transcripts/:id/download`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const query = request.query as { format?: string };
      const raw = (query.format ?? 'pdf').toLowerCase();
      const format = raw === 'html' || raw === 'json' ? raw : 'pdf';
      const file = await service.downloadTranscript(tenantId, id, format);
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .header('X-Checksum-SHA256', file.checksumSha256)
        .send(file.body);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/transcripts/issue`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'transcript.issue')) return;
    const validated = validate(IssueTranscriptSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.issueTranscript(tenantId, validated.data, requestUser(request));
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/board-packs`, async (_request, reply) => {
    return reply.send({ data: service.listBoardPackRegistry() });
  });

  fastify.get(`${prefix}/boards`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const rows = await service.listBoards(tenantId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/board-exports`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const rows = await service.listBoardExportJobs(tenantId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/board-exports`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'board_export.create')) return;
    const validated = validate(CreateBoardExportJobSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const job = await service.createBoardExportJob(
        tenantId,
        validated.data,
        requestUser(request),
      );
      return reply.status(201).send(job);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/board-exports/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const job = await service.getBoardExportJob(tenantId, id);
      if (!job) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Board export job not found',
          statusCode: 404,
        });
      }
      return reply.send(job);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/board-exports/:id/download`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    try {
      const { id } = request.params as { id: string };
      const query = request.query as { format?: string; token?: string };
      const formatRaw = (query.format ?? 'pack').toLowerCase();
      const format =
        formatRaw === 'csv' || formatRaw === 'json' || formatRaw === 'html' || formatRaw === 'pack'
          ? formatRaw
          : 'pack';
      const file = await service.downloadBoardExport(tenantId, id, format, {
        downloadToken: query.token,
        actorId: requestUser(request)?.sub ?? requestUser(request)?.id ?? null,
      });
      return reply
        .header('Content-Type', file.contentType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .header('X-Checksum-SHA256', String(file.job.metadata.checksumSha256 ?? ''))
        .send(file.body);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  /** G-305 — mint a short-lived signed download token for a SUCCEEDED job. */
  fastify.post(`${prefix}/board-exports/:id/signed-download`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'board_export.create')) return;
    try {
      const { id } = request.params as { id: string };
      const job = await service.getBoardExportJob(tenantId, id);
      if (!job) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Board export job not found',
          statusCode: 404,
        });
      }
      const signed = service.issueBoardExportDownloadToken(tenantId, id);
      return reply.send({
        jobId: id,
        ...signed,
        downloadPath: `${prefix}/board-exports/${id}/download?token=${encodeURIComponent(signed.token)}`,
      });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/board-exports/:id/process`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'board_export.create')) return;
    try {
      const { id } = request.params as { id: string };
      const job = await service.processBoardExportJob(tenantId, id);
      return reply.send(job);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });
}
