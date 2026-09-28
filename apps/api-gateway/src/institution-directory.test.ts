import { describe, expect, it } from 'vitest';

import {
  boardLabelFromRows,
  loadInstitutionDirectoryContext,
  type InstitutionDirectoryContext,
} from './institution-directory.js';

describe('boardLabelFromRows', () => {
  it('uses the board code and never an area name', () => {
    expect(
      boardLabelFromRows([{ code: 'CBSE', name: 'Central Board of Secondary Education' }]),
    ).toBe('CBSE');
    expect(boardLabelFromRows([])).toBeNull();
  });

  it('joins several boards without treating a place name as the label source', () => {
    expect(
      boardLabelFromRows([
        { code: 'CBSE', name: 'CBSE' },
        { code: 'ICSE', name: 'ICSE' },
      ]),
    ).toBe('CBSE · ICSE');
  });
});

describe('loadInstitutionDirectoryContext', () => {
  it('scopes every aggregate to the tenant and sums enrolled students', async () => {
    const seen: { sql: string; params?: unknown[] }[] = [];
    const db = {
      async query(sql: string, params?: unknown[]) {
        seen.push({ sql, params });
        if (sql.includes('to_regclass')) {
          const name = String(params?.[0] ?? '');
          const present = [
            'public.tenants',
            'public.boards',
            'public.enrollments',
            'public.staff_assignments',
            'public.student_attendance',
          ];
          return { rows: [{ reg: present.includes(name) ? name : null }] };
        }
        if (sql.includes('FROM tenants')) return { rows: [{ name: 'Sunrise Public School' }] };
        if (sql.includes('FROM boards')) return { rows: [{ code: 'CBSE', name: 'CBSE' }] };
        if (sql.includes('COUNT(*)::int AS value') && sql.includes('enrollments')) {
          return { rows: [{ value: 3615 }] };
        }
        if (sql.includes('student_count')) {
          return {
            rows: [
              { id: 'school-a', student_count: 1240 },
              { id: 'school-b', student_count: 0 },
            ],
          };
        }
        if (sql.includes('staff_count')) {
          return { rows: [{ id: 'school-a', staff_count: 84 }] };
        }
        if (sql.includes('COUNT(DISTINCT institution_id)')) {
          return { rows: [{ value: 4 }] };
        }
        if (sql.includes('attendance_percent')) {
          return { rows: [{ id: 'school-a', attendance_percent: 94 }] };
        }
        return { rows: [] };
      },
    };

    const context = await loadInstitutionDirectoryContext(
      '00000000-0000-4000-8000-00000000a501',
      db,
    );

    expect(context.organizationName).toBe('Sunrise Public School');
    expect(context.boardLabel).toBe('CBSE');
    expect(context.studentsEnrolled).toBe(3615);
    expect(context.reportingToday).toBe(4);
    expect(context.schools['school-a']).toEqual({
      studentCount: 1240,
      staffCount: 84,
      attendancePercent: 94,
    });
    expect(context.schools['school-b']?.studentCount).toBe(0);

    for (const call of seen.filter((row) => !row.sql.includes('to_regclass'))) {
      expect(call.params?.[0]).toBe('00000000-0000-4000-8000-00000000a501');
    }
    expect(seen.some((entry) => entry.sql.includes('FROM geographic_areas'))).toBe(false);
  });

  it('returns null metrics when the aggregate tables are absent', async () => {
    const context: InstitutionDirectoryContext = await loadInstitutionDirectoryContext('tenant', {
      async query(sql: string) {
        if (sql.includes('to_regclass')) return { rows: [{ reg: null }] };
        throw new Error('should not query missing tables');
      },
    });
    expect(context).toEqual({
      organizationName: null,
      boardLabel: null,
      studentsEnrolled: null,
      reportingToday: null,
      studentsAvailable: false,
      staffAvailable: false,
      attendanceAvailable: false,
      schools: {},
    });
  });
});
