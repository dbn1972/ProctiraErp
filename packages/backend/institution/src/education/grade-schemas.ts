/**
 * Typebox schemas for Education Grade CRUD operations.
 */
import { Type, type Static } from '@sinclair/typebox';

export const CreateGradeSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  order: Type.Integer({ minimum: 0, maximum: 32767 }),
});
export type CreateGradeDto = Static<typeof CreateGradeSchema>;

export const UpdateGradeSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  order: Type.Optional(Type.Integer({ minimum: 0, maximum: 32767 })),
});
export type UpdateGradeDto = Static<typeof UpdateGradeSchema>;

export const GradeResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  order: Type.Integer(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type GradeResponse = Static<typeof GradeResponseSchema>;
