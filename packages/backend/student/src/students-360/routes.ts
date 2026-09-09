/**
 * G-914 — Students 360 routes (mounted under the students prefix).
 *
 * POST   /students/:id/photo
 * GET    /students/:id/photo
 * GET    /students/:id/id-card.pdf
 * GET    /students/:id/siblings
 * POST   /students/:id/siblings
 * DELETE /students/:id/siblings/:siblingId
 * GET    /students/:id/consents
 * PUT    /students/:id/consents
 * GET    /students/:id/discipline
 * POST   /students/:id/discipline
 * DELETE /students/:id/discipline/:incidentId
 * GET    /students/:id/attendance-heatmap
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { StudentParamsSchema } from '../schemas.js';
import type { Students360Service } from './service.js';
import {
  CreateDisciplineSchema,
  CreateSiblingSchema,
  HeatmapQuerySchema,
  SetConsentSchema,
  UploadPhotoSchema,
  type CreateDisciplineDto,
  type CreateSiblingDto,
  type HeatmapQueryDto,
  type SetConsentDto,
  type UploadPhotoDto,
} from './schemas.js';
import type { ConsentRecord, DisciplineRecord, PhotoRecord, SiblingRecord } from './store.js';

export interface Students360RoutesOptions {
  service: Students360Service;
  prefix?: string;
}

function tenantOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function actorOf(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string; userId?: string } }).user;
  return user?.sub ?? user?.userId ?? 'system';
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function tenantRequired(reply: FastifyReply) {
  return reply
    .status(400)
    .send({ code: 'TENANT_REQUIRED', message: 'Tenant context is required', statusCode: 400 });
}

function formatPhoto(photo: PhotoRecord) {
  return {
    id: photo.id,
    studentId: photo.studentId,
    mimeType: photo.mimeType,
    sizeBytes: photo.sizeBytes,
    uploadedBy: photo.uploadedBy,
    createdAt: photo.createdAt.toISOString(),
  };
}

function formatSibling(row: SiblingRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    siblingId: row.siblingId,
    createdAt: row.createdAt.toISOString(),
  };
}

function formatConsent(row: ConsentRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    kind: row.kind,
    granted: row.granted,
    actorId: row.actorId,
    recordedAt: row.recordedAt.toISOString(),
  };
}

function formatDiscipline(row: DisciplineRecord) {
  return {
    id: row.id,
    studentId: row.studentId,
    incidentType: row.incidentType,
    severity: row.severity,
    description: row.description,
    actionTaken: row.actionTaken,
    reporterId: row.reporterId,
    incidentDate: row.incidentDate,
    visibleToParent: row.visibleToParent,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function registerStudents360Routes(
  fastify: FastifyInstance,
  options: Students360RoutesOptions,
): Promise<void> {
  const { service, prefix = '/students' } = options;

  fastify.post(
    `${prefix}/:id/photo`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: UploadPhotoDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(UploadPhotoSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid photo payload',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const photo = await service.uploadPhoto(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send(formatPhoto(photo));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/photo`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const { bytes, mimeType, signedUrl } = await service.getPhotoBytes(
          tenantId,
          params.data.id,
        );
        if (signedUrl) {
          return reply.status(200).send({ url: signedUrl, mimeType });
        }
        return reply
          .status(200)
          .header('content-type', mimeType)
          .header('cache-control', 'private, no-store')
          .send(bytes);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/id-card.pdf`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const pdf = await service.renderIdCardPdf(tenantId, params.data.id);
        return reply
          .status(200)
          .header('content-type', 'application/pdf')
          .header(
            'content-disposition',
            `attachment; filename="student-${params.data.id}-id-card.pdf"`,
          )
          .header('cache-control', 'private, no-store')
          .send(pdf);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/siblings`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listSiblings(tenantId, params.data.id);
        return reply.status(200).send({ data: rows.map(formatSibling) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/siblings`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreateSiblingDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateSiblingSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid sibling',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.addSibling(tenantId, params.data.id, body.data);
        return reply.status(201).send(formatSibling(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/siblings/:siblingId`,
    async (
      request: FastifyRequest<{ Params: { id: string; siblingId: string } }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, { id: request.params.id });
      const sibling = validate(StudentParamsSchema, { id: request.params.siblingId });
      if (!params.success || !sibling.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
        });
      }
      try {
        await service.removeSibling(tenantId, params.data.id, sibling.data.id);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/consents`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listConsents(tenantId, params.data.id);
        return reply.status(200).send({ data: rows.map(formatConsent) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.put(
    `${prefix}/:id/consents`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: SetConsentDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(SetConsentSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid consent',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.setConsent(tenantId, params.data.id, body.data, actorOf(request));
        return reply.status(200).send(formatConsent(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/discipline`,
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        const rows = await service.listDiscipline(tenantId, params.data.id);
        return reply.status(200).send({ data: rows.map(formatDiscipline) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/:id/discipline`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Body: CreateDisciplineDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const body = validate(CreateDisciplineSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid discipline incident',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        const row = await service.addDiscipline(
          tenantId,
          params.data.id,
          body.data,
          actorOf(request),
        );
        return reply.status(201).send(formatDiscipline(row));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.delete(
    `${prefix}/:id/discipline/:incidentId`,
    async (
      request: FastifyRequest<{ Params: { id: string; incidentId: string } }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, { id: request.params.id });
      const incident = validate(StudentParamsSchema, { id: request.params.incidentId });
      if (!params.success || !incident.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid id',
          statusCode: 400,
        });
      }
      try {
        await service.removeDiscipline(tenantId, params.data.id, incident.data.id);
        return reply.status(204).send();
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/:id/attendance-heatmap`,
    async (
      request: FastifyRequest<{ Params: { id: string }; Querystring: HeatmapQueryDto }>,
      reply: FastifyReply,
    ) => {
      const tenantId = tenantOf(request);
      if (!tenantId) return tenantRequired(reply);
      const params = validate(StudentParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: params.errors,
        });
      }
      const query = validate(HeatmapQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid heatmap range',
          statusCode: 400,
          errors: query.errors,
        });
      }
      try {
        const heatmap = await service.attendanceHeatmap(
          tenantId,
          params.data.id,
          query.data.from,
          query.data.to,
        );
        return reply.status(200).send(heatmap);
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
