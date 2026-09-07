/**
 * Typebox schemas for Staff HR leave API.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';

export const CreateStaffLeaveSchema = Type.Object({
  staffId: Type.String({ pattern: UUID_PATTERN }),
  leaveType: Type.Optional(
    Type.Union([
      Type.Literal('annual'),
      Type.Literal('sick'),
      Type.Literal('casual'),
      Type.Literal('unpaid'),
      Type.Literal('other'),
    ]),
  ),
  startDate: Type.String({ minLength: 10, maxLength: 10 }),
  endDate: Type.String({ minLength: 10, maxLength: 10 }),
  reason: Type.Optional(Type.String({ maxLength: 1000 })),
});

export type CreateStaffLeaveInput = Static<typeof CreateStaffLeaveSchema>;

export const StaffLeaveParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});

export type StaffLeaveParams = Static<typeof StaffLeaveParamsSchema>;

export const DecideStaffLeaveSchema = Type.Object({
  status: Type.Union([Type.Literal('approved'), Type.Literal('rejected')]),
});

export type DecideStaffLeaveInput = Static<typeof DecideStaffLeaveSchema>;
