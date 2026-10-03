/**
 * Import Routes for Student Bulk Import
 *
 * POST   /students/import           - Upload Excel file for bulk import
 * POST   /students/import/validate  - Dry-run validation (no writes)
 * GET    /students/import/template  - Download the .xlsx template (EXPECTED_HEADERS)
 * GET    /students/import/:jobId    - Get import job progress
 *
 * PRC-H093: uploads are accepted as `multipart/form-data` (field `file`, parsed
 * by @fastify/multipart with fileSize = MAX_IMPORT_FILE_SIZE, files = 1) or as
 * the legacy JSON variant `{ file: { buffer: <base64>, filename, mimetype } }`,
 * which is now explicitly base64-decoded. Size is enforced on decoded bytes.
 *
 * Requirements:
 * - 6.7: Excel import endpoint accepting files up to 50MB
 * - 19.4: Handle files up to 50MB with progress indication
 */
import multipart from '@fastify/multipart';
import { AppError } from '@proctira/common';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';

import { createExcelWorkbook, EXPECTED_HEADERS } from './excel-parser.js';
import type { ImportService } from './import-service.js';
import { MAX_IMPORT_FILE_SIZE } from './types.js';
/**
 * Options for registering import routes.
 */
export interface ImportRoutesOptions {
  importService: ImportService;
  /** Route prefix (default: '/students') */
  prefix?: string;
}

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const VALID_MIME_TYPES = new Set([XLSX_MIME, 'application/vnd.ms-excel']);
const VALID_RESOLUTIONS = ['skip', 'update', 'create'] as const;
type DuplicateResolution = (typeof VALID_RESOLUTIONS)[number];
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

interface ImportUpload {
  buffer: Buffer;
  filename: string;
  mimetype: string;
  fields: Record<string, string | boolean | undefined>;
}

class UploadError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const TOO_LARGE_MESSAGE = `File size exceeds maximum allowed size of ${MAX_IMPORT_FILE_SIZE / (1024 * 1024)}MB`;

function decodeBase64File(raw: string): Buffer {
  const cleaned = raw.replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
  if (cleaned.length === 0 || cleaned.length % 4 !== 0 || !BASE64_PATTERN.test(cleaned)) {
    throw new UploadError(400, 'INVALID_FILE_ENCODING', 'file.buffer must be base64-encoded');
  }
  return Buffer.from(cleaned, 'base64');
}

async function readMultipartUpload(request: FastifyRequest): Promise<ImportUpload | null> {
  let upload: ImportUpload | null = null;
  const fields: ImportUpload['fields'] = {};
  try {
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        if (part.fieldname !== 'file' || upload) {
          // Drain unexpected file parts so the stream completes.
          await part.toBuffer();
          continue;
        }
        const buffer = await part.toBuffer();
        upload = { buffer, filename: part.filename, mimetype: part.mimetype, fields };
      } else if (typeof part.value === 'string') {
        fields[part.fieldname] = part.value;
      }
    }
  } catch (error: unknown) {
    const code = (error as { code?: string }).code;
    if (code === 'FST_REQ_FILE_TOO_LARGE') {
      throw new UploadError(413, 'FILE_TOO_LARGE', TOO_LARGE_MESSAGE);
    }
    if (code === 'FST_FILES_LIMIT' || code === 'FST_PARTS_LIMIT' || code === 'FST_FIELDS_LIMIT') {
      throw new UploadError(400, 'VALIDATION_ERROR', 'Upload exactly one file');
    }
    throw error;
  }
  return upload;
}

function readJsonUpload(request: FastifyRequest): ImportUpload | null {
  const body = (request.body ?? {}) as {
    file?: { buffer?: unknown; filename?: unknown; mimetype?: unknown };
    duplicateResolution?: string;
    async?: boolean;
    mode?: string;
    dryRun?: boolean | string;
  };
  if (!body.file || body.file.buffer === undefined || body.file.buffer === null) return null;
  if (typeof body.file.buffer !== 'string') {
    throw new UploadError(400, 'INVALID_FILE_ENCODING', 'file.buffer must be base64-encoded');
  }
  return {
    buffer: decodeBase64File(body.file.buffer),
    filename: typeof body.file.filename === 'string' ? body.file.filename : 'upload.xlsx',
    mimetype: typeof body.file.mimetype === 'string' ? body.file.mimetype : '',
    fields: {
      duplicateResolution: body.duplicateResolution,
      async: body.async,
      mode: body.mode,
      dryRun: body.dryRun,
    },
  };
}

