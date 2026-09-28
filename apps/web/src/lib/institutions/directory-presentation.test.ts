import { describe, expect, it } from 'vitest';

import {
  INSTITUTION_LIST_ERROR,
  attendanceTone,
  formatPageLabel,
  formatShowingRange,
  formatTenantSwitcher,
  institutionListSubtitle,
  navGroupLabel,
  rowMetrics,
  typeChipLabel,
} from './directory-presentation';
import { resolveLookupLabel } from './lookups';

describe('institutions directory presentation', () => {
  it('colours attendance by the design thresholds', () => {
    expect(attendanceTone(94)).toBe('green');
    expect(attendanceTone(90)).toBe('green');
    expect(attendanceTone(88)).toBe('amber');
    expect(attendanceTone(80)).toBe('amber');
    expect(attendanceTone(76)).toBe('red');
  });

  it('shows em dashes for inactive schools even when counts exist', () => {
    expect(
      rowMetrics('INACTIVE', { studentCount: 12, staffCount: 3, attendancePercent: 91 }),
    ).toEqual({ students: null, staff: null, attendance: null });
    expect(
      rowMetrics('ACTIVE', { studentCount: 1240, staffCount: 84, attendancePercent: 94 }),
    ).toEqual({ students: 1240, staff: 84, attendance: 94 });
    expect(rowMetrics('ACTIVE', undefined)).toEqual({
      students: null,
      staff: null,
      attendance: null,
    });
  });

  it('keeps the board on its own line and never prefixes an area as the board', () => {
    const copy = formatTenantSwitcher({
      organizationName: 'Sunrise Public School',
      boardLabel: 'CBSE',
      studentCount: 1240,
    });
    expect(copy.title).toBe('Sunrise Public School');
    expect(copy.lines).toEqual(['CBSE', '1,240 students']);
    expect(`${copy.title}${copy.lines.join('')}`).not.toContain('Board: Delhi East');
    expect(copy.title.includes('CBSE')).toBe(false);
  });

  it('formats pagination with an en dash, including a single page', () => {
    expect(formatShowingRange(1, 20, 5)).toBe('Showing 1–5 of 5');
    expect(formatPageLabel(1, 1)).toBe('Page 1 of 1');
    expect(formatShowingRange(2, 20, 25)).toBe('Showing 21–25 of 25');
    expect(formatPageLabel(2, 2)).toBe('Page 2 of 2');
  });

  it('shows a stored type label and hides unresolved UUIDs', () => {
    const names = new Map([['00000000-0000-4000-8000-000000000011', 'Secondary']]);
    expect(typeChipLabel('00000000-0000-4000-8000-000000000011', names)).toBe('Secondary');
    expect(typeChipLabel('00000000-0000-4000-8000-000000000099', names)).toBe('');
    expect(typeChipLabel('Senior Secondary', names)).toBe('Senior Secondary');
  });

  it('groups academics once and keeps LMS with academics', () => {
    const keys = [
      'dashboard',
      'institutions',
      'examinations',
      'lms',
      'scholarships',
      'health',
      'fees',
    ];
    const groups = keys.map((key) => navGroupLabel(key));
    expect(groups).toEqual([
      'Overview',
      'Academics',
      'Academics',
      'Academics',
      'Services',
      'Services',
      'Services',
    ]);
    expect(new Set(groups.filter((group) => group === 'Academics')).size).toBe(1);
  });

  it('describes a filtered empty list without pretending the catalogue is empty', () => {
    expect(
      institutionListSubtitle({
        filteredCount: 0,
        catalogCount: 5,
        filtersActive: true,
        failed: false,
      }),
    ).toBe('0 of 5 schools match');
    expect(INSTITUTION_LIST_ERROR).toBe(
      "We couldn't load schools. Check your connection and try again.",
    );
    expect(
      institutionListSubtitle({
        filteredCount: 0,
        catalogCount: 0,
        filtersActive: false,
        failed: true,
      }),
    ).toBe('Schools could not be loaded');
  });

  it('keeps stored type labels and title-cases slugs', () => {
    expect(resolveLookupLabel([], 'Pre-Primary')).toBe('Pre-Primary');
    expect(resolveLookupLabel([], 'Senior Secondary')).toBe('Senior Secondary');
    expect(resolveLookupLabel([], 'school')).toBe('School');
    expect(resolveLookupLabel([], 'pre-primary')).toBe('Pre primary');
  });
});
