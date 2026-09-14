/**
 * Typebox schemas for W1-SEC-06 privacy lifecycle (complete slice).
 */
import { Type, type Static } from '@sinclair/typebox';

export const LegalHoldScopeEnum = Type.Union([Type.Literal('tenant'), Type.Literal('subject')]);
export type LegalHoldScope = Static<typeof LegalHoldScopeEnum>;

export const ErasureStatusEnum = Type.Union([
  Type.Literal('requested'),
  Type.Literal('under_review'),
  Type.Literal('approved'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
  Type.Literal('blocked_legal_hold'),
]);
export type ErasureStatus = Static<typeof ErasureStatusEnum>;

export const ErasureRequestTypeEnum = Type.Union([
  Type.Literal('erasure'),
  Type.Literal('anonymization'),
]);
export type ErasureRequestType = Static<typeof ErasureRequestTypeEnum>;

export const CorrectionStatusEnum = Type.Union([
  Type.Literal('requested'),
  Type.Literal('under_review'),
  Type.Literal('approved'),
  Type.Literal('applied'),
  Type.Literal('rejected'),
  Type.Literal('cancelled'),
]);
export type CorrectionStatus = Static<typeof CorrectionStatusEnum>;

export const AnonymizationJobStatusEnum = Type.Union([
  Type.Literal('queued'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('blocked_legal_hold'),
]);
export type AnonymizationJobStatus = Static<typeof AnonymizationJobStatusEnum>;

export const OffboardJobStatusEnum = Type.Union([
  Type.Literal('requested'),
  Type.Literal('queued'),
  Type.Literal('in_progress'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('blocked_legal_hold'),
  Type.Literal('cancelled'),
]);
export type OffboardJobStatus = Static<typeof OffboardJobStatusEnum>;

export const PlaceLegalHoldSchema = Type.Object({
  tenantId: Type.String({ minLength: 1 }),
  scope: LegalHoldScopeEnum,
  subjectType: Type.Optional(Type.String({ minLength: 1 })),
  subjectId: Type.Optional(Type.String({ minLength: 1 })),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  placedBy: Type.String({ minLength: 1 }),
});
export type PlaceLegalHoldInput = Static<typeof PlaceLegalHoldSchema>;

export const CreateErasureRequestSchema = Type.Object({
  tenantId: Type.String({ minLength: 1 }),
  subjectType: Type.String({ minLength: 1 }),
  subjectId: Type.String({ minLength: 1 }),
  requestType: Type.Optional(ErasureRequestTypeEnum),
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
  requestedBy: Type.String({ minLength: 1 }),
});
export type CreateErasureRequestInput = Static<typeof CreateErasureRequestSchema>;

export const CreateCorrectionRequestSchema = Type.Object({
  tenantId: Type.String({ minLength: 1 }),
  subjectType: Type.String({ minLength: 1 }),
  subjectId: Type.String({ minLength: 1 }),
  fieldPath: Type.String({ minLength: 1, maxLength: 500 }),
  currentValue: Type.Optional(Type.String({ maxLength: 4000 })),
  requestedValue: Type.String({ minLength: 1, maxLength: 4000 }),
  reason: Type.Optional(Type.String({ maxLength: 2000 })),
  requestedBy: Type.String({ minLength: 1 }),
});
export type CreateCorrectionRequestInput = Static<typeof CreateCorrectionRequestSchema>;

export const RequestTenantOffboardSchema = Type.Object({
  tenantId: Type.String({ minLength: 1 }),
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  requestedBy: Type.String({ minLength: 1 }),
});
export type RequestTenantOffboardInput = Static<typeof RequestTenantOffboardSchema>;
