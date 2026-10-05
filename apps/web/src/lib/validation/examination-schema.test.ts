import { describe, expect, it } from 'vitest';
import {
  defaultGradingScheme,
  examinationGradingSchemeFormSchema,
  gradeForScore,
} from './examination-schema';

const base = () => defaultGradingScheme();

describe('PRC-M157 grading scheme coverage', () => {
  it('accepts the default scheme and grades 79.5', () => {
    const scheme = base();
    expect(examinationGradingSchemeFormSchema.safeParse(scheme).success).toBe(true);
    expect(gradeForScore(scheme.thresholds, 79.5)?.grade).toBe('B');
    expect(gradeForScore(scheme.thresholds, 100)?.grade).toBe('A');
    expect(gradeForScore(scheme.thresholds, 0)?.grade).toBe('F');
  });

  it('rejects overlapping bands', () => {
    const scheme = base();
    scheme.thresholds[0] = { ...scheme.thresholds[0]!, minScore: 75 };
    expect(examinationGradingSchemeFormSchema.safeParse(scheme).success).toBe(false);
  });

  it('rejects gapped bands', () => {
    const scheme = base();
    scheme.thresholds[1] = { ...scheme.thresholds[1]!, minScore: 65 };
    expect(examinationGradingSchemeFormSchema.safeParse(scheme).success).toBe(false);
  });

  it('rejects out-of-range bands and pass threshold', () => {
    const outOfRange = base();
    outOfRange.thresholds[0] = { ...outOfRange.thresholds[0]!, maxScore: 120 };
    expect(examinationGradingSchemeFormSchema.safeParse(outOfRange).success).toBe(false);
    const pass = { ...base(), passThreshold: 150 };
    expect(examinationGradingSchemeFormSchema.safeParse(pass).success).toBe(false);
  });

  it('rejects incomplete coverage at either end', () => {
    const scheme = base();
    scheme.thresholds = scheme.thresholds.filter((t) => t.grade !== 'F');
    expect(examinationGradingSchemeFormSchema.safeParse(scheme).success).toBe(false);
  });
});
