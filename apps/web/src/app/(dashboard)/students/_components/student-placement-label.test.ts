import { describe, expect, it } from 'vitest';

import {
  classSectionLabel,
  enrollmentOptionLabel,
  institutionLabel,
  studentDisplayName,
  type PlacementDirectories,
} from './student-placement-label';

const AARAV_CLASS = '00000000-0000-4000-8000-00000000a562';
const GRADE_9 = '00000000-0000-4000-8000-00000000a542';
const SCHOOL = '00000000-0000-4000-8000-00000000a551';
const UNKNOWN = '00000000-0000-4000-8000-00000000aaaa';

const sunrise: PlacementDirectories = {
  institutions: new Map([[SCHOOL, 'Sunrise Public School']]),
  grades: new Map([[GRADE_9, 'Grade 9']]),
  classes: new Map([[AARAV_CLASS, '9-B']]),
};

describe('student placement labels', () => {
  it('uses the person name as the primary label', () => {
    expect(studentDisplayName('Aarav', 'Mehta')).toBe('Aarav Mehta');
    expect(studentDisplayName('Diya', 'Sharma')).toBe('Diya Sharma');
  });

  it('shows grade and class for a Sunrise enrollment', () => {
    expect(
      classSectionLabel({
        classId: AARAV_CLASS,
        gradeId: GRADE_9,
        directories: sunrise,
      }),
    ).toBe('Grade 9 · 9-B');
  });

  it('keeps the class name when the grade directory is empty', () => {
    expect(
      classSectionLabel({
        classId: AARAV_CLASS,
        gradeId: GRADE_9,
        directories: { ...sunrise, grades: new Map() },
      }),
    ).toBe('9-B');
  });

  it('does not use a raw UUID when class and grade are unresolved', () => {
    const label = classSectionLabel({
      classId: UNKNOWN,
      gradeId: UNKNOWN,
      customGradeSection: UNKNOWN,
      directories: { institutions: new Map(), grades: new Map(), classes: new Map() },
    });
    expect(label).toBe('—');
    expect(label).not.toContain(UNKNOWN);
  });

  it('uses a non-uuid custom grade when the directory has no class', () => {
    expect(
      classSectionLabel({
        classId: null,
        gradeId: null,
        customGradeSection: '8-A',
        directories: { institutions: new Map(), grades: new Map(), classes: new Map() },
      }),
    ).toBe('8-A');
  });

  it('labels the school by name', () => {
    expect(
      institutionLabel({
        institutionId: SCHOOL,
        directories: sunrise,
      }),
    ).toBe('Sunrise Public School');
    const missing = institutionLabel({
      institutionId: UNKNOWN,
      directories: sunrise,
    });
    expect(missing).toBe('—');
    expect(missing).not.toContain(UNKNOWN);
  });

  it('builds the transfer source option from school and class', () => {
    expect(
      enrollmentOptionLabel({
        institutionId: SCHOOL,
        classId: AARAV_CLASS,
        gradeId: GRADE_9,
        directories: sunrise,
      }),
    ).toBe('Sunrise Public School · Grade 9 · 9-B');
  });
});
