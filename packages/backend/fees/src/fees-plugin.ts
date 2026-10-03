/**
 * Fastify Fees Plugin — staff fees routes under `/fees`.
 */
import { appendAuditEntryOnClient, toCreateAuditLogInput } from '@proctira/backend-audit';
import { AppError } from '@proctira/common';
import type { PgQueryable } from '@proctira/database';
import { validate } from '@proctira/validation';
import { Type, type Static } from '@sinclair/typebox';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import { isPgFeesEnabled } from './create-fees-repository.js';
import {
  requireFeesAction,
  requireFeesStaffRead,
  resolveFeesReadScope,
} from './fees-http-guard.js';
import {
  FEES_DEFAULT_PAGE_LIMIT,
  FEES_MAX_PAGE_LIMIT,
  type FeesMoneyAuditSink,
  type FeesPageRequest,
  type FeesRepository,
} from './fees-repository.js';
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
  type ScholarshipDisbursementLookup,
} from './fees-service.js';
import type { PaymentAdapter } from './payment-adapter.js';
import { FEES_REMINDER_SANDBOX_HONESTY_NOTE } from './reminder-sandbox.js';

const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';

/** PRC-L105: ISO-8601 date or date-time; also rejected if Date.parse fails. */
const ISO_DATE_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}(T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,6})?)?(Z|[+-]\\d{2}:\\d{2})?)?$';
const IsoDateString = () => Type.String({ pattern: ISO_DATE_PATTERN, maxLength: 40 });
function isValidIsoDate(value: string): boolean {
  return new RegExp(ISO_DATE_PATTERN).test(value) && !Number.isNaN(Date.parse(value));
}
/** PRC-L105: bound on per-request reminder fan-out. */
const MAX_REMINDER_INVOICES = 500;
const SendRemindersSchema = Type.Object({
  invoiceIds: Type.Array(Type.String({ pattern: UUID_PATTERN }), {
    minItems: 1,
    maxItems: MAX_REMINDER_INVOICES,
  }),
  channels: Type.Array(Type.Union([Type.Literal('email'), Type.Literal('sms')]), {
    minItems: 1,
    maxItems: 2,
  }),
  minOverdueDays: Type.Optional(Type.Integer({ minimum: 0, maximum: 3650 })),
  cadenceDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 365 })),
});
const AddSuppressionSchema = Type.Object({
  studentId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  invoiceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
const ScholarshipNetSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  disbursementId: Type.String({ pattern: UUID_PATTERN }),
  amountCents: Type.Optional(Type.Integer({ minimum: 1 })),
  invoiceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
});
const ClonePeriodSchema = Type.Object({
  sourcePeriodId: Type.String({ pattern: UUID_PATTERN }),
  targetPeriodId: Type.String({ pattern: UUID_PATTERN }),
});
function validationFailed(reply: FastifyReply, errors?: unknown, message = 'Validation failed') {
  return reply.status(400).send({ code: 'VALIDATION_ERROR', message, statusCode: 400, errors });
}
/**
 * PRC-L105: map domain errors and malformed-input Postgres errors to 4xx
 * (22P02 invalid text representation, 22007/22008 bad datetime -> 400;
 * 23505 unique violation -> 409). Anything else is rethrown.
 */
function sendFeesError(reply: FastifyReply, error: unknown) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  const pgCode = (error as { code?: unknown } | null)?.code;
  if (pgCode === '22P02' || pgCode === '22007' || pgCode === '22008') {
    return validationFailed(reply, undefined, 'Invalid identifier or value');
  }
  if (pgCode === '23505') {
    return reply
      .status(409)
      .send({ code: 'CONFLICT', message: 'Duplicate record', statusCode: 409 });
  }
  throw error;
}
const CreateFeePlanSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  amountCents: Type.Integer({ minimum: 0 }),
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
  amountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  dueAt: Type.Optional(IsoDateString()),
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
  amountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
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
  amountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  idempotencyKey: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const CreateFeeStructureSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  category: Type.String({ minLength: 1, maxLength: 120 }),
  term: Type.Optional(Type.String({ maxLength: 64 })),
  amountCents: Type.Integer({ minimum: 0 }),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  institutionId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  academicPeriodId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  gradeId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  classId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  validFrom: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  validTo: Type.Optional(
    Type.Union([Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }), Type.Null()]),
  ),
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
  dueAt: Type.Optional(IsoDateString()),
});

const ApplyConcessionSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  structureId: Type.String({ pattern: UUID_PATTERN }),
  invoiceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  kind: Type.Union([Type.Literal('percent'), Type.Literal('amount')]),
  percent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  amountCents: Type.Optional(Type.Integer({ minimum: 0 })),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  approverId: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
});

const RecordRefundSchema = Type.Object({
  paymentId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  amountCents: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});

/** PRC-H059: a void must state why (stored on the reversal journal memo). */
const VoidInvoiceSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});

const IssueCreditNoteSchema = Type.Object({
  amountCents: Type.Integer({ minimum: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});

const WriteOffInvoiceSchema = Type.Object({
  amountCents: Type.Integer({ minimum: 1 }),
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
  /**
   * PRC-H020: verifies scholarship disbursements for HTTP netting. When absent the
   * netting routes fail closed (503) instead of trusting operator-typed ids/amounts.
   */
  scholarshipDisbursements?: ScholarshipDisbursementLookup;
}

declare module 'fastify' {
  interface FastifyInstance {
    feesService: FeesService;
  }
}

function scholarshipLookupUnavailable(reply: FastifyReply) {
  return reply.status(503).send({
    code: 'SCHOLARSHIP_LOOKUP_UNAVAILABLE',
    message: 'Scholarship disbursement verification is not configured',
    statusCode: 503,
  });
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/** Actor from verified JWT only (G-102 — never trust x-user-id headers). */
function getActorId(request: FastifyRequest): string {
  const user = (request as FastifyRequest & { user?: { sub?: string } }).user;
  return user?.sub ?? 'anonymous';
}

function getActorDisplayName(request: FastifyRequest): string {
  const user = (
    request as FastifyRequest & { user?: { sub?: string; displayName?: string; email?: string } }
  ).user;
  return user?.displayName ?? user?.email ?? user?.sub ?? 'anonymous';
}

/** Same Symbol.for key as api-gateway mutation-audit (W1-SEC-10 COMPLETE). */
const MUTATION_AUDIT_COMMITTED = Symbol.for('proctira.mutationAuditCommitted');

function markRegulatedMutationAuditCommitted(request: FastifyRequest): void {
  (request as FastifyRequest & { [MUTATION_AUDIT_COMMITTED]?: boolean })[MUTATION_AUDIT_COMMITTED] =
    true;
}

function buildPaymentAuditBinder(request: FastifyRequest, tenantId: string) {
  if (!isPgFeesEnabled()) return undefined;
  return {
    appendAuditInTxn: async (
      client: PgQueryable,
      settled: {
        payment: { id: string; invoiceId: string; amountCents: number; method: string };
        invoice: { status: string };
      },
    ) => {
      await appendAuditEntryOnClient(
        client,
        toCreateAuditLogInput({
          tenantId,
          entityType: 'fees',
          entityId: settled.payment.id,
          operation: 'CREATE',
          userId: getActorId(request),
          userName: getActorDisplayName(request),
          ipAddress: request.ip,
          beforeValues: null,
          afterValues: {
            path: '/api/v1/fees/payments',
            paymentId: settled.payment.id,
            // PRC-L306: reviewable money detail, no PII.
            invoiceId: settled.payment.invoiceId,
            amountCents: settled.payment.amountCents,
            method: settled.payment.method,
            invoiceStatusAfter: settled.invoice.status,
          },
          metadata: {
            method: request.method,
            path: request.url.split('?')[0] ?? request.url,
            regulated: 'fees.payment',
            atomic: true,
          },
        }),
      );
      markRegulatedMutationAuditCommitted(request);
    },
  };
}

/**
 * PRC-L306: same-transaction audit for refund / credit note / write-off / void /
 * concession approval. No-op when the repository is not transaction-bound
 * (in-memory); the gateway onSend audit remains the safety net there.
 */
function buildMoneyAuditSink(request: FastifyRequest, tenantId: string): FeesMoneyAuditSink {
  return async (tx, event) => {
    const client = tx.transactionClient?.() ?? null;
    if (!client) return;
    await appendAuditEntryOnClient(
      client,
      toCreateAuditLogInput({
        tenantId,
        entityType: 'fees',
        entityId: event.entityId,
        operation:
          event.kind === 'void' || event.kind === 'concession_approve' ? 'UPDATE' : 'CREATE',
        userId: getActorId(request),
        userName: getActorDisplayName(request),
        ipAddress: request.ip,
        beforeValues: { invoiceId: event.invoiceId, status: event.beforeStatus },
        afterValues: {
          invoiceId: event.invoiceId,
          amountCents: event.amountCents,
          status: event.afterStatus,
          kind: event.kind,
        },
        metadata: {
          method: request.method,
          path: request.url.split('?')[0] ?? request.url,
          regulated: `fees.${event.kind}`,
          atomic: true,
        },
      }),
    );
    markRegulatedMutationAuditCommitted(request);
  };
}
/** PRC-M248: `?limit=` (1-200, default 50) and opaque `?cursor=`; null when invalid. */
function parseFeesPage(query: unknown): FeesPageRequest | null {
  const q = (query ?? {}) as Record<string, unknown>;
  let limit = FEES_DEFAULT_PAGE_LIMIT;
  let offset = 0;
  if (q.limit !== undefined) {
    const n = Number(q.limit);
    if (!Number.isInteger(n) || n < 1 || n > FEES_MAX_PAGE_LIMIT) return null;
    limit = n;
  }
  if (q.cursor !== undefined) {
    const raw = String(q.cursor);
    if (!/^\d{1,9}$/.test(raw)) return null;
    offset = Number(raw);
  }
  return { limit, offset };
}

function invalidFeesPage(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'VALIDATION_ERROR',
    message: `limit must be 1-${FEES_MAX_PAGE_LIMIT}; cursor must be a token from nextCursor`,
    statusCode: 400,
  });
}

function tenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

/**
 * PRC-C005: body for a self-scope caller who cannot be safely scoped (no parent binding, or a
 * staff-only surface). Fail closed rather than leak tenant-wide data.
 */
function forbiddenSelfScope() {
  return {
    code: 'FORBIDDEN',
    message: 'Fee data for your account is not available on this endpoint',
    statusCode: 403,
  };
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
  idempotencyKey?: string | null;
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
    idempotencyKey: entity.idempotencyKey ?? null,
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
    const {
      repository,
      paymentAdapter,
      prefix = '/fees',
      parentBinding,
      scholarshipDisbursements,
    } = options;
    const feesService = new FeesService(repository, paymentAdapter);
    fastify.decorate('feesService', feesService);

    fastify.get(`${prefix}/plans`, async function listPlans(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: fee-plan catalogue is a staff surface — deny self-scope callers.
      if (!requireFeesStaffRead(request, reply)) return;
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
        try {
          const plan = await feesService.createFeePlan(tenantId, getActorId(request), result.data);
          return reply.status(201).send(formatPlan(plan));
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/invoices`, async function listInvoices(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: scope is derived from the caller's role, not a ?scope query param.
      const readScope = resolveFeesReadScope(request, reply);
      if (!readScope) return;
      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      let invoices: Awaited<ReturnType<typeof feesService.listInvoices>>;
      let nextCursor: string | null = null;
      if (readScope === 'self') {
        // Self-scope callers may only ever see their own linked students' invoices. Fail closed
        // when no binding is configured rather than falling through to a tenant-wide list.
        if (!parentBinding) return reply.status(403).send(forbiddenSelfScope());
        const studentIds = await parentBinding.listLinkedStudentIds(tenantId, getActorId(request));
        invoices = await feesService.listInvoicesForStudentIds(tenantId, studentIds);
      } else {
        // PRC-M248: staff tenant-wide list is paginated in SQL.
        const page = parseFeesPage(request.query);
        if (!page) return invalidFeesPage(reply);
        const result = await feesService.listInvoicesPage(tenantId, page);
        nextCursor = result.nextCursor;
        invoices = result.data;
      }
      if (institutionId) {
        invoices = invoices.filter((inv) => {
          const id = (inv as { institutionId?: string | null }).institutionId;
          return id == null || id === institutionId;
        });
      }
      return reply.status(200).send({ data: invoices.map(formatInvoice), nextCursor });
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
        try {
          const invoice = await feesService.createInvoice(
            tenantId,
            getActorId(request),
            result.data,
          );
          return reply.status(201).send(formatInvoice(invoice));
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.post(
      `${prefix}/invoices/:id/void`,
      async function voidInvoice(
        request: FastifyRequest<{ Params: IdParams; Body: { reason: string } }>,
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
        if (!requireFeesAction(request, reply, 'invoice.void')) return;
        const bodyResult = validate(VoidInvoiceSchema, request.body ?? {});
        if (!bodyResult.success || bodyResult.data.reason.trim() === '') {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'A void reason is required',
            statusCode: 400,
            errors: bodyResult.success ? [] : bodyResult.errors,
          });
        }
        try {
          const invoice = await feesService.voidInvoice(tenantId, paramsResult.data.id, {
            actorId: getActorId(request),
            reason: bodyResult.data.reason,
            audit: buildMoneyAuditSink(request, tenantId),
          });
          return reply.status(200).send(formatInvoice(invoice));
        } catch (error: unknown) {
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'payment.record')) return;
        try {
          const result = await feesService.recordPayment(
            tenantId,
            getActorId(request),
            {
              invoiceId: paramsResult.data.id,
              ...bodyResult.data,
            },
            buildPaymentAuditBinder(request, tenantId),
          );
          return reply.status(result.idempotent ? 200 : 201).send({
            invoice: formatInvoice(result.invoice),
            payment: formatPayment(result.payment),
            receipt: formatReceipt(result.receipt),
            idempotent: result.idempotent,
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/payments`, async function listPayments(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: the tenant-wide payments list is a staff surface. A guardian's own payment
      // history is served by the parent-portal self routes, not this endpoint — so a parent
      // (even with ?scope=parent) is denied here.
      if (!requireFeesStaffRead(request, reply)) return;
      const page = parseFeesPage(request.query);
      if (!page) return invalidFeesPage(reply);
      const payments = await feesService.listPaymentsPage(tenantId, page);
      return reply
        .status(200)
        .send({ data: payments.data.map(formatPayment), nextCursor: payments.nextCursor });
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
        if (!requireFeesAction(request, reply, 'payment.record')) return;
        try {
          const paid = await feesService.recordPayment(
            tenantId,
            getActorId(request),
            result.data,
            buildPaymentAuditBinder(request, tenantId),
          );
          return reply.status(paid.idempotent ? 200 : 201).send({
            invoice: formatInvoice(paid.invoice),
            payment: formatPayment(paid.payment),
            receipt: formatReceipt(paid.receipt),
            idempotent: paid.idempotent,
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/receipts`, async function listReceipts(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: role-derived scope, not the ?scope query param.
      const readScope = resolveFeesReadScope(request, reply);
      if (!readScope) return;
      if (readScope === 'self') {
        if (!parentBinding) return reply.status(403).send(forbiddenSelfScope());
        const studentIds = await parentBinding.listLinkedStudentIds(tenantId, getActorId(request));
        const invoices = await feesService.listInvoicesForStudentIds(tenantId, studentIds);
        const receipts = await feesService.listReceiptsForInvoiceIds(
          tenantId,
          invoices.map((invoice) => invoice.id),
        );
        return reply.status(200).send({ data: receipts.map(formatReceipt) });
      }
      const page = parseFeesPage(request.query);
      if (!page) return invalidFeesPage(reply);
      const receipts = await feesService.listReceiptsPage(tenantId, page);
      return reply
        .status(200)
        .send({ data: receipts.data.map(formatReceipt), nextCursor: receipts.nextCursor });
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
        // PRC-C005: role-derived scope with per-receipt ownership for self-scope callers.
        const readScope = resolveFeesReadScope(request, reply);
        if (!readScope) return;
        try {
          const receipt = await feesService.getReceipt(tenantId, paramsResult.data.id);
          if (readScope === 'self') {
            if (!parentBinding) return reply.status(403).send(forbiddenSelfScope());
            const studentIds = new Set(
              await parentBinding.listLinkedStudentIds(tenantId, getActorId(request)),
            );
            // Resolve the receipt's invoice → student and confirm it belongs to a linked child.
            const invoiceId = (receipt as { invoiceId?: string }).invoiceId;
            const invoice = invoiceId ? await feesService.getInvoice(tenantId, invoiceId) : null;
            const ownerStudentId = (invoice as { studentId?: string } | null)?.studentId;
            if (!ownerStudentId || !studentIds.has(ownerStudentId)) {
              // 404 (not 403) so a self-scope caller cannot probe which receipt ids exist.
              return reply.status(404).send({
                code: 'NOT_FOUND',
                message: `Receipt with id '${paramsResult.data.id}' not found`,
                statusCode: 404,
              });
            }
          }
          return reply.status(200).send(formatReceipt(receipt));
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    // G-718 — double-entry ledger read models
    fastify.get(
      `${prefix}/invoices/:id/ledger`,
      // PRC-C005: per-invoice double-entry ledger — staff only.
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
        if (!requireFeesStaffRead(request, reply)) return;
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
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/ledger/trial-balance`, async function trialBalance(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: tenant-wide ledger — staff only.
      if (!requireFeesStaffRead(request, reply)) return;
      const balance = await feesService.getTrialBalance(tenantId);
      return reply.status(200).send({
        ...balance,
        balanced: balance.debitCents === balance.creditCents,
      });
    });

    fastify.get(`${prefix}/structures`, async function listStructures(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: fee-structure catalogue is a staff surface.
      if (!requireFeesStaffRead(request, reply)) return;
      const asOf =
        typeof (request.query as { asOf?: unknown })?.asOf === 'string'
          ? (request.query as { asOf: string }).asOf
          : undefined;
      const structures = await feesService.listFeeStructures(tenantId, { asOf });
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
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
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
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
          return sendFeesError(reply, error);
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
        // PRC-C005: instalment schedules are structure-level (not per-student PII); allow either
        // staff or self-scope callers (parent UI reads plan instalments), but require a fees read
        // permission via role — not a query param.
        if (!resolveFeesReadScope(request, reply)) return;
        try {
          const instalments = await feesService.listInstalments(tenantId, paramsResult.data.id);
          return reply.status(200).send({
            data: instalments.map((row) => ({
              ...row,
              createdAt: row.createdAt.toISOString(),
            })),
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
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
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'concession.apply')) return;
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
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.post(
      `${prefix}/concessions/:id/approve`,
      async function approveConcession(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid concession ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        if (!requireFeesAction(request, reply, 'concession.approve')) return;
        try {
          const applied = await feesService.approveConcession(
            tenantId,
            getActorId(request),
            paramsResult.data.id,
            buildMoneyAuditSink(request, tenantId),
          );
          return reply.status(200).send({
            concession: {
              ...applied.concession,
              createdAt: applied.concession.createdAt.toISOString(),
            },
            invoice: applied.invoice ? formatInvoice(applied.invoice) : null,
            discountCents: applied.discountCents,
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.post(
      `${prefix}/concessions/:id/reject`,
      async function rejectConcession(
        request: FastifyRequest<{ Params: IdParams }>,
        reply: FastifyReply,
      ) {
        const paramsResult = validate(IdParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid concession ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        if (!requireFeesAction(request, reply, 'concession.approve')) return;
        try {
          const rejected = await feesService.rejectConcession(
            tenantId,
            getActorId(request),
            paramsResult.data.id,
          );
          return reply.status(200).send({
            concession: {
              ...rejected.concession,
              createdAt: rejected.concession.createdAt.toISOString(),
            },
            invoice: null,
            discountCents: 0,
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'refund.record')) return;
        try {
          const refund = await feesService.recordRefund(
            tenantId,
            getActorId(request),
            {
              invoiceId: paramsResult.data.id,
              ...bodyResult.data,
            },
            buildMoneyAuditSink(request, tenantId),
          );
          return reply.status(201).send({
            ...refund,
            createdAt: refund.createdAt.toISOString(),
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.post(
      `${prefix}/invoices/:id/credit-notes`,
      async function issueCreditNote(
        request: FastifyRequest<{
          Params: IdParams;
          Body: { amountCents: number; reason: string };
        }>,
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
        const bodyResult = validate(IssueCreditNoteSchema, request.body);
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
        if (!requireFeesAction(request, reply, 'credit_note.issue')) return;
        try {
          const result = await feesService.issueCreditNote(
            tenantId,
            getActorId(request),
            {
              invoiceId: paramsResult.data.id,
              amountCents: bodyResult.data.amountCents,
              reason: bodyResult.data.reason,
            },
            buildMoneyAuditSink(request, tenantId),
          );
          return reply.status(201).send({
            creditNote: {
              ...result.creditNote,
              createdAt: result.creditNote.createdAt.toISOString(),
            },
            invoice: formatInvoice(result.invoice),
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.post(
      `${prefix}/invoices/:id/write-offs`,
      async function writeOffInvoice(
        request: FastifyRequest<{
          Params: IdParams;
          Body: { amountCents: number; reason: string };
        }>,
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
        const bodyResult = validate(WriteOffInvoiceSchema, request.body);
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
        if (!requireFeesAction(request, reply, 'write_off.record')) return;
        try {
          const result = await feesService.writeOffInvoice(
            tenantId,
            getActorId(request),
            {
              invoiceId: paramsResult.data.id,
              amountCents: bodyResult.data.amountCents,
              reason: bodyResult.data.reason,
            },
            buildMoneyAuditSink(request, tenantId),
          );
          return reply.status(201).send({
            writeOff: {
              ...result.writeOff,
              createdAt: result.writeOff.createdAt.toISOString(),
            },
            invoice: formatInvoice(result.invoice),
          });
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/reports/dues`, async function duesReport(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: tenant-wide dues report — staff only.
      if (!requireFeesStaffRead(request, reply)) return;
      const asOfRaw = (request.query as { asOf?: string }).asOf;
      if (asOfRaw !== undefined && !isValidIsoDate(asOfRaw)) {
        return validationFailed(reply, undefined, 'asOf must be an ISO-8601 date');
      }
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
        if (!requireFeesAction(request, reply, 'reconciliation.import')) return;
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
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(
      `${prefix}/reconciliation/batches`,
      async function listReconBatches(request, reply) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        // PRC-C005: reconciliation is a finance-ops surface — staff only.
        if (!requireFeesStaffRead(request, reply)) return;
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
        // PRC-C005: reconciliation rows — staff only.
        if (!requireFeesStaffRead(request, reply)) return;
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
        if (!requireFeesAction(request, reply, 'reconciliation.import')) return;
        try {
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
          return sendFeesError(reply, error);
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
      // PRC-C005: tenant-wide overdue list — staff only.
      if (!requireFeesStaffRead(request, reply)) return;
      const asOfRaw = (request.query as { asOf?: string }).asOf;
      if (asOfRaw !== undefined && !isValidIsoDate(asOfRaw)) {
        return validationFailed(reply, undefined, 'asOf must be an ISO-8601 date');
      }
      const asOf = asOfRaw ? new Date(asOfRaw) : new Date();
      const data = await feesService.listOverdueForReminder(tenantId, asOf);
      return reply.status(200).send({ data, asOf: asOf.toISOString() });
    });

    fastify.get(
      `${prefix}/reminders/suppressions`,
      async function listSuppressions(request, reply) {
        // PRC-C005: reminder suppressions are a staff surface.
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        if (!requireFeesStaffRead(request, reply)) return;
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
        if (!requireFeesAction(request, reply, 'reminder.manage')) return;
        const parsed = validate(AddSuppressionSchema, request.body);
        if (!parsed.success) return validationFailed(reply, parsed.errors);
        const body = parsed.data;
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
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'reminder.manage')) return;
        const params = validate(IdParamsSchema, request.params);
        if (!params.success) return validationFailed(reply, params.errors);
        try {
          await feesService.removeReminderSuppression(tenantId, request.params.id);
          return reply.status(204).send();
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(`${prefix}/reminders/audit`, async function listReminderAudit(request, reply) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-C005: reminder audit trail — staff only.
      if (!requireFeesStaffRead(request, reply)) return;
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
        if (!requireFeesAction(request, reply, 'reminder.manage')) return;
        const parsed = validate(SendRemindersSchema, request.body);
        if (!parsed.success) return validationFailed(reply, parsed.errors);
        const body = parsed.data;
        try {
          const result = await feesService.sendReminders(tenantId, getActorId(request), {
            invoiceIds: body.invoiceIds,
            channels: body.channels,
            minOverdueDays: body.minOverdueDays,
            cadenceDays: body.cadenceDays,
          });
          return reply.status(200).send(result);
        } catch (error: unknown) {
          return sendFeesError(reply, error);
        }
      },
    );

    fastify.get(
      `${prefix}/scholarships/nettable-disbursements`,
      async function listNettableDisbursements(
        request: FastifyRequest<{ Querystring: { studentId?: string } }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        if (!requireFeesAction(request, reply, 'concession.approve')) return;
        if (!scholarshipDisbursements) return scholarshipLookupUnavailable(reply);
        const data = await feesService.listNettableScholarshipDisbursements(
          tenantId,
          scholarshipDisbursements,
          { studentId: request.query?.studentId || undefined },
        );
        return reply.status(200).send({ data });
      },
    );
    fastify.post(
      `${prefix}/scholarships/net`,
      async function netScholarship(
        request: FastifyRequest<{
          Body: {
            studentId: string;
            disbursementId: string;
            amountCents?: number;
            invoiceId?: string;
            currency?: string;
          };
        }>,
        reply: FastifyReply,
      ) {
        const tenantId = getTenantId(request);
        if (!tenantId) return tenantRequired(reply);
        // Netting writes the fee ledger (fees.write, #503) and auto-approves a concession, so it
        // also needs concession.approve (PRC-H020). Both checks are required.
        if (!requireFeesAction(request, reply, 'fees.write')) return;
        if (!requireFeesAction(request, reply, 'concession.approve')) return;
        // PRC-L105: schema-validate ids/amount; amountCents is optional because PRC-H020 derives
        // it from the verified disbursement (a mismatching amount is rejected).
        const parsed = validate(ScholarshipNetSchema, request.body);
        if (!parsed.success) return validationFailed(reply, parsed.errors);
        const body = parsed.data;
        if (!scholarshipDisbursements) return scholarshipLookupUnavailable(reply);
        try {
          const result = await feesService.applyVerifiedScholarshipNetting(
            tenantId,
            getActorId(request),
            scholarshipDisbursements,
            {
              studentId: body.studentId,
              disbursementId: body.disbursementId,
              amountCents: body.amountCents,
              invoiceId: body.invoiceId,
              currency: body.currency,
            },
          );
          return reply.status(200).send(result);
        } catch (error: unknown) {
          return sendFeesError(reply, error);
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
        if (!requireFeesAction(request, reply, 'fees.write')) return;
        const parsed = validate(ClonePeriodSchema, request.body);
        if (!parsed.success) return validationFailed(reply, parsed.errors);
        const body = parsed.data;
        try {
          const result = await feesService.cloneStructuresForPeriod(
            tenantId,
            getActorId(request),
            body.sourcePeriodId,
            body.targetPeriodId,
          );
          return reply.status(201).send(result);
        } catch (error: unknown) {
          return sendFeesError(reply, error);
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
