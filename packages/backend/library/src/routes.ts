/**
 * Library routes — catalog and circulation.
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { LibraryService } from './library-service.js';
import {
  AssessFineSchema,
  BarcodeQuerySchema,
  CheckoutSchema,
  CreateLibraryItemSchema,
  FineParamsSchema,
  FinePolicySchema,
  HoldParamsSchema,
  ImportIsbnSchema,
  IsbnParamsSchema,
  ItemParamsSchema,
  PatronParamsSchema,
  PlaceHoldSchema,
  RenewSchema,
  ReturnBarcodeSchema,
  ReturnSchema,
  type AssessFineInput,
  type BarcodeQuery,
  type CheckoutInput,
  type CreateLibraryItemInput,
  type FineParams,
  type FinePolicyInput,
  type HoldParams,
  type ImportIsbnInput,
  type IsbnParams,
  type ItemParams,
  type OpacSearchQuery,
  type PatronParams,
  type PlaceHoldInput,
  type RenewInput,
  type ReturnBarcodeInput,
  type ReturnInput,
} from './schemas.js';

/**
 * Parent/guardian → child linkage used to bind portal reads of loans and holds
 * to the caller's own children (G-916). Staff principals are never bound.
 */
export interface PatronBinding {
  isLinked(tenantId: string, parentUserId: string, studentId: string): Promise<boolean>;
}

