/**
 * Audit Routes
 *
 * POST   /audit                    - Record a single audit log entry
 * POST   /audit/batch              - Record multiple audit log entries
 * GET    /audit                    - Query audit logs with filters
 * GET    /audit/dsar/:subjectId     - G-734 DSAR export for a data subject
 * GET    /audit/:id                - Get a single audit log entry
 * GET    /audit/retention          - Get retention configuration
 * PUT    /audit/retention          - Set retention configuration
 * POST   /audit/archival/execute   - Execute archival of expired entries
 * GET    /audit/archival/candidates - Get count of archival candidates
 *
 * Requirements:
 * - 21.1: Record audit log entry for every create/update/delete
 * - 21.2: Log authenticated user, timestamp, IP address, entity
 * - 21.4: Query with filtering by entity type, user, date range, operation type
 * - 21.5: Configurable retention with automated archival
 */
import { AppError } from '@proctira/common';
import { validate } from '@proctira/validation';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { AuditService } from './audit-service.js';
import {
  RecordAuditSchema,
  RecordAuditBatchSchema,
  QueryAuditLogsSchema,
  AuditEntryParamsSchema,
  SetRetentionConfigSchema,
  type RecordAuditInput,
  type RecordAuditBatchInput,
  type QueryAuditLogsInput,
  type AuditEntryParams,
  type SetRetentionConfigInput,
} from './schemas.js';
import type { AuditLogEntry, AuditRetentionConfig, ArchivalResult } from './audit-repository.js';

/**
 * Options for registering audit routes.
 */
export interface AuditRoutesOptions {
  auditService: AuditService;
  /** Route prefix (default: '/audit') */
  prefix?: string;
}

/**
 * Formats an audit log entry to the API response shape.
 */
function formatAuditEntryResponse(entry: AuditLogEntry) {
  return {
    id: entry.id,
    tenantId: entry.tenantId,
    entityType: entry.entityType,
    entityId: entry.entityId,
    operation: entry.operation,
    userId: entry.userId,
    userName: entry.userName,
    ipAddress: entry.ipAddress,
    timestamp: entry.timestamp.toISOString(),
    beforeValues: entry.beforeValues,
    afterValues: entry.afterValues,
    metadata: entry.metadata,
  };
}

/**
 * Formats a retention config to the API response shape.
 */
function formatRetentionConfigResponse(config: AuditRetentionConfig) {
  return {
    tenantId: config.tenantId,
    retentionMonths: config.retentionMonths,
    archivalEnabled: config.archivalEnabled,
    archivalDestination: config.archivalDestination,
    lastArchivalAt: config.lastArchivalAt?.toISOString() ?? null,
  };
}

/**
 * Formats an archival result to the API response shape.
 */
function formatArchivalResultResponse(result: ArchivalResult) {
  return {
    archivedCount: result.archivedCount,
    cutoffDate: result.cutoffDate.toISOString(),
    destination: result.destination,
    executedAt: result.executedAt.toISOString(),
  };
}

/**
 * Extracts the client IP address from the request.
 */
function getClientIp(request: FastifyRequest): string {
  // Check common proxy headers
  const forwarded = request.headers['x-forwarded-for'];
  if (forwarded) {
    const firstIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return firstIp?.trim() ?? request.ip;
  }
  const realIp = request.headers['x-real-ip'];
  if (realIp) {
    return Array.isArray(realIp) ? (realIp[0] ?? request.ip) : realIp;
  }
  return request.ip;
}

/**
 * Extracts tenant ID from the request (set by tenant resolution middleware).
 */
function getTenantId(request: FastifyRequest): string {
  return (request as unknown as { tenantId?: string }).tenantId ?? 'default';
}

/**
 * Extracts authenticated user info from the request (set by auth middleware).
 */
function getUserInfo(request: FastifyRequest): { userId: string; userName: string } {
  const user = (request as unknown as { user?: { sub?: string; name?: string } }).user;
  return {
    userId: user?.sub ?? 'system',
    userName: user?.name ?? 'System',
  };
}

/**
 * Register audit routes on a Fastify instance.
 */
