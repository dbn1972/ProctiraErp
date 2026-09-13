/**
 * Student Routes
 *
 * POST   /students          - Create a new student
 * PUT    /students/:id      - Update a student
 * GET    /students          - List students (paginated, filterable)
 * GET    /students/search   - Full-text search on name and national ID
 * GET    /students/:id      - Get a single student
 * DELETE /students/:id      - Delete a student (soft delete)
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import {
  CreateStudentSchema,
  UpdateStudentSchema,
  StudentParamsSchema,
  type CreateStudentInput,
  type UpdateStudentInput,
  type StudentListQuery,
  type StudentSearchQuery,
  type StudentParams,
} from './schemas.js';
import { assertStudentReadAccess, assertStudentWriteAccess } from './student-access.js';
import type { StudentService } from './student-service.js';

function getRoles(request: FastifyRequest): unknown {
  const user = (request as FastifyRequest & { user?: { roles?: unknown } }).user;
  return user?.roles ?? [];
}

/**
 * Options for registering student routes.
 */
export interface StudentRoutesOptions {
  studentService: StudentService;
  /** Route prefix (default: '/students') */
  prefix?: string;
}

/**
 * Formats a student entity to the API response shape.
 */
function formatStudentResponse(entity: {
  id: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  nationalId: string | null;
  nationality: string | null;
  contacts: unknown[];
  guardians: unknown[];
  identityDocuments: unknown[];
  customData: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    firstName: entity.firstName,
    lastName: entity.lastName,
    dateOfBirth: entity.dateOfBirth,
    gender: entity.gender,
    nationalId: entity.nationalId,
    nationality: entity.nationality,
    contacts: entity.contacts,
    guardians: entity.guardians,
    identityDocuments: entity.identityDocuments,
    customData: entity.customData,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register student routes on a Fastify instance.
 */
export async function registerStudentRoutes(
  fastify: FastifyInstance,
  options: StudentRoutesOptions,
): Promise<void> {
  const { studentService, prefix = '/students' } = options;

  /**
   * POST /students
   * Create a new student.
   */
  fastify.post(
    prefix,
    async function createHandler(
      request: FastifyRequest<{ Body: CreateStudentInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateStudentSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        assertStudentWriteAccess(getRoles(request), 'student.create');
        const student = await studentService.create(tenantId, result.data);
        return reply.status(201).send(formatStudentResponse(student));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /students/:id
   * Update an existing student.
   */
  fastify.put(
    `${prefix}/:id`,
    async function updateHandler(
      request: FastifyRequest<{ Params: StudentParams; Body: UpdateStudentInput }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StudentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateStudentSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        assertStudentWriteAccess(getRoles(request), 'student.update');
        const student = await studentService.update(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatStudentResponse(student));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /students/search
   * Full-text search on student name and national ID.
   * Must be registered before GET /students/:id to avoid route conflict.
   */
  fastify.get(
    `${prefix}/search`,
    async function searchHandler(
      request: FastifyRequest<{ Querystring: StudentSearchQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      const query = request.query;
      if (!query.q || query.q.trim().length === 0) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Search query is required',
          statusCode: 400,
          errors: [{ field: 'q', message: 'q is required', rule: 'required' }],
        });
      }

      try {
        assertStudentReadAccess(getRoles(request));
        const page = Number(query.page) || 1;
        const pageSize = Number(query.pageSize) || 20;

        const result = await studentService.search(tenantId, query.q.trim(), { page, pageSize });

        return reply.status(200).send({
          data: result.data.map(formatStudentResponse),
          meta: result.meta,
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
   * GET /students
   * List students with pagination and filtering.
   */
  fastify.get(
    prefix,
    async function listHandler(
      request: FastifyRequest<{ Querystring: StudentListQuery }>,
      reply: FastifyReply,
    ) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
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
      try {
        assertStudentReadAccess(getRoles(request));
        const sortBy = query.sortBy ?? 'lastName';
        const sortOrder = (query.sortOrder ?? 'asc') as 'asc' | 'desc';

        const result = await studentService.list(
          tenantId,
          {
            gender: query.gender,
            search: query.search,
            institutionId: query.institutionId,
          },
          { page, pageSize, sortBy, sortOrder },
        );

        return reply.status(200).send({
          data: result.data.map(formatStudentResponse),
          meta: result.meta,
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
   * GET /students/:id
   * Get a single student by ID.
   */
  fastify.get(
    `${prefix}/:id`,
    async function getHandler(
      request: FastifyRequest<{ Params: StudentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StudentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        assertStudentReadAccess(getRoles(request));
        const student = await studentService.getById(tenantId, paramsResult.data.id);
        return reply.status(200).send(formatStudentResponse(student));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /students/:id
   * Delete a student (soft delete).
   */
  fastify.delete(
    `${prefix}/:id`,
    async function deleteHandler(
      request: FastifyRequest<{ Params: StudentParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(StudentParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid student ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      try {
        assertStudentWriteAccess(getRoles(request), 'student.delete');
        await studentService.delete(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );
}
