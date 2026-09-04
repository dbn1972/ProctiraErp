import { Type, type Static } from '@sinclair/typebox';

export const BoardTypeSchema = Type.Union(
  [Type.Literal('NATIONAL'), Type.Literal('STATE'), Type.Literal('PRIVATE')],
  { description: 'Education board type' },
);
export type BoardTypeValue = Static<typeof BoardTypeSchema>;

export const CreateBoardSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.String({ minLength: 1, maxLength: 50 }),
  type: BoardTypeSchema,
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
});
export type CreateBoardDto = Static<typeof CreateBoardSchema>;

export const UpdateBoardSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  type: Type.Optional(BoardTypeSchema),
  status: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
});
export type UpdateBoardDto = Static<typeof UpdateBoardSchema>;

export const BoardResponseSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenantId: Type.String({ format: 'uuid' }),
  name: Type.String(),
  code: Type.String(),
  type: Type.String(),
  status: Type.String(),
  createdAt: Type.String(),
  updatedAt: Type.String(),
});
export type BoardResponse = Static<typeof BoardResponseSchema>;
