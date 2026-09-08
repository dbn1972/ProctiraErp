/**
 * Data Warehouse Routes
 *
 * POST   /warehouses                                    - Create warehouse
 * GET    /warehouses                                    - List warehouses
 * GET    /warehouses/:warehouseId                       - Get warehouse
 * PUT    /warehouses/:warehouseId                       - Update warehouse
 * DELETE /warehouses/:warehouseId                       - Delete warehouse
 * POST   /warehouses/:warehouseId/indicators            - Create indicator
 * GET    /warehouses/:warehouseId/indicators            - List indicators
 * POST   /warehouses/:warehouseId/units                 - Create unit
 * GET    /warehouses/:warehouseId/units                 - List units
 * POST   /warehouses/:warehouseId/subgroups             - Create subgroup
 * GET    /warehouses/:warehouseId/subgroups             - List subgroups
 * POST   /warehouses/:warehouseId/time-periods          - Create time period
 * GET    /warehouses/:warehouseId/time-periods          - List time periods
 * POST   /warehouses/:warehouseId/areas                 - Create area
 * GET    /warehouses/:warehouseId/areas                 - List areas
 * POST   /warehouses/:warehouseId/import                - Import data
 * POST   /warehouses/:warehouseId/query                 - Query data
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { DataWarehouseService } from './data-warehouse-service.js';
import {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  WarehouseParamsSchema,
  WarehouseListQuerySchema,
  CreateIndicatorSchema,
  CreateUnitSchema,
  CreateSubgroupSchema,
  CreateTimePeriodSchema,
  CreateAreaSchema,
  BulkImportSchema,
  DataQuerySchema,
  type CreateWarehouseInput,
  type WarehouseParams,
  type WarehouseListQuery,
} from './schemas.js';

export interface DataWarehouseRoutesOptions {
  dataWarehouseService: DataWarehouseService;
  prefix?: string;
}

function getTenantId(request: FastifyRequest): string | undefined {
  return (request as FastifyRequest & { tenantId?: string }).tenantId;
}

function sendTenantRequired(reply: FastifyReply) {
  return reply.status(400).send({
    code: 'TENANT_REQUIRED',
    message: 'Tenant context is required',
    statusCode: 400,
  });
}

function handleError(error: unknown, reply: FastifyReply) {
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }
  throw error;
}

export async function registerDataWarehouseRoutes(
  fastify: FastifyInstance,
  options: DataWarehouseRoutesOptions,
): Promise<void> {
  const { dataWarehouseService, prefix = '/warehouses' } = options;

  // ─── Warehouse CRUD ───────────────────────────────────────────────────────

  fastify.post(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return sendTenantRequired(reply);

    const result = validate(CreateWarehouseSchema, request.body);
    if (!result.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: result.errors,
      });
    }

    try {
      const warehouse = await dataWarehouseService.createWarehouse(tenantId, result.data);
      return reply.status(201).send(warehouse);
    } catch (error: unknown) {
      return handleError(error, reply);
    }
  });

  fastify.get(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return sendTenantRequired(reply);

    const query = request.query as WarehouseListQuery;
    const page = Number(query.page) || 1;
    const pageSize = Number(query.pageSize) || 20;

    const result = await dataWarehouseService.listWarehouses(
      tenantId,
      { search: query.search },
      page,
      pageSize,
    );

    return reply.status(200).send({
      data: result.data,
      meta: { page, pageSize, total: result.total, totalPages: Math.ceil(result.total / pageSize) },
    });
  });

  fastify.get(`${prefix}/:warehouseId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return sendTenantRequired(reply);

    const paramsResult = validate(WarehouseParamsSchema, request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid warehouse ID',
        statusCode: 400,
        errors: paramsResult.errors,
      });
    }

    try {
      const warehouse = await dataWarehouseService.getWarehouse(
        tenantId,
        paramsResult.data.warehouseId,
      );
      return reply.status(200).send(warehouse);
    } catch (error: unknown) {
      return handleError(error, reply);
    }
  });

  fastify.put(`${prefix}/:warehouseId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return sendTenantRequired(reply);

    const paramsResult = validate(WarehouseParamsSchema, request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid warehouse ID',
        statusCode: 400,
        errors: paramsResult.errors,
      });
    }

    const bodyResult = validate(UpdateWarehouseSchema, request.body);
    if (!bodyResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        statusCode: 400,
        errors: bodyResult.errors,
      });
    }

    try {
      const warehouse = await dataWarehouseService.updateWarehouse(
        tenantId,
        paramsResult.data.warehouseId,
        bodyResult.data,
      );
      return reply.status(200).send(warehouse);
    } catch (error: unknown) {
      return handleError(error, reply);
    }
  });

  fastify.delete(`${prefix}/:warehouseId`, async (request: FastifyRequest, reply: FastifyReply) => {
    const tenantId = getTenantId(request);
    if (!tenantId) return sendTenantRequired(reply);

    const paramsResult = validate(WarehouseParamsSchema, request.params);
    if (!paramsResult.success) {
      return reply.status(400).send({
        code: 'VALIDATION_ERROR',
        message: 'Invalid warehouse ID',
        statusCode: 400,
        errors: paramsResult.errors,
      });
    }

    try {
      await dataWarehouseService.deleteWarehouse(tenantId, paramsResult.data.warehouseId);
      return reply.status(204).send();
    } catch (error: unknown) {
      return handleError(error, reply);
    }
  });

  // ─── Indicator Routes ─────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/indicators`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateIndicatorSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const indicator = await dataWarehouseService.createIndicator(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data,
        );
        return reply.status(201).send(indicator);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  fastify.get(
    `${prefix}/:warehouseId/indicators`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WarehouseListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await dataWarehouseService.listIndicators(
          tenantId,
          paramsResult.data.warehouseId,
          { search: query.search },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Unit Routes ──────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/units`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateUnitSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const unit = await dataWarehouseService.createUnit(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data,
        );
        return reply.status(201).send(unit);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  fastify.get(
    `${prefix}/:warehouseId/units`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WarehouseListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await dataWarehouseService.listUnits(
          tenantId,
          paramsResult.data.warehouseId,
          { search: query.search },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Subgroup Routes ──────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/subgroups`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateSubgroupSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const subgroup = await dataWarehouseService.createSubgroup(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data,
        );
        return reply.status(201).send(subgroup);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  fastify.get(
    `${prefix}/:warehouseId/subgroups`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WarehouseListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await dataWarehouseService.listSubgroups(
          tenantId,
          paramsResult.data.warehouseId,
          { search: query.search },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Time Period Routes ───────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/time-periods`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateTimePeriodSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const tp = await dataWarehouseService.createTimePeriod(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data,
        );
        return reply.status(201).send(tp);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  fastify.get(
    `${prefix}/:warehouseId/time-periods`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WarehouseListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await dataWarehouseService.listTimePeriods(
          tenantId,
          paramsResult.data.warehouseId,
          { search: query.search },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Area Routes ──────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/areas`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(CreateAreaSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const area = await dataWarehouseService.createArea(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data,
        );
        return reply.status(201).send(area);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  fastify.get(
    `${prefix}/:warehouseId/areas`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const query = request.query as WarehouseListQuery;
      const page = Number(query.page) || 1;
      const pageSize = Number(query.pageSize) || 20;

      try {
        const result = await dataWarehouseService.listAreas(
          tenantId,
          paramsResult.data.warehouseId,
          { search: query.search },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Data Import ──────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/import`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(BulkImportSchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      try {
        const importResult = await dataWarehouseService.importData(
          tenantId,
          paramsResult.data.warehouseId,
          bodyResult.data.format,
          {
            records: bodyResult.data.records,
            fileContent: bodyResult.data.fileContent,
            dbConnectionConfig: bodyResult.data.dbConnectionConfig,
          },
        );
        return reply.status(200).send(importResult);
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );

  // ─── Data Query ───────────────────────────────────────────────────────────

  fastify.post(
    `${prefix}/:warehouseId/query`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      const tenantId = getTenantId(request);
      if (!tenantId) return sendTenantRequired(reply);

      const paramsResult = validate(WarehouseParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid warehouse ID',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const bodyResult = validate(DataQuerySchema, request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          statusCode: 400,
          errors: bodyResult.errors,
        });
      }

      const page = bodyResult.data.page ?? 1;
      const pageSize = bodyResult.data.pageSize ?? 50;

      try {
        const result = await dataWarehouseService.queryData(
          tenantId,
          paramsResult.data.warehouseId,
          {
            indicatorIds: bodyResult.data.indicatorIds,
            unitIds: bodyResult.data.unitIds,
            subgroupIds: bodyResult.data.subgroupIds,
            areaIds: bodyResult.data.areaIds,
            timePeriods: bodyResult.data.timePeriods,
          },
          page,
          pageSize,
        );
        return reply.status(200).send({
          data: result.data,
          meta: {
            page,
            pageSize,
            total: result.total,
            totalPages: Math.ceil(result.total / pageSize),
          },
        });
      } catch (error: unknown) {
        return handleError(error, reply);
      }
    },
  );
}
