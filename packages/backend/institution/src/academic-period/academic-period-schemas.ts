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
