import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const lmsBankItemSchema = z.object({
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
export type LmsBankItemValues = z.infer<typeof lmsBankItemSchema>;

export const lmsRubricSchema = z.object({
  scope: z.enum(['board', 'school']),
  boardId: z.string().regex(UUID).optional().or(z.literal('')),
  institutionId: z.string().regex(UUID).optional().or(z.literal('')),
  name: z.string().min(1).max(200),
  subject: z.string().max(120).optional().or(z.literal('')),
  criterionName: z.string().min(1).max(200),
  maxPoints: z.coerce.number().positive().max(1000),
});
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
  contentBase64: z.string().min(1),
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
  resourceUrl: z.string().max(2048).optional().or(z.literal('')),
  published: z.boolean().optional(),
});
export type LmsLessonValues = z.infer<typeof lmsLessonSchema>;

export const lmsContentSchema = z.object({
  scope: z.enum(['board', 'school']),
  boardId: z.string().regex(UUID).optional().or(z.literal('')),
  institutionId: z.string().regex(UUID).optional().or(z.literal('')),
  title: z.string().min(1).max(255),
  kind: z.enum(['link', 'file', 'text']),
  body: z.string().max(20000).optional().or(z.literal('')),
  classKey: z.string().max(120).optional().or(z.literal('')),
  subject: z.string().max(120).optional().or(z.literal('')),
  published: z.boolean().optional(),
});
export type LmsContentValues = z.infer<typeof lmsContentSchema>;
