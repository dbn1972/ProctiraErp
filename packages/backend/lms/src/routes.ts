/**
 * LMS Routes (Wave 8 / G-801, G-802)
 *
 * Skills (Spiral PAL taxonomy):
 *   POST   /lms/skills                              - Create a skill (board or school scope)
 *   GET    /lms/skills                              - List skills visible to the caller
 *
 * Assignments · homework · quizzes:
 *   POST   /lms/assignments                         - Create (optionally publish) an assignment
 *   GET    /lms/assignments                         - List (board-shared + own-school rows)
 *   GET    /lms/assignments/:id                     - Detail + quiz questions (answer key hidden for learners)
 *   PUT    /lms/assignments/:id                     - Update / replace quiz questions / change status
 *   POST   /lms/assignments/:id/publish             - Publish
 *   POST   /lms/assignments/:id/close               - Close
 *   DELETE /lms/assignments/:id                     - Delete a draft
 *   POST   /lms/assignments/:id/submissions         - Submit (quizzes auto-grade + feed PAL)
 *   GET    /lms/assignments/:id/submissions         - List submissions for an assignment
 *
 * Submissions:
 *   GET    /lms/submissions                         - List submissions (learners: own only)
 *   GET    /lms/submissions/:id                     - Submission detail
 *   POST   /lms/submissions/:id/grade               - Grade + feed PAL for linked skills
 *
 * Spiral PAL:
 *   GET    /lms/pal/students/:studentId/plan        - Today's adaptive plan (reviews → reinforce → introduce)
 *   GET    /lms/pal/students/:studentId/progress    - Mastery per skill
 *   GET    /lms/pal/students/:studentId/attempts    - Attempt history
 *   POST   /lms/pal/students/:studentId/attempts    - Record a practice attempt
 */
import { AppError } from '@proctira/common';
import { validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { getLmsFile } from './lms-file-store.js';
import type { LmsActor, LmsService } from './lms-service.js';
import {
  AssembleFromBankSchema,
  AssignmentListQuerySchema,
  BankListQuerySchema,
  ClassAnalyticsQuerySchema,
  ContentListQuerySchema,
  CreateAssignmentSchema,
  CreateModuleSchema,
  CreateModuleItemSchema,
  ListModulesQuerySchema,
  CreateBankQuestionSchema,
  CreateContentItemSchema,
  CreateDiscussionSchema,
  CreateLessonResourceSchema,
  CreateLessonSchema,
  CreatePostSchema,
  CreateRubricSchema,
  CreateSkillSchema,
  CreateSubmissionSchema,
  DiscussionListQuerySchema,
  FileIdParamsSchema,
  GradeRubricSchema,
  GradeSubmissionSchema,
  HidePostSchema,
  IdParamsSchema,
  LessonListQuerySchema,
  LockDiscussionSchema,
  PinPostSchema,
  PlanQuerySchema,
  PostIdParamsSchema,
  RecordAttemptSchema,
  SkillListQuerySchema,
  StudentParamsSchema,
  SubmissionListQuerySchema,
  UpdateAssignmentSchema,
  UploadFileSchema,
} from './schemas.js';

export interface LmsRoutesOptions {
  lmsService: LmsService;
  /** Route prefix (default: '/lms') */
  prefix?: string;
}

interface RequestUserLike {
  sub?: string;
  roles?: Array<string | { roleId?: string }>;
  institutions?: string[];
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/** Derive the LMS actor from the gateway-decorated JWT payload. */
export function getLmsActor(request: FastifyRequest): LmsActor {
  const user = (request as FastifyRequest & { user?: RequestUserLike | null }).user;
  if (!user) return { userId: null, roles: [], institutions: [] };
  const roles = (user.roles ?? [])
    .map((r) => (typeof r === 'string' ? r : r?.roleId))
    .filter((r): r is string => typeof r === 'string' && r.length > 0);
  return {
    userId: user.sub ?? null,
    roles,
    institutions: Array.isArray(user.institutions) ? user.institutions : [],
  };
}

/** Fastify's parsed query is a null-prototype object; TypeBox needs a plain one. */
function plainQuery(request: FastifyRequest): Record<string, unknown> {
  return { ...(request.query as Record<string, unknown>) };
}

function plainParams(request: FastifyRequest): Record<string, unknown> {
  return { ...(request.params as Record<string, unknown>) };
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function serialise(entity: object): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entity as Record<string, unknown>)) {
    if (value instanceof Date) out[key] = iso(value);
    else if (Array.isArray(value)) {
      out[key] = (value as unknown[]).map((v): unknown => {
        if (v instanceof Date) return iso(v);
        if (v && typeof v === 'object') return serialise(v);
        return v;
      });
    } else if (value && typeof value === 'object') {
      out[key] = serialise(value);
    } else out[key] = value;
  }
  return out;
}

function tenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function validationFailed(reply: FastifyReply, errors: unknown, message = 'Validation failed') {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message,
    statusCode: 400,
    errors,
  });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerLmsRoutes(
  fastify: FastifyInstance,
  options: LmsRoutesOptions,
): Promise<void> {
  const { lmsService, prefix = '/lms' } = options;

  // ─── Skills ────────────────────────────────────────────────────────────

  fastify.post(`${prefix}/skills`, async (request, reply) => {
    const body = validate(CreateSkillSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const skill = await lmsService.createSkill(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(skill));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/skills`, async (request, reply) => {
    const query = validateQuery(SkillListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 50, ...filter } = query.data;
    try {
      const result = await lmsService.listSkills(
        tenantId,
        filter,
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Assignments ───────────────────────────────────────────────────────

  fastify.post(`${prefix}/assignments`, async (request, reply) => {
    const body = validate(CreateAssignmentSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createAssignment(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/assignments`, async (request, reply) => {
    const query = validateQuery(AssignmentListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, dueBefore, dueAfter, ...rest } = query.data;
    try {
      const result = await lmsService.listAssignments(
        tenantId,
        {
          ...rest,
          dueBefore: dueBefore ? new Date(dueBefore) : undefined,
          dueAfter: dueAfter ? new Date(dueAfter) : undefined,
        },
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/assignments/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const assignment = await lmsService.getAssignment(
        tenantId,
        params.data.id,
        getLmsActor(request),
      );
      return reply.send(serialise(assignment));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.put(`${prefix}/assignments/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(UpdateAssignmentSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const updated = await lmsService.updateAssignment(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.send(serialise(updated));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  for (const action of ['publish', 'close'] as const) {
    fastify.post(`${prefix}/assignments/:id/${action}`, async (request, reply) => {
      const params = validate(IdParamsSchema, plainParams(request));
      if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const updated =
          action === 'publish'
            ? await lmsService.publishAssignment(tenantId, params.data.id, getLmsActor(request))
            : await lmsService.closeAssignment(tenantId, params.data.id, getLmsActor(request));
        return reply.send(serialise(updated));
      } catch (error) {
        return sendError(reply, error);
      }
    });
  }

  fastify.delete(`${prefix}/assignments/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      await lmsService.deleteAssignment(tenantId, params.data.id, getLmsActor(request));
      return reply.status(204).send();
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/assignments/:id/submissions`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(CreateSubmissionSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const submission = await lmsService.submit(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(submission));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/assignments/:id/submissions`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const query = validateQuery(SubmissionListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, ...filter } = query.data;
    try {
      const result = await lmsService.listSubmissions(
        tenantId,
        { ...filter, assignmentId: params.data.id },
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Submissions ───────────────────────────────────────────────────────

  fastify.get(`${prefix}/submissions`, async (request, reply) => {
    const query = validateQuery(SubmissionListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, ...filter } = query.data;
    try {
      const result = await lmsService.listSubmissions(
        tenantId,
        filter,
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/submissions/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const submission = await lmsService.getSubmission(
        tenantId,
        params.data.id,
        getLmsActor(request),
      );
      return reply.send(serialise(submission));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/submissions/:id/grade`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(GradeSubmissionSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const graded = await lmsService.grade(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.send(serialise(graded));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Spiral PAL ────────────────────────────────────────────────────────

  fastify.get(`${prefix}/pal/students/:studentId/plan`, async (request, reply) => {
    const params = validate(StudentParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid student ID');
    const query = validateQuery(PlanQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const plan = await lmsService.getPlan(
        tenantId,
        params.data.studentId,
        query.data,
        getLmsActor(request),
      );
      return reply.send({
        studentId: params.data.studentId,
        generatedAt: plan.generatedAt.toISOString(),
        items: plan.items.map((item) => ({ ...item, dueAt: iso(item.dueAt) })),
        blockedSkillIds: plan.blockedSkillIds,
        summary: plan.summary,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/pal/students/:studentId/progress`, async (request, reply) => {
    const params = validate(StudentParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid student ID');
    const query = validateQuery(PlanQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const progress = await lmsService.getProgress(
        tenantId,
        params.data.studentId,
        query.data,
        getLmsActor(request),
      );
      return reply.send({
        studentId: progress.studentId,
        summary: progress.summary,
        skills: progress.skills.map((row) => ({
          skill: serialise(row.skill),
          mastery: row.mastery ? serialise(row.mastery) : null,
        })),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/pal/students/:studentId/attempts`, async (request, reply) => {
    const params = validate(StudentParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid student ID');
    const query = validateQuery(SubmissionListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const result = await lmsService.listAttempts(
        tenantId,
        params.data.studentId,
        { page: query.data.page ?? 1, pageSize: query.data.pageSize ?? 20 },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/pal/students/:studentId/attempts`, async (request, reply) => {
    const params = validate(StudentParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid student ID');
    const body = validate(RecordAttemptSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const mastery = await lmsService.recordAttempt(
        tenantId,
        params.data.studentId,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(mastery));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Question bank ──────────────────────────────────────────────────────

  fastify.post(`${prefix}/bank`, async (request, reply) => {
    const body = validate(CreateBankQuestionSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createBankQuestion(
        tenantId,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/bank`, async (request, reply) => {
    const query = validateQuery(BankListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 50, tags, ...rest } = query.data;
    try {
      const result = await lmsService.listBankQuestions(
        tenantId,
        {
          ...rest,
          tags: tags
            ? tags
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean)
            : undefined,
        },
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/bank/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const row = await lmsService.getBankQuestion(tenantId, params.data.id, getLmsActor(request));
      return reply.send(serialise(row));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/assignments/:id/from-bank`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(AssembleFromBankSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const updated = await lmsService.assembleFromBank(
        tenantId,
        params.data.id,
        body.data.questionIds,
        getLmsActor(request),
      );
      return reply.send(serialise(updated));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/assignments/:id/analytics`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const analytics = await lmsService.getQuizAnalytics(
        tenantId,
        params.data.id,
        getLmsActor(request),
      );
      return reply.send(analytics);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/assignments/:id/files`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(UploadFileSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const file = await lmsService.uploadAssignmentFile(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(file));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/assignments/:id/files`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const files = await lmsService.listAssignmentFiles(
        tenantId,
        params.data.id,
        getLmsActor(request),
      );
      return reply.send({ data: files.map(serialise) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/files/:id/signed-download`, async (request, reply) => {
    const params = validate(FileIdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const signed = await lmsService.signedFileDownload(
        tenantId,
        params.data.id,
        getLmsActor(request),
      );
      return reply.send(serialise(signed));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/files/:id/download`, async (request, reply) => {
    const params = validate(FileIdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const token = String((plainQuery(request).token as string | undefined) ?? '');
    try {
      const file = await lmsService.downloadFile(
        tenantId,
        params.data.id,
        token,
        getLmsActor(request),
      );
      const bytes = await getLmsFile(file.storageKey);
      return reply
        .header('Content-Type', file.mimeType)
        .header('Content-Disposition', `attachment; filename="${file.filename}"`)
        .send(bytes);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Rubrics ───────────────────────────────────────────────────────────

  fastify.post(`${prefix}/rubrics`, async (request, reply) => {
    const body = validate(CreateRubricSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createRubric(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/rubrics`, async (request, reply) => {
    const query = validateQuery(LessonListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const result = await lmsService.listRubrics(
        tenantId,
        {
          institutionId: query.data.institutionId,
          boardId: query.data.boardId,
          subject: query.data.subject,
        },
        { page: query.data.page ?? 1, pageSize: query.data.pageSize ?? 20 },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/rubrics/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const rubric = await lmsService.getRubric(tenantId, params.data.id, getLmsActor(request));
      return reply.send(serialise(rubric));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/submissions/:id/rubric-grade`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(GradeRubricSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const graded = await lmsService.gradeWithRubric(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.send(serialise(graded));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Discussions ───────────────────────────────────────────────────────

  fastify.post(`${prefix}/discussions`, async (request, reply) => {
    const body = validate(CreateDiscussionSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createDiscussion(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/discussions`, async (request, reply) => {
    const query = validateQuery(DiscussionListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, ...filter } = query.data;
    try {
      const result = await lmsService.listDiscussions(
        tenantId,
        filter,
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/discussions/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const thread = await lmsService.getDiscussion(tenantId, params.data.id, getLmsActor(request));
      return reply.send(serialise(thread));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/discussions/:id/lock`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(LockDiscussionSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const updated = await lmsService.lockDiscussion(
        tenantId,
        params.data.id,
        body.data.locked,
        getLmsActor(request),
      );
      return reply.send(serialise(updated));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/discussions/:id/posts`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(CreatePostSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const post = await lmsService.createPost(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(post));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/discussions/:id/posts/:postId/pin`, async (request, reply) => {
    const params = validate(PostIdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(PinPostSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const post = await lmsService.pinPost(
        tenantId,
        params.data.id,
        params.data.postId,
        body.data.pinned,
        getLmsActor(request),
      );
      return reply.send(serialise(post));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/discussions/:id/posts/:postId/hide`, async (request, reply) => {
    const params = validate(PostIdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(HidePostSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const post = await lmsService.hidePost(
        tenantId,
        params.data.id,
        params.data.postId,
        body.data.hidden,
        getLmsActor(request),
      );
      return reply.send(serialise(post));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/analytics`, async (request, reply) => {
    const query = validateQuery(ClassAnalyticsQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const analytics = await lmsService.getClassAnalytics(
        tenantId,
        query.data,
        getLmsActor(request),
      );
      return reply.send(analytics);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/content`, async (request, reply) => {
    const body = validate(CreateContentItemSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createContentItem(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/content`, async (request, reply) => {
    const query = validateQuery(ContentListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, ...filter } = query.data;
    try {
      const result = await lmsService.listContentItems(
        tenantId,
        filter,
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/content/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const item = await lmsService.getContentItem(tenantId, params.data.id, getLmsActor(request));
      return reply.send(serialise(item));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ─── Lessons ────────────────────────────────────────────────────────────

  fastify.post(`${prefix}/lessons`, async (request, reply) => {
    const body = validate(CreateLessonSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const created = await lmsService.createLesson(tenantId, body.data, getLmsActor(request));
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/lessons`, async (request, reply) => {
    const query = validateQuery(LessonListQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    const { page = 1, pageSize = 20, ...filter } = query.data;
    try {
      const result = await lmsService.listLessons(
        tenantId,
        filter,
        { page, pageSize },
        getLmsActor(request),
      );
      return reply.send({ data: result.data.map(serialise), meta: result.meta });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/lessons/:id`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const lesson = await lmsService.getLesson(tenantId, params.data.id, getLmsActor(request));
      return reply.send(serialise(lesson));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/lessons/:id/resources`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(CreateLessonResourceSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const resource = await lmsService.addLessonResource(
        tenantId,
        params.data.id,
        body.data,
        getLmsActor(request),
      );
      return reply.status(201).send(serialise(resource));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  // ── Modules (Canvas-class sequencing) ───────────────────────────────────
  fastify.post(`${prefix}/modules`, async (request, reply) => {
    const body = validate(CreateModuleSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const actor = getLmsActor(request);
      const created = await lmsService.createModule(tenantId, actor.userId ?? 'system', body.data);
      return reply.status(201).send(serialise(created));
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(`${prefix}/modules`, async (request, reply) => {
    const query = validateQuery(ListModulesQuerySchema, plainQuery(request));
    if (!query.success) return validationFailed(reply, query.errors, 'Invalid query');
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const modules = await lmsService.listModules(tenantId, query.data);
      const withItems = await Promise.all(
        modules.map(async (mod) => ({
          ...mod,
          items: await lmsService.listModuleItems(tenantId, mod.id),
        })),
      );
      return reply.send({ data: withItems.map(serialise) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(`${prefix}/modules/:id/items`, async (request, reply) => {
    const params = validate(IdParamsSchema, plainParams(request));
    if (!params.success) return validationFailed(reply, params.errors, 'Invalid ID');
    const body = validate(CreateModuleItemSchema, request.body);
    if (!body.success) return validationFailed(reply, body.errors);
    const tenantId = getTenantId(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const item = await lmsService.addModuleItem(tenantId, params.data.id, body.data);
      return reply.status(201).send(serialise(item));
    } catch (error) {
      return sendError(reply, error);
    }
  });
}
