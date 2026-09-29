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

import { isGradePublished, isGradeWorkflowAction } from './grade-workflow.js';
import {
  assertGradebookAccess,
  hasGradebookAccess,
  normalizeRoles,
  type GradebookAction,
} from './gradebook-access.js';
import {
  isGradebookSchemaMissingError,
  isGradeLockedError,
  isTranscriptImmutableError,
} from './gradebook-errors.js';
import type { GradebookService } from './gradebook-service.js';
import {
  BulkTransitionGradeEntriesSchema,
  ComputeClassRankSchema,
  ComputeGpaSchema,
  CreateBoardExportJobSchema,
  CreateCreditRuleSchema,
  CreateReportCardJobSchema,
  IssueTranscriptSchema,
  TransitionGradeEntrySchema,
  UpsertCommentsBankSchema,
  UpsertGradeEntrySchema,
} from './schemas.js';
import { isTranscriptSigningKeyMissingError } from './signed-download.js';

export interface GradebookStudentBindingPort {
  listReadableStudentIds(tenantId: string, actorUserId: string): Promise<string[]>;
}

export interface GradebookRoutesOptions {
  service: GradebookService;
  prefix?: string;
  /** PRC-C006: portal self-scope binding (parent/guardian/student → readable student ids). */
  studentBinding?: GradebookStudentBindingPort;
}

function tenantIdOf(request: FastifyRequest, reply: FastifyReply): string | undefined {
  // SEC-2: `x-tenant-id` is a client-supplied header and must never be trusted as a
  // tenant source. The gateway overwrites it with the JWT-verified tenant before
  // proxying (see apps/api-gateway/src/plugins/service-router.ts), but this package
  // has no standalone boot path, so there is no legitimate case where tenant identity
  // should fall back to it. Resolve strictly from server-verified sources.
  const user = (request as FastifyRequest & { user?: { tenantId?: string } }).user;
  const tenantId = user?.tenantId ?? (request as FastifyRequest & { tenantId?: string }).tenantId;
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

const PORTAL_ONLY_ROLES = new Set(['parent', 'student', 'guardian']);

function isPortalOnlyReader(roles: unknown): boolean {
  const names = normalizeRoles(roles);
  return names.length > 0 && names.every((role) => PORTAL_ONLY_ROLES.has(role));
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

function actorUserId(request: FastifyRequest): string | null {
  const user = requestUser(request);
  return user?.sub ?? user?.id ?? null;
}

/**
 * PRC-C006: outcome of resolving a read request's scope from the caller's role.
 *  - kind 'staff': caller holds grade.read.staff → tenant/staff read.
 *  - kind 'self':  portal caller (parent/student/guardian) → reads bound to studentIds.
 *  - kind 'denied': reply already sent (403).
 */
type GradebookReadScope =
  | { kind: 'staff' }
  | { kind: 'self'; studentIds: string[] }
  | { kind: 'denied' };

async function resolveReadScope(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  studentBinding: GradebookStudentBindingPort | undefined,
): Promise<GradebookReadScope> {
  const roles = requestRoles(request);
  if (hasGradebookAccess(roles, 'grade.read.staff')) return { kind: 'staff' };
  if (isPortalOnlyReader(roles)) {
    // Portal reader: must be bound to specific students, else fail closed.
    const actor = actorUserId(request);
    if (!studentBinding || !actor) {
      reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Portal access to gradebook is not available for this account',
        statusCode: 403,
      });
      return { kind: 'denied' };
    }
    const studentIds = await studentBinding.listReadableStudentIds(tenantId, actor);
    return { kind: 'self', studentIds };
  }
  // Neither staff nor a recognised portal reader → deny.
  reply.status(403).send({
    code: 'FORBIDDEN',
    message: 'Forbidden: role cannot read gradebook',
    statusCode: 403,
  });
  return { kind: 'denied' };
}

/** PRC-C006: staff-only read routes (audits, board exports, rank, credit rules, etc.). */
function requireStaffRead(request: FastifyRequest, reply: FastifyReply): boolean {
  return requireAction(request, reply, 'grade.read.staff');
}

/** PRC-C006: body for a portal reader requesting a student outside their linked set. */
function portalScopeForbidden() {
  return {
    code: 'FORBIDDEN',
    message: 'You may only read gradebook data for your own linked students',
    statusCode: 403,
  };
}

