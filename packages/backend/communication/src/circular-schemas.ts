/**
 * Typebox schemas for circulars and delivery-log (G-922).
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

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
  channels: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: 8 })),
  recipientIds: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 128 }))),
  recipientLabels: Type.Optional(Type.Record(Type.String(), Type.String())),
  createdBy: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
});
export type CreateCircularInput = Static<typeof CreateCircularSchema>;

export const CircularParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type CircularParams = Static<typeof CircularParamsSchema>;

export const AckCircularSchema = Type.Object({
  recipientId: Type.String({ minLength: 1, maxLength: 128 }),
});
export type AckCircularInput = Static<typeof AckCircularSchema>;

export const DeliveryLogQuerySchema = Type.Object({
  channel: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
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
