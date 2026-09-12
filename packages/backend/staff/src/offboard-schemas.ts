/**
 * Thin offboard status stub schemas (P1-HR S0/S1).
 * Status + metadata only — not a full HCM offboarding product.
 */
import { Type, type Static } from '@sinclair/typebox';

const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const DATE_PATTERN = '^\\d{4}-\\d{2}-\\d{2}$';

export const OffboardStaffParamsSchema = Type.Object({
  id: Type.String({ pattern: UUID_PATTERN, description: 'Staff UUID' }),
});
export type OffboardStaffParams = Static<typeof OffboardStaffParamsSchema>;

export const OffboardStaffSchema = Type.Object({
  effectiveDate: Type.String({
    pattern: DATE_PATTERN,
    description: 'Last working / effective offboard date (YYYY-MM-DD)',
  }),
  reason: Type.Optional(
    Type.String({
      maxLength: 2000,
      description: 'Optional free-text reason (resignation, end of contract, …)',
    }),
  ),
});
export type OffboardStaffInput = Static<typeof OffboardStaffSchema>;

export const OffboardStatusResponseSchema = Type.Object({
  staffId: Type.String(),
  employmentStatus: Type.Union([Type.Literal('ACTIVE'), Type.Literal('INACTIVE')]),
  offboardStatus: Type.Union([Type.Literal('active'), Type.Literal('offboarded')]),
  effectiveDate: Type.Union([Type.String(), Type.Null()]),
  reason: Type.Union([Type.String(), Type.Null()]),
  decidedBy: Type.Union([Type.String(), Type.Null()]),
  decidedAt: Type.Union([Type.String(), Type.Null()]),
});
export type OffboardStatusResponse = Static<typeof OffboardStatusResponseSchema>;
