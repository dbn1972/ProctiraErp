/**
 * Zod schemas for attendance forms.
 *
 * Mirrors the Typebox schemas in `@proctira/backend-attendance`:
 *   - Attendance dates must be current or past (Requirement 9.7).
 *   - Class roster entries map student → status with optional comment.
 */
import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

const isoDate = z
  .string()
  .min(1, 'Date is required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format');

export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
]);

export type AttendanceStatusValue = z.infer<typeof attendanceStatusSchema>;

export const attendanceMarkingFormSchema = z
  .object({
    institutionId: uuid,
    classId: uuid,
    academicPeriodId: uuid,
    date: isoDate,
    records: z
      .array(
        z.object({
          studentId: uuid,
          status: attendanceStatusSchema,
          comment: z.string().max(500).optional().or(z.literal('')),
        }),
      )
      .min(1, 'Cannot record an empty roster'),
  })
  .refine(
    (d) => {
      // Compare YYYY-MM-DD strings for "no future dates" rule.
      const today = new Date().toISOString().slice(0, 10);
      return d.date <= today;
    },
    { message: 'Attendance date cannot be in the future', path: ['date'] },
  );

export type AttendanceMarkingFormValues = z.infer<
  typeof attendanceMarkingFormSchema
>;

export const attendanceReportFiltersSchema = z
  .object({
    scope: z.enum(['student', 'class', 'institution']),
    institutionId: uuid.optional().or(z.literal('')),
    classId: uuid.optional().or(z.literal('')),
    studentId: uuid.optional().or(z.literal('')),
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  });

export type AttendanceReportFiltersValues = z.infer<
  typeof attendanceReportFiltersSchema
>;
