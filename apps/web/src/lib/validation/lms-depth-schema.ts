import { z } from 'zod';
import { isHttpUrl } from '@/lib/safe-url';
import { refineScopeTarget } from './lms-schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL_MESSAGE = 'Enter a full http:// or https:// link';
/** User-supplied link — http(s) only (PRC-H024 / PRC-H033). */
const httpUrl = z.string().max(2048).refine(isHttpUrl, { message: HTTP_URL_MESSAGE });

function splitOptions(raw?: string): string[] {
  return (raw ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
}
/** Parses "0,2" into indexes; returns null when any token is not a non-negative integer. */
export function parseCorrectIndexes(raw?: string): number[] | null {
  const tokens = (raw ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter((n) => n.length > 0);
  const indexes = tokens.map((n) => (/^\d+$/.test(n) ? Number(n) : NaN));
  if (indexes.some((n) => !Number.isInteger(n))) return null;
  return [...new Set(indexes)];
}
export const lmsBankItemFieldsSchema = z.object({
  scope: z.enum(['board', 'school']),
  boardId: z.string().regex(UUID).optional().or(z.literal('')),
  institutionId: z.string().regex(UUID).optional().or(z.literal('')),
  subject: z.string().min(1).max(120),
  gradeLevel: z.string().max(40).optional().or(z.literal('')),
  tags: z.string().max(400).optional().or(z.literal('')),
  questionType: z.enum(['mcq', 'msq', 'numeric', 'match', 'essay']),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  prompt: z.string().min(1).max(8000),
  points: z.coerce.number().positive().max(1000).optional(),
  correctOptionIndex: z.coerce.number().int().min(0).max(9).optional(),
  options: z.string().max(4000).optional().or(z.literal('')),
  correctIndexes: z.string().max(80).optional().or(z.literal('')),
  correctValue: z.coerce.number().optional(),
  tolerance: z.coerce.number().min(0).optional(),
  pairs: z.string().max(4000).optional().or(z.literal('')),
});
export const lmsBankItemSchema = lmsBankItemFieldsSchema.superRefine((data, ctx) => {
  refineScopeTarget(data, ctx);
  if (data.questionType === 'mcq' || data.questionType === 'msq') {
    const options = splitOptions(data.options);
    if (options.length < 2) {
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'At least two options' });
      return;
    }
    if (data.questionType === 'mcq') {
      if (data.correctOptionIndex === undefined || data.correctOptionIndex >= options.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctOptionIndex'],
          message: 'Correct answer must be one of the options',
        });
      }
    } else {
      const indexes = parseCorrectIndexes(data.correctIndexes);
      if (!indexes || indexes.length === 0 || indexes.some((n) => n >= options.length)) {
        ctx.addIssue({
          code: 'custom',
          path: ['correctIndexes'],
          message: 'Correct answers must list valid option numbers',
        });
      }
    }
  }
  if (data.questionType === 'numeric' && data.correctValue === undefined) {
    ctx.addIssue({ code: 'custom', path: ['correctValue'], message: 'Correct value is required' });
  }
});
export type LmsBankItemValues = z.infer<typeof lmsBankItemFieldsSchema>;

export const lmsRubricSchema = z
  .object({
    scope: z.enum(['board', 'school']),
    boardId: z.string().regex(UUID).optional().or(z.literal('')),
    institutionId: z.string().regex(UUID).optional().or(z.literal('')),
    name: z.string().min(1).max(200),
    subject: z.string().max(120).optional().or(z.literal('')),
    criterionName: z.string().min(1).max(200),
    maxPoints: z.coerce.number().positive().max(1000),
  })
  .superRefine(refineScopeTarget);
export type LmsRubricValues = z.infer<typeof lmsRubricSchema>;

export const lmsRubricGradeSchema = z.object({
  submissionId: z.string().regex(UUID),
  questionId: z.string().regex(UUID).optional().or(z.literal('')),
  scores: z
    .array(
      z.object({
        criterionId: z.string().regex(UUID),
        points: z.coerce.number().min(0).max(1000),
        levelIndex: z.coerce.number().int().min(0).max(20),
      }),
    )
    .min(1),
});
export type LmsRubricGradeValues = z.infer<typeof lmsRubricGradeSchema>;

export const lmsFileUploadSchema = z.object({
  assignmentId: z.string().regex(UUID),
  submissionId: z.string().regex(UUID).optional().or(z.literal('')),
  filename: z.string().min(1).max(200),
  mimeType: z.enum([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  ]),
  // PRC-M099: 5 MB of bytes is at most 6,990,508 base64 characters.
  contentBase64: z.string().min(1).max(6_990_508, 'File exceeds 5 MB.'),
});
export type LmsFileUploadValues = z.infer<typeof lmsFileUploadSchema>;

export const lmsDiscussionSchema = z.object({
  classKey: z.string().min(1).max(120),
  title: z.string().min(1).max(255),
  institutionId: z.string().regex(UUID).optional().or(z.literal('')),
});
export type LmsDiscussionValues = z.infer<typeof lmsDiscussionSchema>;

export const lmsLessonSchema = z.object({
  institutionId: z.string().regex(UUID),
  title: z.string().min(1).max(255),
  subject: z.string().max(120).optional().or(z.literal('')),
  description: z.string().max(10000).optional().or(z.literal('')),
  resourceTitle: z.string().max(255).optional().or(z.literal('')),
  resourceUrl: httpUrl.optional().or(z.literal('')),
  published: z.boolean().optional(),
});
export type LmsLessonValues = z.infer<typeof lmsLessonSchema>;

export const lmsContentSchema = z
  .object({
    scope: z.enum(['board', 'school']),
    boardId: z.string().regex(UUID).optional().or(z.literal('')),
    institutionId: z.string().regex(UUID).optional().or(z.literal('')),
    title: z.string().min(1).max(255),
    kind: z.enum(['link', 'file', 'text']),
    body: z.string().max(20000).optional().or(z.literal('')),
    classKey: z.string().max(120).optional().or(z.literal('')),
    subject: z.string().max(120).optional().or(z.literal('')),
    published: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    // PRC-L24x: board/school scope needs its target id.
    refineScopeTarget(value, ctx);
    // A 'link' body becomes an href — enforce the same scheme allow-list (H024/H033).
    if (value.kind === 'link' && value.body && !isHttpUrl(value.body)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: HTTP_URL_MESSAGE });
    }
  });
export type LmsContentValues = z.infer<typeof lmsContentSchema>;
