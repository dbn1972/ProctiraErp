/**
 * Typebox schemas for Case Management.
 *
 * Defines schemas for:
 * - Case CRUD (disciplinary, counselling, complaints)
 * - Case status tracking, attachments, and resolution
 *
 * Requirements: 13.5
 */
import { Type, type Static } from '@sinclair/typebox';

// UUID pattern for validation
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// ─── Case Type ───────────────────────────────────────────────────────────────

export const CaseTypeEnum = Type.Union(
  [Type.Literal('disciplinary'), Type.Literal('counselling'), Type.Literal('complaint')],
  { description: 'Type of case' },
);

export type CaseType = Static<typeof CaseTypeEnum>;

// ─── Case Status ─────────────────────────────────────────────────────────────

export const CaseStatusEnum = Type.Union(
  [
    Type.Literal('open'),
    Type.Literal('in_progress'),
    Type.Literal('pending_review'),
    Type.Literal('resolved'),
    Type.Literal('closed'),
    Type.Literal('escalated'),
  ],
  { description: 'Current status of the case' },
);

export type CaseStatus = Static<typeof CaseStatusEnum>;

// ─── Case Attachment Schema ──────────────────────────────────────────────────

export const CaseAttachmentSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 100, description: 'Unique attachment identifier' }),
  fileName: Type.String({ minLength: 1, maxLength: 255, description: 'Original file name' }),
  fileType: Type.String({ minLength: 1, maxLength: 100, description: 'MIME type of the file' }),
  fileSize: Type.Number({ minimum: 1, description: 'File size in bytes' }),
  storagePath: Type.String({ minLength: 1, maxLength: 500, description: 'Storage path or URL' }),
  uploadedBy: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'User who uploaded the file',
  }),
  uploadedAt: Type.Optional(Type.String({ description: 'ISO timestamp of upload' })),
});

export type CaseAttachmentInput = Static<typeof CaseAttachmentSchema>;

// ─── Case Resolution Schema ─────────────────────────────────────────────────

export const CaseResolutionSchema = Type.Object({
  outcome: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Resolution outcome description',
  }),
  resolvedBy: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'User who resolved the case',
  }),
  resolvedAt: Type.Optional(Type.String({ description: 'ISO timestamp of resolution' })),
  notes: Type.Optional(
    Type.String({ maxLength: 2000, description: 'Additional resolution notes' }),
  ),
  followUpRequired: Type.Optional(Type.Boolean({ description: 'Whether follow-up is required' })),
  followUpDate: Type.Optional(Type.String({ description: 'ISO date for follow-up' })),
});

export type CaseResolutionInput = Static<typeof CaseResolutionSchema>;

// ─── Create Case Schema ──────────────────────────────────────────────────────

export const CreateCaseSchema = Type.Object({
  type: CaseTypeEnum,
  title: Type.String({ minLength: 1, maxLength: 255, description: 'Case title' }),
  description: Type.String({ minLength: 1, maxLength: 5000, description: 'Case description' }),
  entityType: Type.String({
    minLength: 1,
    maxLength: 100,
    description: 'Related entity type (e.g., student, staff)',
  }),
  entityId: Type.String({ minLength: 1, maxLength: 255, description: 'Related entity ID' }),
  institutionId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Institution context' }),
  ),
  areaId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Area hierarchy context' }),
  ),
  assignedTo: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Assigned user or role' }),
  ),
  priority: Type.Optional(
    Type.Union(
      [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('critical')],
      { description: 'Case priority level' },
    ),
  ),
  workflowInstanceId: Type.Optional(
    Type.String({ pattern: UUID_PATTERN, description: 'Linked workflow instance' }),
  ),
  attachments: Type.Optional(
    Type.Array(CaseAttachmentSchema, { description: 'Initial attachments' }),
  ),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Additional case metadata' }),
  ),
});

export type CreateCaseInput = Static<typeof CreateCaseSchema>;

// ─── Update Case Schema ──────────────────────────────────────────────────────

