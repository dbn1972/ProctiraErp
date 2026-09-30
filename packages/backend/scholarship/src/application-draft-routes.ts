/**
 * PRC-H031 — PUT /scholarships/applications/:id updates a draft application so the
 * wizard can persist edits (program, academic records, financial info, personal
 * statement) made after the draft was first created. Submitted applications are
 * immutable here (409/422 via BusinessRuleError).
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import { updateDraftApplication } from './application-draft.js';
import { resolveScholarshipActor } from './application-intake.js';
import { UpdateDraftApplicationSchema } from './schemas.js';
import type { ScholarshipRepository } from './scholarship-repository.js';

const IdParams = Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }) });

export interface ApplicationDraftRoutesOptions {
  repository: ScholarshipRepository;
  prefix?: string;
  resolveLinkedStudentIds?: (tenantId: string, userId: string) => Promise<string[]>;
}

function tenantIdOf(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

export async function registerApplicationDraftRoutes(
  fastify: FastifyInstance,
  options: ApplicationDraftRoutesOptions,
): Promise<void> {
  const { repository, prefix = '/scholarships', resolveLinkedStudentIds } = options;

  fastify.put(
    `${prefix}/applications/:id`,
    async function updateDraftHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = tenantIdOf(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const params = validate(IdParams, request.params);
      const body = validate(UpdateDraftApplicationSchema, request.body ?? {});
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      try {
        const actor = await resolveScholarshipActor(request, tenantId, resolveLinkedStudentIds);
        const updated = await updateDraftApplication(
          repository,
          tenantId,
          params.data.id,
          actor,
          body.data,
        );
        return reply.send({
          ...updated,
          submittedAt: updated.submittedAt.toISOString(),
          reviewedAt: updated.reviewedAt ? updated.reviewedAt.toISOString() : null,
          createdAt: updated.createdAt.toISOString(),
          updatedAt: updated.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
