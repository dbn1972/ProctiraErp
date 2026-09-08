/**
 * Import Routes for Student Bulk Import
 *
 * POST   /students/import          - Upload Excel file for bulk import
 * GET    /students/import/:jobId   - Get import job progress
 *
 * Requirements:
 * - 6.7: Excel import endpoint accepting files up to 50MB
 * - 19.4: Handle files up to 50MB with progress indication
 */
import { AppError } from '@proctira/common';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import type { ImportService } from './import-service.js';
import type { ImportProgress, ImportResult } from './types.js';
import { MAX_IMPORT_FILE_SIZE } from './types.js';

/**
 * Options for registering import routes.
 */
export interface ImportRoutesOptions {
  importService: ImportService;
  /** Route prefix (default: '/students') */
  prefix?: string;
}

/**
 * Register student import routes on a Fastify instance.
 */
export async function registerImportRoutes(
  fastify: FastifyInstance,
  options: ImportRoutesOptions,
): Promise<void> {
  const { importService, prefix = '/students' } = options;

  /**
   * POST /students/import
   * Upload an Excel file for bulk student import.
   *
   * Expects multipart/form-data with:
   * - file: Excel file (.xlsx)
   * - duplicateResolution: 'skip' | 'update' | 'create'
   * - async: boolean (optional)
   */
  fastify.post(
    `${prefix}/import`,
    async function importHandler(request: FastifyRequest, reply: FastifyReply) {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }

      // Extract file and options from the request body
      // In a real implementation, this would use @fastify/multipart
      const body = request.body as {
        file?: { buffer: Buffer; filename: string; mimetype: string };
        duplicateResolution?: string;
        async?: boolean;
        /** G-307: `validate` or `dryRun=true` skips writes */
        mode?: string;
        dryRun?: boolean | string;
      };

      if (!body.file || !body.file.buffer) {
        return reply.status(400).send({
          code: 'FILE_REQUIRED',
          message: 'An Excel file is required for import',
          statusCode: 400,
        });
      }

      // Validate file size
      if (body.file.buffer.length > MAX_IMPORT_FILE_SIZE) {
        return reply.status(400).send({
          code: 'FILE_TOO_LARGE',
          message: `File size exceeds maximum allowed size of 50MB`,
          statusCode: 400,
        });
      }

      // Validate file type
      const validMimeTypes = [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel',
      ];
      if (body.file.mimetype && !validMimeTypes.includes(body.file.mimetype)) {
        return reply.status(400).send({
          code: 'INVALID_FILE_TYPE',
          message: 'Only Excel files (.xlsx) are accepted',
          statusCode: 400,
        });
      }

      // Validate duplicate resolution option
      const validResolutions = ['skip', 'update', 'create'];
      const duplicateResolution = body.duplicateResolution ?? 'skip';
      if (!validResolutions.includes(duplicateResolution)) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'duplicateResolution must be one of: skip, update, create',
          statusCode: 400,
        });
      }

      try {
        const dryRun =
          body.dryRun === true ||
          body.dryRun === 'true' ||
          body.mode === 'validate' ||
          body.mode === 'dry-run' ||
          body.mode === 'dryRun';

        const result = await importService.processImport(tenantId, body.file.buffer, {
          duplicateResolution: duplicateResolution as 'skip' | 'update' | 'create',
          async: dryRun ? false : body.async,
          dryRun,
        });

        // Check if result is async (ImportProgress) or sync (ImportResult)
        if ('jobId' in result) {
          return reply.status(202).send(result);
        }

        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    },
  );

  /**
   * GET /students/import/:jobId
   * Get the progress of an async import job.
   */
  fastify.get(
    `${prefix}/import/:jobId`,
    async function progressHandler(
      request: FastifyRequest<{ Params: { jobId: string } }>,
      reply: FastifyReply,
    ) {
      const { jobId } = request.params;

      if (
        !jobId ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(jobId)
      ) {
        return reply.status(400).send({
          code: 'VALIDATION_ERROR',
          message: 'Invalid job ID format',
          statusCode: 400,
        });
      }

      const progress = await importService.getImportProgress(jobId);
      if (!progress) {
        return reply.status(404).send({
          code: 'NOT_FOUND',
          message: `Import job '${jobId}' not found`,
          statusCode: 404,
        });
      }

      return reply.status(200).send(progress);
    },
  );
}
