import { Type, type Static } from '@sinclair/typebox';

export const UUID_PATTERN =
  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';

export const ENQUIRY_SOURCES = ['website', 'walk_in', 'referral', 'campaign', 'other'] as const;
export type EnquirySource = (typeof ENQUIRY_SOURCES)[number];

export const ENQUIRY_STAGES = [
  'new',
  'contacted',
  'qualified',
  'applied',
  'lost',
  'waitlisted',
] as const;
export type EnquiryStage = (typeof ENQUIRY_STAGES)[number];

export const FOLLOWUP_STATUSES = ['open', 'done', 'cancelled'] as const;
export type FollowupStatus = (typeof FOLLOWUP_STATUSES)[number];

export const OFFER_STATUSES = ['draft', 'sent', 'accepted', 'declined', 'expired'] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

const Uuid = Type.String({ pattern: UUID_PATTERN });
const DateOnly = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' });

export const EnquirySourceSchema = Type.Union(ENQUIRY_SOURCES.map((s) => Type.Literal(s)));
export const EnquiryStageSchema = Type.Union(ENQUIRY_STAGES.map((s) => Type.Literal(s)));
export const FollowupStatusSchema = Type.Union(FOLLOWUP_STATUSES.map((s) => Type.Literal(s)));
export const OfferStatusSchema = Type.Union(OFFER_STATUSES.map((s) => Type.Literal(s)));

export const CreateEnquirySchema = Type.Object({
  institutionId: Uuid,
  academicPeriodId: Uuid,
  gradeId: Uuid,
  quota: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  source: Type.Optional(EnquirySourceSchema),
  firstName: Type.String({ minLength: 1, maxLength: 100 }),
  lastName: Type.String({ minLength: 1, maxLength: 100 }),
  dateOfBirth: DateOnly,
  gender: Type.Optional(Type.String({ minLength: 1, maxLength: 20 })),
  guardianName: Type.String({ minLength: 1, maxLength: 200 }),
  guardianPhone: Type.String({ minLength: 1, maxLength: 50 }),
  guardianEmail: Type.Optional(Type.String({ maxLength: 254 })),
  interviewScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  testScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
  institutionName: Type.Optional(Type.String({ maxLength: 200 })),
});
export type CreateEnquiryDto = Static<typeof CreateEnquirySchema>;

export const UpdateEnquirySchema = Type.Object({
  stage: Type.Optional(EnquiryStageSchema),
  source: Type.Optional(EnquirySourceSchema),
  interviewScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  testScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
  quota: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
});
export type UpdateEnquiryDto = Static<typeof UpdateEnquirySchema>;

export const CreateFollowupSchema = Type.Object({
  dueAt: Type.String({ minLength: 1 }),
  ownerId: Type.Optional(Type.String({ maxLength: 100 })),
  notes: Type.Optional(Type.String({ maxLength: 2000 })),
});
export type CreateFollowupDto = Static<typeof CreateFollowupSchema>;

export const UpsertSeatMatrixSchema = Type.Object({
  institutionId: Uuid,
  academicPeriodId: Uuid,
  gradeId: Uuid,
  quota: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  seats: Type.Integer({ minimum: 0, maximum: 100000 }),
});
export type UpsertSeatMatrixDto = Static<typeof UpsertSeatMatrixSchema>;

export const GenerateMeritListSchema = Type.Object({
  institutionId: Uuid,
  academicPeriodId: Uuid,
  gradeId: Uuid,
  interviewWeight: Type.Number({ minimum: 0, maximum: 1 }),
  testWeight: Type.Number({ minimum: 0, maximum: 1 }),
});
export type GenerateMeritListDto = Static<typeof GenerateMeritListSchema>;

export const ApplicationPlacementSchema = Type.Object({
  academicPeriodId: Uuid,
  gradeId: Uuid,
  quota: Type.Optional(Type.String({ minLength: 1, maxLength: 50 })),
  interviewScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  testScore: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});
export type ApplicationPlacementDto = Static<typeof ApplicationPlacementSchema>;

export const CreateOfferSchema = Type.Object({
  applicationId: Uuid,
  meritListId: Type.Optional(Uuid),
  feeAmount: Type.Optional(Type.Number({ minimum: 0 })),
  feeCurrency: Type.Optional(Type.String({ minLength: 3, maxLength: 8 })),
  expiresAt: Type.Optional(Type.String({ minLength: 1 })),
  offerFeeInvoiceId: Type.Optional(Uuid),
});
export type CreateOfferDto = Static<typeof CreateOfferSchema>;

export const AcceptOfferSchema = Type.Object({
  paymentRef: Type.String({ minLength: 1, maxLength: 100 }),
  offerFeeInvoiceId: Type.Optional(Uuid),
});
export type AcceptOfferDto = Static<typeof AcceptOfferSchema>;

export const IdParamsSchema = Type.Object({
  id: Uuid,
});
export type IdParams = Static<typeof IdParamsSchema>;
