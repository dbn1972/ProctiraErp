import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { AdmissionsPipelineService } from './pipeline-service.js';
import {
  AcceptOfferSchema,
  ApplicationPlacementSchema,
  CreateEnquirySchema,
  CreateFollowupSchema,
  CreateOfferSchema,
  GenerateMeritListSchema,
  IdParamsSchema,
  UpdateEnquirySchema,
  UpsertSeatMatrixSchema,
  type AcceptOfferDto,
  type ApplicationPlacementDto,
  type CreateEnquiryDto,
  type CreateFollowupDto,
  type CreateOfferDto,
  type GenerateMeritListDto,
  type IdParams,
  type UpdateEnquiryDto,
  type UpsertSeatMatrixDto,
} from './schemas.js';

export interface AdmissionsPipelineRoutesOptions {
  service: AdmissionsPipelineService;
  prefix?: string;
}

function tenantOf(request: FastifyRequest, fallback?: string): string | null {
  const fromReq = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromReq) return fromReq;
  const header = request.headers['x-tenant-id'];
  if (typeof header === 'string' && header.length > 0) return header;
  return fallback ?? null;
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

function formatSeat(row: {
  id: string;
  institutionId: string;
  academicPeriodId: string;
  gradeId: string;
  quota: string;
  seats: number;
  filled: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function registerAdmissionsPipelineRoutes(
  fastify: FastifyInstance,
  options: AdmissionsPipelineRoutesOptions,
): Promise<void> {
  const { service, prefix = '/admissions' } = options;

  const requireTenant = (request: FastifyRequest, reply: FastifyReply): string | null => {
    const tenantId = tenantOf(request);
    if (!tenantId) {
      void reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
      return null;
    }
    return tenantId;
  };

  fastify.get(`${prefix}/enquiries`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    try {
      return reply.status(200).send({ data: await service.listEnquiries(tenantId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(
    `${prefix}/enquiries`,
    async (request: FastifyRequest<{ Body: CreateEnquiryDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const body = validate(CreateEnquirySchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enquiry',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        return reply.status(201).send(await service.createEnquiry(tenantId, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch(
    `${prefix}/enquiries/:id`,
    async (request: FastifyRequest<{ Params: IdParams; Body: UpdateEnquiryDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      const body = validate(UpdateEnquirySchema, request.body ?? {});
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enquiry update',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      try {
        return reply
          .status(200)
          .send(await service.updateEnquiry(tenantId, params.data.id, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(
    `${prefix}/enquiries/:id/follow-ups`,
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enquiry id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        return reply
          .status(200)
          .send({ data: await service.listFollowups(tenantId, params.data.id) });
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/enquiries/:id/follow-ups`,
    async (request: FastifyRequest<{ Params: IdParams; Body: CreateFollowupDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      const body = validate(CreateFollowupSchema, request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid follow-up',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      try {
        return reply
          .status(201)
          .send(await service.addFollowup(tenantId, params.data.id, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/enquiries/:id/convert`,
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid enquiry id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        return reply.status(201).send(await service.convertEnquiry(tenantId, params.data.id));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/seat-matrix`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const query = request.query as { institutionId?: string; academicPeriodId?: string };
    try {
      const rows = await service.listSeats(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
      });
      return reply.status(200).send({ data: rows.map(formatSeat) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.put(
    `${prefix}/seat-matrix`,
    async (request: FastifyRequest<{ Body: UpsertSeatMatrixDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const body = validate(UpsertSeatMatrixSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid seat matrix row',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        return reply.status(200).send(formatSeat(await service.upsertSeat(tenantId, body.data)));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/merit-lists`,
    async (request: FastifyRequest<{ Body: GenerateMeritListDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const body = validate(GenerateMeritListSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid merit list request',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        return reply.status(201).send(await service.generateMeritList(tenantId, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/merit-lists`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const query = request.query as {
      institutionId?: string;
      academicPeriodId?: string;
      gradeId?: string;
    };
    if (!query.institutionId || !query.academicPeriodId || !query.gradeId) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'institutionId, academicPeriodId and gradeId are required',
        statusCode: 400,
      });
    }
    try {
      const list = await service.getMeritList(tenantId, {
        institutionId: query.institutionId,
        academicPeriodId: query.academicPeriodId,
        gradeId: query.gradeId,
      });
      if (!list) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Merit list not found',
          statusCode: 404,
        });
      }
      return reply.status(200).send(list);
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.get(
    `${prefix}/applications/:id`,
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid application id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        return reply.status(200).send(await service.getApplicationBundle(tenantId, params.data.id));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.patch(
    `${prefix}/applications/:id/placement`,
    async (
      request: FastifyRequest<{ Params: IdParams; Body: ApplicationPlacementDto }>,
      reply,
    ) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      const body = validate(ApplicationPlacementSchema, request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid placement',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      try {
        return reply
          .status(200)
          .send(await service.setPlacement(tenantId, params.data.id, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.get(`${prefix}/offers`, async (request, reply) => {
    const tenantId = requireTenant(request, reply);
    if (!tenantId) return;
    const applicationId = (request.query as { applicationId?: string }).applicationId;
    try {
      return reply.status(200).send({ data: await service.listOffers(tenantId, applicationId) });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  fastify.post(
    `${prefix}/offers`,
    async (request: FastifyRequest<{ Body: CreateOfferDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const body = validate(CreateOfferSchema, request.body);
      if (!body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid offer',
          statusCode: 400,
          errors: body.errors,
        });
      }
      try {
        return reply.status(201).send(await service.createOffer(tenantId, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/offers/:id/send`,
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid offer id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        return reply.status(200).send(await service.sendOffer(tenantId, params.data.id));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/offers/:id/accept`,
    async (request: FastifyRequest<{ Params: IdParams; Body: AcceptOfferDto }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      const body = validate(AcceptOfferSchema, request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid offer accept',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      try {
        return reply.status(200).send(await service.acceptOffer(tenantId, params.data.id, body.data));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );

  fastify.post(
    `${prefix}/offers/:id/decline`,
    async (request: FastifyRequest<{ Params: IdParams }>, reply) => {
      const tenantId = requireTenant(request, reply);
      if (!tenantId) return;
      const params = validate(IdParamsSchema, request.params);
      if (!params.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid offer id',
          statusCode: 400,
          errors: params.errors,
        });
      }
      try {
        return reply.status(200).send(await service.declineOffer(tenantId, params.data.id));
      } catch (error) {
        return sendError(reply, error);
      }
    },
  );
}
