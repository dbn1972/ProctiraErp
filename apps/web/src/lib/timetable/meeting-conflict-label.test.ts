import { describe, expect, it } from 'vitest';

import { formatSubstituteClash, formatTeacherClash } from './meeting-conflict-label';

describe('formatTeacherClash', () => {
  it('names the teacher, section, and slot', () => {
    expect(
      formatTeacherClash({
        teacherLabel: 'Neha Verma · TGT Mathematics',
        dayOfWeek: 1,
        periodLabel: 'Morning bell · P3 (09:20–10:00)',
        sectionLabel: 'G9A-MATH · Class 9-A Mathematics (PUBLISHED)',
      }),
    ).toBe(
      'Neha Verma already teaches G9A-MATH on Mon · P3 (09:20–10:00). Choose another period or staff member.',
    );
  });
});

describe('formatSubstituteClash', () => {
  it('names the substitute and the occupied slot', () => {
    expect(
      formatSubstituteClash({
        teacherLabel: 'Arun Kapoor',
        dayOfWeek: 5,
        periodLabel: 'Morning bell · P4 (10:20–11:00)',
        sectionLabel: 'G8C-HIN · Class 8-C Hindi',
      }),
    ).toBe(
      'Arun Kapoor is already teaching G8C-HIN on Fri · P4 (10:20–11:00). Pick another substitute.',
    );
  });
});
