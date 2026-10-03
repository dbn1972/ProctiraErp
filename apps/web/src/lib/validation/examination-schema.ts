/**
 * Zod schemas for examination create forms.
 *
 * Mirrors `CreateExaminationSchema` in `@proctira/backend-examination`
 * (Requirement 10.1 / 10.7): subjects ≥1, centers ≥1, grading schemes 1–10,
 * exam start date at least 7 days in the future.
 */
import { z } from 'zod';

/** UUID v4 pattern matching backend Typebox UUID_PATTERN. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const uuid = z.string().min(1, 'UUID is required').regex(UUID_V4, 'Must be a valid UUID v4');

const isoDate = z
  .string()
  .min(1, 'Date is required')
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format');

export const examinationSubjectFormSchema = z.object({
  name: z.string().trim().min(1, 'Subject name is required').max(255),
  code: z.string().trim().min(1, 'Subject code is required').max(50),
  maxScore: z.coerce.number().min(1, 'Max score must be at least 1'),
});

export const examinationCenterFormSchema = z.object({
  name: z.string().trim().min(1, 'Center name is required').max(255),
  code: z.string().trim().min(1, 'Center code is required').max(50),
  institutionId: uuid,
  capacity: z.coerce.number().min(1, 'Capacity must be at least 1').max(99999),
});

export const gradeThresholdFormSchema = z.object({
  grade: z.string().trim().min(1, 'Grade label is required').max(10),
  minScore: z.coerce.number().min(0),
  maxScore: z.coerce.number().min(0),
  descriptor: z.string().max(255).optional().or(z.literal('')),
});

type ThresholdLike = { grade: string; minScore: number; maxScore: number };

/**
 * PRC-M157: a score belongs to the highest band whose `minScore` it reaches
 * (half-open intervals `[min, nextMin)`), so fractional scores such as 79.5
 * between the inclusive integer bands 60–79 and 80–100 are still graded.
 */
export function gradeForScore<T extends ThresholdLike>(thresholds: T[], score: number): T | null {
  const sorted = [...thresholds].sort((a, b) => b.minScore - a.minScore);
  return sorted.find((t) => score >= t.minScore) ?? null;
}

/**
 * PRC-M157: thresholds must cover [scheme.min, scheme.max] without overlap. Adjacent
 * bands may leave at most a 1-point step (inclusive integer bands, e.g. 60–79 then
 * 80–100); anything between is graded by {@link gradeForScore}.
 */
export function gradingSchemeCoverageIssues(scheme: {
  minScore: number;
  maxScore: number;
  passThreshold: number;
  thresholds: ThresholdLike[];
}): Array<{ path: (string | number)[]; message: string }> {
  const issues: Array<{ path: (string | number)[]; message: string }> = [];
  if (scheme.maxScore <= scheme.minScore) {
    issues.push({ path: ['maxScore'], message: 'Maximum score must be greater than minimum score' });
    return issues;
  }
  if (scheme.passThreshold < scheme.minScore || scheme.passThreshold > scheme.maxScore) {
    issues.push({
      path: ['passThreshold'],
      message: `Pass threshold must be within ${scheme.minScore}–${scheme.maxScore}`,
    });
  }
  scheme.thresholds.forEach((t, i) => {
    if (t.maxScore < t.minScore) {
      issues.push({ path: ['thresholds', i, 'maxScore'], message: 'Band max must be ≥ band min' });
    }
    if (t.minScore < scheme.minScore || t.maxScore > scheme.maxScore) {
      issues.push({
        path: ['thresholds', i],
        message: `Grade ${t.grade} must lie within ${scheme.minScore}–${scheme.maxScore}`,
      });
    }
  });
  if (issues.length > 0) return issues;
  const order = scheme.thresholds
    .map((t, i) => ({ t, i }))
    .sort((a, b) => a.t.minScore - b.t.minScore);
  const first = order[0]!;
  const last = order[order.length - 1]!;
  if (first.t.minScore !== scheme.minScore) {
    issues.push({
      path: ['thresholds', first.i, 'minScore'],
      message: `The lowest band must start at ${scheme.minScore}`,
    });
  }
  if (Math.max(...scheme.thresholds.map((t) => t.maxScore)) !== scheme.maxScore) {
    issues.push({
      path: ['thresholds', last.i, 'maxScore'],
      message: `The highest band must end at ${scheme.maxScore}`,
    });
  }
  for (let k = 1; k < order.length; k += 1) {
    const prev = order[k - 1]!;
    const next = order[k]!;
    if (next.t.minScore <= prev.t.maxScore) {
      issues.push({
        path: ['thresholds', next.i, 'minScore'],
        message: `Grade ${next.t.grade} overlaps grade ${prev.t.grade}`,
      });
    } else if (next.t.minScore - prev.t.maxScore > 1) {
      issues.push({
        path: ['thresholds', next.i, 'minScore'],
        message: `Gap between grade ${prev.t.grade} and grade ${next.t.grade}`,
      });
    }
  }
  return issues;
}

