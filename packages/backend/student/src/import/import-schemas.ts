/**
 * Typebox schemas for Student Import API endpoints.
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Schema for import options in the request body (multipart form data).
 */
export const ImportOptionsSchema = Type.Object({
  duplicateResolution: Type.Union(
    [Type.Literal('skip'), Type.Literal('update'), Type.Literal('create')],
    { description: 'How to handle detected duplicates: skip, update existing, or create new' },
  ),
  async: Type.Optional(
    Type.Boolean({ description: 'Force async processing via queue (auto-determined for large files)' }),
  ),
});

export type ImportOptionsInput = Static<typeof ImportOptionsSchema>;

/**
 * Schema for import progress query.
 */
export const ImportProgressParamsSchema = Type.Object({
  jobId: Type.String({
    pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
    description: 'Import job UUID',
  }),
});

export type ImportProgressParams = Static<typeof ImportProgressParamsSchema>;

/**
 * Schema for the import result response.
 */
export const ImportResultResponseSchema = Type.Object({
  totalRows: Type.Number({ description: 'Total rows in the file' }),
  successCount: Type.Number({ description: 'Rows successfully imported' }),
  errorCount: Type.Number({ description: 'Rows that failed validation' }),
  duplicateCount: Type.Number({ description: 'Duplicate rows detected' }),
  errors: Type.Array(
    Type.Object({
      rowNumber: Type.Number({ description: 'Row number in the Excel file' }),
      field: Type.String({ description: 'Field that failed validation' }),
      message: Type.String({ description: 'Human-readable error message' }),
      code: Type.String({ description: 'Error code' }),
    }),
  ),
  duplicates: Type.Array(
    Type.Object({
      rowNumber: Type.Number({ description: 'Row number of the duplicate' }),
      existingStudentId: Type.String({ description: 'ID of the existing matching student' }),
      matchType: Type.String({ description: 'Type of match: national_id or name_dob' }),
      matchedFields: Type.Record(Type.String(), Type.String(), {
        description: 'Fields that matched',
      }),
    }),
  ),
});

export type ImportResultResponse = Static<typeof ImportResultResponseSchema>;

/**
 * Schema for the import progress response.
 */
export const ImportProgressResponseSchema = Type.Object({
  jobId: Type.String({ description: 'Import job UUID' }),
  status: Type.Union(
    [
      Type.Literal('queued'),
      Type.Literal('processing'),
      Type.Literal('completed'),
      Type.Literal('failed'),
    ],
    { description: 'Current job status' },
  ),
  totalRows: Type.Number({ description: 'Total rows to process' }),
  processedRows: Type.Number({ description: 'Rows processed so far' }),
  progressPercent: Type.Number({ description: 'Progress percentage (0-100)' }),
  result: Type.Optional(ImportResultResponseSchema),
  errorMessage: Type.Optional(Type.String({ description: 'Error message if failed' })),
  startedAt: Type.String({ description: 'ISO timestamp when import started' }),
  completedAt: Type.Optional(Type.String({ description: 'ISO timestamp when import completed' })),
});

export type ImportProgressResponse = Static<typeof ImportProgressResponseSchema>;
