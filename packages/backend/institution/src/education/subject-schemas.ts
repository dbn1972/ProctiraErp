/**
 * Typebox schemas for Subject and InstitutionSubject CRUD operations.
 *
 * Subjects are tenant-level entities linked to grades within institutions
 * via the InstitutionSubject join model.
 */
import { Type, type Static } from '@sinclair/typebox';

export const CreateSubjectSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
});
export type CreateSubjectDto = Static<typeof CreateSubjectSchema>;

export const UpdateSubjectSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
});
export type UpdateSubjectDto = Static<typeof UpdateSubjectSchema>;

export const SubjectResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type SubjectResponse = Static<typeof SubjectResponseSchema>;

/**
 * Schema for linking a subject to a grade within an institution.
 */
export const LinkSubjectToGradeSchema = Type.Object({
  institutionId: Type.String({ format: 'uuid' }),
  subjectId: Type.String({ format: 'uuid' }),
  gradeId: Type.String({ format: 'uuid' }),
});
export type LinkSubjectToGradeDto = Static<typeof LinkSubjectToGradeSchema>;

export const InstitutionSubjectResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  institutionId: Type.String({ format: 'uuid' }),
  subjectId: Type.String({ format: 'uuid' }),
  gradeId: Type.String({ format: 'uuid' }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type InstitutionSubjectResponse = Static<typeof InstitutionSubjectResponseSchema>;
