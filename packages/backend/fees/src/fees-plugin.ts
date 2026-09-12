/**
 * Fastify Fees Plugin — staff fees routes under `/fees`.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { assertFeesAccess } from './fees-access.js';
import type { FeesRepository } from './fees-repository.js';
import {
  FeesService,
  type ApplyConcessionInput,
  type BulkInvoiceInput,
  type CreateFeePlanInput,
  type CreateFeeStructureInput,
  type CreateInvoiceInput,
  type GenerateInstalmentScheduleInput,
  type RecordPaymentInput,
  type RecordRefundInput,
} from './fees-service.js';
import type { PaymentAdapter } from './payment-adapter.js';
import { FEES_REMINDER_SANDBOX_HONESTY_NOTE } from './reminder-sandbox.js';

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

const CreateFeeStructureSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  category: Type.String({ minLength: 1, maxLength: 120 }),
  term: Type.Optional(Type.String({ maxLength: 64 })),
  amountCents: Type.Number({ minimum: 0 }),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  institutionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  academicPeriodId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  gradeId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  classId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});

const GenerateInstalmentsSchema = Type.Object({
  partCount: Type.Optional(Type.Integer({ minimum: 1, maximum: 24 })),
  shares: Type.Optional(Type.Array(Type.Number({ minimum: 0 }), { minItems: 1 })),
  dueOffsetDays: Type.Optional(Type.Array(Type.Integer())),
  labels: Type.Optional(Type.Array(Type.String({ maxLength: 120 }))),
});

const BulkInvoiceSchema = Type.Object({
  structureId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  classId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  gradeId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  studentIds: Type.Optional(Type.Array(Type.String({ pattern: UUID_PATTERN }), { minItems: 1 })),
  dueAt: Type.Optional(Type.String()),
});

const ApplyConcessionSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  structureId: Type.String({ pattern: UUID_PATTERN }),
  invoiceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  kind: Type.Union([Type.Literal('percent'), Type.Literal('amount')]),
  percent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  amountCents: Type.Optional(Type.Number({ minimum: 0 })),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  approverId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const RecordRefundSchema = Type.Object({
  paymentId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  amountCents: Type.Number({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});

const ReconciliationImportSchema = Type.Object({
  csv: Type.String({ minLength: 1 }),
  filename: Type.Optional(Type.String({ maxLength: 255 })),
});

const ResolveReconExceptionSchema = Type.Object({
  status: Type.Union([Type.Literal('resolved'), Type.Literal('ignored')]),
  resolutionNote: Type.String({ minLength: 1, maxLength: 2000 }),
});

type IdParams = Static<typeof IdParamsSchema>;

function formatReconBatch(batch: {
  id: string;
  tenantId: string;
  filename: string;
  matchedCount: number;
  unmatchedCount: number;
  createdBy: string | null;
  createdAt: Date;
}) {
  return {
    ...batch,
    createdAt: batch.createdAt.toISOString(),
  };
}

function formatReconRow(row: {
  id: string;
  tenantId: string;
  batchId: string;
  invoiceNumber: string;
  amountCents: number;
  matched: boolean;
  invoiceId: string | null;
  note: string | null;
  exceptionStatus: string;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  createdAt: Date;
}) {
  return {
    ...row,
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface ParentFeeBinding {
  listLinkedStudentIds(tenantId: string, parentUserId: string): Promise<string[]>;
  isLinked(tenantId: string, parentUserId: string, studentId: string): Promise<boolean>;
}

export interface FeesPluginOptions {
  repository: FeesRepository;
  paymentAdapter?: PaymentAdapter;
  prefix?: string;
  parentBinding?: ParentFeeBinding;
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

function getRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
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
  invoiceNumber?: string | null;
  structureId?: string | null;
  classId?: string | null;
  gradeId?: string | null;
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
    invoiceNumber: entity.invoiceNumber ?? null,
    structureId: entity.structureId ?? null,
    classId: entity.classId ?? null,
    gradeId: entity.gradeId ?? null,
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
    const { repository, paymentAdapter, prefix = '/fees', parentBinding } = options;
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
          const plan = await feesService.createFeePlan(tenantId, getActorId(request), result.data);
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
      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      let invoices = await feesService.listInvoices(tenantId);
      const scope = String(
        (request.query as { scope?: string; institutionId?: string }).scope ?? '',
      ).toLowerCase();
      if (scope === 'parent') {
        if (!parentBinding) {
          return reply.status(200).send({ data: [] });
        }
        const studentIds = await parentBinding.listLinkedStudentIds(tenantId, getActorId(request));
        invoices = await feesService.listInvoicesForStudentIds(tenantId, studentIds);
      }
      if (institutionId) {
        invoices = invoices.filter((inv) => {
          const id = (inv as { institutionId?: string | null }).institutionId;
          return id == null || id === institutionId;
        });
      }
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
          assertFeesAccess(getRoles(request), 'payment.record');
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
          assertFeesAccess(getRoles(request), 'payment.record');
          const paid = await feesService.recordPayment(tenantId, getActorId(request), result.data);
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
      const scope = String((request.query as { scope?: string }).scope ?? '').toLowerCase();
      if (scope === 'parent' && parentBinding) {
        const studentIds = await parentBinding.listLinkedStudentIds(tenantId, getActorId(request));
        const invoices = await feesService.listInvoicesForStudentIds(tenantId, studentIds);
        const receipts = await feesService.listReceiptsForInvoiceIds(
          tenantId,
          invoices.map((invoice) => invoice.id),
        );
        return reply.status(200).send({ data: receipts.map(formatReceipt) });
      }
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

    fastify.get(`${prefix}/structures`, async function listStructures(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const structures = await feesService.listFeeStructures(tenantId);
      return reply.status(200).send({
        data: structures.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
          updatedAt: row.updatedAt.toISOString(),
        })),
      });
    });

    fastify.post(
      `${prefix}/structures`,
      async function createStructure(
        request: FastifyRequest<{ Body: CreateFeeStructureInput }>,
        reply: FastifyReply,
      ) {
        const result = validate(CreateFeeStructureSchema, request.body);
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
          const structure = await feesService.createFeeStructure(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send({
            ...structure,
            createdAt: structure.createdAt.toISOString(),
            updatedAt: structure.updatedAt.toISOString(),
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
      `${prefix}/structures/:id/instalments`,
      async function generateInstalments(
        request: FastifyRequest<{ Params: IdParams; Body: GenerateInstalmentScheduleInput }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid structure ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const bodyResult = validate(GenerateInstalmentsSchema, request.body ?? {});
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
          const instalments = await feesService.generateInstalmentSchedule(
            tenantId,
            paramsResult.data.id,
            bodyResult.data,
          );
          return reply.status(201).send({
            data: instalments.map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
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

    fastify.get(
      `${prefix}/structures/:id/instalments`,
      async function listInstalments(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid structure ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          const instalments = await feesService.listInstalments(tenantId, paramsResult.data.id);
          return reply.status(200).send({
            data: instalments.map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
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

    fastify.post(
      `${prefix}/structures/:id/bulk-invoice`,
      async function bulkInvoice(
        request: FastifyRequest<{ Params: IdParams; Body: BulkInvoiceInput }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid structure ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const bodyResult = validate(BulkInvoiceSchema, request.body ?? {});
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
          const result = await feesService.bulkInvoiceClass(tenantId, getActorId(request), {
            ...bodyResult.data,
            structureId: paramsResult.data.id,
          });
          return reply.status(201).send({
            created: result.created.map(formatInvoice),
            skipped: result.skipped,
            structureId: result.structureId,
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
      `${prefix}/concessions`,
      async function applyConcession(
        request: FastifyRequest<{ Body: ApplyConcessionInput }>,
        reply: FastifyReply,
      ) {
        const result = validate(ApplyConcessionSchema, request.body);
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
          const applied = await feesService.applyConcession(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send({
            concession: {
              ...applied.concession,
              createdAt: applied.concession.createdAt.toISOString(),
            },
            invoice: applied.invoice ? formatInvoice(applied.invoice) : null,
            discountCents: applied.discountCents,
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
      `${prefix}/invoices/:id/refund`,
      async function refundInvoice(
        request: FastifyRequest<{ Params: IdParams; Body: RecordRefundInput }>,
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
        const bodyResult = validate(RecordRefundSchema, request.body);
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
          const refund = await feesService.recordRefund(tenantId, getActorId(request), {
            invoiceId: paramsResult.data.id,
            ...bodyResult.data,
          });
          return reply.status(201).send({
            ...refund,
            createdAt: refund.createdAt.toISOString(),
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/reports/dues`, async function duesReport(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const asOfRaw = (request.query as { asOf?: string }).asOf;
      const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
      const report = await feesService.duesReport(tenantId, asOf);
      const format = String((request.query as { format?: string }).format ?? 'json').toLowerCase();
      if (format === 'csv') {
        const header = 'classId,openCount,overdueCount,openCents,overdueCents';
        const lines = report.byClass.map(
          (row) =>
            `${row.classId},${row.openCount},${row.overdueCount},${row.openCents},${row.overdueCents}`,
        );
        return reply
          .status(200)
          .header('content-type', 'text/csv; charset=utf-8')
          .header('content-disposition', 'attachment; filename="fees-dues-report.csv"')
          .send([header, ...lines].join('\n'));
      }
      return reply.status(200).send(report);
    });

    fastify.post(
      `${prefix}/reconciliation/import`,
      async function importReconciliation(
        request: FastifyRequest<{ Body: { csv: string; filename?: string } }>,
        reply: FastifyReply,
      ) {
        const result = validate(ReconciliationImportSchema, request.body);
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
          const imported = await feesService.importReconciliationCsv(
            tenantId,
            getActorId(request),
            result.data.csv,
            result.data.filename,
          );
          return reply.status(201).send({
            batch: {
              ...imported.batch,
              createdAt: imported.batch.createdAt.toISOString(),
            },
            matched: imported.matched,
            unmatched: imported.unmatched,
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(
      `${prefix}/reconciliation/batches`,
      async function listReconBatches(request, reply) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const batches = await feesService.listReconciliationBatches(tenantId);
        return reply.status(200).send({ data: batches.map(formatReconBatch) });
      },
    );

    fastify.get(
      `${prefix}/reconciliation/batches/:id/rows`,
      async function listReconRows(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid batch ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const rows = await feesService.listReconciliationRows(tenantId, paramsResult.data.id);
        return reply.status(200).send({ data: rows.map(formatReconRow) });
      },
    );

    fastify.post(
      `${prefix}/reconciliation/rows/:id/resolve`,
      async function resolveReconException(
        request: FastifyRequest<{
          Params: IdParams;
          Body: { status: 'resolved' | 'ignored'; resolutionNote: string };
        }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid row ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const bodyResult = validate(ResolveReconExceptionSchema, request.body);
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
          assertFeesAccess(getRoles(request), 'payment.record');
          const updated = await feesService.resolveReconciliationException(
            tenantId,
            getActorId(request),
            {
              rowId: paramsResult.data.id,
              status: bodyResult.data.status,
              resolutionNote: bodyResult.data.resolutionNote,
            },
          );
          return reply.status(200).send(formatReconRow(updated));
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    /**
     * Dues reminder feed for the notification scheduler (G-903) + F2 console.
     * `@proctira/backend-notification` has no fee-rule hook; poll
     * GET /fees/reminders/overdue?asOf=ISO and emit from the scheduler.
     */
    fastify.get(`${prefix}/reminders/overdue`, async function overdueReminders(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const asOfRaw = (request.query as { asOf?: string }).asOf;
      const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
      const data = await feesService.listOverdueForReminder(tenantId, asOf);
      return reply.status(200).send({ data, asOf: asOf.toISOString() });
    });

    fastify.get(
      `${prefix}/reminders/suppressions`,
      async function listSuppressions(request, reply) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const data = await feesService.listReminderSuppressions(tenantId);
        return reply.status(200).send({
          data: data.map((row) => ({
            ...row,
            createdAt: row.createdAt.toISOString(),
          })),
        });
      },
    );

    fastify.post(
      `${prefix}/reminders/suppressions`,
      async function addSuppression(
        request: FastifyRequest<{
          Body: { studentId?: string; invoiceId?: string; reason: string };
        }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const body = request.body;
        if (!body?.reason) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'reason is required',
            statusCode: 400,
          });
        }
        try {
          const row = await feesService.addReminderSuppression(tenantId, getActorId(request), {
            studentId: body.studentId,
            invoiceId: body.invoiceId,
            reason: body.reason,
          });
          return reply.status(201).send({
            ...row,
            createdAt: row.createdAt.toISOString(),
          });
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.delete(
      `${prefix}/reminders/suppressions/:id`,
      async function removeSuppression(
        request: FastifyRequest<{ Params: { id: string } }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        try {
          await feesService.removeReminderSuppression(tenantId, request.params.id);
          return reply.status(204).send();
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.get(`${prefix}/reminders/audit`, async function listReminderAudit(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const data = await feesService.listReminderSendAudits(tenantId);
      return reply.status(200).send({
        data: data.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
        honestyNote: FEES_REMINDER_SANDBOX_HONESTY_NOTE,
      });
    });

    fastify.post(
      `${prefix}/reminders/send`,
      async function sendReminders(
        request: FastifyRequest<{
          Body: {
            invoiceIds: string[];
            channels: Array<'email' | 'sms'>;
            minOverdueDays?: number;
            cadenceDays?: number;
          };
        }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const body = request.body;
        if (!body?.invoiceIds?.length || !body?.channels?.length) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'invoiceIds and channels are required',
            statusCode: 400,
          });
        }
        try {
          const result = await feesService.sendReminders(tenantId, getActorId(request), {
            invoiceIds: body.invoiceIds,
            channels: body.channels,
            minOverdueDays: body.minOverdueDays,
            cadenceDays: body.cadenceDays,
          });
          return reply.status(200).send(result);
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.post(
      `${prefix}/scholarships/net`,
      async function netScholarship(
        request: FastifyRequest<{
          Body: {
            studentId: string;
            disbursementId: string;
            amountCents: number;
            invoiceId?: string;
            currency?: string;
          };
        }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const body = request.body;
        if (!body?.studentId || !body?.disbursementId || !body?.amountCents) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'studentId, disbursementId, amountCents are required',
            statusCode: 400,
          });
        }
        try {
          const result = await feesService.applyScholarshipNetting(tenantId, getActorId(request), {
            studentId: body.studentId,
            disbursementId: body.disbursementId,
            amountCents: body.amountCents,
            invoiceId: body.invoiceId,
            currency: body.currency,
          });
          return reply.status(200).send(result);
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );

    fastify.post(
      `${prefix}/structures/clone-period`,
      async function cloneStructures(
        request: FastifyRequest<{
          Body: { sourcePeriodId: string; targetPeriodId: string };
        }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        const body = request.body;
        if (!body?.sourcePeriodId || !body?.targetPeriodId) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'sourcePeriodId and targetPeriodId are required',
            statusCode: 400,
          });
        }
        try {
          const result = await feesService.cloneStructuresForPeriod(
            tenantId,
            getActorId(request),
            body.sourcePeriodId,
            body.targetPeriodId,
          );
          return reply.status(201).send(result);
        } catch (error: unknown) {
          if (error instanceof AppError) {
            return reply.status(error.statusCode).send(error.toJSON());
          }
          throw error;
        }
      },
    );
  },
  {
    name: '@proctira/backend-fees',
    fastify: '5.x',
    dependencies: [],
  },
);
