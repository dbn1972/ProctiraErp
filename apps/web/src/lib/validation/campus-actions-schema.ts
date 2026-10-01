/**
 * PRC-L241 — boundary schemas for hostel/library (campus-actions.ts),
 * infrastructure and curriculum server actions. Ids must be UUIDs so a
 * crafted value such as `../x` can never be interpolated into a gateway path;
 * counts and capacities are bounded integers; dates are ISO calendar dates.
 */
import { z } from 'zod';

export const uuid = z.string().uuid('Invalid id');
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a YYYY-MM-DD date');
const isoInstant = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date/time');
const capacity = z.number().int().min(0, 'Capacity cannot be negative').max(10_000);

/** First issue message from a failed parse, prefixed with the field path. */
export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return 'Invalid input';
  return issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message;
}

// ── Hostel ──────────────────────────────────────────────────────────────────
export const createHostelSchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(64),
  address: z.string().max(1000).optional(),
  capacity: capacity.optional(),
});
export const hostelAssignmentSchema = z.object({
  studentId: uuid,
  bedId: uuid,
  startDate: isoDate,
  endDate: isoDate.optional(),
  feeStructureId: uuid.optional(),
});
export const hostelLeaveSchema = z
  .object({
    studentId: uuid,
    hostelId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    reason: z.string().max(2000).optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'End date must be on or after the start date',
  });
export const decideLeaveSchema = z.object({
  id: uuid,
  status: z.enum(['approved', 'rejected']),
});
export const visitorStatusSchema = z.object({
  id: uuid,
  status: z.enum(['checked_in', 'checked_out', 'denied']),
});
export const hostelVisitorSchema = z.object({
  hostelId: uuid,
  visitorName: z.string().trim().min(1).max(200),
  studentId: uuid,
  visitDate: isoDate,
});
export const hostelBlockSchema = z.object({
  hostelId: uuid,
  name: z.string().trim().min(1).max(200),
  floor: z.number().int().min(-5).max(200).optional(),
});
export const hostelRoomSchema = z.object({
  blockId: uuid,
  roomNumber: z.string().trim().min(1).max(64),
  capacity: capacity.optional(),
});
export const hostelBedSchema = z.object({
  roomId: uuid,
  bedLabel: z.string().trim().min(1).max(64),
  isAvailable: z.boolean().optional(),
});

// ── Library ─────────────────────────────────────────────────────────────────
export const createLibraryItemSchema = z.object({
  title: z.string().trim().min(1).max(500),
  isbn: z.string().max(32).optional(),
  author: z.string().max(500).optional(),
  copies: z.number().int().min(1).max(10_000).optional(),
});
export const checkoutSchema = z.object({
  itemId: uuid,
  patronUserId: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[^/?#]+$/, 'Invalid patron')
    .optional(),
  studentId: uuid.optional(),
  dueAt: isoInstant.optional(),
});
export const renewSchema = z.object({
  loanId: uuid,
  extendDays: z.number().int().min(1).max(365).optional(),
});

// ── Infrastructure ──────────────────────────────────────────────────────────
const condition = z.enum(['Good', 'Fair', 'Needs repair', 'Unknown']);
export const repairRequestSchema = z.object({
  institutionId: uuid,
  infrastructureId: uuid,
  summary: z.string().trim().min(1, 'Describe the repair before submitting.').max(2000),
});
export const createRoomSchema = z.object({
  institutionId: uuid,
  floorId: uuid,
  name: z.string().trim().min(1).max(200),
  capacity,
  condition,
});
export const updateFacilitySchema = z.object({
  institutionId: uuid,
  id: uuid,
  name: z.string().trim().min(1).max(200),
  capacity,
  condition,
});

// ── Curriculum (update/delete actions without an existing schema) ──────────
export const curriculumIdSchema = z.object({ institutionId: uuid, id: uuid });
export const updateLessonPlanSchema = z.object({
  institutionId: uuid,
  id: uuid,
  title: z.string().trim().min(1).max(500),
  plannedDate: isoDate.optional().or(z.literal('')),
});
export const updateLearningOutcomeSchema = z.object({
  institutionId: uuid,
  id: uuid,
  code: z.string().trim().min(1).max(64),
  statement: z.string().trim().min(1).max(4000),
  unitId: uuid.optional().or(z.literal('')),
});
