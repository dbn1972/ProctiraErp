/**
 * Custom Field Routes
 *
 * POST   /custom-fields/definitions          - Create a new custom field definition
 * PUT    /custom-fields/definitions/:id      - Update a custom field definition
 * GET    /custom-fields/definitions          - List custom field definitions
 * GET    /custom-fields/definitions/:id      - Get a single custom field definition
 * DELETE /custom-fields/definitions/:id      - Delete (deactivate) a custom field definition
 *
 * PUT    /custom-fields/values/:entityType/:entityId           - Bulk set values for an entity
 * GET    /custom-fields/values/:entityType/:entityId           - Get all values for an entity
 * PUT    /custom-fields/values/:entityType/:entityId/:fieldId  - Set a single value
 * DELETE /custom-fields/values/:entityType/:entityId           - Delete all values for an entity
 *
 * Requirements:
 * - 6.5: Support Custom_Fields to extend student profiles without database schema changes
 * - 7.6: Support Custom_Fields to extend staff profiles without database schema changes
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { CustomFieldService } from './custom-field-service.js';
import type {
  CustomFieldEntityType,
  CustomFieldValidationRules,
} from './custom-field-repository.js';
import {
  CreateCustomFieldDefinitionSchema,
  UpdateCustomFieldDefinitionSchema,
  CustomFieldDefinitionListQuerySchema,
  CustomFieldDefinitionParamsSchema,
  EntityValuesParamsSchema,
  BulkSetCustomFieldValuesSchema,
  SetCustomFieldValueSchema,
  type CreateCustomFieldDefinitionInput,
  type UpdateCustomFieldDefinitionInput,
  type CustomFieldDefinitionListQuery,
  type CustomFieldDefinitionParams,
  type EntityValuesParams,
  type BulkSetCustomFieldValuesInput,
  type SetCustomFieldValueInput,
} from './schemas.js';

/**
 * Options for registering custom field routes.
 */
export interface CustomFieldRoutesOptions {
  customFieldService: CustomFieldService;
  /** Route prefix (default: '/custom-fields') */
  prefix?: string;
}

/**
 * Formats a custom field definition entity to the API response shape.
 */
