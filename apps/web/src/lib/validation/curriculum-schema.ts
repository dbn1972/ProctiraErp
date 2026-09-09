import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

export const createSyllabusUnitFormSchema = z.object({
  institutionId: z.string().uuid().optional().or(z.literal('')),
  subjectId: uuid,
  gradeId: uuid,
  academicPeriodId: uuid,
  code: z.string().trim().min(1, 'Code is required').max(50),
  name: z.string().trim().min(1, 'Name is required').max(255),
  sequence: z.number().int().min(1).optional(),
  notes: z.string().max(4000).optional().or(z.literal('')),
});

export type CreateSyllabusUnitFormValues = z.infer<typeof createSyllabusUnitFormSchema>;

export const createLessonPlanFormSchema = z.object({
  unitId: uuid,
  title: z.string().trim().min(1, 'Title is required').max(255),
  objectives: z.string().max(4000).optional().or(z.literal('')),
  plannedDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    .optional()
    .or(z.literal('')),
});

export type CreateLessonPlanFormValues = z.infer<typeof createLessonPlanFormSchema>;

export const createLearningOutcomeFormSchema = z.object({
  subjectId: uuid,
  gradeId: z.string().uuid().optional().or(z.literal('')),
  unitId: z.string().uuid().optional().or(z.literal('')),
  code: z.string().trim().min(1, 'Code is required').max(50),
  statement: z.string().trim().min(1, 'Statement is required').max(2000),
});

export type CreateLearningOutcomeFormValues = z.infer<typeof createLearningOutcomeFormSchema>;

export const markTaughtFormSchema = z.object({
  unitId: uuid,
  timetableMeetingId: z.string().uuid().optional().or(z.literal('')),
  lmsSkillId: z.string().uuid().optional().or(z.literal('')),
});

export type MarkTaughtFormValues = z.infer<typeof markTaughtFormSchema>;
