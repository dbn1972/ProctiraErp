/**
 * PRC-M152: GPA values are checked against the program's configured GPA scale
 * (`eligibility.gpaScaleMax`, default 4.0) instead of a hard-coded 4.0.
 */
import { ValidationError } from '@proctira/common';

import { DEFAULT_GPA_SCALE_MAX, type AcademicRecord, type EligibilityCriteria } from './schemas.js';
import type { ScholarshipProgramEntity } from './scholarship-repository.js';

/** PRC-M152: minGPA must lie on the program's configured GPA scale. */
export function assertGpaScale(eligibility: EligibilityCriteria | undefined): void {
  if (!eligibility) return;
  const scaleMax = eligibility.gpaScaleMax ?? DEFAULT_GPA_SCALE_MAX;
  if (eligibility.minGPA !== undefined && eligibility.minGPA > scaleMax) {
    throw new ValidationError('Validation failed', [
      {
        field: 'eligibility.minGPA',
        rule: 'maximum',
        message: `minGPA must not exceed the program GPA scale (${scaleMax})`,
      },
    ]);
  }
}

/** PRC-M152: a declared GPA must lie on the program's GPA scale (default 4.0). */
export function assertGpaWithinProgramScale(
  program: Pick<ScholarshipProgramEntity, 'eligibility'>,
  records: readonly AcademicRecord[],
): void {
  const scaleMax = program.eligibility?.gpaScaleMax ?? DEFAULT_GPA_SCALE_MAX;
  records.forEach((record, index) => {
    if (record.gpa !== undefined && record.gpa > scaleMax) {
      throw new ValidationError('Validation failed', [
        {
          field: `academicRecords.${index}.gpa`,
          rule: 'maximum',
          message: `GPA must be between 0 and ${scaleMax} for this program`,
        },
      ]);
    }
  });
}