export interface LibraryRoutesOptions {
  libraryService: LibraryService;
  prefix?: string;
  patronBinding?: PatronBinding | null;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

interface JwtUserLike {
  sub?: string;
  userId?: string;
  roles?: Array<{ roleId?: string; roleName?: string } | string>;
}

const PORTAL_PARENT_ROLES = new Set(['parent', 'guardian']);
const PORTAL_STUDENT_ROLES = new Set(['student']);

function roleIds(request: FastifyRequest): string[] {
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  return (user?.roles ?? [])
    .map((role) => (typeof role === 'string' ? role : (role.roleId ?? role.roleName ?? '')))
    .filter(Boolean)
    .map((role) => role.toLowerCase());
}

type PortalScope =
  | { kind: 'staff' }
  | { kind: 'student'; subject: string }
  | { kind: 'parent'; subject: string };

/** Portal-only principals (no staff role) are bound; anyone holding a staff role is not. */
function portalScope(request: FastifyRequest): PortalScope {
  const roles = roleIds(request);
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  const subject = user?.sub ?? user?.userId ?? '';
  const hasStaffRole = roles.some(
    (role) => !PORTAL_PARENT_ROLES.has(role) && !PORTAL_STUDENT_ROLES.has(role),
  );
  if (hasStaffRole || roles.length === 0 || !subject) return { kind: 'staff' };
  if (roles.some((role) => PORTAL_PARENT_ROLES.has(role))) return { kind: 'parent', subject };
  return { kind: 'student', subject };
}

/**
 * Resolves the `studentId` a portal caller may read. Returns `{ studentId }` on
 * success or a reply-ready error. Students are pinned to their JWT subject;
 * parents must name a linked child.
 */
async function bindPatronStudent(
  request: FastifyRequest,
  reply: FastifyReply,
  tenantId: string,
  requested: string | undefined,
  binding: PatronBinding | null,
): Promise<{ studentId: string | undefined } | FastifyReply> {
  const scope = portalScope(request);
  if (scope.kind === 'staff') return { studentId: requested };
  if (scope.kind === 'student') {
    if (requested && requested !== scope.subject) {
      return reply.status(403).send({
        code: 'FORBIDDEN',
        message: 'Students may only read their own loans and holds',
        statusCode: 403,
      });
    }
    return { studentId: scope.subject };
  }
  if (!requested) {
    return reply.status(400).send({
      code: 'VALIDATION_ERROR',
      message: 'studentId is required for parent reads',
      statusCode: 400,
    });
  }
  if (!binding) {
    return reply.status(403).send({
      code: 'FORBIDDEN',
      message: 'Parent library reads are not enabled',
      statusCode: 403,
    });
  }
  const linked = await binding.isLinked(tenantId, scope.subject, requested);
  if (!linked) {
    // 404 (not 403) so an unlinked parent cannot probe which student ids exist.
    return reply.status(404).send({
      code: 'NOT_FOUND',
      message: 'Student not found',
      statusCode: 404,
    });
  }
  return { studentId: requested };
}

function formatItem(entity: {
  id: string;
  tenantId: string;
  isbn: string | null;
  title: string;
  author: string | null;
  copies: number;
  available: number;
  barcode: string | null;
  accessionNo: string | null;
  publisher: string | null;
  publishedYear: number | null;
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
    barcode: entity.barcode,
    accessionNo: entity.accessionNo,
    publisher: entity.publisher,
    publishedYear: entity.publishedYear,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatLoan(entity: {
  id: string;
  tenantId: string;
  itemId: string;
  copyId: string | null;
  barcode: string | null;
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
    copyId: entity.copyId,
    barcode: entity.barcode,
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

function formatCopy(entity: {
  id: string;
  tenantId: string;
  itemId: string;
  barcode: string;
  accessionNo: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    itemId: entity.itemId,
    barcode: entity.barcode,
    accessionNo: entity.accessionNo,
    status: entity.status,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatHold(entity: {
  id: string;
  tenantId: string;
  itemId: string;
  copyId: string | null;
  patronUserId: string | null;
  studentId: string | null;
  position: number;
  status: string;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    itemId: entity.itemId,
    copyId: entity.copyId,
    patronUserId: entity.patronUserId,
    studentId: entity.studentId,
    position: entity.position,
    status: entity.status,
    expiresAt: entity.expiresAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

function formatFine(entity: {
  id: string;
  tenantId: string;
  loanId: string;
  studentId: string;
  amountCents: number;
  currency: string;
  overdueDays: number;
  status: string;
  invoiceId: string | null;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    loanId: entity.loanId,
    studentId: entity.studentId,
    amountCents: entity.amountCents,
    currency: entity.currency,
    overdueDays: entity.overdueDays,
    status: entity.status,
    invoiceId: entity.invoiceId,
    paidAt: entity.paidAt?.toISOString() ?? null,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

export async function registerLibraryRoutes(
  fastify: FastifyInstance,
  options: LibraryRoutesOptions,
): Promise<void> {
  const { libraryService, prefix = '/library', patronBinding = null } = options;

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

      const institutionId =
        typeof (request.query as { institutionId?: string }).institutionId === 'string'
          ? (request.query as { institutionId?: string }).institutionId
          : undefined;
      let items = await libraryService.listItems(tenantId);
      if (institutionId) {
        items = items.filter((item) => {
          const id = (item as { institutionId?: string | null }).institutionId;
          return id == null || id === institutionId;
        });
      }
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

  fastify.post(
    `${prefix}/circulation/renew`,
    async function renewHandler(
      request: FastifyRequest<{ Body: RenewInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RenewSchema, request.body);
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
        const loan = await libraryService.renewLoan(
          tenantId,
          result.data.loanId,
          result.data.extendDays ?? 14,
        );
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
    `${prefix}/loans`,
    async function listLoansHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const studentId =
        typeof (request.query as { studentId?: string }).studentId === 'string'
          ? (request.query as { studentId?: string }).studentId
          : undefined;
      const patronUserId =
        typeof (request.query as { patronUserId?: string }).patronUserId === 'string'
          ? (request.query as { patronUserId?: string }).patronUserId
          : undefined;
      const bound = await bindPatronStudent(request, reply, tenantId, studentId, patronBinding);
      if (!('studentId' in bound)) return bound;
      let loans = await libraryService.listLoans(tenantId, bound.studentId);
      if (patronUserId) {
        loans = loans.filter((loan) => loan.patronUserId === patronUserId);
      }
      return reply.status(200).send({ data: loans.map(formatLoan) });
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

  /**
   * POST /library/fines/assess — compute overdue fine and post to fees ledger (G-603).
   */
  fastify.post(
    `${prefix}/fines/assess`,
    async function assessFineHandler(
      request: FastifyRequest<{ Body: AssessFineInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(AssessFineSchema, request.body);
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

      const actorId =
        (request as FastifyRequest & { user?: { sub?: string } }).user?.sub ?? 'library-system';

      try {
        const assessed = await libraryService.assessFine(tenantId, actorId, result.data);
        return reply.status(201).send({
          loanId: assessed.loanId,
          studentId: assessed.studentId,
          overdueDays: assessed.overdueDays,
          amountCents: assessed.amountCents,
          invoice: assessed.invoice,
          fine: formatFine(assessed.fine),
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
    `${prefix}/fines`,
    async function listFinesHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const studentId =
        typeof (request.query as { studentId?: string }).studentId === 'string'
          ? (request.query as { studentId?: string }).studentId
          : undefined;
      const fines = await libraryService.listFines(tenantId, studentId);
      return reply.status(200).send({ data: fines.map(formatFine) });
    },
  );

  fastify.get(
    `${prefix}/fines/summary`,
    async function finesSummaryHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const studentId = (request.query as { studentId?: string }).studentId;
      if (!studentId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'studentId is required',
          statusCode: 400,
        });
      }
      const summary = await libraryService.summarizeForStudent(tenantId, studentId);
      return reply.status(200).send(summary);
    },
  );

  fastify.get(
    `${prefix}/fines/policy`,
    async function getFinePolicyHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const policy = await libraryService.getFinePolicy(tenantId);
      return reply.status(200).send({
        id: policy.id,
        tenantId: policy.tenantId,
        centsPerDay: policy.centsPerDay,
        capCents: policy.capCents,
        currency: policy.currency,
      });
    },
  );

  fastify.put(
    `${prefix}/fines/policy`,
    async function putFinePolicyHandler(
      request: FastifyRequest<{ Body: FinePolicyInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(FinePolicySchema, request.body);
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
      const policy = await libraryService.upsertFinePolicy(tenantId, result.data);
      return reply.status(200).send({
        id: policy.id,
        tenantId: policy.tenantId,
        centsPerDay: policy.centsPerDay,
        capCents: policy.capCents,
        currency: policy.currency,
      });
    },
  );

  fastify.post(
    `${prefix}/fines/:id/pay`,
    async function payFineHandler(
      request: FastifyRequest<{ Params: FineParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(FineParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid fine ID',
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
        const fine = await libraryService.markFinePaid(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatFine(fine));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/isbn/:isbn`,
    async function isbnLookupHandler(
      request: FastifyRequest<{ Params: IsbnParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(IsbnParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ISBN',
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
        const meta = await libraryService.lookupIsbn(paramsResult.data.isbn);
        return reply.status(200).send(meta);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/items/import-isbn`,
    async function importIsbnHandler(
      request: FastifyRequest<{ Body: ImportIsbnInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(ImportIsbnSchema, request.body);
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
        const item = await libraryService.importFromIsbn(
          tenantId,
          result.data.isbn,
          result.data.copies ?? 1,
        );
        return reply.status(201).send(formatItem(item));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/items/:id`,
    async function getItemHandler(
      request: FastifyRequest<{ Params: ItemParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ItemParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid item ID',
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
        const item = await libraryService.getItem(tenantId, paramsResult.data.id);
        const copies = await libraryService.listCopies(tenantId, item.id);
        const holds = await libraryService.listHolds(tenantId, item.id);
        return reply.status(200).send({
          ...formatItem(item),
          copyList: copies.map(formatCopy),
          holds: holds.map(formatHold),
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
    `${prefix}/opac/search`,
    async function opacSearchHandler(
      request: FastifyRequest<{ Querystring: OpacSearchQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const q = typeof request.query.q === 'string' ? request.query.q : '';
      const items = await libraryService.searchOpac(tenantId, q);
      return reply.status(200).send({ data: items.map(formatItem) });
    },
  );

  fastify.get(
    `${prefix}/copies/by-barcode`,
    async function copyByBarcodeHandler(
      request: FastifyRequest<{ Querystring: BarcodeQuery }>,
      reply: FastifyReply,
    ) {
      const result = validate(BarcodeQuerySchema, request.query);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'barcode is required',
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
        const found = await libraryService.lookupBarcode(tenantId, result.data.barcode);
        return reply.status(200).send({
          copy: formatCopy(found.copy),
          item: found.item ? formatItem(found.item) : null,
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
    `${prefix}/circulation/return-barcode`,
    async function returnBarcodeHandler(
      request: FastifyRequest<{ Body: ReturnBarcodeInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(ReturnBarcodeSchema, request.body);
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
        const loan = await libraryService.returnByBarcode(tenantId, result.data.barcode);
        return reply.status(200).send(formatLoan(loan));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/holds`,
    async function placeHoldHandler(
      request: FastifyRequest<{ Body: PlaceHoldInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(PlaceHoldSchema, request.body);
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
        const hold = await libraryService.placeHold(tenantId, result.data);
        return reply.status(201).send(formatHold(hold));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/holds`,
    async function listHoldsHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = getTenantId(request);
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      const itemId =
        typeof (request.query as { itemId?: string }).itemId === 'string'
          ? (request.query as { itemId?: string }).itemId
          : undefined;
      const studentId =
        typeof (request.query as { studentId?: string }).studentId === 'string'
          ? (request.query as { studentId?: string }).studentId
          : undefined;
      const patronUserId =
        typeof (request.query as { patronUserId?: string }).patronUserId === 'string'
          ? (request.query as { patronUserId?: string }).patronUserId
          : undefined;
      const bound = await bindPatronStudent(request, reply, tenantId, studentId, patronBinding);
      if (!('studentId' in bound)) return bound;
      let holds = await libraryService.listHolds(tenantId, itemId);
      if (bound.studentId) {
        const boundStudentId = bound.studentId;
        holds = holds.filter((h) => h.studentId === boundStudentId);
      }
      if (patronUserId) {
        holds = holds.filter((h) => h.patronUserId === patronUserId);
      }
      return reply.status(200).send({ data: holds.map(formatHold) });
    },
  );

  fastify.post(
    `${prefix}/holds/:id/cancel`,
    async function cancelHoldHandler(
      request: FastifyRequest<{ Params: HoldParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(HoldParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid hold ID',
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
        const hold = await libraryService.cancelHold(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatHold(hold));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
