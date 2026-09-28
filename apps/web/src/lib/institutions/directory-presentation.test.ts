import { describe, expect, it } from 'vitest';

import {
  attendanceTone,
  formatPageLabel,
  formatShowingRange,
  formatTenantSwitcher,
  rowMetrics,
  typeChipLabel,
} from './directory-presentation';

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
});
