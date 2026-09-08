/**
 * Document Generation Schemas
 *
 * Typebox schemas for document generation request/response validation.
 *
 * Requirements:
 * - 10.6: Generate examination documents as PDF files
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Schema for document generation request body.
 */
export const GenerateDocumentsSchema = Type.Object({
  documentType: Type.Union([
    Type.Literal('admit_card'),
    Type.Literal('seating_plan'),
    Type.Literal('result_certificate'),
  ]),
  candidateIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 })),
  centerId: Type.Optional(Type.String({ format: 'uuid' })),
});

export type GenerateDocumentsInput = Static<typeof GenerateDocumentsSchema>;

/**
 * Schema for document generation job params.
 */
export const DocumentJobParamsSchema = Type.Object({
  examinationId: Type.String({ format: 'uuid' }),
  jobId: Type.String({ format: 'uuid' }),
});

export type DocumentJobParams = Static<typeof DocumentJobParamsSchema>;

/**
 * Schema for examination params (reused from result schemas).
 */
export const DocumentExaminationParamsSchema = Type.Object({
  examinationId: Type.String({ format: 'uuid' }),
});

export type DocumentExaminationParams = Static<typeof DocumentExaminationParamsSchema>;

/**
 * Schema for document generation job response.
 */
export const DocumentJobResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  examinationId: Type.String({ format: 'uuid' }),
  documentType: Type.Union([
    Type.Literal('admit_card'),
    Type.Literal('seating_plan'),
    Type.Literal('result_certificate'),
  ]),
  status: Type.Union([
    Type.Literal('queued'),
    Type.Literal('processing'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  totalCandidates: Type.Number(),
  processedCount: Type.Number(),
  failedCount: Type.Number(),
  errorMessage: Type.Optional(Type.String()),
  outputPath: Type.Optional(Type.String()),
  durationMs: Type.Optional(Type.Number()),
  createdAt: Type.String(),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
});

export type DocumentJobResponse = Static<typeof DocumentJobResponseSchema>;

/**
 * Schema for list of document generation jobs response.
 */
export const DocumentJobListResponseSchema = Type.Object({
  jobs: Type.Array(DocumentJobResponseSchema),
});

export type DocumentJobListResponse = Static<typeof DocumentJobListResponseSchema>;
