/**
 * Zod schemas for attendance forms.
 *
 * Mirrors the Typebox schemas in `@proctira/backend-attendance`:
 *   - Attendance dates must be current or past (Requirement 9.7).
 *   - Class roster entries map student → status with optional comment.
 */
import { z } from 'zod';
import { isoDate, todayInTimeZone } from './zod-helpers';

const uuid = z.string().uuid('Must be a valid UUID');

export const attendanceStatusSchema = z.enum([
  'PRESENT',
  'ABSENT',
  'LATE',
  'EXCUSED',
  'EARLY_DEPARTURE',
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
      .min(1, 'Cannot record an empty roster')
      .max(1000, 'At most 1000 students per submission')
      .refine((rows) => new Set(rows.map((r) => r.studentId)).size === rows.length, {
        message: 'Each student can only be marked once',
      }),
  })
  .refine(
    (d) => {
      // Compare YYYY-MM-DD strings for "no future dates" rule, using the tenant's
      // wall-clock day (PRC-M494) rather than the UTC date.
      const today = todayInTimeZone();
      return d.date <= today;
    },
    { message: 'Attendance date cannot be in the future', path: ['date'] },
  );

export type AttendanceMarkingFormValues = z.infer<typeof attendanceMarkingFormSchema>;

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

export type AttendanceReportFiltersValues = z.infer<typeof attendanceReportFiltersSchema>;
