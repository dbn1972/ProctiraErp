/**
 * Typebox schemas for Parent Portal API validation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

// PRC-M317: ISO-8601 date-time (e.g. 2026-10-09T00:00:00Z or with ±hh:mm offset).
// Expressed as a pattern (not `format`) so it is enforced by TypeBox's value
// checker without depending on a registered ajv format.
const ISO_DATE_TIME_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d{1,3})?(Z|[+-]\\d{2}:\\d{2})$';

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
  isPrimary: Type.Optional(Type.Boolean()),
  canConsentMedical: Type.Optional(Type.Boolean()),
  canViewFees: Type.Optional(Type.Boolean()),
  householdId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
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
  // PRC-M314 / NEW-g4_apps_auth-003: senderRole is intentionally NOT accepted from
  // the client. It is derived server-side from the caller's verified JWT roles
  // (see parent-portal-messaging-access.ts) so a guardian/student cannot post as
  // 'staff'/'system' or bypass the guardian-link check.
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
  consentVersion: Type.String({ minLength: 1, maxLength: 64 }),
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

export const SupersedeConsentSchema = Type.Object({
  consentVersion: Type.String({ minLength: 1, maxLength: 64 }),
  title: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
});

export type SupersedeConsentInput = Static<typeof SupersedeConsentSchema>;

export const WithdrawConsentSchema = Type.Object({
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
});

export type WithdrawConsentInput = Static<typeof WithdrawConsentSchema>;

export const CreateFeePlanSchema = Type.Object({
  code: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  name: Type.String({ minLength: 1, maxLength: 500 }),
  description: Type.Optional(Type.String({ maxLength: 5000 })),
  // PRC-M317: integer cents only, bounded, to reject fractional/huge amounts that
  // would otherwise 500 downstream. ~1e13 cents = 100 billion major units.
  amountCents: Type.Integer({ minimum: 0, maximum: 1_000_000_000_000 }),
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
  // PRC-M317: integer cents only, bounded; date-time formatted dueAt.
  amountCents: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000_000_000 })),
  currency: Type.Optional(Type.String({ minLength: 3, maxLength: 3 })),
  dueAt: Type.Optional(Type.String({ pattern: ISO_DATE_TIME_PATTERN, maxLength: 40 })),
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

// PRC-C001: a self-service caller may only request the honest 'sandbox' method. Real
// settlement methods (upi/card/cash) must not be caller-selectable because this endpoint
// performs no PSP verification; they would falsely imply that money moved.
export const PayInvoiceSchema = Type.Object({
  method: Type.Optional(Type.Literal('sandbox')),
});

export type PayInvoiceInput = Static<typeof PayInvoiceSchema>;

export const ChildParamsSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
});

export type ChildParams = Static<typeof ChildParamsSchema>;

export const StudentQuerySchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
});

export type StudentQuery = Static<typeof StudentQuerySchema>;

export const OfferParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type OfferParams = Static<typeof OfferParamsSchema>;

export const AcceptGuardianOfferSchema = Type.Object({
  /** Informational only; never proof of payment (PRC-H079). */
  paymentRef: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  offerFeeInvoiceId: Type.Optional(Type.String({ pattern: UUID_PATTERN })),
});

export type AcceptGuardianOfferInput = Static<typeof AcceptGuardianOfferSchema>;
