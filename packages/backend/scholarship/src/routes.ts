/**
 * Scholarship Routes
 *
 * Programs:
 *   POST   /scholarships/programs           - Create a scholarship program
 *   PUT    /scholarships/programs/:id       - Update a scholarship program
 *   GET    /scholarships/programs           - List scholarship programs
 *   GET    /scholarships/programs/:id       - Get a scholarship program
 *   DELETE /scholarships/programs/:id       - Delete a scholarship program
 *
 * Applications:
 *   POST   /scholarships/applications       - Submit an application
 *   GET    /scholarships/applications       - List applications
 *   GET    /scholarships/applications/:id   - Get an application
 *   POST   /scholarships/applications/:id/approve - Approve an application
 *   POST   /scholarships/applications/:id/reject  - Reject an application
 *
 * Disbursements:
 *   POST   /scholarships/disbursements      - Create a disbursement
 *   PUT    /scholarships/disbursements/:id  - Update disbursement status
 *   GET    /scholarships/disbursements      - List disbursements
 *   GET    /scholarships/applications/:id/disbursements - List disbursements for application
 *
 * Compliance:
 *   POST   /scholarships/compliance         - Record compliance
 *   GET    /scholarships/applications/:id/compliance - Get compliance records
 *
 * Reports:
 *   GET    /scholarships/reports/utilization - Get utilization report
 *
 * Requirements: 11.1, 11.2, 11.3, 11.4, 11.5
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ScholarshipService } from './scholarship-service.js';
import {
  CreateScholarshipProgramSchema,
  UpdateScholarshipProgramSchema,
  CreateApplicationSchema,
  CreateDisbursementSchema,
  UpdateDisbursementSchema,
  RecipientComplianceSchema,
  UtilizationReportQuerySchema,
  ScholarshipParamsSchema,
  ScholarshipListQuerySchema,
  UploadScholarshipDocumentSchema,
  type CreateScholarshipProgramInput,
  type UpdateScholarshipProgramInput,
  type CreateApplicationInput,
  type CreateDisbursementInput,
  type UpdateDisbursementInput,
  type RecipientComplianceInput,
  type UtilizationReportQuery,
  type ScholarshipParams,
  type ScholarshipListQuery,
  type UploadScholarshipDocumentInput,
} from './schemas.js';
import {
  defaultScholarshipDocumentStore,
  type ScholarshipDocumentStore,
} from './document-store.js';

/**
 * Options for registering scholarship routes.
 */
export interface ScholarshipRoutesOptions {
  scholarshipService: ScholarshipService;
  /** Route prefix (default: '/scholarships') */
  prefix?: string;
  /** Optional document store override (defaults to in-memory). */
  documentStore?: ScholarshipDocumentStore;
}

/**
 * Helper to extract tenant ID from request.
 */
function getTenantId(request: FastifyRequest): string | null {
  return (request as FastifyRequest & { tenantId?: string }).tenantId ?? null;
}

/**
 * Format date fields for response.
 */
function formatDate(date: Date | null): string | null {
  return date ? date.toISOString() : null;
}

/**
 * Register scholarship routes on a Fastify instance.
 */
