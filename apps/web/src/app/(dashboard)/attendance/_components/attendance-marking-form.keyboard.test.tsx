/**
 * @vitest-environment jsdom
 *
 * UX AT-2 — the roster grid is keyboard-first.
 *
 * The defect (`docs/audits/UX_ATTENDANCE_2026-09-24.md`): each row rendered five
 * `<button aria-pressed>` elements inside a `role="group"`. So a 40-student roster cost ~200 tab
 * stops before the first comment field, and assistive technology heard five independent toggles
 * instead of one five-way choice. Attendance is the highest-frequency journey in the product, so
 * that cost was paid every period of every day.
 *
 * These tests measure the two properties that matter rather than the markup:
 *
 *   1. **tab stops scale with rows, not with rows × options** — a roving tabindex means one
 *      reachable control per row
 *   2. **arrow keys select**, which is what makes marking a row a single keystroke
 *
 * The count assertions are deliberately expressed against the number of rows, so they keep
 * meaning if a sixth status is ever added.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import React from 'react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '@/messages/en.json';

import { describe, expect, it, vi, beforeEach } from 'vitest';

let currentPathname = '/attendance';
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => currentPathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('../actions', () => ({
  markAttendanceAction: vi.fn(async () => ({ status: 'success', message: 'ok' })),
}));

import { AttendanceMarkingForm } from './attendance-marking-form';

const ROSTER = [
  {
    studentId: 's1',
    studentName: 'Aarav Sharma',
    enrollmentId: 'e1',
    classId: 'c1',
    gradeId: 'g1',
  },
  { studentId: 's2', studentName: 'Diya Patel', enrollmentId: 'e2', classId: 'c1', gradeId: 'g1' },
  { studentId: 's3', studentName: 'Kabir Singh', enrollmentId: 'e3', classId: 'c1', gradeId: 'g1' },
];

function renderForm() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <AttendanceMarkingForm
        institutions={[{ id: 'i1', name: 'Northfield' }]}
        classes={[{ id: 'c1', name: '5A' }]}
        academicPeriods={[{ id: 'p1', name: 'Term 1', isActive: true }]}
        defaults={{
          institutionId: 'i1',
          classId: 'c1',
          academicPeriodId: 'p1',
          date: '2026-09-24',
        }}
        roster={ROSTER}
      />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  currentPathname = '/attendance';
  window.localStorage.clear();
});

describe('AT-2 status control exposes real radio-group semantics', () => {
  it('is a radiogroup per student, not five independent toggles', () => {
    renderForm();
    const groups = screen.getAllByRole('radiogroup');
    expect(groups).toHaveLength(ROSTER.length);
    // The old shape: aria-pressed buttons. It must be gone, or AT hears toggles.
    expect(document.querySelectorAll('[aria-pressed]')).toHaveLength(0);
  });

  it('exposes exactly one checked radio per row', () => {
    renderForm();
    for (const group of screen.getAllByRole('radiogroup')) {
      const checked = within(group)
        .getAllByRole('radio')
        .filter((r) => r.getAttribute('aria-checked') === 'true');
      expect(checked).toHaveLength(1);
    }
  });

  it('keeps one tab stop per row — not one per option', () => {
    renderForm();
    const radios = screen.getAllByRole('radio');
    const tabbable = radios.filter((r) => r.getAttribute('tabindex') === '0');
    // The measurement the finding was about: 3 rows → 3 stops, not 3 × 5 = 15.
    expect(tabbable).toHaveLength(ROSTER.length);
    expect(radios.length).toBeGreaterThan(tabbable.length);
  });
});

describe('AT-2 keyboard operation', () => {
  /** The checked option's label inside a given row. */
  function checkedLabel(group: HTMLElement): string | null {
    return (
      within(group)
        .getAllByRole('radio')
        .find((r) => r.getAttribute('aria-checked') === 'true')?.textContent ?? null
    );
  }

  /** Focus the row's tabbable radio, as Tab would. */
  function focusRow(group: HTMLElement): HTMLElement {
    const tabbable = within(group)
      .getAllByRole('radio')
      .find((r) => r.getAttribute('tabindex') === '0')!;
    tabbable.focus();
    return tabbable;
  }

  it('arrow keys move and select, so marking a row is one keystroke', () => {
    renderForm();
    const group = screen.getAllByRole('radiogroup')[0]!;
    focusRow(group);

    expect(checkedLabel(group)).toBe('Present');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedLabel(group)).toBe('Absent');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedLabel(group)).toBe('Late');
    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(checkedLabel(group)).toBe('Absent');
    // Down/Up are equivalent in a radio group.
    fireEvent.keyDown(group, { key: 'ArrowDown' });
    expect(checkedLabel(group)).toBe('Late');
    fireEvent.keyDown(group, { key: 'ArrowUp' });
    expect(checkedLabel(group)).toBe('Absent');
  });

  it('wraps at both ends rather than dead-ending', () => {
    renderForm();
    const group = screen.getAllByRole('radiogroup')[0]!;
    focusRow(group);

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(checkedLabel(group)).toBe('Early'); // wrapped backwards to the last option
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(checkedLabel(group)).toBe('Present'); // and forwards to the first
  });

  it('Home and End jump to the first and last status', () => {
    renderForm();
    const group = screen.getAllByRole('radiogroup')[0]!;
    focusRow(group);

    fireEvent.keyDown(group, { key: 'End' });
    expect(checkedLabel(group)).toBe('Early');
    fireEvent.keyDown(group, { key: 'Home' });
    expect(checkedLabel(group)).toBe('Present');
  });

  it('type-ahead picks a status by first letter and cycles on collisions', () => {
    renderForm();
    const group = screen.getAllByRole('radiogroup')[0]!;
    focusRow(group);

    fireEvent.keyDown(group, { key: 'a' });
    expect(checkedLabel(group)).toBe('Absent');
    fireEvent.keyDown(group, { key: 'l' });
    expect(checkedLabel(group)).toBe('Late');
    // Two labels start with "e" — Excused and Early. Repeats must cycle, not stick.
    fireEvent.keyDown(group, { key: 'e' });
    expect(checkedLabel(group)).toBe('Excused');
    fireEvent.keyDown(group, { key: 'e' });
    expect(checkedLabel(group)).toBe('Early');
    fireEvent.keyDown(group, { key: 'p' });
    expect(checkedLabel(group)).toBe('Present');
  });

  it('keeps focus on the selected option so ring and announcement agree', () => {
    renderForm();
    const group = screen.getAllByRole('radiogroup')[0]!;
    focusRow(group);
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(document.activeElement?.textContent).toBe('Absent');
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
  });

  it('changing one row leaves the others alone', () => {
    renderForm();
    const [first, second] = screen.getAllByRole('radiogroup');
    fireEvent.click(within(first!).getByRole('radio', { name: 'Absent' }));
    expect(checkedLabel(first!)).toBe('Absent');
    expect(checkedLabel(second!)).toBe('Present');
  });
});
