/**
 * @vitest-environment jsdom
 *
 * PRC-M142 — the institution week grid must show Sunday meetings (the create
 * form allows day 7) and must render every overlapping meeting in a cell, not
 * just the first match.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@/app/(dashboard)/timetable-actions', () => ({ deleteMeetingAction: vi.fn() }));
vi.mock('@/components/shared/confirm-action-dialog', () => ({
  ConfirmActionDialog: () => null,
}));

import { InstitutionWeekGrid, type GridMeeting, type GridPeriod } from './institution-week-grid';

const periods: GridPeriod[] = [{ id: 'p1', label: 'P1', time: '08:00', isBreak: false }];

function meeting(partial: Partial<GridMeeting> & { id: string; dayOfWeek: number }): GridMeeting {
  return {
    sectionId: 's1',
    periodId: 'p1',
    title: partial.id,
    detail: 'd',
    tone: 'c1',
    draft: false,
    editable: true,
    ...partial,
  };
}

function renderGrid(meetings: GridMeeting[]) {
  return render(
    <InstitutionWeekGrid
      institutionId="i1"
      classKey="c1"
      periods={periods}
      meetings={meetings}
      caption="week"
    />,
  );
}

describe('InstitutionWeekGrid (PRC-M142)', () => {
  it('shows a Sunday column when a meeting falls on Sunday (day 7)', () => {
    renderGrid([meeting({ id: 'sun', dayOfWeek: 7, title: 'Sunday class' })]);
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Sunday class')).toBeInTheDocument();
  });

  it('treats day 0 as Sunday too', () => {
    renderGrid([meeting({ id: 'sun0', dayOfWeek: 0, title: 'Zero class' })]);
    expect(screen.getByText('Sun')).toBeInTheDocument();
    expect(screen.getByText('Zero class')).toBeInTheDocument();
  });

  it('renders every overlapping meeting in the same cell', () => {
    renderGrid([
      meeting({ id: 'a', dayOfWeek: 1, title: 'Meeting A' }),
      meeting({ id: 'b', dayOfWeek: 1, title: 'Meeting B' }),
    ]);
    expect(screen.getByText('Meeting A')).toBeInTheDocument();
    expect(screen.getByText('Meeting B')).toBeInTheDocument();
  });

  it('still shows the standard Mon–Sat week without Sunday when none falls on it', () => {
    renderGrid([meeting({ id: 'a', dayOfWeek: 1 })]);
    expect(screen.getByText('Mon')).toBeInTheDocument();
    expect(screen.getByText('Sat')).toBeInTheDocument();
    expect(screen.queryByText('Sun')).not.toBeInTheDocument();
  });
});
