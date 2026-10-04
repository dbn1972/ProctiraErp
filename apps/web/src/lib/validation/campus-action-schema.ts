/**
 * Shared input validation for campus (hostel / library) and communication
 * server actions. Ids are validated before any gateway call so values such as
 * `../x` never reach a gateway path (PRC-L033).
 */
import { z } from 'zod';

/** Entity id — same shape as the gateway Typebox `format: 'uuid'`. */
export const actionIdSchema = z.string().uuid();

/** Calendar date `YYYY-MM-DD`. */
export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');

/** ISO-8601 date or date-time accepted by the gateway. */
export const isoDateTimeSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Expected an ISO date/time');

export const INVALID_ID_MESSAGE = 'Invalid identifier.';

/** True when every value is a well-formed entity id. */
export function areValidActionIds(...ids: unknown[]): boolean {
  return ids.every((id) => actionIdSchema.safeParse(id).success);
}

export const hostelAssignmentInputSchema = z
  .object({
    studentId: actionIdSchema,
    bedId: actionIdSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema.optional(),
    feeStructureId: actionIdSchema.optional(),
  })
  .refine((v) => !v.endDate || v.endDate >= v.startDate, {
    message: 'End date must be on or after start date.',
    path: ['endDate'],
  });

export const hostelLeaveInputSchema = z
  .object({
    studentId: actionIdSchema,
    hostelId: actionIdSchema,
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: z.string().max(1000).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must be on or after start date.',
    path: ['endDate'],
  });

export const hostelVisitorInputSchema = z.object({
  hostelId: actionIdSchema,
  visitorName: z.string().trim().min(1).max(255),
  studentId: actionIdSchema,
  visitDate: isoDateSchema,
});

export const libraryCheckoutInputSchema = z.object({
  itemId: actionIdSchema,
  patronUserId: actionIdSchema.optional(),
  studentId: actionIdSchema.optional(),
  dueAt: isoDateTimeSchema.optional(),
});

/** Gate pass: return must be after leaving. */
export const gatePassWindowSchema = z
  .object({ expectedOutAt: isoDateTimeSchema, expectedInAt: isoDateTimeSchema })
  .refine((v) => Date.parse(v.expectedOutAt) < Date.parse(v.expectedInAt), {
    message: 'Expected return must be after expected departure.',
    path: ['expectedInAt'],
  });

/** First validation message, for action error states. */
export function firstIssue(error: z.ZodError, fallback: string): string {
  const issue = error.issues[0];
  return issue ? `${issue.path.join('.') || 'input'}: ${issue.message}` : fallback;
}