async function readUpload(request: FastifyRequest): Promise<ImportUpload> {
  const upload = request.isMultipart()
    ? await readMultipartUpload(request)
    : readJsonUpload(request);
  if (!upload || upload.buffer.length === 0) {
    throw new UploadError(400, 'FILE_REQUIRED', 'An Excel file is required for import');
  }
  if (upload.buffer.length > MAX_IMPORT_FILE_SIZE) {
    throw new UploadError(413, 'FILE_TOO_LARGE', TOO_LARGE_MESSAGE);
  }
  if (upload.mimetype && !VALID_MIME_TYPES.has(upload.mimetype)) {
    throw new UploadError(400, 'INVALID_FILE_TYPE', 'Only Excel files (.xlsx) are accepted');
  }
  // .xlsx is a ZIP container — reject anything without the PK signature.
  if (upload.buffer.length < 4 || upload.buffer.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new UploadError(400, 'INVALID_FILE_TYPE', 'Only Excel files (.xlsx) are accepted');
  }
  return upload;
}

function isTruthy(value: string | boolean | undefined): boolean {
  return value === true || value === 'true' || value === '1';
}

/**
 * Register student import routes on a Fastify instance.
 * Routes live in an encapsulated scope so the multipart parser does not leak
 * onto other gateway domains.
 */
export async function registerImportRoutes(
  fastify: FastifyInstance,
  options: ImportRoutesOptions,
): Promise<void> {
  const { importService, prefix = '/students' } = options;
  await fastify.register(async (scope) => {
    await scope.register(multipart, {
      limits: { fileSize: MAX_IMPORT_FILE_SIZE, files: 1, fields: 10, parts: 12 },
    });

    const handleUpload = async (
      request: FastifyRequest,
      reply: FastifyReply,
      forceDryRun: boolean,
    ): Promise<FastifyReply> => {
      const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
      if (!tenantId) {
        return reply.status(400).send({
          code: 'TENANT_REQUIRED',
          message: 'Tenant context is required',
          statusCode: 400,
        });
      }
      try {
        const upload = await readUpload(request);
        const { fields } = upload;
        const duplicateResolution = (fields.duplicateResolution ?? 'skip') as string;
        if (!(VALID_RESOLUTIONS as readonly string[]).includes(duplicateResolution)) {
          return reply.status(400).send({
            code: 'VALIDATION_ERROR',
            message: 'duplicateResolution must be one of: skip, update, create',
            statusCode: 400,
          });
        }
        const mode = typeof fields.mode === 'string' ? fields.mode : undefined;
        const dryRun =
          forceDryRun ||
          isTruthy(fields.dryRun) ||
          mode === 'validate' ||
          mode === 'dry-run' ||
          mode === 'dryRun';
        const result = await importService.processImport(tenantId, upload.buffer, {
          duplicateResolution: duplicateResolution as DuplicateResolution,
          async: dryRun ? false : isTruthy(fields.async),
          dryRun,
        });
        if ('jobId' in result) {
          return reply.status(202).send(result);
        }
        return reply.status(200).send(result);
      } catch (error: unknown) {
        if (error instanceof UploadError) {
          return reply.status(error.statusCode).send({
            code: error.code,
            message: error.message,
            statusCode: error.statusCode,
          });
        }
        if (error instanceof AppError) {
          return reply.status(error.statusCode).send(error.toJSON());
        }
        throw error;
      }
    };

    /**
     * POST /students/import
     * multipart/form-data: file (.xlsx), duplicateResolution, async, mode/dryRun.
     */
    scope.post(`${prefix}/import`, async function importHandler(request, reply) {
      return handleUpload(request, reply, false);
    });

    /** POST /students/import/validate — dry-run; never writes. */
    scope.post(`${prefix}/import/validate`, async function validateImportHandler(request, reply) {
      return handleUpload(request, reply, true);
    });

    /** GET /students/import/template — xlsx whose header row equals EXPECTED_HEADERS. */
    scope.get(`${prefix}/import/template`, async function templateHandler(_request, reply) {
      const workbook = await createExcelWorkbook();
      const sheet = workbook.addWorksheet('Students');
      sheet.addRow([...EXPECTED_HEADERS]);
      const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
      return reply
        .status(200)
        .header('content-type', XLSX_MIME)
        .header('content-disposition', 'attachment; filename="students-import-template.xlsx"')
        .send(bytes);
    });

    /**
     * GET /students/import/:jobId
     * Get the progress of an async import job.
     */
    scope.get(
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
        // PRC-H092: progress is tenant-scoped — another tenant's job id reads as 404.
        const tenantId = (request as FastifyRequest & { tenantId?: string }).tenantId;
        if (!tenantId) {
          return reply.status(400).send({
            code: 'TENANT_REQUIRED',
            message: 'Tenant context is required',
            statusCode: 400,
          });
        }
        const progress = await importService.getImportProgress(jobId, tenantId);
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
  });
}
