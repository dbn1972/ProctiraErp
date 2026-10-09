/**
 * @vitest-environment jsdom
 *
 * PRC-M141 — enrol handlers must reset the form and call router.refresh() on
 * success (they previously called event.currentTarget.reset() after an await,
 * where currentTarget is null, which threw and skipped the refresh).
 * PRC-M140 — bulk enrol must flag ambiguous tokens instead of silently
 * enrolling the last-matching student.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const refresh = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));

const actions = vi.hoisted(() => ({
  enrollStudentAction: vi.fn(),
  bulkEnrollStudentsAction: vi.fn(),
  publishSectionAction: vi.fn(),
  unpublishSectionAction: vi.fn(),
  withdrawStudentAction: vi.fn(),
}));
vi.mock('@/app/(dashboard)/timetable-actions', () => actions);

// Render EntitySearchSelect as a plain native select so the test can set a value.
vi.mock('@/components/shared/entity-search-select', () => ({
  EntitySearchSelect: ({
    id,
    name,
    options,
  }: {
    id: string;
    name: string;
    options?: { id: string; label: string }[];
  }) => (
    <select id={id} name={name} aria-label={name}>
      <option value="">—</option>
      {(options ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

import { SectionEnrollForm, SectionBulkEnrollForm } from './section-roster-controls';

const options = [
  { id: 's-1', label: 'Asha Rao', searchText: 'Asha Rao ADM-1' },
  { id: 's-2', label: 'Asha Singh', searchText: 'Asha Singh ADM-2' },
];

beforeEach(() => {
  refresh.mockReset();
  for (const fn of Object.values(actions)) fn.mockReset();
});

describe('SectionEnrollForm (PRC-M141)', () => {
  it('resets the form and refreshes on success (no currentTarget-null throw)', async () => {
    actions.enrollStudentAction.mockResolvedValue({ ok: true });
    render(<SectionEnrollForm institutionId="i1" sectionId="sec1" studentOptions={options} />);
    const select = screen.getByLabelText('studentId') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 's-1' } });
    fireEvent.submit(select.closest('form')!);
    await waitFor(() => expect(actions.enrollStudentAction).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(select.value).toBe('');
  });
});

describe('SectionBulkEnrollForm (PRC-M140)', () => {
  it('blocks an ambiguous token instead of enrolling the last match', async () => {
    render(<SectionBulkEnrollForm institutionId="i1" sectionId="sec1" studentOptions={options} />);
    const textarea = screen.getByLabelText(/bulk assign/i);
    // "Asha" matches both students → ambiguous.
    fireEvent.change(textarea, { target: { value: 'Asha' } });
    fireEvent.submit(textarea.closest('form')!);
    expect(await screen.findByRole('alert')).toHaveTextContent(/ambiguous/i);
    expect(actions.bulkEnrollStudentsAction).not.toHaveBeenCalled();
  });

  it('enrols a unique admission token and resets/refreshes on success', async () => {
    actions.bulkEnrollStudentsAction.mockResolvedValue({ ok: true, enrolled: 1, failed: [] });
    render(<SectionBulkEnrollForm institutionId="i1" sectionId="sec1" studentOptions={options} />);
    const textarea = screen.getByLabelText(/bulk assign/i) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'ADM-1' } });
    fireEvent.submit(textarea.closest('form')!);
    await waitFor(() => expect(actions.bulkEnrollStudentsAction).toHaveBeenCalledTimes(1));
    expect(actions.bulkEnrollStudentsAction.mock.calls[0]![0].studentIds).toEqual(['s-1']);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(textarea.value).toBe('');
  });
});
