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

/** PRC-M192: closed set of delivery channels. */
export const CommunicationChannelSchema = Type.Union([
  Type.Literal('email'),
  Type.Literal('sms'),
  Type.Literal('push'),
  Type.Literal('in_app'),
  Type.Literal('whatsapp'),
]);
/** PRC-M192: serialized audienceJson cap (bytes). */
export const MAX_AUDIENCE_JSON_BYTES = 16 * 1024;
// ISO-8601 date-time with timezone (no `format` keyword dependency).
const ISO_DATE_TIME_PATTERN =
  '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}(:\\d{2}(\\.\\d{1,6})?)?(Z|[+-]\\d{2}:\\d{2})$';
export const CreateCampaignSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  channels: Type.Optional(
    Type.Array(CommunicationChannelSchema, { maxItems: 5, uniqueItems: true }),
  ),
  body: Type.Optional(Type.String({ maxLength: 20_000 })),
  audienceJson: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  scheduledAt: Type.Optional(Type.String({ pattern: ISO_DATE_TIME_PATTERN })),
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
  channels: Type.Array(CommunicationChannelSchema, { minItems: 1, maxItems: 5, uniqueItems: true }),
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
