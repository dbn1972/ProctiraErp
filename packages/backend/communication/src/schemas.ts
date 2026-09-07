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
  /** Actor id from session (UUID preferred; opaque string accepted for local auth). */
  createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type CreateCampaignInput = Static<typeof CreateCampaignSchema>;

export const CampaignParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type CampaignParams = Static<typeof CampaignParamsSchema>;

export const CreateEmergencyBlastSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  channels: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});

export type CreateEmergencyBlastInput = Static<typeof CreateEmergencyBlastSchema>;

export const EmergencyParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type EmergencyParams = Static<typeof EmergencyParamsSchema>;

export const ConfirmEmergencySchema = Type.Object({
  actorId: Type.String({ minLength: 1, maxLength: 128 }),
});

export type ConfirmEmergencyInput = Static<typeof ConfirmEmergencySchema>;
