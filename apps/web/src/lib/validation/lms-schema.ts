/**
 * Server-side validation for the core LMS server actions (PRC-L245).
 *
 * The gateway remains the authoritative validator; these schemas reject
 * malformed payloads before an upstream call and enforce cross-field rules
 * (scope -> owning id, answer-key index within the option list) instead of
 * silently defaulting them.
 */
import { z } from 'zod';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const lmsIdSchema = z.string().regex(UUID, 'Invalid id');

const optionalUuid = z.string().regex(UUID, 'Invalid id').optional().or(z.literal(''));

interface ScopedValues {
  scope: 'board' | 'school';
  boardId?: string;
  institutionId?: string;
}

/** A board-scoped record needs a boardId; a school-scoped one an institutionId. */
export function refineScopeTarget(value: ScopedValues, ctx: z.RefinementCtx): void {
  if (value.scope === 'board' && !value.boardId) {
    ctx.addIssue({
      code: 'custom',
      path: ['boardId'],
      message: 'A board is required for board-scoped items',
    });
  }
  if (value.scope === 'school' && !value.institutionId) {
    ctx.addIssue({
      code: 'custom',
      path: ['institutionId'],
      message: 'A school is required for school-scoped items',
    });
  }
}

const quizQuestionSchema = z
  .object({
    prompt: z.string().trim().min(1, 'Question prompt is required').max(8000),
    options: z.array(z.string().trim().min(1).max(1000)).min(2, 'At least two options').max(10),
    correctOptionIndex: z.number().int().min(0),
    points: z.number().positive().max(1000).optional(),
    skillId: lmsIdSchema.optional(),
    explanation: z.string().max(4000).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.correctOptionIndex >= q.options.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['correctOptionIndex'],
        message: 'Correct answer must be one of the options',
      });
    }
  });

export const createAssignmentSchema = z
  .object({
    scope: z.enum(['board', 'school']),
    boardId: optionalUuid,
    institutionId: optionalUuid,
    kind: z.enum(['assignment', 'homework', 'quiz']),
    title: z.string().trim().min(1, 'Title is required').max(255),
    description: z.string().max(20000).optional(),
    subject: z.string().trim().min(1, 'Subject is required').max(120),
    gradeLevel: z.string().max(40).optional(),
    sectionId: lmsIdSchema.optional(),
    skillIds: z.array(lmsIdSchema).max(100).optional(),
    maxScore: z.number().positive().max(100000).optional(),
    dueAt: z.string().max(64).optional(),
    timeLimitMinutes: z.number().int().positive().max(1440).optional(),
    allowLate: z.boolean().optional(),
    publish: z.boolean().optional(),
    questions: z.array(quizQuestionSchema).max(200).optional(),
    bankQuestionIds: z.array(lmsIdSchema).max(200).optional(),
  })
  .superRefine(refineScopeTarget);

export const gradeSubmissionSchema = z.object({
  score: z.number().min(0).max(100000),
  feedback: z.string().max(10000).optional(),
  returnToStudent: z.boolean().optional(),
});

export const createSkillSchema = z
  .object({
    scope: z.enum(['board', 'school']),
    boardId: optionalUuid,
    institutionId: optionalUuid,
    code: z.string().trim().min(1, 'Code is required').max(60),
    name: z.string().trim().min(1, 'Name is required').max(200),
    subject: z.string().trim().min(1, 'Subject is required').max(120),
    gradeLevel: z.string().max(40).optional(),
    description: z.string().max(4000).optional(),
    prerequisiteSkillIds: z.array(lmsIdSchema).max(100).optional(),
  })
  .superRefine(refineScopeTarget);

export const palLookupQuerySchema = z.object({
  boardId: lmsIdSchema.optional(),
  institutionId: lmsIdSchema.optional(),
});

export function firstIssue(error: z.ZodError, fallback: string): string {
  return error.issues[0]?.message ?? fallback;
}
