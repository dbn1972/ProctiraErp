/**
 * PRC-L041 — academic picker defaults come from data, not seed codes.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  activeAcademicPeriods,
  pickActiveAcademicPeriod,
  pickDefaultSection,
  pickGradingBoardId,
} from './academic-defaults';
import { todayInTimeZone } from './tenant-today';

const period = (
  id: string,
  startDate: string,
  endDate: string,
  status: 'active' | 'inactive' | 'archived' = 'active',
  parentId: string | null = null,
) => ({ id, startDate, endDate, status, parentId });

describe('academic defaults (PRC-L041)', () => {
  const periods = [
    period('y2024', '2024-04-01', '2025-03-31', 'archived'),
    period('y2025', '2025-04-01', '2026-03-31'),
    period('t1', '2025-04-01', '2025-09-30', 'active', 'y2025'),
    period('t2', '2025-10-01', '2026-03-31', 'active', 'y2025'),
  ];

  it('curriculum opens on the active period (innermost current term)', () => {
    expect(pickActiveAcademicPeriod(periods, '2025-11-15')?.id).toBe('t2');
    expect(pickActiveAcademicPeriod(periods, '2025-05-01')?.id).toBe('t1');
    expect(pickActiveAcademicPeriod([], '2025-05-01')).toBeUndefined();
  });

  it('prefers a section in the active period over list order', () => {
    const active = new Set(activeAcademicPeriods(periods, '2025-11-15').map((p) => p.id));
    const sections = [
      { id: 's-old', academicPeriodId: 'y2024', status: 'active' },
      { id: 's-now', academicPeriodId: 't2', status: 'active' },
    ];
    expect(pickDefaultSection(sections, active)?.id).toBe('s-now');
    expect(pickDefaultSection(sections, new Set())?.id).toBe('s-old');
  });

  it('requires an explicit board when several boards have no default', () => {
    expect(pickGradingBoardId([{ boardId: 'cbse', isDefault: false }])).toBe('cbse');
    expect(
      pickGradingBoardId([
        { boardId: 'cbse', isDefault: false },
        { boardId: 'icse', isDefault: false },
      ]),
    ).toBe('');
    expect(
      pickGradingBoardId([
        { boardId: 'cbse', isDefault: false },
        { boardId: 'icse', isDefault: true },
      ]),
    ).toBe('icse');
  });

  it('computes today in the tenant timezone', () => {
    const now = new Date('2025-11-14T20:00:00Z');
    expect(todayInTimeZone('Asia/Kolkata', now)).toBe('2025-11-15');
    expect(todayInTimeZone('UTC', now)).toBe('2025-11-14');
    expect(todayInTimeZone('Not/AZone', now)).toBe('2025-11-14');
  });

  it('gradebook page carries no seed section codes', () => {
    const src = readFileSync(
      resolve(__dirname, '../app/(dashboard)/institutions/[id]/gradebook/page.tsx'),
      'utf8',
    );
    expect(src).not.toContain('G9B-MATH');
    expect(src).not.toMatch(/scales\[0\]/);
  });
});
