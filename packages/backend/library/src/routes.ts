/**
 * Library routes — catalog and circulation.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { LibraryService } from './library-service.js';
import {
  CheckoutSchema,
  CreateLibraryItemSchema,
  PatronParamsSchema,
  ReturnSchema,
  type CheckoutInput,
  type CreateLibraryItemInput,
  type PatronParams,
  type ReturnInput,
} from './schemas.js';

export interface LibraryRoutesOptions {
  libraryService: LibraryService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

function formatItem(entity: {
  id: string;
  tenantId: string;
  isbn: string | null;
  title: string;
  author: string | null;
  copies: number;
  available: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    isbn: entity.isbn,
    title: entity.title,
    author: entity.author,
    copies: entity.copies,
    available: entity.available,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatLoan(entity: {
  id: string;
  tenantId: string;
  itemId: string;
  patronUserId: string | null;
  studentId: string | null;
  checkoutAt: Date;
  dueAt: Date;
  returnedAt: Date | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    itemId: entity.itemId,
    patronUserId: entity.patronUserId,
    studentId: entity.studentId,
    checkoutAt: entity.checkoutAt.toISOString(),
    dueAt: entity.dueAt.toISOString(),
    returnedAt: entity.returnedAt?.toISOString() ?? null,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerLibraryRoutes(
  fastify: FastifyInstance,
  options: LibraryRoutesOptions,
): Promise<void> {
  const { libraryService, prefix = '/library' } = options;

  fastify.get(
    `${prefix}/items`,
    async function listItemsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const items = await libraryService.listItems(tenantId);
      return reply.status(200).send({ data: items.map(formatItem) });
    },
  );

  fastify.post(
    `${prefix}/items`,
    async function createItemHandler(
      request: FastifyRequest<{ Body: CreateLibraryItemInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateLibraryItemSchema, request.body);
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
        const item = await libraryService.createItem(tenantId, result.data);
        return reply.status(201).send(formatItem(item));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/circulation/checkout`,
    async function checkoutHandler(
      request: FastifyRequest<{ Body: CheckoutInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CheckoutSchema, request.body);
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
        const loan = await libraryService.checkout(tenantId, result.data);
        return reply.status(201).send(formatLoan(loan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/circulation/return`,
    async function returnHandler(
      request: FastifyRequest<{ Body: ReturnInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(ReturnSchema, request.body);
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
        const loan = await libraryService.returnLoan(tenantId, result.data.loanId);
        return reply.status(200).send(formatLoan(loan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/overdues`,
    async function overduesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const overdues = await libraryService.listOverdues(tenantId);
      return reply.status(200).send({ data: overdues.map(formatLoan) });
    },
  );

  fastify.get(
    `${prefix}/patrons/:studentId/clearance`,
    async function clearanceHandler(
      request: FastifyRequest<{ Params: PatronParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(PatronParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
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

      const clearance = await libraryService.getStudentClearance(
        tenantId,
        paramsResult.data.studentId,
      );
      return reply.status(200).send({
        studentId: clearance.studentId,
        clear: clearance.clear,
        openLoanCount: clearance.openLoanCount,
        overdueCount: clearance.overdueCount,
        openLoans: clearance.openLoans.map(formatLoan),
        checkedAt: clearance.checkedAt.toISOString(),
      });
    },
  );
}
