/**
 * Staff / HR routes (G-918).
 *
 * GET/POST  /staff/contracts
 * GET/PATCH /staff/contracts/:id
 * GET/POST  /staff/qualifications
 * POST      /staff/qualifications/:id/verify
 * GET/POST  /staff/attendance
 * POST      /staff/attendance/bulk
 * GET       /staff/attendance/summary
 * POST      /staff/import/dry-run
 * POST      /staff/import/commit
 * GET       /staff/payroll/export
 */
import { AppError } from '@proctira/common';
import { validate, validateQuery } from '@proctira/validation';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

import {
  AttendanceListQuerySchema,
  AttendanceSummaryQuerySchema,
  BulkAttendanceSchema,
  ContractListQuerySchema,
  ContractParamsSchema,
  CreateContractSchema,
  CreateQualificationSchema,
  MarkAttendanceSchema,
  pageMeta,
  PayrollExportQuerySchema,
  QualificationListQuerySchema,
  QualificationParamsSchema,
  StaffImportSchema,
  toPageWindow,
  UpdateContractSchema,
  VerifyQualificationSchema,
  type AttendanceListQuery,
  type AttendanceSummaryQuery,
  type BulkAttendanceInput,
  type ContractListQuery,
  type ContractParams,
  type CreateContractInput,
  type CreateQualificationInput,
  type MarkAttendanceInput,
  type PayrollExportQuery,
  type QualificationListQuery,
  type QualificationParams,
  type StaffImportInput,
  type UpdateContractInput,
  type VerifyQualificationInput,
} from './hr-schemas.js';
import type { StaffHrService } from './hr-service.js';
import { staffHrActionFor } from './staff-access.js';
import {
  assertStaffWritableOr404,
  callerInstitutionScope,
  requireStaffAction,
} from './staff-http-guard.js';
import type { StaffService } from './staff-service.js';

export interface StaffHrRoutesOptions {
  hrService: StaffHrService;
  /** PRC-H090: used to enforce school-scope on HR writes (contracts/qualifications/attendance). */
  staffService: StaffService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

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

function iso(value: Date): string {
  return value.toISOString();
}

function formatContract(entity: {
  id: string;
  tenantId: string;
  staffId: string;
  contractType: string;
  startDate: string;
  endDate: string | null;
  salaryBand: string;
  status: string;
  notes: string | null;
  renewalAlert: boolean;
  daysUntilEnd: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    staffId: entity.staffId,
    contractType: entity.contractType,
    startDate: entity.startDate,
    endDate: entity.endDate,
    salaryBand: entity.salaryBand,
    status: entity.status,
    notes: entity.notes,
    renewalAlert: entity.renewalAlert,
    daysUntilEnd: entity.daysUntilEnd,
    createdAt: iso(entity.createdAt),
    updatedAt: iso(entity.updatedAt),
  };
}

function formatQualification(entity: {
  id: string;
  tenantId: string;
  staffId: string;
  degree: string;
  institution: string;
  year: number;
  verified: boolean;
  documentRef: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    staffId: entity.staffId,
    degree: entity.degree,
    institution: entity.institution,
    year: entity.year,
    verified: entity.verified,
    documentRef: entity.documentRef,
    createdAt: iso(entity.createdAt),
    updatedAt: iso(entity.updatedAt),
  };
}

function formatAttendance(entity: {
  id: string;
  tenantId: string;
  staffId: string;
  date: string;
  status: string;
  notes: string | null;
  markedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    staffId: entity.staffId,
    date: entity.date,
    status: entity.status,
    notes: entity.notes,
    markedBy: entity.markedBy,
    createdAt: iso(entity.createdAt),
    updatedAt: iso(entity.updatedAt),
  };
}

export async function registerStaffHrRoutes(
  fastify: FastifyInstance,
  options: StaffHrRoutesOptions,
): Promise<void> {
  const { hrService, staffService, prefix = '/staff' } = options;

  // PRC-H088: every HR route (reads included) is domain-gated. The old hook returned early for
  // GET, so GET /payroll/export — which persists/reverses payroll runs — never asserted
  // payroll.export, and salary/qualification/attendance reads had no domain role check.
  // Scoped to this encapsulated HR route module only (see staff-plugin.ts).
  fastify.addHook('preHandler', async (request, reply) => {
    // Classify by the *matched route pattern*, not the raw request target: Fastify routes on the
    // percent-decoded path, so `/staff/%70ayroll/export` reaches the payroll handler while a regex
    // over request.url would see no "payroll" segment and downgrade the check.
    const routePath = request.routeOptions.url ?? request.url;
    const action = staffHrActionFor(request.method, routePath, prefix);
    requireStaffAction(request, reply, action);
  });

  fastify.get(
    `${prefix}/contracts`,
    async function listContractsHandler(
      request: FastifyRequest<{ Querystring: ContractListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-M379: invalid query -> 400 (never "return everything"); bounded pages.
      const query = validateQuery(ContractListQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: query.errors,
        });
      }
      const w = toPageWindow(query.data);
      const { rows, total } = await hrService.listContractsPage(tenantId, query.data.staffId, w);
      return reply
        .status(200)
        .send({ data: rows.map(formatContract), meta: pageMeta(w.page, w.pageSize, total) });
    },
  );

