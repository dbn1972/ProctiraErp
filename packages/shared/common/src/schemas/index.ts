/**
 * Typebox schemas for API error responses.
 * Used for Fastify response schema validation and OpenAPI documentation.
 */
import type { Static } from '@sinclair/typebox';
import { Type } from '@sinclair/typebox';

/**
 * Schema for a single field-level validation error.
 */
export const FieldErrorSchema = Type.Object(
  {
    field: Type.String({ description: 'JSON path to the field (e.g., "body.email")' }),
    rule: Type.String({ description: 'The validation rule that failed (e.g., "required", "format")' }),
    message: Type.String({ description: 'Human-readable error message' }),
  },
  { $id: 'FieldError', description: 'Field-level validation error detail' }
);

/**
 * Schema for the structured API error response.
 */
export const ApiErrorSchema = Type.Object(
  {
    code: Type.String({ description: 'Machine-readable error code (e.g., "VALIDATION_ERROR")' }),
    message: Type.String({ description: 'Human-readable error message' }),
    statusCode: Type.Integer({ description: 'HTTP status code', minimum: 400, maximum: 599 }),
    errors: Type.Optional(
      Type.Array(FieldErrorSchema, { description: 'Array of field-level errors for validation failures' })
    ),
  },
  { $id: 'ApiError', description: 'Structured API error response' }
);

/** TypeScript type inferred from FieldErrorSchema */
export type FieldErrorType = Static<typeof FieldErrorSchema>;

/** TypeScript type inferred from ApiErrorSchema */
export type ApiErrorType = Static<typeof ApiErrorSchema>;
