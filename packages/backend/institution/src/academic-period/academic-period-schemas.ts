/**
 * Typebox schemas for Academic Period CRUD operations.
 */
import { Type, type Static } from '@sinclair/typebox';

/**
 * Valid academic period statuses with lifecycle transitions:
 * - active: period is currently in use, allows enrollment/attendance/assessment
 * - inactive: period is not currently active, no operations allowed
 * - archived: period is permanently closed, read-only
 */
export const AcademicPeriodStatus = Type.Union(
  [Type.Literal('active'), Type.Literal('inactive'), Type.Literal('archived')],
  { description: 'Academic period status' },
);
export type AcademicPeriodStatusType = Static<typeof AcademicPeriodStatus>;

/**
 * G-905 — period hierarchy. `year` is the top level; the others nest under a
 * year via `parentId` and must fall inside its date range.
 */
export const AcademicPeriodKind = Type.Union(
  [Type.Literal('year'), Type.Literal('semester'), Type.Literal('term'), Type.Literal('quarter')],
  { description: 'Academic period kind' },
);
export type AcademicPeriodKindType = Static<typeof AcademicPeriodKind>;

export const CreateAcademicPeriodSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  startDate: Type.String({ format: 'date', description: 'ISO date (YYYY-MM-DD)' }),
  endDate: Type.String({ format: 'date', description: 'ISO date (YYYY-MM-DD)' }),
  status: Type.Optional(AcademicPeriodStatus),
  kind: Type.Optional(AcademicPeriodKind),
  /** Owning academic year — required for every kind except `year`. */
  parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
});
export type CreateAcademicPeriodDto = Static<typeof CreateAcademicPeriodSchema>;

export const UpdateAcademicPeriodSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  startDate: Type.Optional(Type.String({ format: 'date' })),
  endDate: Type.Optional(Type.String({ format: 'date' })),
  status: Type.Optional(AcademicPeriodStatus),
  kind: Type.Optional(AcademicPeriodKind),
  parentId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
});
export type UpdateAcademicPeriodDto = Static<typeof UpdateAcademicPeriodSchema>;

/**
 * PRC-L321: body for POST /academic-periods/:id/supersede — the successor
 * version's corrected window. `code` defaults to (and must equal) the prior code.
 */
// Patterns rather than `format` — @proctira/validation registers no string formats.
const ISO_DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';
const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const SupersedeAcademicPeriodSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 100 }),
    code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
    startDate: Type.String({ pattern: ISO_DATE_PATTERN, description: 'ISO date (YYYY-MM-DD)' }),
    endDate: Type.String({ pattern: ISO_DATE_PATTERN, description: 'ISO date (YYYY-MM-DD)' }),
    status: Type.Optional(AcademicPeriodStatus),
    kind: Type.Optional(AcademicPeriodKind),
    parentId: Type.Optional(Type.Union([Type.String({ pattern: UUID_PATTERN }), Type.Null()])),
  },
  { additionalProperties: false },
);
export type SupersedeAcademicPeriodDto = Static<typeof SupersedeAcademicPeriodSchema>;

export const AcademicPeriodResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  startDate: Type.String(),
  endDate: Type.String(),
  status: Type.String(),
  kind: Type.String(),
  parentId: Type.Union([Type.String(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type AcademicPeriodResponse = Static<typeof AcademicPeriodResponseSchema>;
