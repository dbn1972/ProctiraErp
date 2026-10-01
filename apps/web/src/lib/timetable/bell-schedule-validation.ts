/**
 * Shared bell-schedule / period validation (PRC-L260).
 *
 * Used by the timetable server actions and the client forms so the user sees
 * the same rules before and after submit. Mirrors the backend TypeBox
 * patterns in `packages/backend/timetable/src/schemas.ts`.
 */
import { z } from 'zod';

/** Comma-separated ISO weekdays, 1=Mon … 7=Sun (e.g. "1,2,3,4,5"). */
export const DAY_PATTERN_REGEX = /^[1-7](,[1-7])*$/;
/** 24-hour HH:mm, 00:00–23:59. */
export const HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

export const dayPatternSchema = z
  .string()
  .trim()
  .regex(DAY_PATTERN_REGEX, 'Use comma-separated weekdays 1–7 (for example 1,2,3,4,5).')
  .refine((value) => new Set(value.split(',')).size === value.split(',').length, {
    message: 'Each weekday may appear only once.',
  });

export const bellScheduleInputSchema = z.object({
  name: z.string().trim().min(1, 'Schedule name is required.').max(255),
  dayPattern: dayPatternSchema,
});

const timeSchema = z.string().trim().regex(HHMM_REGEX, 'Use 24-hour time HH:mm (00:00–23:59).');

export const periodInputSchema = z
  .object({
    name: z.string().trim().min(1, 'Period name is required.').max(120),
    periodOrder: z.number().int().min(1, 'Order must be 1 or greater.'),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((value) => value.startTime < value.endTime, {
    message: 'End time must be after start time.',
    path: ['endTime'],
  });

/** Returns the first validation message, or null when the input is valid. */
export function firstIssue(result: { success: boolean; error?: z.ZodError }): string | null {
  if (result.success) return null;
  return result.error?.issues[0]?.message ?? 'Invalid input.';
}

/** User-facing copy for a missing timetable schema (no internal file names). */
export const TIMETABLE_NOT_PROVISIONED_MESSAGE =
  'The timetable module is not provisioned for this school yet. Contact your administrator.';
