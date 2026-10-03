/**
 * Typebox schemas for circulars and delivery-log (G-922).
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

/** PRC-M193: max recipients per circular. */
export const MAX_CIRCULAR_RECIPIENTS = 5000;

export const CircularAudienceTypeSchema = Type.Union([
  Type.Literal('all'),
  Type.Literal('roles'),
  Type.Literal('classes'),
  Type.Literal('institution'),
]);

export const CreateCircularSchema = Type.Object({
  title: Type.String({ minLength: 1, maxLength: 255 }),
  body: Type.String({ minLength: 1, maxLength: 20_000 }),
  audienceType: CircularAudienceTypeSchema,
  audienceIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
  requiresAck: Type.Optional(Type.Boolean()),
  channels: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal('email'),
        Type.Literal('sms'),
        Type.Literal('push'),
        Type.Literal('in_app'),
        Type.Literal('whatsapp'),
      ]),
      { maxItems: 5, uniqueItems: true },
    ),
  ),
  // PRC-M193: bounded fan-out (de-duplicated server-side).
  recipientIds: Type.Optional(
    Type.Array(Type.String({ minLength: 1, maxLength: 128 }), {
      maxItems: MAX_CIRCULAR_RECIPIENTS,
    }),
  ),
  recipientLabels: Type.Optional(Type.Record(Type.String(), Type.String())),
  createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type CreateCircularInput = Static<typeof CreateCircularSchema>;

export const CircularParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type CircularParams = Static<typeof CircularParamsSchema>;

/**
 * PRC-M188: the recipient is resolved from the session. `recipientId` is only
 * honoured when it is the caller or one of the caller's linked identities
 * (e.g. a guardian acknowledging for a linked student).
 */
export const AckCircularSchema = Type.Object({
  recipientId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type AckCircularInput = Static<typeof AckCircularSchema>;

export const DeliveryLogQuerySchema = Type.Object({
  channel: Type.Optional(
    Type.Union([
      Type.Literal('email'),
      Type.Literal('sms'),
      Type.Literal('push'),
      Type.Literal('in_app'),
      Type.Literal('whatsapp'),
    ]),
  ),
  status: Type.Optional(
    Type.Union([
      Type.Literal('queued'),
      Type.Literal('sent'),
      Type.Literal('delivered'),
      Type.Literal('failed'),
    ]),
  ),
  sourceType: Type.Optional(
    Type.Union([Type.Literal('campaign'), Type.Literal('emergency'), Type.Literal('circular')]),
  ),
});
export type DeliveryLogQuery = Static<typeof DeliveryLogQuerySchema>;

export const DeliveryLogParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type DeliveryLogParams = Static<typeof DeliveryLogParamsSchema>;
