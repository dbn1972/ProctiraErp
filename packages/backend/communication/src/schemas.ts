/**
 * Typebox schemas for Communication API validation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const CampaignStatusEnum = Type.Union([
  Type.Literal('draft'),
  Type.Literal('scheduled'),
  Type.Literal('sending'),
  Type.Literal('sent'),
  Type.Literal('failed'),
]);

export const CreateCampaignSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  channels: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
  body: Type.Optional(Type.String()),
  audienceJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  scheduledAt: Type.Optional(Type.String()),
  // PRC-H045: creator identity is derived from the verified session server-side, never accepted
  // from the client. Any client-supplied createdBy is ignored.
});

export type CreateCampaignInput = Static<typeof CreateCampaignSchema>;

export const CampaignParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type CampaignParams = Static<typeof CampaignParamsSchema>;

export const CreateEmergencyBlastSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  channels: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  // PRC-H045: creator identity is derived from the verified session server-side.
});

export type CreateEmergencyBlastInput = Static<typeof CreateEmergencyBlastSchema>;

export const EmergencyParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type EmergencyParams = Static<typeof EmergencyParamsSchema>;

export const ConfirmEmergencySchema = Type.Object({
  // PRC-H045: the confirming actor is taken from the verified session, never the body — a single
  // authenticated user cannot satisfy the two-person rule by posting two fabricated actor ids.
});

export type ConfirmEmergencyInput = Static<typeof ConfirmEmergencySchema>;

export const AudiencePreviewSchema = Type.Object({
  audienceJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export type AudiencePreviewInput = Static<typeof AudiencePreviewSchema>;