export async function registerAuditRoutes(
  fastify: FastifyInstance,
  options: AuditRoutesOptions,
): Promise<void> {
  const { auditService, prefix = '/audit' } = options;

  // POST /audit - Record a single audit log entry
  fastify.post(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = validate(RecordAuditSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid audit log input',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      const { userId, userName } = getUserInfo(request);
      const ipAddress = getClientIp(request);

      const entry = await auditService.recordAudit({
        tenantId,
        entityType: result.data.entityType,
        entityId: result.data.entityId,
        operation: result.data.operation,
        userId,
        userName,
        ipAddress,
        beforeValues: result.data.beforeValues ?? null,
        afterValues: result.data.afterValues ?? null,
        metadata: result.data.metadata ?? null,
      });

      return reply.status(201).send(formatAuditEntryResponse(entry));
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          errors: 'errors' in error ? (error as { errors: unknown }).errors : undefined,
        });
      }
      throw error;
    }
  });

  // POST /audit/batch - Record multiple audit log entries
  fastify.post(`${prefix}/batch`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = validate(RecordAuditBatchSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid batch audit log input',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);
      const { userId, userName } = getUserInfo(request);
      const ipAddress = getClientIp(request);

      const inputs = result.data.entries.map((entry) => ({
        tenantId,
        entityType: entry.entityType,
        entityId: entry.entityId,
        operation: entry.operation,
        userId,
        userName,
        ipAddress,
        beforeValues: entry.beforeValues ?? null,
        afterValues: entry.afterValues ?? null,
        metadata: entry.metadata ?? null,
      }));

      const entries = await auditService.recordAuditBatch(inputs);

      return reply.status(201).send({
        data: entries.map(formatAuditEntryResponse),
        count: entries.length,
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          errors: 'errors' in error ? (error as { errors: unknown }).errors : undefined,
        });
      }
      throw error;
    }
  });

  // GET /audit - Query audit logs with filters
  fastify.get(prefix, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      // Coerce query string values to appropriate types before validation
      const rawQuery = request.query as Record<string, unknown>;
      const coercedQuery = {
        ...rawQuery,
        ...(rawQuery['page'] != null ? { page: Number(rawQuery['page']) } : {}),
        ...(rawQuery['pageSize'] != null ? { pageSize: Number(rawQuery['pageSize']) } : {}),
      };

      const result = validate(QueryAuditLogsSchema, coercedQuery);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid query parameters',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);

      const queryResult = await auditService.queryAuditLogs({
        tenantId,
        entityType: result.data.entityType,
        entityId: result.data.entityId,
        userId: result.data.userId,
        operation: result.data.operation,
        startDate: result.data.startDate,
        endDate: result.data.endDate,
        page: result.data.page,
        pageSize: result.data.pageSize,
        sortOrder: result.data.sortOrder,
      });

      return reply.status(200).send({
        data: queryResult.data.map(formatAuditEntryResponse),
        meta: queryResult.meta,
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          errors: 'errors' in error ? (error as { errors: unknown }).errors : undefined,
        });
      }
      throw error;
    }
  });

  // GET /audit/retention - Get retention configuration
  fastify.get(`${prefix}/retention`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const tenantId = getTenantId(request);
      const config = await auditService.getRetentionConfig(tenantId);
      return reply.status(200).send(formatRetentionConfigResponse(config));
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        });
      }
      throw error;
    }
  });

  // PUT /audit/retention - Set retention configuration
  fastify.put(`${prefix}/retention`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = validate(SetRetentionConfigSchema, request.body);
      if (!result.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid retention configuration',
          statusCode: 400,
          errors: result.errors,
        });
      }

      const tenantId = getTenantId(request);

      const config = await auditService.setRetentionConfig({
        tenantId,
        retentionMonths: result.data.retentionMonths,
        archivalEnabled: result.data.archivalEnabled,
        archivalDestination: result.data.archivalDestination ?? null,
      });

      return reply.status(200).send(formatRetentionConfigResponse(config));
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
          errors: 'errors' in error ? (error as { errors: unknown }).errors : undefined,
        });
      }
      throw error;
    }
  });

  // POST /audit/archival/execute - Execute archival of expired entries
  fastify.post(
    `${prefix}/archival/execute`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const result = await auditService.executeArchival(tenantId);
        return reply.status(200).send(formatArchivalResultResponse(result));
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          });
        }
        throw error;
      }
    },
  );

  // GET /audit/archival/candidates - Get count of archival candidates
  fastify.get(
    `${prefix}/archival/candidates`,
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const tenantId = getTenantId(request);
        const count = await auditService.getArchivalCandidateCount(tenantId);
        return reply.status(200).send({ count });
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          });
        }
        throw error;
      }
    },
  );

  // GET /audit/dsar/:subjectId — G-734 Data Subject Access Request export
  fastify.get(`${prefix}/dsar/:subjectId`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const subjectId = String((request.params as { subjectId?: string }).subjectId ?? '').trim();
      if (!subjectId) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'subjectId is required',
          statusCode: 400,
        });
      }
      const tenantId = getTenantId(request);
      const pack = await auditService.exportDataSubjectPackage(tenantId, subjectId);
      return reply.status(200).send({
        subjectId: pack.subjectId,
        tenantId: pack.tenantId,
        exportedAt: pack.exportedAt,
        entryCount: pack.entryCount,
        truncated: pack.truncated,
        entries: pack.entries.map(formatAuditEntryResponse),
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        });
      }
      throw error;
    }
  });

  // GET /audit/:id - Get a single audit log entry
  fastify.get(`${prefix}/:id`, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const paramsResult = validate(AuditEntryParamsSchema, request.params);
      if (!paramsResult.success) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid parameters',
          statusCode: 400,
          errors: paramsResult.errors,
        });
      }

      const tenantId = getTenantId(request);
      const entry = await auditService.getAuditEntry(tenantId, paramsResult.data.id);

      return reply.status(200).send(formatAuditEntryResponse(entry));
    } catch (error: unknown) {
      if (error instanceof AppError) {
        return reply.status(error.statusCode).send({
          code: error.code,
          message: error.message,
          statusCode: error.statusCode,
        });
      }
      throw error;
    }
  });
}
