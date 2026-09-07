/**
 * Typebox schemas for Library API validation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const CreateLibraryItemSchema = Type.Object({
  isbn: Type.Optional(Type.String({ maxLength: 32 })),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  author: Type.Optional(Type.String({ maxLength: 255 })),
  copies: Type.Optional(Type.Number({ minimum: 1 })),
});

export type CreateLibraryItemInput = Static<typeof CreateLibraryItemSchema>;

export const CheckoutSchema = Type.Object({
  itemId: Type.String({ pattern: UUID_PATTERN }),
  patronUserId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  studentId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  dueAt: Type.Optional(Type.String()),
});

export type CheckoutInput = Static<typeof CheckoutSchema>;

export const ReturnSchema = Type.Object({
  loanId: Type.String({ pattern: UUID_PATTERN }),
});

export type ReturnInput = Static<typeof ReturnSchema>;
