/**
 * @vitest-environment jsdom
 *
 * PRC-M116 — the PAL learner picker searches the whole directory (a student
 * far past the first 50 can be chosen and their plan loads) and a failed
 * student search is an error, not an empty picker.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchPalStudentsAction = vi.fn();
const lookupStudentPalAction = vi.fn();
vi.mock('../actions', () => ({
  searchPalStudentsAction: (...a: unknown[]) => searchPalStudentsAction(...a),
  lookupStudentPalAction: (...a: unknown[]) => lookupStudentPalAction(...a),
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, v?: Record<string, unknown>) =>
    v && 'count' in v ? `${key}:${String(v.count)}` : key,
}));
vi.mock('@/hooks/useHydrated', () => ({ useHydrated: () => true }));

import { PalLookup } from './pal-lookup';

const STUDENT_120 = '00000000-0000-4000-8000-000000000120';

describe('PalLookup search (PRC-M116)', () => {
  beforeEach(() => {
    searchPalStudentsAction.mockReset();
    lookupStudentPalAction.mockReset();
  });

  it('a student ranked #120 is found by search and their plan loads', async () => {
    searchPalStudentsAction.mockResolvedValue({
      ok: true,
      items: [{ id: STUDENT_120, name: 'Zara Zubair' }],
    });
    lookupStudentPalAction.mockResolvedValue({
      status: 'success',
      plan: {
        summary: { dueReviews: 0, mastered: 0, inProgress: 0, notStarted: 0, blocked: 0 },
        items: [],
      },
      progress: null,
    });
    render(<PalLookup />);
    fireEvent.change(screen.getByLabelText('searchStudents'), { target: { value: 'Zub' } });
    await waitFor(() => expect(searchPalStudentsAction).toHaveBeenCalledWith('Zub'));
    const select = (await screen.findByRole('combobox', {
      name: 'fieldStudent',
    })) as HTMLSelectElement;
    expect(select.value).toBe(STUDENT_120);
    fireEvent.click(screen.getByRole('button', { name: /loadPlan/ }));
    await waitFor(() => expect(lookupStudentPalAction).toHaveBeenCalledWith(STUDENT_120));
    expect(await screen.findByTestId('pal-plan')).toBeTruthy();
  });

  it('a failed student search shows an error', async () => {
    searchPalStudentsAction.mockResolvedValue({ ok: false });
    render(<PalLookup />);
    fireEvent.change(screen.getByLabelText('searchStudents'), { target: { value: 'Ann' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('studentsLoadFailed');
  });

  it('?studentId= preselects the learner', () => {
    render(<PalLookup initialStudentId={STUDENT_120} />);
    expect((screen.getByLabelText('fieldStudent') as HTMLInputElement).value).toBe(STUDENT_120);
  });
});