export const UpdateCaseSchema = Type.Object({
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 255, description: 'Case title' })),
  description: Type.Optional(
    Type.String({ minLength: 1, maxLength: 5000, description: 'Case description' }),
  ),
  status: Type.Optional(CaseStatusEnum),
  assignedTo: Type.Optional(
    Type.String({ minLength: 1, maxLength: 255, description: 'Assigned user or role' }),
  ),
  priority: Type.Optional(
    Type.Union(
      [Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('critical')],
      { description: 'Case priority level' },
    ),
  ),
  metadata: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), { description: 'Additional case metadata' }),
  ),
});

export type UpdateCaseInput = Static<typeof UpdateCaseSchema>;

// ─── Add Attachment Schema ───────────────────────────────────────────────────

export const AddAttachmentSchema = Type.Object({
  fileName: Type.String({ minLength: 1, maxLength: 255, description: 'Original file name' }),
  fileType: Type.String({ minLength: 1, maxLength: 100, description: 'MIME type of the file' }),
  fileSize: Type.Number({ minimum: 1, description: 'File size in bytes' }),
  storagePath: Type.String({ minLength: 1, maxLength: 500, description: 'Storage path or URL' }),
  uploadedBy: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'User who uploaded the file',
  }),
});

export type AddAttachmentInput = Static<typeof AddAttachmentSchema>;

// ─── Resolve Case Schema ─────────────────────────────────────────────────────

export const ResolveCaseSchema = Type.Object({
  outcome: Type.String({
    minLength: 1,
    maxLength: 500,
    description: 'Resolution outcome description',
  }),
  resolvedBy: Type.String({
    minLength: 1,
    maxLength: 255,
    description: 'User who resolved the case',
  }),
  notes: Type.Optional(
    Type.String({ maxLength: 2000, description: 'Additional resolution notes' }),
  ),
  followUpRequired: Type.Optional(Type.Boolean({ description: 'Whether follow-up is required' })),
  followUpDate: Type.Optional(Type.String({ description: 'ISO date for follow-up' })),
});

export type ResolveCaseInput = Static<typeof ResolveCaseSchema>;

// ─── Case Params Schema ──────────────────────────────────────────────────────

export const CaseParamsSchema = Type.Object({
  caseId: Type.String({
    pattern: UUID_PATTERN,
    description: 'Case UUID',
  }),
});

export type CaseParams = Static<typeof CaseParamsSchema>;

// ─── Case List Query Schema ──────────────────────────────────────────────────

export const CaseListQuerySchema = Type.Object({
  page: Type.Optional(Type.Number({ minimum: 1, default: 1 })),
  pageSize: Type.Optional(Type.Number({ minimum: 1, maximum: 100, default: 20 })),
  type: Type.Optional(CaseTypeEnum),
  status: Type.Optional(CaseStatusEnum),
  entityType: Type.Optional(Type.String({ description: 'Filter by entity type' })),
  entityId: Type.Optional(Type.String({ description: 'Filter by entity ID' })),
  assignedTo: Type.Optional(Type.String({ description: 'Filter by assignee' })),
});

export type CaseListQuery = Static<typeof CaseListQuerySchema>;

// ─── Case Response Schema ────────────────────────────────────────────────────

export const CaseResponseSchema = Type.Object({
  id: Type.String(),
  tenantId: Type.String(),
  type: CaseTypeEnum,
  title: Type.String(),
  description: Type.String(),
  status: CaseStatusEnum,
  entityType: Type.String(),
  entityId: Type.String(),
  institutionId: Type.Union([Type.String(), Type.Null()]),
  areaId: Type.Union([Type.String(), Type.Null()]),
  assignedTo: Type.Union([Type.String(), Type.Null()]),
  priority: Type.Union([Type.String(), Type.Null()]),
  workflowInstanceId: Type.Union([Type.String(), Type.Null()]),
  attachments: Type.Array(CaseAttachmentSchema),
  resolution: Type.Union([CaseResolutionSchema, Type.Null()]),
  metadata: Type.Union([Type.Record(Type.String(), Type.Unknown()), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});

export type CaseResponse = Static<typeof CaseResponseSchema>;
