import { z } from 'zod';

export const gradeWorkflowActionSchema = z.enum([
  'submit',
  'approve',
  'reject',
  'lock',
  'publish',
  'reopen',
]);

export const transitionGradeFormSchema = z.object({
  id: z.string().min(1),
  action: gradeWorkflowActionSchema,
  institutionId: z.string().min(1),
});

export const bulkTransitionGradeFormSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: gradeWorkflowActionSchema,
  institutionId: z.string().min(1),
});

export const commentsBankFormSchema = z.object({
  institutionId: z.string().min(1),
  subjectId: z.string().optional().or(z.literal('')),
  gradeBand: z.string().max(20).optional().or(z.literal('')),
  label: z.string().trim().min(1, 'Label is required').max(200),
  body: z.string().trim().min(1, 'Comment is required').max(4000),
});

export const computeRankFormSchema = z.object({
  sectionId: z.string().min(1),
  institutionId: z.string().min(1),
  academicPeriodId: z.string().optional().or(z.literal('')),
  boardId: z.string().optional().or(z.literal('')),
});

export type GradeWorkflowActionValue = z.infer<typeof gradeWorkflowActionSchema>;