  fastify.post(
    `${prefix}/contracts`,
    async function createContractHandler(
      request: FastifyRequest<{ Body: CreateContractInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateContractSchema, request.body);
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
        // PRC-H090: contract writes are scoped to the caller's institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            result.data.staffId,
          ))
        )
          return reply;
        const row = await hrService.createContract(tenantId, result.data);
        return reply.status(201).send(formatContract(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/contracts/:id`,
    async function getContractHandler(
      request: FastifyRequest<{ Params: ContractParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ContractParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid contract ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      try {
        const row = await hrService.getContract(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatContract(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.patch(
    `${prefix}/contracts/:id`,
    async function updateContractHandler(
      request: FastifyRequest<{ Params: ContractParams; Body: UpdateContractInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ContractParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid contract ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(UpdateContractSchema, request.body);
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
        // PRC-H090: resolve the contract's staff and enforce school scope before updating.
        const existing = await hrService.getContract(tenantId, paramsResult.data.id);
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            existing.staffId,
          ))
        )
          return reply;
        const row = await hrService.updateContract(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send(formatContract(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/qualifications`,
    async function listQualificationsHandler(
      request: FastifyRequest<{ Querystring: QualificationListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const query = validateQuery(QualificationListQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: query.errors,
        });
      }
      const w = toPageWindow(query.data);
      const { rows, total } = await hrService.listQualificationsPage(
        tenantId,
        query.data.staffId,
        w,
      );
      return reply
        .status(200)
        .send({ data: rows.map(formatQualification), meta: pageMeta(w.page, w.pageSize, total) });
    },
  );

  fastify.post(
    `${prefix}/qualifications`,
    async function createQualificationHandler(
      request: FastifyRequest<{ Body: CreateQualificationInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateQualificationSchema, request.body);
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
        // PRC-H090: qualification writes are scoped to the caller's institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            result.data.staffId,
          ))
        )
          return reply;
        const row = await hrService.createQualification(tenantId, result.data);
        return reply.status(201).send(formatQualification(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/qualifications/:id/verify`,
    async function verifyQualificationHandler(
      request: FastifyRequest<{ Params: QualificationParams; Body: VerifyQualificationInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(QualificationParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid qualification ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }
      const bodyResult = validate(VerifyQualificationSchema, request.body);
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
        // PRC-H090: resolve the qualification's staff and enforce school scope.
        const existing = await hrService.getQualification(tenantId, paramsResult.data.id);
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            existing.staffId,
          ))
        )
          return reply;
        const row = await hrService.verifyQualification(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatQualification(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/attendance/summary`,
    async function attendanceSummaryHandler(
      request: FastifyRequest<{ Querystring: AttendanceSummaryQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const result = validate(AttendanceSummaryQuerySchema, request.query ?? {});
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'month query (YYYY-MM) is required',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const rows = await hrService.attendanceSummary(tenantId, result.data);
      return reply.status(200).send({ data: rows });
    },
  );

  fastify.get(
    `${prefix}/attendance`,
    async function listAttendanceHandler(
      request: FastifyRequest<{ Querystring: AttendanceListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      const query = validateQuery(AttendanceListQuerySchema, request.query ?? {});
      if (!query.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: query.errors,
        });
      }
      const { date, staffId, from, to } = query.data;
      const filter = { date, staffId, from, to };
      const w = toPageWindow(query.data);
      const { rows, total } = await hrService.listAttendancePage(tenantId, filter, w);
      return reply
        .status(200)
        .send({ data: rows.map(formatAttendance), meta: pageMeta(w.page, w.pageSize, total) });
    },
  );

  fastify.post(
    `${prefix}/attendance`,
    async function markAttendanceHandler(
      request: FastifyRequest<{ Body: MarkAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(MarkAttendanceSchema, request.body);
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
        // PRC-H090: attendance writes are scoped to the caller's institution(s).
        if (
          !(await assertStaffWritableOr404(
            request,
            reply,
            staffService,
            tenantId,
            result.data.staffId,
          ))
        )
          return reply;
        const row = await hrService.markAttendance(tenantId, result.data, getActorId(request));
        return reply.status(201).send(formatAttendance(row));
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/attendance/bulk`,
    async function bulkAttendanceHandler(
      request: FastifyRequest<{ Body: BulkAttendanceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(BulkAttendanceSchema, request.body);
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
        // PRC-H090: every staff member in the batch must be in the caller's institution(s).
        for (const staffId of new Set(result.data.marks.map((m) => m.staffId))) {
          if (!(await assertStaffWritableOr404(request, reply, staffService, tenantId, staffId)))
            return reply;
        }
        const rows = await hrService.markAttendanceBulk(tenantId, result.data, getActorId(request));
        return reply.status(200).send({ data: rows.map(formatAttendance) });
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.post(
    `${prefix}/import/dry-run`,
    async function importDryRunHandler(
      request: FastifyRequest<{ Body: StaffImportInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(StaffImportSchema, request.body);
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
      return reply.status(200).send(hrService.dryRunImport(result.data));
    },
  );

  fastify.post(
    `${prefix}/import/commit`,
    async function importCommitHandler(
      request: FastifyRequest<{ Body: StaffImportInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(StaffImportSchema, request.body);
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
        const report = await hrService.commitImport(tenantId, result.data);
        return reply.status(200).send(report);
      } catch (error: unknown) {
        if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
        throw error;
      }
    },
  );

  fastify.get(
    `${prefix}/payroll/export`,
    // PRC-H088: this GET persists (and with ?replace=true reverses) payroll runs, so do not let
    // Fastify's auto-HEAD route re-run it. Moving persistence to a POST is a tracked follow-up.
    { exposeHeadRoute: false },
    async function payrollExportHandler(
      request: FastifyRequest<{ Querystring: PayrollExportQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = getTenantId(request);
      if (!tenantId) return tenantRequired(reply);
      // PRC-H090: payroll export persists/reverses a tenant-wide run (every staff row, no
      // per-institution scope on this endpoint). A school-bound caller cannot be scoped at row
      // level here, so deny it (fail closed). Tenant-wide/board admins proceed.
      if (callerInstitutionScope(request) !== undefined) {
        return reply.status(403).send({
          code: 'FORBIDDEN',
          message: 'Payroll export is tenant-wide and not available to school-scoped roles',
          statusCode: 403,
        });
      }
      const result = validate(PayrollExportQuerySchema, request.query ?? {});
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'month query (YYYY-MM) is required',
          statusCode: 400,
          errors: result.errors,
        });
      }
      const exportResult = await hrService.exportPayroll(tenantId, result.data);
      return reply.status(200).send(exportResult);
    },
  );
}
