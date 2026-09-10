/**
 * Zod schemas for assessment forms.
 *
 * Mirrors the Typebox schemas in `@proctira/backend-assessment`.
 *   - Grading scheme: numeric / letter / competency with thresholds.
 *   - Assessment items: weights must sum to exactly 100.
 *   - Result entry: scores must fall within the grading scheme range.
 */
import { z } from 'zod';

const uuid = z.string().uuid('Must be a valid UUID');

export const gradingSchemeTypeSchema = z.enum(['numeric', 'letter', 'competency']);

export type GradingSchemeTypeValue = z.infer<typeof gradingSchemeTypeSchema>;

export const gradeThresholdSchema = z
  .object({
    grade: z.string().min(1, 'Grade label is required').max(10, 'Grade label is too long'),
    minScore: z.number({ message: 'Min score is required' }),
    maxScore: z.number({ message: 'Max score is required' }),
    descriptor: z.string().max(500, 'Descriptor is too long').optional().or(z.literal('')),
  })
  .refine((d) => d.maxScore >= d.minScore, {
    message: 'Max score must be ≥ min score',
    path: ['maxScore'],
  });

export const gradingSchemeFormSchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
    type: gradingSchemeTypeSchema,
    minValue: z.number({ message: 'Min value is required' }),
    maxValue: z.number({ message: 'Max value is required' }),
    thresholds: z.array(gradeThresholdSchema).min(1, 'At least one threshold is required'),
  })
  .refine((d) => d.maxValue > d.minValue, {
    message: 'Max value must be greater than min value',
    path: ['maxValue'],
  })
  .refine((d) => d.thresholds.every((t) => t.minScore >= d.minValue && t.maxScore <= d.maxValue), {
    message: 'All thresholds must fall within the scheme range',
    path: ['thresholds'],
  });

export type GradingSchemeFormValues = z.infer<typeof gradingSchemeFormSchema>;

export const assessmentItemEntrySchema = z
  .object({
    name: z.string().min(1, 'Name is required').max(255, 'Name is too long'),
    weight: z
      .number({ message: 'Weight is required' })
      .gt(0, 'Weight must be greater than 0')
      .max(100, 'Weight cannot exceed 100'),
    minScore: z.number({ message: 'Min score is required' }).min(0),
    maxScore: z.number({ message: 'Max score is required' }).min(0),
  })
  .refine((d) => d.maxScore >= d.minScore, {
    message: 'Max score must be ≥ min score',
    path: ['maxScore'],
  });

const WEIGHT_TOLERANCE = 0.01;

export const assessmentItemsFormSchema = z
  .object({
    subjectId: uuid,
    academicPeriodId: uuid,
    gradingSchemeId: uuid,
    items: z
      .array(assessmentItemEntrySchema)
      .min(1, 'Add at least one assessment item')
      .max(50, 'Up to 50 items per subject per period'),
  })
  .refine(
    (d) => {
      const total = d.items.reduce((sum, item) => sum + Number(item.weight), 0);
      return Math.abs(total - 100) <= WEIGHT_TOLERANCE;
    },
    {
      message: 'Item weights must sum to exactly 100%',
      path: ['items'],
    },
  );

export type AssessmentItemsFormValues = z.infer<typeof assessmentItemsFormSchema>;
