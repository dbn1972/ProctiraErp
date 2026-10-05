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
/** PRC-H091: leave types that consume a tracked balance (unpaid never does). */
export const BALANCE_LEAVE_TYPES = ['annual', 'sick', 'casual', 'other'] as const;
export const StaffLeaveBalanceParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN }),
});
export type StaffLeaveBalanceParams = Static<typeof StaffLeaveBalanceParamsSchema>;
export const SetStaffLeaveBalanceSchema = Type.Object(
  {
    leaveType: Type.Union(BALANCE_LEAVE_TYPES.map((t) => Type.Literal(t))),
    balanceDays: Type.Number({ minimum: 0, maximum: 366, multipleOf: 0.5 }),
  },
  { additionalProperties: false },
);
export type SetStaffLeaveBalanceInput = Static<typeof SetStaffLeaveBalanceSchema>;
/** PRC-H091: bulk opening-balance import (all-or-nothing). */
export const MAX_LEAVE_BALANCE_IMPORT_ROWS = 2000;
export const ImportStaffLeaveBalancesSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          staffId: Type.String({ pattern: UUID_PATTERN }),
          leaveType: Type.Union(BALANCE_LEAVE_TYPES.map((t) => Type.Literal(t))),
          balanceDays: Type.Number({ minimum: 0, maximum: 366, multipleOf: 0.5 }),
        },
        { additionalProperties: false },
      ),
      { minItems: 1, maxItems: MAX_LEAVE_BALANCE_IMPORT_ROWS },
    ),
    /** Validate only (staff existence, duplicates); write nothing. */
    dryRun: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);
export type ImportStaffLeaveBalancesInput = Static<typeof ImportStaffLeaveBalancesSchema>;
