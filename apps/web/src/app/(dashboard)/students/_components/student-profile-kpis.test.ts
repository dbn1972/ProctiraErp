/**
 * PRC-L054 — profile KPIs derive from gradebook + invoices, never customData.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  averageScore,
  gradeBadgeVariant,
  gradeOutcome,
  recentGradeEntries,
  summarizeFeeStatus,
} from './student-profile-kpis';

describe('student profile KPIs (PRC-L054)', () => {
  it('average score follows gradebook scores', () => {
    expect(averageScore([])).toBeNull();
    expect(averageScore([{ numericScore: 80 }, { numericScore: null }, { numericScore: 60 }])).toBe(
      70,
    );
    expect(averageScore([{ numericScore: 80 }, { numericScore: 90 }])).toBe(85);
  });

  it('a failed assessment never renders with the success variant', () => {
    expect(gradeBadgeVariant(gradeOutcome({ letterGrade: 'F', metadata: {} }))).toBe('destructive');
    expect(gradeBadgeVariant(gradeOutcome({ letterGrade: 'B', metadata: { passed: false } }))).toBe(
      'destructive',
    );
    expect(gradeBadgeVariant(gradeOutcome({ letterGrade: 'A', metadata: {} }))).toBe('success');
    expect(gradeBadgeVariant(gradeOutcome({ letterGrade: null, metadata: {} }))).toBe('outline');
  });

  it('fee status reflects unpaid / overdue invoices and hides when none exist', () => {
    expect(summarizeFeeStatus([])).toBeNull();
    expect(summarizeFeeStatus([{ status: 'void' }])).toBeNull();
    expect(summarizeFeeStatus([{ status: 'paid' }, { status: 'open' }])).toEqual({
      label: '1 unpaid',
      tone: 'due',
    });
    expect(summarizeFeeStatus([{ status: 'open' }, { status: 'overdue' }])?.tone).toBe('overdue');
    expect(summarizeFeeStatus([{ status: 'paid' }])).toEqual({ label: 'Clear', tone: 'clear' });
  });

  it('recent entries are newest first', () => {
    const out = recentGradeEntries(
      [{ enteredAt: '2025-01-01' }, { enteredAt: '2025-03-01' }, { enteredAt: '2025-02-01' }],
      2,
    );
    expect(out.map((e) => e.enteredAt)).toEqual(['2025-03-01', '2025-02-01']);
  });

  it('profile page no longer reads KPI values from customData', () => {
    const src = readFileSync(join(__dirname, '../[id]/page.tsx'), 'utf8');
    for (const key of [
      'avgScore',
      'averageScore',
      'rankBand',
      'feeStatus',
      'feeClearanceStatus',
      'attendance',
      'attendanceRate',
    ]) {
      expect(src).not.toContain(`cd, '${key}'`);
    }
    expect(src).not.toContain("cd['recentAssessments']");
    expect(src).not.toMatch(/<Badge variant="success" className="text-xs">/);
  });
});
