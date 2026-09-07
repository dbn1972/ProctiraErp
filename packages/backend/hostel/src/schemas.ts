/**
 * Typebox schemas for Hostel API validation.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const CreateHostelSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
  code: Type.String({ minLength: 1, maxLength: 32 }),
  address: Type.Optional(Type.String({ maxLength: 500 })),
  capacity: Type.Optional(Type.Number({ minimum: 0 })),
});

export type CreateHostelInput = Static<typeof CreateHostelSchema>;

export const HostelParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type HostelParams = Static<typeof HostelParamsSchema>;

export const CreateAssignmentSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  bedId: Type.String({ pattern: UUID_PATTERN }),
  startDate: Type.String({ minLength: 10, maxLength: 10 }),
  endDate: Type.Optional(Type.String({ minLength: 10, maxLength: 10 })),
  isActive: Type.Optional(Type.Boolean()),
});

export type CreateAssignmentInput = Static<typeof CreateAssignmentSchema>;
