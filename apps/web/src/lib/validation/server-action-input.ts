/**
 * Shared server-action input schemas (PRC-L232 / PRC-L241).
 *
 * Every server action validates its arguments with zod before any gateway
 * call: ids are UUIDs (never `../x`), enums are closed, arrays are bounded and
 * numbers are finite. The same schemas are imported by client forms so the
 * browser and the action reject the same input.
 */
import { z } from 'zod';
import { actionIdSchema, isoDateSchema } from './campus-action-schema';

export { actionIdSchema, isoDateSchema };

export const optionalActionId = actionIdSchema.optional();
export const nullableActionId = actionIdSchema.nullish();
export const approveRejectSchema = z.enum(['approve', 'reject']);
/** `HH:MM` or `HH:MM:SS`, 24-hour. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Expected HH:MM (24-hour)');
export const trimmedText = (max: number) => z.string().trim().min(1).max(max);
export const optionalText = (max: number) => z.string().max(max).optional();
/** Bounded list of ids; mirrors the gateway's batch caps. */
export const actionIdListSchema = (max = 500) => z.array(actionIdSchema).min(1).max(max);
/** http(s) URL (attachments, links). */
export const httpUrlSchema = z
  .string()
  .max(2048)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), 'Only http(s) URLs are allowed');

export type ActionInputResult<T> = { ok: true; data: T } | { ok: false; message: string };

/** Parses `input`; on failure returns the first issue as `path: message`. */
export function parseActionInput<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  fallback = 'Invalid input.',
): ActionInputResult<z.infer<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const where = issue?.path.join('.');
  return {
    ok: false,
    message: issue ? (where ? `${where}: ${issue.message}` : issue.message) : fallback,
  };
}