export async function registerScholarshipRoutes(
  fastify: FastifyInstance,
  options: ScholarshipRoutesOptions,
): Promise<void> {
  const {
    scholarshipService,
    prefix = '/scholarships',
    documentStore = defaultScholarshipDocumentStore,
  } = options;

  // ─── Document upload ───────────────────────────────────────────────────

  /**
   * POST /scholarships/documents
   * Upload a supporting document (JSON base64 or multipart form fields).
   * Returns metadata suitable for the application `documents[]` array.
   */
  fastify.post(
    `${prefix}/documents`,
    async function uploadDocumentHandler(
      request: FastifyRequest,
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

      let payload: unknown = request.body;
      const contentType = String(request.headers['content-type'] ?? '');
      if (contentType.includes('multipart/form-data') && payload && typeof payload === 'object') {
        // When @fastify/multipart (or a gateway pre-parser) materialises fields
        // onto the body, accept them directly. Otherwise clients should use the
        // JSON + contentBase64 contract below.
        const raw = payload as Record<string, unknown>;
        payload = {
          documentType: raw['documentType'] ?? raw['document_type'],
          fileName: raw['fileName'] ?? raw['file_name'] ?? raw['filename'],
          contentBase64: raw['contentBase64'] ?? raw['content'] ?? raw['file'],
          mimeType: raw['mimeType'] ?? raw['mime_type'] ?? raw['contentType'],
          fileSize:
            typeof raw['fileSize'] === 'number'
              ? raw['fileSize']
              : typeof raw['file_size'] === 'number'
                ? raw['file_size']
                : undefined,
        };
      }

      const result = validate(UploadScholarshipDocumentSchema, payload);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const data = result.data as UploadScholarshipDocumentInput;
      let content: Buffer;
      try {
        content = Buffer.from(data.contentBase64, 'base64');
      } catch {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'contentBase64 is not valid base64',
          statusCode: 400,
        });
      }
      if (content.byteLength === 0) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Uploaded document is empty',
          statusCode: 400,
        });
      }
      // Soft cap ~10 MiB to keep gateway memory bounded.
      if (content.byteLength > 10 * 1024 * 1024) {
        return reply.status(413).send({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Document exceeds the 10 MiB limit',
          statusCode: 413,
        });
      }

      const stored = await documentStore.put({
        tenantId,
        documentType: data.documentType,
        fileName: data.fileName,
        mimeType: data.mimeType,
        content,
      });

      return reply.status(201).send({
        id: stored.id,
        documentType: stored.documentType,
        fileName: stored.fileName,
        fileUrl: stored.fileUrl,
        fileSize: stored.fileSize,
        mimeType: stored.mimeType,
        createdAt: stored.createdAt.toISOString(),
      });
    },
  );

  /**
   * POST /scholarships/applications/:id/documents
   * Upload a document and attach its metadata to an existing application.
   */
  fastify.post(
    `${prefix}/applications/:id/documents`,
    async function uploadApplicationDocumentHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid application ID',
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

      let payload: unknown = request.body;
      const contentType = String(request.headers['content-type'] ?? '');
      if (contentType.includes('multipart/form-data') && payload && typeof payload === 'object') {
        const raw = payload as Record<string, unknown>;
        payload = {
          documentType: raw['documentType'] ?? raw['document_type'],
          fileName: raw['fileName'] ?? raw['file_name'] ?? raw['filename'],
          contentBase64: raw['contentBase64'] ?? raw['content'] ?? raw['file'],
          mimeType: raw['mimeType'] ?? raw['mime_type'] ?? raw['contentType'],
          fileSize:
            typeof raw['fileSize'] === 'number'
              ? raw['fileSize']
              : typeof raw['file_size'] === 'number'
                ? raw['file_size']
                : undefined,
        };
      }

      const result = validate(UploadScholarshipDocumentSchema, payload);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const data = result.data as UploadScholarshipDocumentInput;
      let content: Buffer;
      try {
        content = Buffer.from(data.contentBase64, 'base64');
      } catch {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'contentBase64 is not valid base64',
          statusCode: 400,
        });
      }
      if (content.byteLength === 0) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Uploaded document is empty',
          statusCode: 400,
        });
      }
      if (content.byteLength > 10 * 1024 * 1024) {
        return reply.status(413).send({
          code: 'PAYLOAD_TOO_LARGE',
          message: 'Document exceeds the 10 MiB limit',
          statusCode: 413,
        });
      }

      try {
        const stored = await documentStore.put({
          tenantId,
          documentType: data.documentType,
          fileName: data.fileName,
          mimeType: data.mimeType,
          content,
        });

        const application = await scholarshipService.attachApplicationDocument(
          tenantId,
          paramsResult.data.id,
          {
            documentType: stored.documentType,
            fileName: stored.fileName,
            fileUrl: stored.fileUrl,
            fileSize: stored.fileSize,
          },
        );

        return reply.status(201).send({
          document: {
            id: stored.id,
            documentType: stored.documentType,
            fileName: stored.fileName,
            fileUrl: stored.fileUrl,
            fileSize: stored.fileSize,
            mimeType: stored.mimeType,
            createdAt: stored.createdAt.toISOString(),
          },
          application: {
            ...application,
            submittedAt: application.submittedAt.toISOString(),
            reviewedAt: formatDate(application.reviewedAt),
            createdAt: application.createdAt.toISOString(),
            updatedAt: application.updatedAt.toISOString(),
          },
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /scholarships/documents/:id
   * Fetch a previously uploaded document (bytes) for the current tenant.
   */
  fastify.get(
    `${prefix}/documents/:id`,
    async function getDocumentHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid document ID',
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

      const stored = await documentStore.get(paramsResult.data.id, tenantId);
      if (!stored) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: 'Document not found',
          statusCode: 404,
        });
      }

      return reply
        .status(200)
        .header('content-type', stored.mimeType)
        .header(
          'content-disposition',
          `attachment; filename="${stored.fileName.replace(/"/g, '')}"`,
        )
        .send(stored.content);
    },
  );

  // ─── Program Routes ────────────────────────────────────────────────────

  /**
   * POST /scholarships/programs - Create a scholarship program
   */
  fastify.post(
    `${prefix}/programs`,
    async function createProgramHandler(
      request: FastifyRequest<{ Body: CreateScholarshipProgramInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateScholarshipProgramSchema, request.body);
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
        const program = await scholarshipService.createProgram(tenantId, result.data);
        return reply.status(201).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /scholarships/programs/:id - Update a scholarship program
   */
  fastify.put(
    `${prefix}/programs/:id`,
    async function updateProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body: UpdateScholarshipProgramInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateScholarshipProgramSchema, request.body);
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
        const program = await scholarshipService.updateProgram(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /scholarships/programs - List scholarship programs
   */
  fastify.get(
    `${prefix}/programs`,
    async function listProgramsHandler(
      request: FastifyRequest<{ Querystring: ScholarshipListQuery }>,
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

      const query = request.query as ScholarshipListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await scholarshipService.listPrograms(
        tenantId,
        { status: query.status as any, search: query.search },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((p) => ({
          ...p,
          createdAt: p.createdAt.toISOString(),
          updatedAt: p.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/programs/:id - Get a scholarship program
   */
  fastify.get(
    `${prefix}/programs/:id`,
    async function getProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const program = await scholarshipService.getProgramById(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...program,
          createdAt: program.createdAt.toISOString(),
          updatedAt: program.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /scholarships/programs/:id - Delete a scholarship program
   */
  fastify.delete(
    `${prefix}/programs/:id`,
    async function deleteProgramHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        await scholarshipService.deleteProgram(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Application Routes ────────────────────────────────────────────────

  /**
   * POST /scholarships/applications - Submit an application
   */
  fastify.post(
    `${prefix}/applications`,
    async function submitApplicationHandler(
      request: FastifyRequest<{ Body: CreateApplicationInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateApplicationSchema, request.body);
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
        const application = await scholarshipService.submitApplication(tenantId, result.data);
        return reply.status(201).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /scholarships/applications - List applications
   */
  fastify.get(
    `${prefix}/applications`,
    async function listApplicationsHandler(
      request: FastifyRequest<{ Querystring: ScholarshipListQuery & { programId?: string; applicantId?: string; institutionId?: string; areaId?: string; gender?: string } }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'createdAt';
      const sortOrder = (query.sortOrder ?? 'desc') as 'asc' | 'desc';

      const result = await scholarshipService.listApplications(
        tenantId,
        {
          programId: query.programId,
          applicantId: query.applicantId,
          institutionId: query.institutionId,
          status: query.status as any,
          areaId: query.areaId,
          gender: query.gender,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((a) => ({
          ...a,
          submittedAt: a.submittedAt.toISOString(),
          reviewedAt: formatDate(a.reviewedAt),
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/applications/:id - Get an application
   */
  fastify.get(
    `${prefix}/applications/:id`,
    async function getApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const application = await scholarshipService.getApplicationById(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /scholarships/applications/:id/approve - Approve an application
   */
  fastify.post(
    `${prefix}/applications/:id/approve`,
    async function approveApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const application = await scholarshipService.approveApplication(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * POST /scholarships/applications/:id/reject - Reject an application
   */
  fastify.post(
    `${prefix}/applications/:id/reject`,
    async function rejectApplicationHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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
        const application = await scholarshipService.rejectApplication(tenantId, paramsResult.data.id);
        return reply.status(200).send({
          ...application,
          submittedAt: application.submittedAt.toISOString(),
          reviewedAt: formatDate(application.reviewedAt),
          createdAt: application.createdAt.toISOString(),
          updatedAt: application.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Disbursement Routes ───────────────────────────────────────────────

  /**
   * POST /scholarships/disbursements - Create a disbursement
   */
  fastify.post(
    `${prefix}/disbursements`,
    async function createDisbursementHandler(
      request: FastifyRequest<{ Body: CreateDisbursementInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateDisbursementSchema, request.body);
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
        const disbursement = await scholarshipService.createDisbursement(tenantId, result.data);
        return reply.status(201).send({
          ...disbursement,
          createdAt: disbursement.createdAt.toISOString(),
          updatedAt: disbursement.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /scholarships/disbursements/:id - Update disbursement status
   */
  fastify.put(
    `${prefix}/disbursements/:id`,
    async function updateDisbursementHandler(
      request: FastifyRequest<{ Params: ScholarshipParams; Body: UpdateDisbursementInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateDisbursementSchema, request.body);
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
        const disbursement = await scholarshipService.updateDisbursement(tenantId, paramsResult.data.id, bodyResult.data);
        return reply.status(200).send({
          ...disbursement,
          createdAt: disbursement.createdAt.toISOString(),
          updatedAt: disbursement.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /scholarships/disbursements - List disbursements
   */
  fastify.get(
    `${prefix}/disbursements`,
    async function listDisbursementsHandler(
      request: FastifyRequest<{ Querystring: ScholarshipListQuery & { applicationId?: string; paymentStatus?: string } }>,
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

      const query = request.query;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;
      const sortBy = query.sortBy ?? 'scheduledDate';
      const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

      const result = await scholarshipService.listDisbursements(
        tenantId,
        {
          applicationId: query.applicationId,
          paymentStatus: query.paymentStatus as any,
        },
        { page, pageSize, sortBy, sortOrder },
      );

      return reply.status(200).send({
        data: result.data.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /scholarships/applications/:id/disbursements - List disbursements for an application
   */
  fastify.get(
    `${prefix}/applications/:id/disbursements`,
    async function listApplicationDisbursementsHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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

      const disbursements = await scholarshipService.listDisbursementsByApplication(
        tenantId,
        paramsResult.data.id,
      );

      return reply.status(200).send({
        data: disbursements.map((d) => ({
          ...d,
          createdAt: d.createdAt.toISOString(),
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    },
  );

  // ─── Compliance Routes ─────────────────────────────────────────────────

  /**
   * POST /scholarships/compliance - Record compliance
   */
  fastify.post(
    `${prefix}/compliance`,
    async function recordComplianceHandler(
      request: FastifyRequest<{ Body: RecipientComplianceInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(RecipientComplianceSchema, request.body);
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
        const record = await scholarshipService.recordCompliance(tenantId, result.data);
        return reply.status(201).send({
          ...record,
          createdAt: record.createdAt.toISOString(),
          updatedAt: record.updatedAt.toISOString(),
        });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /scholarships/applications/:id/compliance - Get compliance records
   */
  fastify.get(
    `${prefix}/applications/:id/compliance`,
    async function getComplianceHandler(
      request: FastifyRequest<{ Params: ScholarshipParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(ScholarshipParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid ID',
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

      const records = await scholarshipService.getComplianceRecords(tenantId, paramsResult.data.id);

      return reply.status(200).send({
        data: records.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        })),
      });
    },
  );

  // ─── Report Routes ─────────────────────────────────────────────────────

  /**
   * GET /scholarships/reports/utilization - Get utilization report
   */
  fastify.get(
    `${prefix}/reports/utilization`,
    async function utilizationReportHandler(
      request: FastifyRequest<{ Querystring: UtilizationReportQuery }>,
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

      const query = request.query as UtilizationReportQuery;
      const report = await scholarshipService.getUtilizationReport(tenantId, query);

      return reply.status(200).send({
        ...report,
        generatedAt: new Date().toISOString(),
      });
    },
  );
}
