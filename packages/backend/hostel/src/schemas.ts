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

export const CreateLeaveSchema = Type.Object({
  studentId: Type.String({ pattern: UUID_PATTERN }),
  hostelId: Type.String({ pattern: UUID_PATTERN }),
  startDate: Type.String({ minLength: 10, maxLength: 10 }),
  endDate: Type.String({ minLength: 10, maxLength: 10 }),
  reason: Type.Optional(Type.String({ maxLength: 1000 })),
});

export type CreateLeaveInput = Static<typeof CreateLeaveSchema>;

export const LeaveParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type LeaveParams = Static<typeof LeaveParamsSchema>;

export const DecideLeaveSchema = Type.Object({
  status: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
});

export type DecideLeaveInput = Static<typeof DecideLeaveSchema>;

export const VisitorParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type VisitorParams = Static<typeof VisitorParamsSchema>;

export const UpdateVisitorStatusSchema = Type.Object({
  status: Type.Union([
    Type.Literal('checked_in'),
    Type.Literal('checked_out'),
    Type.Literal('denied'),
  ]),
});

export type UpdateVisitorStatusInput = Static<typeof UpdateVisitorStatusSchema>;

export const CreateVisitorSchema = Type.Object({
  hostelId: Type.String({ pattern: UUID_PATTERN }),
  visitorName: Type.String({ minLength: 1, maxLength: 255 }),
  studentId: Type.String({ pattern: UUID_PATTERN }),
  visitDate: Type.String({ minLength: 10, maxLength: 10 }),
});

export type CreateVisitorInput = Static<typeof CreateVisitorSchema>;

export const CreateBlockSchema = Type.Object({
  hostelId: Type.String({ pattern: UUID_PATTERN }),
  name: Type.String({ minLength: 1, maxLength: 255 }),
  floor: Type.Optional(Type.Number()),
});

export type CreateBlockInput = Static<typeof CreateBlockSchema>;

export const CreateRoomSchema = Type.Object({
  blockId: Type.String({ pattern: UUID_PATTERN }),
  roomNumber: Type.String({ minLength: 1, maxLength: 32 }),
  capacity: Type.Optional(Type.Number({ minimum: 1 })),
});

export type CreateRoomInput = Static<typeof CreateRoomSchema>;

export const CreateBedSchema = Type.Object({
  roomId: Type.String({ pattern: UUID_PATTERN }),
  bedLabel: Type.String({ minLength: 1, maxLength: 32 }),
  isAvailable: Type.Optional(Type.Boolean()),
});

export type CreateBedInput = Static<typeof CreateBedSchema>;
