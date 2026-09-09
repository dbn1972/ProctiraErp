/**
 * Examination ops routes (G-908).
 *
 * POST/GET    /examinations/:id/sessions
 * DELETE      /examinations/:id/sessions/:sessionId
 * POST/GET    /examinations/:id/sessions/:sessionId/invigilators
 * DELETE      /examinations/:id/sessions/:sessionId/invigilators/:allocationId
 * GET/POST    /examinations/:id/seating  (POST generate)
 * POST        /examinations/:id/seating/generate
 * GET/POST    /examinations/:id/marks/entries
 * POST        /examinations/:id/marks/resolve
 * GET/POST    /examinations/:id/reevaluations
 * POST        /examinations/:id/reevaluations/:requestId/assign
 * POST        /examinations/:id/reevaluations/:requestId/complete
 * POST        /examinations/:id/reevaluations/:requestId/reject
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { conflictResponse, type ExamOpsActor, type ExamOpsService } from './ops-service.js';
import {
  AllocateInvigilatorSchema,
  AllocationParamsSchema,
  AssignReevaluationSchema,
  CompleteReevaluationSchema,
  CreateExamSessionSchema,
  CreateReevaluationSchema,
  ExaminationIdParamsSchema,
  GenerateSeatingSchema,
  RecordDoubleEntrySchema,
  ReevaluationParamsSchema,
  RejectReevaluationSchema,
  ResolveMarksSchema,
  SessionIdParamsSchema,
  type AllocateInvigilatorInput,
  type AssignReevaluationInput,
  type CompleteReevaluationInput,
  type CreateExamSessionInput,
  type CreateReevaluationInput,
  type ExaminationIdParams,
  type GenerateSeatingInput,
  type RecordDoubleEntryInput,
  type RejectReevaluationInput,
  type ResolveMarksInput,
} from './ops-schemas.js';

export interface ExamOpsRoutesOptions {
  examOpsService: ExamOpsService;
  prefix?: string;
}

interface JwtRole {
  roleId?: string;
  roleName?: string;
}

interface JwtUser {
  sub?: string;
  userId?: string;
  roles?: Array<string | JwtRole>;
}

function tenantOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function actorOf(request: FastifyRequest): ExamOpsActor {
  const user = (request as FastifyRequest & { user?: JwtUser }).user;
  const roles = (user?.roles ?? []).flatMap((role) => {
    if (typeof role === 'string') return [role];
    return [role.roleName, role.roleId].filter((value): value is string => Boolean(value));
  });
  return { userId: user?.sub ?? user?.userId ?? '', roles };
}

function tenantRequired(reply: FastifyReply) {
  return reply
    .status(400)
    .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function iso(value: Date): string {
  return value.toISOString();
}

export async function registerExamOpsRoutes(
  fastify: FastifyInstance,
  options: ExamOpsRoutesOptions,
): Promise<void> {
  const { examOpsService, prefix = '/examinations' } = options;

  fastify.get(
    `${prefix}/:id/sessions`,
    async (request: FastifyRequest<{ Params: ExaminationIdParams }>, reply: FastifyReply) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const sessions = await examOpsService.listSessions(tenantId, params.data.id);
        return reply.status(200).send({
          data: sessions.map((s) => ({
            ...s,
            createdAt: iso(s.createdAt),
            updatedAt: iso(s.updatedAt),
          })),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/sessions`,
    async (
      request: FastifyRequest<{ Params: ExaminationIdParams; Body: CreateExamSessionInput }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateExamSessionSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid exam session',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const result = await examOpsService.createSession(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        if (!result.ok) {
          return reply.status(409).send(conflictResponse(result.conflicts));
        }
        return reply.status(201).send({
          ...result.session,
          createdAt: iso(result.session.createdAt),
          updatedAt: iso(result.session.updatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/sessions/:sessionId`,
    async (
      request: FastifyRequest<{ Params: { id: string; sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const params = validate(SessionIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid session ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        await examOpsService.deleteSession(tenantId, params.data.id, params.data.sessionId);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/sessions/:sessionId/invigilators`,
    async (
      request: FastifyRequest<{ Params: { id: string; sessionId: string } }>,
      reply: FastifyReply,
    ) => {
      const params = validate(SessionIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid session ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const rows = await examOpsService.listInvigilators(
          tenantId,
          params.data.id,
          params.data.sessionId,
        );
        return reply.status(200).send({
          data: rows.map((row) => ({ ...row, allocatedAt: iso(row.allocatedAt) })),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/sessions/:sessionId/invigilators`,
    async (
      request: FastifyRequest<{
        Params: { id: string; sessionId: string };
        Body: AllocateInvigilatorInput;
      }>,
      reply: FastifyReply,
    ) => {
      const params = validate(SessionIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid session ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(AllocateInvigilatorSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid invigilator allocation',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const result = await examOpsService.allocateInvigilator(
          tenantId,
          params.data.id,
          params.data.sessionId,
          body.data,
          actorOf(request),
        );
        if (!result.ok) {
          return reply.status(409).send(conflictResponse(result.conflicts));
        }
        return reply.status(201).send({
          ...result.allocation,
          allocatedAt: iso(result.allocation.allocatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/sessions/:sessionId/invigilators/:allocationId`,
    async (
      request: FastifyRequest<{
        Params: { id: string; sessionId: string; allocationId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const params = validate(AllocationParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid allocation ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        await examOpsService.removeInvigilator(
          tenantId,
          params.data.id,
          params.data.sessionId,
          params.data.allocationId,
        );
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/seating`,
    async (request: FastifyRequest<{ Params: ExaminationIdParams }>, reply: FastifyReply) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const seats = await examOpsService.listSeating(tenantId, params.data.id);
        return reply.status(200).send({
          data: seats.map((s) => ({ ...s, generatedAt: iso(s.generatedAt) })),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  const generateSeatingHandler = async (
    request: FastifyRequest<{ Params: ExaminationIdParams; Body: GenerateSeatingInput }>,
    reply: FastifyReply,
  ) => {
    const params = validate(ExaminationIdParamsSchema, request.params);
    if (!params.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid examination ID',
        statusCode: 400,
        errors: params.errors,
      });
    }
    const body = validate(GenerateSeatingSchema, request.body ?? {});
    if (!body.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid seating request',
        statusCode: 400,
        errors: body.errors,
      });
    }
    const tenantId = tenantOf(request);
    if (!tenantId) return tenantRequired(reply);
    try {
      const seats = await examOpsService.generateSeating(
        tenantId,
        params.data.id,
        body.data,
        actorOf(request),
      );
      return reply.status(200).send({
        data: seats.map((s) => ({ ...s, generatedAt: iso(s.generatedAt) })),
      });
    } catch (error) {
      return sendError(reply, error);
    }
  };

  fastify.post(`${prefix}/:id/seating/generate`, generateSeatingHandler);
  fastify.post(`${prefix}/:id/seating`, generateSeatingHandler);

  fastify.get(
    `${prefix}/:id/marks/entries`,
    async (request: FastifyRequest<{ Params: ExaminationIdParams }>, reply: FastifyReply) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const pairs = await examOpsService.listMarksPairs(tenantId, params.data.id);
        return reply.status(200).send({
          data: pairs.map((pair) => ({
            ...pair,
            entry1: pair.entry1
              ? { ...pair.entry1, enteredAt: iso(pair.entry1.enteredAt) }
              : null,
            entry2: pair.entry2
              ? { ...pair.entry2, enteredAt: iso(pair.entry2.enteredAt) }
              : null,
          })),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/marks/entries`,
    async (
      request: FastifyRequest<{ Params: ExaminationIdParams; Body: RecordDoubleEntryInput }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(RecordDoubleEntrySchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid marks entry',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const entry = await examOpsService.recordDoubleEntry(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send({ ...entry, enteredAt: iso(entry.enteredAt) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/marks/resolve`,
    async (
      request: FastifyRequest<{ Params: ExaminationIdParams; Body: ResolveMarksInput }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(ResolveMarksSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid resolve payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const view = await examOpsService.resolveMarks(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(200).send(view);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/reevaluations`,
    async (request: FastifyRequest<{ Params: ExaminationIdParams }>, reply: FastifyReply) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const rows = await examOpsService.listReevaluations(tenantId, params.data.id);
        return reply.status(200).send({
          data: rows.map((row) => ({
            ...row,
            createdAt: iso(row.createdAt),
            updatedAt: iso(row.updatedAt),
          })),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/reevaluations`,
    async (
      request: FastifyRequest<{ Params: ExaminationIdParams; Body: CreateReevaluationInput }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ExaminationIdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid examination ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateReevaluationSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid re-evaluation request',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await examOpsService.requestReevaluation(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/reevaluations/:requestId/assign`,
    async (
      request: FastifyRequest<{
        Params: { id: string; requestId: string };
        Body: AssignReevaluationInput;
      }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ReevaluationParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid re-evaluation ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(AssignReevaluationSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid assign payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await examOpsService.assignReevaluation(
          tenantId,
          params.data.id,
          params.data.requestId,
          body.data,
          actorOf(request),
        );
        return reply.status(200).send({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/reevaluations/:requestId/complete`,
    async (
      request: FastifyRequest<{
        Params: { id: string; requestId: string };
        Body: CompleteReevaluationInput;
      }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ReevaluationParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid re-evaluation ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CompleteReevaluationSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid complete payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await examOpsService.completeReevaluation(
          tenantId,
          params.data.id,
          params.data.requestId,
          body.data,
          actorOf(request),
        );
        return reply.status(200).send({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/reevaluations/:requestId/reject`,
    async (
      request: FastifyRequest<{
        Params: { id: string; requestId: string };
        Body: RejectReevaluationInput;
      }>,
      reply: FastifyReply,
    ) => {
      const params = validate(ReevaluationParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid re-evaluation ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(RejectReevaluationSchema, request.body ?? {});
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid reject payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await examOpsService.rejectReevaluation(
          tenantId,
          params.data.id,
          params.data.requestId,
          body.data,
          actorOf(request),
        );
        return reply.status(200).send({
          ...row,
          createdAt: iso(row.createdAt),
          updatedAt: iso(row.updatedAt),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
