/**
 * Zod schemas for dashboard server actions that previously forwarded their
 * arguments unchecked (PRC-L232 / PRC-L241). Shapes mirror the `lib/api`
 * input types and the gateway TypeBox contracts: ids are UUIDs, enums are
 * closed, arrays are bounded, numbers are finite integers in range, and free
 * text is length-capped. Client forms import the same schemas.
 */
import { z } from 'zod';
import { isoDateTimeSchema } from './campus-action-schema';
import {
  actionIdListSchema,
  actionIdSchema,
  isoDateSchema,
  timeOfDaySchema,
} from './server-action-input';

const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code');
const amountCentsSchema = z.number().int().min(0).max(1_000_000_000_000);
const text = (max: number) => z.string().max(max);
const required = (max: number) => z.string().trim().min(1).max(max);
/** Optional field; forms send '' for "not set", which is treated as absent. */
const opt = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
/** Optional reference that the gateway accepts as null ("none"). */
const nullableId = z.preprocess((value) => (value === '' ? null : value), actionIdSchema.nullish());

// ─── Fees ────────────────────────────────────────────────────────────────────
export const feePlanInputSchema = z.object({
  code: opt(text(64)),
  name: required(255),
  description: opt(text(2000)),
  amountCents: amountCentsSchema,
  currency: opt(currencySchema),
  frequency: opt(z.enum(['once', 'term', 'month', 'year'])),
});

export const invoiceInputSchema = z.object({
  studentId: actionIdSchema,
  planId: opt(actionIdSchema),
  title: opt(text(255)),
  description: opt(text(2000)),
  amountCents: opt(amountCentsSchema),
  currency: opt(currencySchema),
  dueAt: opt(isoDateTimeSchema),
});

// ─── Health ──────────────────────────────────────────────────────────────────
export const counsellingSessionInputSchema = z.object({
  studentId: actionIdSchema,
  counsellorId: actionIdSchema,
  sessionDate: isoDateTimeSchema,
  sessionType: z.enum(['individual', 'group', 'family', 'crisis']),
  reason: required(2000),
  caseNotes: text(20_000),
  outcome: opt(text(5000)),
  followUpRequired: z.boolean(),
  followUpDate: opt(isoDateTimeSchema),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no-show']),
});

export const allergyInputSchema = z.object({
  studentId: actionIdSchema,
  allergyType: required(120),
  description: required(2000),
  severity: z.enum(['mild', 'moderate', 'severe', 'life-threatening']),
  reaction: opt(text(2000)),
  treatment: opt(text(2000)),
  diagnosedDate: opt(isoDateTimeSchema),
});

export const vaccinationInputSchema = z.object({
  studentId: actionIdSchema,
  vaccineName: required(255),
  doseNumber: z.number().int().min(1).max(20),
  dateAdministered: isoDateTimeSchema,
  administeredBy: opt(text(255)),
  batchNumber: opt(text(120)),
  nextDueDate: opt(isoDateTimeSchema),
  notes: opt(text(5000)),
});

export const nurseIncidentInputSchema = z.object({
  studentId: actionIdSchema,
  institutionId: opt(actionIdSchema),
  incidentAt: isoDateTimeSchema,
  category: required(120),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  notes: opt(text(5000)),
  reportedBy: required(255),
});

// ─── Reports / pipelines ─────────────────────────────────────────────────────
export const importJobInputSchema = z.object({
  source: z.enum(['EXCEL', 'CSV', 'DATABASE']),
  filename: required(255),
  rows: opt(z.number().int().min(0).max(10_000_000)),
});

export const pipelineInputSchema = z.object({
  name: required(255),
  sourceType: z.enum(['csv', 'rest_api']),
});

// ─── Scholarships ────────────────────────────────────────────────────────────
const slotsSchema = z.number().int().min(1).max(1_000_000);
const awardSchema = z.number().finite().min(0).max(1_000_000_000);

export const scholarshipProgramInputSchema = z
  .object({
    name: required(255),
    code: opt(text(64)),
    description: opt(text(5000)),
    applicationStartDate: isoDateTimeSchema,
    applicationEndDate: isoDateTimeSchema,
    totalSlots: slotsSchema,
    awardAmount: awardSchema,
    currency: opt(currencySchema),
    eligibilityNotes: opt(text(5000)),
  })
  .refine((v) => Date.parse(v.applicationEndDate) >= Date.parse(v.applicationStartDate), {
    message: 'Application end must be on or after the start.',
    path: ['applicationEndDate'],
  });

