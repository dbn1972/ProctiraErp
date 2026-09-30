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

/**
 * Largest allowed distance between a band's max and the next band's min. Grades are
 * assigned half-open (highest band whose min the score reaches), so B 80–89 / A 90–100
 * and B 60–79.99 / A 80–100 are both contiguous; skipping a whole mark is a gap.
 */
export const MAX_BAND_GAP = 1;
const EPSILON = 1e-9;

export interface ThresholdCoverageIssue {
  /** Index in the caller's (unsorted) threshold array. */
  index: number;
  field: 'minScore' | 'maxScore';
  message: string;
}

/**
 * PRC-H114: bands must cover [minValue, maxValue] with no overlap and no skipped mark,
 * so — with half-open grade assignment — every score in range maps to exactly one grade.
 * The backend mirrors this rule in `AssessmentService.validateThresholds`.
 */
export function findThresholdCoverageIssues(
  thresholds: ReadonlyArray<{ minScore: number; maxScore: number }>,
  minValue: number,
  maxValue: number,
): ThresholdCoverageIssue[] {
  const valid = thresholds.every(
    (t) => Number.isFinite(t.minScore) && Number.isFinite(t.maxScore) && t.maxScore >= t.minScore,
  );
  if (!valid || thresholds.length === 0) return [];
  const order = thresholds
    .map((t, index) => ({ ...t, index }))
    .sort((a, b) => a.minScore - b.minScore);
  const issues: ThresholdCoverageIssue[] = [];
  const first = order[0]!;
  const last = order[order.length - 1]!;
  if (Math.abs(first.minScore - minValue) > EPSILON) {
    issues.push({
      index: first.index,
      field: 'minScore',
      message: `Lowest band must start at the scheme minimum (${minValue})`,
    });
  }
  for (let i = 1; i < order.length; i++) {
    const previous = order[i - 1]!;
    const current = order[i]!;
    if (current.minScore <= previous.maxScore + EPSILON) {
      issues.push({
        index: current.index,
        field: 'minScore',
        message: `Overlaps the band ending at ${previous.maxScore}`,
      });
    } else if (current.minScore - previous.maxScore > MAX_BAND_GAP + EPSILON) {
      issues.push({
        index: current.index,
        field: 'minScore',
        message: `Leaves a gap after ${previous.maxScore}; start at or below ${
          previous.maxScore + MAX_BAND_GAP
        }`,
      });
    }
  }
  const topMax = Math.max(...order.map((t) => t.maxScore));
  if (Math.abs(topMax - maxValue) > EPSILON) {
    issues.push({
      index: last.index,
      field: 'maxScore',
      message: `Highest band must end at the scheme maximum (${maxValue})`,
    });
  }
  return issues;
}

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
  })
  .superRefine((d, ctx) => {
    for (const issue of findThresholdCoverageIssues(d.thresholds, d.minValue, d.maxValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: issue.message,
        path: ['thresholds', issue.index, issue.field],
      });
    }
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
