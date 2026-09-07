/**
 * Typebox schemas for Parent Portal API validation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const LinkChildSchema = Type.Object({
  parentUserId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  studentId: Type.String({ pattern: UUID_PATTERN }),
  relationship: Type.Optional(
    Type.Union([
      Type.Literal('guardian'),
      Type.Literal('mother'),
      Type.Literal('father'),
      Type.Literal('other'),
    ]),
  ),
});

export type LinkChildInput = Static<typeof LinkChildSchema>;

export const CreateThreadSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  subject: Type.String({ minLength: 1, maxLength: 500 }),
  body: Type.String({ minLength: 1, maxLength: 10000 }),
});

export type CreateThreadInput = Static<typeof CreateThreadSchema>;

export const ThreadParamsSchema = Type.Object({
  threadId: Type.String({ pattern: UUID_PATTERN }),
});

export type ThreadParams = Static<typeof ThreadParamsSchema>;

export const AddMessageSchema = Type.Object({
  body: Type.String({ minLength: 1, maxLength: 10000 }),
  senderRole: Type.Optional(
    Type.Union([Type.Literal('parent'), Type.Literal('staff'), Type.Literal('system')]),
  ),
});

export type AddMessageInput = Static<typeof AddMessageSchema>;

export const CreateConsentSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  parentUserId: Type.String({ minLength: 1, maxLength: 128 }),
  consentType: Type.Union([
    Type.Literal('photo_media'),
    Type.Literal('medical_treatment'),
    Type.Literal('field_trip'),
    Type.Literal('data_sharing'),
    Type.Literal('other'),
  ]),
  title: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
});

export type CreateConsentInput = Static<typeof CreateConsentSchema>;

export const ConsentParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type ConsentParams = Static<typeof ConsentParamsSchema>;

export const DecideConsentSchema = Type.Object({
  status: Type.Union([Type.Literal('approved'), Type.Literal('denied')]),
});

export type DecideConsentInput = Static<typeof DecideConsentSchema>;

export const CreateFeePlanSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  amountCents: Type.Number({ minimum: 0 }),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  frequency: Type.Optional(
    Type.Union([
      Type.Literal('once'),
      Type.Literal('term'),
      Type.Literal('month'),
      Type.Literal('year'),
    ]),
  ),
});

export type CreateFeePlanInput = Static<typeof CreateFeePlanSchema>;

export const CreateInvoiceSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  planId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  amountCents: Type.Optional(Type.Number({ minimum: 0 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  dueAt: Type.Optional(Type.String()),
});

export type CreateInvoiceInput = Static<typeof CreateInvoiceSchema>;

export const InvoiceParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type InvoiceParams = Static<typeof InvoiceParamsSchema>;

export const ReceiptParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type ReceiptParams = Static<typeof ReceiptParamsSchema>;

export const PayInvoiceSchema = Type.Object({
  method: Type.Optional(
    Type.Union([
      Type.Literal('sandbox'),
      Type.Literal('upi'),
      Type.Literal('card'),
      Type.Literal('cash'),
    ]),
  ),
});

export type PayInvoiceInput = Static<typeof PayInvoiceSchema>;

export const StudentQuerySchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
});

export type StudentQuery = Static<typeof StudentQuerySchema>;