export const scholarshipProgramUpdateSchema = z.object({
  name: opt(required(255)),
  description: opt(text(5000)),
  applicationStartDate: opt(isoDateTimeSchema),
  applicationEndDate: opt(isoDateTimeSchema),
  totalSlots: opt(slotsSchema),
  amountPerRecipient: opt(awardSchema),
  currency: opt(currencySchema),
  status: opt(z.enum(['draft', 'open', 'closed', 'archived'])),
});

// ─── Staff leave ─────────────────────────────────────────────────────────────
export const staffLeaveInputSchema = z
  .object({
    staffId: actionIdSchema,
    leaveType: opt(z.enum(['annual', 'sick', 'casual', 'unpaid', 'other'])),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
    reason: opt(text(2000)),
  })
  .refine((v) => v.endDate >= v.startDate, {
    message: 'End date must be on or after start date.',
    path: ['endDate'],
  });

export const staffLeaveDecisionSchema = z.object({
  id: actionIdSchema,
  status: z.enum(['approved', 'rejected']),
});

// ─── LMS discussions ─────────────────────────────────────────────────────────
export const discussionPostInputSchema = z.object({
  threadId: actionIdSchema,
  body: required(10_000),
});
export const discussionFlagSchema = z.object({
  threadId: actionIdSchema,
  postId: opt(actionIdSchema),
  value: z.boolean(),
});

// ─── Timetable ───────────────────────────────────────────────────────────────
const dayOfWeekSchema = z.number().int().min(0).max(7);

export const periodInputSchema = z.object({
  bellScheduleId: actionIdSchema,
  academicPeriodId: actionIdSchema,
  name: required(120),
  periodOrder: z.number().int().min(0).max(100),
  startTime: timeOfDaySchema,
  endTime: timeOfDaySchema,
});

export const meetingInputSchema = z.object({
  institutionId: actionIdSchema,
  academicPeriodId: actionIdSchema,
  sectionId: actionIdSchema,
  staffId: actionIdSchema,
  periodId: actionIdSchema,
  dayOfWeek: dayOfWeekSchema,
  subjectId: nullableId,
  roomId: nullableId,
});

export const meetingRefSchema = z.object({
  institutionId: actionIdSchema,
  meetingId: actionIdSchema,
  sectionId: actionIdSchema,
});

export const substitutionInputSchema = z.object({
  sectionMeetingId: actionIdSchema,
  substituteStaffId: actionIdSchema,
  substitutionDate: isoDateSchema,
  reason: text(2000).nullish(),
});

export const sectionInputSchema = z.object({
  institutionId: actionIdSchema,
  academicPeriodId: actionIdSchema,
  name: required(120),
  code: opt(text(64)),
  capacity: opt(z.number().int().min(1).max(10_000)),
  primaryTeacherId: opt(actionIdSchema),
  defaultRoomId: opt(actionIdSchema),
});

export const sectionStudentSchema = z.object({
  institutionId: actionIdSchema,
  sectionId: actionIdSchema,
  studentId: actionIdSchema,
});

export const sectionBulkEnrollSchema = z.object({
  institutionId: actionIdSchema,
  sectionId: actionIdSchema,
  studentIds: actionIdListSchema(500),
});

export const sectionRefSchema = z.object({
  institutionId: actionIdSchema,
  sectionId: actionIdSchema,
});

export const generationJobInputSchema = z.object({
  institutionId: actionIdSchema,
  academicPeriodId: actionIdSchema,
  bellScheduleId: opt(actionIdSchema),
  persistMeetings: z.boolean().optional(),
  demands: z
    .array(
      z.object({
        sectionId: actionIdSchema,
        subjectId: actionIdSchema,
        staffId: actionIdSchema,
        periodsPerWeek: z.number().int().min(1).max(60),
        preferredRoomId: nullableId,
        enrollmentCount: opt(z.number().int().min(0).max(10_000)),
      }),
    )
    .min(1)
    .max(2000),
});

export const teacherAbsenceInputSchema = z.object({
  institutionId: actionIdSchema,
  staffId: actionIdSchema,
  absenceDate: isoDateSchema,
  reason: text(2000).nullish(),
});

// ─── Parent portal ───────────────────────────────────────────────────────────
export const parentThreadInputSchema = z.object({
  studentId: actionIdSchema,
  subject: required(255),
  body: required(10_000),
});
export const parentReplyInputSchema = z.object({
  threadId: actionIdSchema,
  body: required(10_000),
});
export const parentConsentDecisionSchema = z.object({
  id: actionIdSchema,
  status: z.enum(['approved', 'denied']),
});
export const guardianOfferAcceptSchema = z.object({
  offerId: actionIdSchema,
  paymentRef: required(255),
  offerFeeInvoiceId: opt(actionIdSchema),
});
