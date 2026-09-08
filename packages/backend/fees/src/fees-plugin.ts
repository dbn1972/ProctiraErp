/**
 * Fastify Fees Plugin — staff fees routes under `/fees`.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import type { FeesRepository } from './fees-repository.js';
import {
  FeesService,
  type CreateFeePlanInput,
  type CreateInvoiceInput,
  type RecordPaymentInput,
} from './fees-service.js';
import type { PaymentAdapter } from './payment-adapter.js';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

const CreateFeePlanSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  amountCents: Type.Number({ minimum: 0 }),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  frequency: Type.Optional(
    Type.Union([
      Type.Literal('once'),
      Type.Literal('term'),
      Type.Literal('month'),
      Type.Literal('year'),
    ]),
  ),
});

const CreateInvoiceSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  planId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  amountCents: Type.Optional(Type.Number({ minimum: 0 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  dueAt: Type.Optional(Type.String()),
});

const IdParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

const RecordPaymentSchema = Type.Object({
  invoiceId: Type.String({ pattern: UUID_PATTERN }),
  payerUserId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  method: Type.Optional(
    Type.Union([
      Type.Literal('sandbox'),
      Type.Literal('upi'),
      Type.Literal('card'),
      Type.Literal('cash'),
    ]),
  ),
  amountCents: Type.Optional(Type.Number({ minimum: 0 })),
});

const PayInvoiceSchema = Type.Object({
  method: Type.Optional(
    Type.Union([
      Type.Literal('sandbox'),
      Type.Literal('upi'),
      Type.Literal('card'),
      Type.Literal('cash'),
    ]),
  ),
  payerUserId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  amountCents: Type.Optional(Type.Number({ minimum: 0 })),
});

type IdParams = Static<typeof IdParamsSchema>;

export interface FeesPluginOptions {
  repository: FeesRepository;
  paymentAdapter?: PaymentAdapter;
  prefix?: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    feesService: FeesService;
  }
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/** Actor from verified JWT only (G-102 — never trust x-user-id headers). */
function getActorId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'anonymous';
}

function tenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function formatPlan(entity: {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  description: string;
  amountCents: number;
  currency: string;
  frequency: string;
  status: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    code: entity.code,
    name: entity.name,
    description: entity.description,
    amountCents: entity.amountCents,
    currency: entity.currency,
    frequency: entity.frequency,
    status: entity.status,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatInvoice(entity: {
  id: string;
  tenantId: string;
  studentId: string;
  planId: string | null;
  title: string;
  description: string;
  amountCents: number;
  currency: string;
  status: string;
  dueAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    planId: entity.planId,
    title: entity.title,
    description: entity.description,
    amountCents: entity.amountCents,
    currency: entity.currency,
    status: entity.status,
    dueAt: entity.dueAt?.toISOString() ?? null,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatPayment(entity: {
  id: string;
  invoiceId: string;
  tenantId: string;
  payerUserId: string;
  amountCents: number;
  method: string;
  status: string;
  paidAt: Date;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    invoiceId: entity.invoiceId,
    tenantId: entity.tenantId,
    payerUserId: entity.payerUserId,
    amountCents: entity.amountCents,
    method: entity.method,
    status: entity.status,
    paidAt: entity.paidAt.toISOString(),
    createdAt: entity.createdAt.toISOString(),
  };
}

function formatReceipt(entity: {
  id: string;
  tenantId: string;
  paymentId: string;
  invoiceId: string;
  receiptNumber: string;
  amountCents: number;
  currency: string;
  issuedAt: Date;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    paymentId: entity.paymentId,
    invoiceId: entity.invoiceId,
    receiptNumber: entity.receiptNumber,
    amountCents: entity.amountCents,
    currency: entity.currency,
    issuedAt: entity.issuedAt.toISOString(),
    createdAt: entity.createdAt.toISOString(),
  };
}

export const feesPlugin = fp(
  async function feesPluginImpl(fastify: FastifyInstance, options: FeesPluginOptions) {
    const { repository, paymentAdapter, prefix = '/fees' } = options;
    const feesService = new FeesService(repository, paymentAdapter);
    fastify.decorate('feesService', feesService);

    fastify.get(`${prefix}/plans`, async function listPlans(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const plans = await feesService.listFeePlans(tenantId);
      return reply.status(200).send({ data: plans.map(formatPlan) });
    });

    fastify.post(
      `${prefix}/plans`,
      async function createPlan(
        request: FastifyRequest<{ Body: CreateFeePlanInput }>,
        reply: FastifyReply,
      ) {
        const result = validate(CreateFeePlanSchema, request.body);
        if (!result.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: result.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const plan = await feesService.createFeePlan(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send(formatPlan(plan));
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/invoices`, async function listInvoices(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const invoices = await feesService.listInvoices(tenantId);
      return reply.status(200).send({ data: invoices.map(formatInvoice) });
    });

    fastify.post(
      `${prefix}/invoices`,
      async function createInvoice(
        request: FastifyRequest<{ Body: CreateInvoiceInput }>,
        reply: FastifyReply,
      ) {
        const result = validate(CreateInvoiceSchema, request.body);
        if (!result.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: result.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const invoice = await feesService.createInvoice(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send(formatInvoice(invoice));
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.post(
      `${prefix}/invoices/:id/void`,
      async function voidInvoice(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid invoice ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const invoice = await feesService.voidInvoice(tenantId, paramsResult.data.id);
          return reply.status(200).send(formatInvoice(invoice));
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.post(
      `${prefix}/invoices/:id/pay`,
      async function payInvoice(
        request: FastifyRequest<{ Params: IdParams; Body: RecordPaymentInput }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid invoice ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const bodyResult = validate(PayInvoiceSchema, request.body ?? {});
        if (!bodyResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: bodyResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const result = await feesService.recordPayment(tenantId, getActorId(request), {
            invoiceId: paramsResult.data.id,
            ...bodyResult.data,
          });
          return reply.status(201).send({
            invoice: formatInvoice(result.invoice),
            payment: formatPayment(result.payment),
            receipt: formatReceipt(result.receipt),
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/payments`, async function listPayments(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const payments = await feesService.listPayments(tenantId);
      return reply.status(200).send({ data: payments.map(formatPayment) });
    });

    fastify.post(
      `${prefix}/payments`,
      async function recordPayment(
        request: FastifyRequest<{ Body: RecordPaymentInput }>,
        reply: FastifyReply,
      ) {
        const result = validate(RecordPaymentSchema, request.body);
        if (!result.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Validation failed',
            statusCode: 400,
            errors: result.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const paid = await feesService.recordPayment(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send({
            invoice: formatInvoice(paid.invoice),
            payment: formatPayment(paid.payment),
            receipt: formatReceipt(paid.receipt),
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/receipts`, async function listReceipts(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const receipts = await feesService.listReceipts(tenantId);
      return reply.status(200).send({ data: receipts.map(formatReceipt) });
    });

    fastify.get(
      `${prefix}/receipts/:id`,
      async function getReceipt(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid receipt ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const receipt = await feesService.getReceipt(tenantId, paramsResult.data.id);
          return reply.status(200).send(formatReceipt(receipt));
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    // G-718 — double-entry ledger read models
    fastify.get(
      `${prefix}/invoices/:id/ledger`,
      async function getInvoiceLedger(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid invoice ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const entries = await feesService.getInvoiceLedger(tenantId, paramsResult.data.id);
          return reply.status(200).send({
            data: entries.map((e) => ({
              ...e,
              postedAt: e.postedAt.toISOString(),
              createdAt: e.createdAt.toISOString(),
            })),
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/ledger/trial-balance`, async function trialBalance(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const balance = await feesService.getTrialBalance(tenantId);
      return reply.status(200).send({
        ...balance,
        balanced: balance.debitCents === balance.creditCents,
      });
    });
  },
  {
    name: '@proctira/backend-fees',
    fastify: '4.x',
    dependencies: [],
  },
);