function formatDefinitionResponse(entity: {
  id: string;
  entityType: string;
  fieldKey: string;
  label: string;
  description: string | null;
  fieldType: string;
  validationRules: Record<string, unknown> | CustomFieldValidationRules;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    entityType: entity.entityType,
    fieldKey: entity.fieldKey,
    label: entity.label,
    description: entity.description,
    fieldType: entity.fieldType,
    validationRules: entity.validationRules,
    displayOrder: entity.displayOrder,
    isActive: entity.isActive,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Formats a custom field value entity to the API response shape.
 */
function formatValueResponse(entity: {
  id: string;
  entityType: string;
  entityId: string;
  fieldDefinitionId: string;
  value: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entity.id,
    entityType: entity.entityType,
    entityId: entity.entityId,
    fieldDefinitionId: entity.fieldDefinitionId,
    value: entity.value,
    createdAt: entity.createdAt.toISOString(),
    updatedAt: entity.updatedAt.toISOString(),
  };
}

/**
 * Register custom field routes on a Fastify instance.
 */
export async function registerCustomFieldRoutes(
  fastify: FastifyInstance,
  options: CustomFieldRoutesOptions,
): Promise<void> {
  const { customFieldService, prefix = '/custom-fields' } = options;

  // ─── Definition Routes ───────────────────────────────────────────────────

  /**
   * POST /custom-fields/definitions
   * Create a new custom field definition.
   */
  fastify.post(
    `${prefix}/definitions`,
    async function createDefinitionHandler(
      request: FastifyRequest<{ Body: CreateCustomFieldDefinitionInput }>,
      reply: FastifyReply,
    ) {
      const result = validate(CreateCustomFieldDefinitionSchema, request.body);
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
        const definition = await customFieldService.createDefinition(tenantId, result.data);
        return reply.status(201).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * PUT /custom-fields/definitions/:id
   * Update an existing custom field definition.
   */
  fastify.put(
    `${prefix}/definitions/:id`,
    async function updateDefinitionHandler(
      request: FastifyRequest<{
        Params: CustomFieldDefinitionParams;
        Body: UpdateCustomFieldDefinitionInput;
      }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CustomFieldDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid definition ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(UpdateCustomFieldDefinitionSchema, request.body);
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
        const definition = await customFieldService.updateDefinition(
          tenantId,
          paramsResult.data.id,
          bodyResult.data,
        );
        return reply.status(200).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /custom-fields/definitions
   * List custom field definitions with pagination and filtering.
   */
  fastify.get(
    `${prefix}/definitions`,
    async function listDefinitionsHandler(
      request: FastifyRequest<{ Querystring: CustomFieldDefinitionListQuery }>,
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

      const query = request.query as CustomFieldDefinitionListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      const result = await customFieldService.listDefinitions(
        tenantId,
        {
          entityType: query.entityType,
          isActive: query.isActive,
          search: query.search,
        },
        { page, pageSize },
      );

      return reply.status(200).send({
        data: result.data.map(formatDefinitionResponse),
        meta: result.meta,
      });
    },
  );

  /**
   * GET /custom-fields/definitions/:id
   * Get a single custom field definition by ID.
   */
  fastify.get(
    `${prefix}/definitions/:id`,
    async function getDefinitionHandler(
      request: FastifyRequest<{ Params: CustomFieldDefinitionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CustomFieldDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid definition ID',
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
        const definition = await customFieldService.getDefinitionById(
          tenantId,
          paramsResult.data.id,
        );
        return reply.status(200).send(formatDefinitionResponse(definition));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * DELETE /custom-fields/definitions/:id
   * Delete (deactivate) a custom field definition.
   */
  fastify.delete(
    `${prefix}/definitions/:id`,
    async function deleteDefinitionHandler(
      request: FastifyRequest<{ Params: CustomFieldDefinitionParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(CustomFieldDefinitionParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid definition ID',
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
        await customFieldService.deleteDefinition(tenantId, paramsResult.data.id);
        return reply.status(204).send();
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  // ─── Value Routes ────────────────────────────────────────────────────────

  /**
   * PUT /custom-fields/values/:entityType/:entityId
   * Bulk set custom field values for an entity.
   */
  fastify.put(
    `${prefix}/values/:entityType/:entityId`,
    async function bulkSetValuesHandler(
      request: FastifyRequest<{
        Params: EntityValuesParams;
        Body: { values: Record<string, unknown> };
      }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EntityValuesParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
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

      const body = request.body as { values?: Record<string, unknown> };
      if (!body.values || typeof body.values !== 'object') {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'values field is required and must be an object',
          statusCode: 400,
          errors: [
            {
              field: 'values',
              message: 'values is required and must be an object',
              rule: 'required',
            },
          ],
        });
      }

      try {
        const results = await customFieldService.bulkSetValues(
          tenantId,
          paramsResult.data.entityType as CustomFieldEntityType,
          paramsResult.data.entityId,
          body.values,
        );
        return reply.status(200).send({
          data: results.map(formatValueResponse),
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
   * GET /custom-fields/values/:entityType/:entityId
   * Get all custom field values for an entity.
   */
  fastify.get(
    `${prefix}/values/:entityType/:entityId`,
    async function getValuesHandler(
      request: FastifyRequest<{ Params: EntityValuesParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EntityValuesParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
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

      const values = await customFieldService.getValuesForEntity(
        tenantId,
        paramsResult.data.entityType as CustomFieldEntityType,
        paramsResult.data.entityId,
      );

      return reply.status(200).send({
        data: values.map(formatValueResponse),
      });
    },
  );

  /**
   * DELETE /custom-fields/values/:entityType/:entityId
   * Delete all custom field values for an entity.
   */
  fastify.delete(
    `${prefix}/values/:entityType/:entityId`,
    async function deleteValuesHandler(
      request: FastifyRequest<{ Params: EntityValuesParams }>,
      reply: FastifyReply,
    ) {
      const paramsResult = validate(EntityValuesParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
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

      const count = await customFieldService.deleteValuesForEntity(
        tenantId,
        paramsResult.data.entityType as CustomFieldEntityType,
        paramsResult.data.entityId,
      );

      return reply.status(200).send({ deletedCount: count });
    },
  );
}
