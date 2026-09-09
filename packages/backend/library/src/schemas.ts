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
  barcode: Type.Optional(Type.String({ maxLength: 64 })),
  accessionNo: Type.Optional(Type.String({ maxLength: 64 })),
  publisher: Type.Optional(Type.String({ maxLength: 255 })),
  publishedYear: Type.Optional(Type.Number({ minimum: 1000, maximum: 9999 })),
});

export type CreateLibraryItemInput = Static<typeof CreateLibraryItemSchema>;

export const ImportIsbnSchema = Type.Object({
  isbn: Type.String({ minLength: 10, maxLength: 32 }),
  copies: Type.Optional(Type.Number({ minimum: 1 })),
});

export type ImportIsbnInput = Static<typeof ImportIsbnSchema>;

export const IsbnParamsSchema = Type.Object({
  isbn: Type.String({ minLength: 10, maxLength: 32 }),
});

export type IsbnParams = Static<typeof IsbnParamsSchema>;

export const ItemParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type ItemParams = Static<typeof ItemParamsSchema>;

export const HoldParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type HoldParams = Static<typeof HoldParamsSchema>;

export const FineParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type FineParams = Static<typeof FineParamsSchema>;

export const PlaceHoldSchema = Type.Object({
  itemId: Type.String({ pattern: UUID_PATTERN }),
  patronUserId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  studentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type PlaceHoldInput = Static<typeof PlaceHoldSchema>;

export const CheckoutSchema = Type.Object({
  itemId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  barcode: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  patronUserId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  studentId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  dueAt: Type.Optional(Type.String()),
});

export type CheckoutInput = Static<typeof CheckoutSchema>;

export const ReturnSchema = Type.Object({
  loanId: Type.String({ pattern: UUID_PATTERN }),
});

export type ReturnInput = Static<typeof ReturnSchema>;

export const RenewSchema = Type.Object({
  loanId: Type.String({ pattern: UUID_PATTERN }),
  extendDays: Type.Optional(Type.Number({ minimum: 1, maximum: 90 })),
});

export type RenewInput = Static<typeof RenewSchema>;

export const PatronParamsSchema = Type.Object({
  studentId: Type.String({ minLength: 1, maxLength: 128 }),
});

export type PatronParams = Static<typeof PatronParamsSchema>;

/** G-603 — assess overdue fine and post to fees ledger. */
export const AssessFineSchema = Type.Object({
  loanId: Type.String({ pattern: UUID_PATTERN }),
  amountCents: Type.Optional(Type.Number({ minimum: 1 })),
  centsPerDay: Type.Optional(Type.Number({ minimum: 1 })),
  capCents: Type.Optional(Type.Number({ minimum: 1 })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
});

export type AssessFineInput = Static<typeof AssessFineSchema>;

export const FinePolicySchema = Type.Object({
  centsPerDay: Type.Number({ minimum: 0 }),
  capCents: Type.Number({ minimum: 0 }),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
});

export type FinePolicyInput = Static<typeof FinePolicySchema>;

export const BarcodeQuerySchema = Type.Object({
  barcode: Type.String({ minLength: 1, maxLength: 64 }),
});

export type BarcodeQuery = Static<typeof BarcodeQuerySchema>;

export const ReturnBarcodeSchema = Type.Object({
  barcode: Type.String({ minLength: 1, maxLength: 64 }),
});

export type ReturnBarcodeInput = Static<typeof ReturnBarcodeSchema>;

export const OpacSearchQuerySchema = Type.Object({
  q: Type.Optional(Type.String({ maxLength: 200 })),
});

export type OpacSearchQuery = Static<typeof OpacSearchQuerySchema>;