function sendDomainError(reply: FastifyReply, error: unknown) {
  if (isGradebookSchemaMissingError(error)) {
    return reply.status(503).send(error.toJSON());
  }
  if (isTranscriptSigningKeyMissingError(error)) {
    const body = error.toJSON();
    return reply.status(body.statusCode).send(body);
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
  const { service, studentBinding } = options;

  fastify.get(`${prefix}/sections`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    // PRC-C006: staff read all; portal readers are bound to their own students and see only
    // published grades. Non-staff, non-portal callers are denied.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
    try {
      const query = request.query as { sectionId?: string; studentId?: string };
      if (scope.kind === 'self') {
        // A portal reader may only request a linked student's grades.
        if (!query.studentId || !scope.studentIds.includes(query.studentId)) {
          return reply.status(403).send(portalScopeForbidden());
        }
      }
      const rows = await service.listGradeEntries(tenantId, {
        sectionId: query.sectionId,
        studentId: query.studentId,
      });
      const visible =
        scope.kind === 'self'
          ? rows.filter((row) => isGradePublished(row.metadata, row.publishedAt))
          : rows;
      return reply.send({ data: visible });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  /** Parent-portal read: only PUBLISHED grades (G-907). */
  fastify.get(`${prefix}/published`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    // PRC-C006: portal readers bound to their linked students; staff read all.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
    try {
      const query = request.query as { sectionId?: string; studentId?: string };
      if (scope.kind === 'self') {
        if (!query.studentId || !scope.studentIds.includes(query.studentId)) {
          return reply.status(403).send(portalScopeForbidden());
        }
      }
      const rows = await service.listPublishedGradeEntries(tenantId, {
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
      const row = await service.transitionGradeEntry(
        tenantId,
        id,
        action,
        requestUser(request),
        validated.data.reason,
      );
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/entries/bulk-transition`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    const validated = validate(BulkTransitionGradeEntriesSchema, request.body);
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
    const needed: GradebookAction = action === 'submit' ? 'grade.entry' : 'grade.moderate';
    if (!requireAction(request, reply, needed)) return;
    try {
      const rows = await service.bulkTransitionGradeEntries(
        tenantId,
        validated.data.ids,
        action,
        requestUser(request),
      );
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/comments-bank`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
    try {
      const query = request.query as {
        subjectId?: string;
        gradeBand?: string;
        institutionId?: string;
      };
      const rows = await service.listCommentsBank(tenantId, query);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/comments-bank`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'grade.entry')) return;
    const validated = validate(UpsertCommentsBankSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.createCommentsBank(tenantId, validated.data);
      return reply.status(201).send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.put(`${prefix}/comments-bank/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'grade.entry')) return;
    const { id } = request.params as { id: string };
    const validated = validate(UpsertCommentsBankSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const row = await service.updateCommentsBank(tenantId, id, validated.data);
      return reply.send(row);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.delete(`${prefix}/comments-bank/:id`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'grade.moderate')) return;
    try {
      const { id } = request.params as { id: string };
      await service.deleteCommentsBank(tenantId, id);
      return reply.status(204).send();
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.post(`${prefix}/rank/compute`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireAction(request, reply, 'gpa.compute')) return;
    const validated = validate(ComputeClassRankSchema, request.body);
    if (!validated.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: validated.errors,
      });
    }
    try {
      const result = await service.computeClassRank(tenantId, validated.data);
      return reply.status(201).send(result);
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/rank`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireStaffRead(request, reply)) return; // PRC-C006: class rank is a staff surface
    try {
      const query = request.query as { sectionId?: string };
      if (!query.sectionId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'sectionId query parameter is required',
          statusCode: 400,
        });
      }
      const rows = await service.listClassRanks(tenantId, query.sectionId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/audits`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireStaffRead(request, reply)) return; // PRC-C006: audit trail is staff-only
    try {
      const query = request.query as { gradeEntryId?: string };
      const rows = await service.listGradeChangeAudits(tenantId, query.gradeEntryId);
      return reply.send({ data: rows });
    } catch (error) {
      return sendDomainError(reply, error);
    }
  });

  fastify.get(`${prefix}/credit-rules`, async (request, reply) => {
    const tenantId = tenantIdOf(request, reply);
    if (!tenantId) return;
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    // PRC-C006: portal readers may only read a linked student's GPA; staff read any.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
    try {
      const query = request.query as { studentId?: string };
      if (!query.studentId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'studentId query parameter is required',
          statusCode: 400,
        });
      }
      if (scope.kind === 'self' && !scope.studentIds.includes(query.studentId)) {
        return reply.status(403).send(portalScopeForbidden());
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: report-card jobs are staff-only
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    // PRC-C006: portal readers scoped to linked students; staff read all.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
    try {
      const query = request.query as { studentId?: string };
      if (scope.kind === 'self') {
        if (!query.studentId || !scope.studentIds.includes(query.studentId)) {
          return reply.status(403).send(portalScopeForbidden());
        }
      }
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
    // PRC-C006: portal readers may only read their linked students' transcripts.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
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
      if (scope.kind === 'self' && !scope.studentIds.includes(row.studentId)) {
        // 404 (not 403) so a portal caller cannot probe transcript ids.
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
    // PRC-C006/C007: transcript download requires a real read scope. Portal readers may only
    // download their linked students' transcripts; the download is never anonymous.
    const scope = await resolveReadScope(request, reply, tenantId, studentBinding);
    if (scope.kind === 'denied') return;
    try {
      const { id } = request.params as { id: string };
      if (scope.kind === 'self') {
        const row = await service.getTranscript(tenantId, id);
        if (!row || !scope.studentIds.includes(row.studentId)) {
          return reply.status(404).send({
            code: 'NOT_FOUND',
            message: 'Transcript not found',
            statusCode: 404,
          });
        }
      }
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: board export jobs are staff-only
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
    if (!requireStaffRead(request, reply)) return; // PRC-C006: staff surface
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
    // PRC-C007: board-export downloads carry PII (national IDs, names, marks). Require a real
    // staff read role — the previous handler had NO role check and only verified the token when
    // one happened to be supplied, so the signed token was decorative and downloads were open.
    if (!requireStaffRead(request, reply)) return;
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
