/**
 * Communication routes — campaigns and emergency blasts.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { CommunicationService } from './communication-service.js';
import {
  AudiencePreviewSchema,
  CampaignParamsSchema,
  ConfirmEmergencySchema,
  CreateCampaignSchema,
  CreateEmergencyBlastSchema,
  EmergencyParamsSchema,
  type AudiencePreviewInput,
  type CampaignParams,
  type ConfirmEmergencyInput,
  type CreateCampaignInput,
  type CreateEmergencyBlastInput,
  type EmergencyParams,
} from './schemas.js';

export interface CommunicationRoutesOptions {
  communicationService: CommunicationService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function formatCampaign(entity: {
  id: string;
  tenantId: string;
  name: string;
  status: string;
  channels: string[];
  body: string;
  audienceJson: Record<string, unknown>;
  scheduledAt: Date | null;
  sentAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    status: entity.status,
    channels: entity.channels,
    body: entity.body,
    audienceJson: entity.audienceJson,
    scheduledAt: entity.scheduledAt?.toISOString() ?? null,
    sentAt: entity.sentAt?.toISOString() ?? null,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatEmergency(entity: {
  id: string;
  tenantId: string;
  reason: string;
  channels: string[];
  status: string;
  confirmActor1: string | null;
  confirmActor2: string | null;
  confirmedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    reason: entity.reason,
    channels: entity.channels,
    status: entity.status,
    confirmActor1: entity.confirmActor1,
    confirmActor2: entity.confirmActor2,
    confirmedAt: entity.confirmedAt?.toISOString() ?? null,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerCommunicationRoutes(
  fastify: FastifyInstance,
  options: CommunicationRoutesOptions,
): Promise<void> {
  const { communicationService, prefix = '/communication' } = options;

  fastify.post(
    `${prefix}/audience/preview`,
    async function audiencePreviewHandler(
      request: FastifyRequest<{ Body: AudiencePreviewInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(AudiencePreviewSchema, request.body ?? {});
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const preview = communicationService.previewAudience(
        (result.data.audienceJson as Record<string, unknown> | undefined) ?? {},
      );
      return reply.status(200).send(preview);
    },
  );

  fastify.get(
    `${prefix}/campaigns`,
    async function listCampaignsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const campaigns = await communicationService.listCampaigns(tenantId);
      return reply.status(200).send({ data: campaigns.map(formatCampaign) });
    },
  );

  fastify.post(
    `${prefix}/campaigns`,
    async function createCampaignHandler(
      request: FastifyRequest<{ Body: CreateCampaignInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateCampaignSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const campaign = await communicationService.createCampaign(tenantId, result.data);
        return reply.status(201).send(formatCampaign(campaign));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/campaigns/:id`,
    async function getCampaignHandler(
      request: FastifyRequest<{ Params: CampaignParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CampaignParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid campaign ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const campaign = await communicationService.getCampaign(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatCampaign(campaign));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/campaigns/:id/send`,
    async function sendCampaignHandler(
      request: FastifyRequest<{ Params: CampaignParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CampaignParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid campaign ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const result = await communicationService.sendCampaign(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...formatCampaign(result.campaign),
          delivery: result.delivery,
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/emergency`,
    async function createEmergencyHandler(
      request: FastifyRequest<{ Body: CreateEmergencyBlastInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateEmergencyBlastSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const blast = await communicationService.createEmergencyBlast(tenantId, result.data);
        return reply.status(201).send(formatEmergency(blast));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/emergency/:id/confirm`,
    async function confirmEmergencyHandler(
      request: FastifyRequest<{ Params: EmergencyParams; Body: ConfirmEmergencyInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EmergencyParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid emergency blast ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(ConfirmEmergencySchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        const blast = await communicationService.confirmEmergencyBlast(
          tenantId,
          paramsResult.data.id,
          bodyResult.data.actorId,
        );
        return reply.status(200).send(formatEmergency(blast!));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/emergency`,
    async function listEmergencyHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const blasts = await communicationService.listEmergencyBlasts(tenantId);
      return reply.status(200).send({ data: blasts.map(formatEmergency) });
    },
  );
}
