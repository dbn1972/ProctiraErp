/**
 * Typebox schemas for Class CRUD operations.
 *
 * Each class is assigned to exactly one grade and one academic period
 * within an institution.
 */
import { Type, type Static } from '@sinclair/typebox';

export const CreateClassSchema = Type.Object({
  institutionId: Type.String({ format: 'uuid' }),
  gradeId: Type.String({ format: 'uuid' }),
  academicPeriodId: Type.String({ format: 'uuid' }),
  name: Type.String({ minLength: 1, maxLength: 100 }),
  capacity: Type.Optional(Type.Integer({ minimum: 1, maximum: 32767 })),
});
export type CreateClassDto = Static<typeof CreateClassSchema>;

export const UpdateClassSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  capacity: Type.Optional(Type.Integer({ minimum: 1, maximum: 32767 })),
  gradeId: Type.Optional(Type.String({ format: 'uuid' })),
});
export type UpdateClassDto = Static<typeof UpdateClassSchema>;

export const ClassResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  institutionId: Type.String({ format: 'uuid' }),
  gradeId: Type.String({ format: 'uuid' }),
  academicPeriodId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  capacity: Type.Union([Type.Integer(), Type.Null()]),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type ClassResponse = Static<typeof ClassResponseSchema>;