export const examinationGradingSchemeFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Scheme name is required').max(255),
    minScore: z.coerce.number().min(0),
    maxScore: z.coerce.number().min(1),
    passThreshold: z.coerce.number().min(0),
    thresholds: z
      .array(gradeThresholdFormSchema)
      .min(1, 'At least one grade threshold is required'),
  })
  .superRefine((scheme, ctx) => {
    for (const issue of gradingSchemeCoverageIssues(scheme)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });

export const createExaminationFormSchema = z
  .object({
    name: z.string().trim().min(1, 'Name is required').max(255),
    code: z.string().trim().min(1, 'Code is required').max(50),
    description: z.string().max(1000).optional().or(z.literal('')),
    academicPeriodId: uuid,
    startDate: isoDate,
    endDate: isoDate,
    subjects: z.array(examinationSubjectFormSchema).min(1, 'At least one subject is required'),
    centers: z.array(examinationCenterFormSchema).min(1, 'At least one center is required'),
    gradingSchemes: z
      .array(examinationGradingSchemeFormSchema)
      .min(1, 'At least one grading scheme is required')
      .max(10, 'At most 10 grading schemes allowed'),
  })
  .refine((d) => d.endDate >= d.startDate, {
    message: 'End date must be on or after start date',
    path: ['endDate'],
  })
  .refine(
    (d) => {
      const min = new Date();
      min.setUTCHours(0, 0, 0, 0);
      min.setUTCDate(min.getUTCDate() + 7);
      const start = new Date(`${d.startDate}T00:00:00.000Z`);
      return start.getTime() >= min.getTime();
    },
    {
      message: 'Start date must be at least 7 days in the future',
      path: ['startDate'],
    },
  );

export type CreateExaminationFormValues = z.infer<typeof createExaminationFormSchema>;

/** Sensible default grading scheme for the create form. */
export function defaultGradingScheme(): CreateExaminationFormValues['gradingSchemes'][number] {
  return {
    name: 'Standard Grading',
    minScore: 0,
    maxScore: 100,
    passThreshold: 40,
    thresholds: [
      { grade: 'A', minScore: 80, maxScore: 100, descriptor: '' },
      { grade: 'B', minScore: 60, maxScore: 79, descriptor: '' },
      { grade: 'C', minScore: 40, maxScore: 59, descriptor: '' },
      { grade: 'F', minScore: 0, maxScore: 39, descriptor: '' },
    ],
  };
}

export function defaultCreateExaminationValues(institutionId = ''): CreateExaminationFormValues {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + 14);
  const end = new Date();
  end.setUTCDate(end.getUTCDate() + 21);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);

  return {
    name: '',
    code: '',
    description: '',
    academicPeriodId: '',
    startDate: toIso(start),
    endDate: toIso(end),
    subjects: [{ name: '', code: '', maxScore: 100 }],
    centers: [
      {
        name: '',
        code: '',
        institutionId,
        capacity: 100,
      },
    ],
    gradingSchemes: [defaultGradingScheme()],
  };
}
