/**
 * Parent portal routes — child links, messaging, consents, fees.
 */
import { getActor } from '@proctira/backend-auth';
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import type { ParentPortalService } from './parent-portal-service.js';
import type { AdmissionsOffersPort } from './admissions-offers-port.js';
import {
  AddMessageSchema,
  ConsentParamsSchema,
  CreateConsentSchema,
  CreateFeePlanSchema,
  CreateInvoiceSchema,
  CreateThreadSchema,
  DecideConsentSchema,
  InvoiceParamsSchema,
  LinkChildSchema,
  PayInvoiceSchema,
  ReceiptParamsSchema,
  ThreadParamsSchema,
  ChildParamsSchema,
  OfferParamsSchema,
  AcceptGuardianOfferSchema,
  type AddMessageInput,
  type CreateConsentInput,
  type CreateFeePlanInput,
  type CreateInvoiceInput,
  type CreateThreadInput,
  type DecideConsentInput,
  type LinkChildInput,
  type PayInvoiceInput,
  type ThreadParams,
  type ConsentParams,
  type InvoiceParams,
  type ReceiptParams,
  type ChildParams,
  type OfferParams,
  type AcceptGuardianOfferInput,
} from './schemas.js';

export interface ParentPortalRoutesOptions {
  parentPortalService: ParentPortalService;
  admissionsOffers?: AdmissionsOffersPort;
  prefix?: string;
  studentPrefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/** Actor from verified JWT only (G-102 / G-306 — never trust x-user-id headers). */
function getActorId(request: FastifyRequest): string {
  const actor = getActor(request);
  return actor.userId || 'anonymous';
}

function formatLink(entity: {
  id: string;
  tenantId: string;
  parentUserId: string;
  studentId: string;
  relationship: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    parentUserId: entity.parentUserId,
    studentId: entity.studentId,
    relationship: entity.relationship,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatThread(entity: {
  id: string;
  tenantId: string;
  studentId: string;
  subject: string;
  createdBy: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    subject: entity.subject,
    createdBy: entity.createdBy,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatMessage(entity: {
  id: string;
  threadId: string;
  tenantId: string;
  senderUserId: string;
  senderRole: string;
  body: string;
  createdAt: Date;
}) {
  return {
    id: entity.id,
    threadId: entity.threadId,
    tenantId: entity.tenantId,
    senderUserId: entity.senderUserId,
    senderRole: entity.senderRole,
    body: entity.body,
    createdAt: entity.createdAt.toISOString(),
  };
}

function formatConsent(entity: {
  id: string;
  tenantId: string;
  studentId: string;
  parentUserId: string;
  consentType: string;
  title: string;
  description: string;
  status: string;
  decidedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    parentUserId: entity.parentUserId,
    consentType: entity.consentType,
    title: entity.title,
    description: entity.description,
    status: entity.status,
    decidedAt: entity.decidedAt?.toISOString() ?? null,
    createdBy: entity.createdBy,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
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

export async function registerParentPortalRoutes(
  fastify: FastifyInstance,
  options: ParentPortalRoutesOptions,
): Promise<void> {
  const {
    parentPortalService,
    admissionsOffers,
    prefix = '/parent-portal',
    studentPrefix = '/student-portal',
  } = options;

  fastify.get(
    `${prefix}/children`,
    async function listChildrenHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const parentUserId = getActorId(request);
      const children = await parentPortalService.listChildrenForParent(tenantId, parentUserId);
      return reply.status(200).send({ data: children.map(formatLink) });
    },
  );

  fastify.post(
    `${prefix}/children/links`,
    async function linkChildHandler(
      request: FastifyRequest<{ Body: LinkChildInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(LinkChildSchema, request.body);
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

      // G-306: parent identity from JWT only — ignore forgeable body.parentUserId.
      const parentUserId = getActorId(request);

      try {
        const link = await parentPortalService.linkChild(tenantId, parentUserId, result.data);
        return reply.status(201).send(formatLink(link));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/messages/threads`,
    async function listThreadsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const parentUserId = getActorId(request);
      const threads = await parentPortalService.listThreadsForParent(tenantId, parentUserId);
      return reply.status(200).send({ data: threads.map(formatThread) });
    },
  );

  fastify.post(
    `${prefix}/messages/threads`,
    async function createThreadHandler(
      request: FastifyRequest<{ Body: CreateThreadInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateThreadSchema, request.body);
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

      const parentUserId = getActorId(request);

      try {
        const { thread, message } = await parentPortalService.createThread(
          tenantId,
          parentUserId,
          result.data,
        );
        return reply.status(201).send({
          thread: formatThread(thread),
          message: formatMessage(message),
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
    `${prefix}/messages/threads/:threadId/messages`,
    async function listMessagesHandler(
      request: FastifyRequest<{ Params: ThreadParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ThreadParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid thread ID',
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

      const parentUserId = getActorId(request);

      try {
        const messages = await parentPortalService.listMessages(
          tenantId,
          parentUserId,
          paramsResult.data.threadId,
        );
        return reply.status(200).send({ data: messages.map(formatMessage) });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/messages/threads/:threadId/messages`,
    async function addMessageHandler(
      request: FastifyRequest<{ Params: ThreadParams; Body: AddMessageInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ThreadParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid thread ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(AddMessageSchema, request.body);
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

      const parentUserId = getActorId(request);

      try {
        const message = await parentPortalService.addMessage(
          tenantId,
          parentUserId,
          paramsResult.data.threadId,
          bodyResult.data.body,
          bodyResult.data.senderRole ?? 'parent',
        );
        return reply.status(201).send(formatMessage(message));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/consents`,
    async function listConsentsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const parentUserId = getActorId(request);
      const consents = await parentPortalService.listConsentsForParent(tenantId, parentUserId);
      return reply.status(200).send({ data: consents.map(formatConsent) });
    },
  );

  fastify.post(
    `${prefix}/consents`,
    async function createConsentHandler(
      request: FastifyRequest<{ Body: CreateConsentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateConsentSchema, request.body);
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

      const actorId = getActorId(request);

      try {
        const consent = await parentPortalService.createConsentRequest(
          tenantId,
          actorId,
          result.data,
        );
        return reply.status(201).send(formatConsent(consent));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/consents/:id/decide`,
    async function decideConsentHandler(
      request: FastifyRequest<{ Params: ConsentParams; Body: DecideConsentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ConsentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid consent ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(DecideConsentSchema, request.body);
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

      const parentUserId = getActorId(request);

      try {
        const consent = await parentPortalService.decideConsent(
          tenantId,
          parentUserId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatConsent(consent));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/fees/plans`,
    async function listFeePlansHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const plans = await parentPortalService.listFeePlans(tenantId);
      return reply.status(200).send({ data: plans.map(formatPlan) });
    },
  );

  fastify.post(
    `${prefix}/fees/plans`,
    async function createFeePlanHandler(
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
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const actorId = getActorId(request);

      try {
        const plan = await parentPortalService.createFeePlan(tenantId, actorId, result.data);
        return reply.status(201).send(formatPlan(plan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/fees/invoices`,
    async function listInvoicesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const scope = String(
        (request.query as { scope?: string } | undefined)?.scope ?? 'parent',
      ).toLowerCase();

      if (scope === 'staff') {
        const invoices = await parentPortalService.listInvoicesForStaff(tenantId);
        return reply.status(200).send({ data: invoices.map(formatInvoice) });
      }

      const parentUserId = getActorId(request);
      const invoices = await parentPortalService.listInvoicesForParent(tenantId, parentUserId);
      return reply.status(200).send({ data: invoices.map(formatInvoice) });
    },
  );

  fastify.post(
    `${prefix}/fees/invoices`,
    async function createInvoiceHandler(
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
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const actorId = getActorId(request);

      try {
        const invoice = await parentPortalService.createInvoice(tenantId, actorId, result.data);
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
    `${prefix}/fees/invoices/:id/void`,
    async function voidInvoiceHandler(
      request: FastifyRequest<{ Params: InvoiceParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InvoiceParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid invoice ID',
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
        const invoice = await parentPortalService.voidInvoice(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatInvoice(invoice));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/fees/payments`,
    async function listPaymentsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const payments = await parentPortalService.listPaymentsForStaff(tenantId);
      return reply.status(200).send({ data: payments.map(formatPayment) });
    },
  );

  fastify.get(
    `${prefix}/fees/receipts`,
    async function listReceiptsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const scope = String(
        (request.query as { scope?: string } | undefined)?.scope ?? 'parent',
      ).toLowerCase();

      if (scope === 'staff') {
        const receipts = await parentPortalService.listReceiptsForStaff(tenantId);
        return reply.status(200).send({ data: receipts.map(formatReceipt) });
      }

      const parentUserId = getActorId(request);
      const receipts = await parentPortalService.listReceiptsForParent(tenantId, parentUserId);
      return reply.status(200).send({ data: receipts.map(formatReceipt) });
    },
  );

  fastify.get(
    `${prefix}/fees/receipts/:id`,
    async function getReceiptHandler(
      request: FastifyRequest<{ Params: ReceiptParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ReceiptParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid receipt ID',
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
        const receipt = await parentPortalService.getReceipt(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatReceipt(receipt));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/fees/invoices/:id/pay`,
    async function payInvoiceHandler(
      request: FastifyRequest<{ Params: InvoiceParams; Body: PayInvoiceInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(InvoiceParamsSchema, request.params);
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
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const parentUserId = getActorId(request);

      try {
        const { invoice, payment, receipt } = await parentPortalService.payInvoice(
          tenantId,
          parentUserId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send({
          invoice: formatInvoice(invoice),
          payment: formatPayment(payment),
          receipt: formatReceipt(receipt),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  function actorEmail(request: FastifyRequest): string | null {
    const user = (request as FastifyRequest & { user?: { email?: string } }).user;
    return typeof user?.email === 'string' ? user.email : null;
  }

  async function requireTenant(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<string | null> {
    const tenantId = getTenantId(request);
    if (!tenantId) {
      await reply.status(400).send({
        code: 'TENANT_REQUIRED',
        message: 'Tenant context is required',
        statusCode: 400,
      });
      return null;
    }
    return tenantId;
  }

  async function sendOrAppError(reply: FastifyReply, run: () => Promise<unknown>) {
    try {
      const payload = await run();
      return reply.status(200).send(payload);
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send(error.toJSON());
      }
      throw error;
    }
  }

  // A2 — guardian offer-pay (sandbox honesty; scopes by JWT email ↔ guardianEmail)
  fastify.get(`${prefix}/offers`, async (request, reply) => {
    const tenantId = await requireTenant(request, reply);
    if (!tenantId) return;
    if (!admissionsOffers) {
      return reply.status(503).send({
        code: 'OFFERS_UNAVAILABLE',
        message: 'Admission offers are not configured for the family portal',
        statusCode: 503,
      });
    }
    const email = actorEmail(request);
    if (!email) {
      return reply.status(400).send({
        code: 'EMAIL_REQUIRED',
        message: 'A verified email on your account is required to view admission offers',
        statusCode: 400,
      });
    }
    return sendOrAppError(reply, async () => ({
      data: await admissionsOffers.listGuardianOffers(tenantId, email),
    }));
  });

  fastify.post(
    `${prefix}/offers/:id/accept`,
    async (
      request: FastifyRequest<{ Params: OfferParams; Body: AcceptGuardianOfferInput }>,
      reply: FastifyReply,
    ) => {
      const tenantId = await requireTenant(request, reply);
      if (!tenantId) return;
      if (!admissionsOffers) {
        return reply.status(503).send({
          code: 'OFFERS_UNAVAILABLE',
          message: 'Admission offers are not configured for the family portal',
          statusCode: 503,
        });
      }
      const params = validate(OfferParamsSchema, request.params);
      const body = validate(AcceptGuardianOfferSchema, request.body);
      if (!params.success || !body.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid offer accept',
          statusCode: 400,
          errors: [...(params.success ? [] : params.errors), ...(body.success ? [] : body.errors)],
        });
      }
      const email = actorEmail(request);
      if (!email) {
        return reply.status(400).send({
          code: 'EMAIL_REQUIRED',
          message: 'A verified email on your account is required to accept an offer',
          statusCode: 400,
        });
      }
      return sendOrAppError(reply, () =>
        admissionsOffers.acceptOfferForGuardian(tenantId, params.data.id, email, body.data),
      );
    },
  );

  const childViews = [
    {
      path: 'attendance',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildAttendance(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfAttendance(tenantId, actor),
    },
    {
      path: 'grades',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildGrades(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfGrades(tenantId, actor),
    },
    {
      path: 'report-cards',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildReportCards(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfReportCards(tenantId, actor),
    },
    {
      path: 'lms',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildLms(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfLms(tenantId, actor),
    },
    {
      path: 'pal',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildPalPlan(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfPalPlan(tenantId, actor),
    },
    {
      path: 'timetable',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildTimetable(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfTimetable(tenantId, actor),
    },
    {
      path: 'homework',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildHomework(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfHomework(tenantId, actor),
    },
    {
      path: 'calendar',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildCalendar(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfCalendar(tenantId, actor),
    },
    {
      path: 'notices',
      parent: (tenantId: string, parentUserId: string, studentId: string) =>
        parentPortalService.getChildNotices(tenantId, parentUserId, studentId),
      self: (tenantId: string, actor: { userId: string; email?: string | null }) =>
        parentPortalService.getSelfNotices(tenantId, actor),
    },
  ] as const;

  for (const view of childViews) {
    fastify.get(
      `${prefix}/children/:studentId/${view.path}`,
      async (request: FastifyRequest<{ Params: ChildParams }>, reply: FastifyReply) => {
        const paramsResult = validate(ChildParamsSchema, request.params);
        if (!paramsResult.success) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'Invalid student ID',
            statusCode: 400,
            errors: paramsResult.errors,
          });
        }
        const tenantId = await requireTenant(request, reply);
        if (!tenantId) return;
        const parentUserId = getActorId(request);
        return sendOrAppError(reply, () =>
          view.parent(tenantId, parentUserId, paramsResult.data.studentId),
        );
      },
    );

    fastify.get(`${studentPrefix}/me/${view.path}`, async (request, reply) => {
      const tenantId = await requireTenant(request, reply);
      if (!tenantId) return;
      const actor = { userId: getActorId(request), email: actorEmail(request) };
      return sendOrAppError(reply, () => view.self(tenantId, actor));
    });
  }
}
