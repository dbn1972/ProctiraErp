/**
 * PRC-L228: EntitySearchSelect submits ids, filters by label and shows an
 * explicit empty state instead of a raw id field.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { EntitySearchSelect } from './entity-search-select';

const options = [
  { id: 'id-1', label: 'ADM-1 · Asha', searchText: 'asha adm-1' },
  { id: 'id-2', label: 'ADM-2 · Ravi' },
];

describe('EntitySearchSelect', () => {
  it('filters options by label and reports the chosen id', () => {
    const onValueChange = vi.fn();
    render(
      <EntitySearchSelect
        id="s"
        name="studentId"
        label="Student"
        options={options}
        onValueChange={onValueChange}
      />,
    );
    fireEvent.change(screen.getByLabelText('Student search'), { target: { value: 'ravi' } });
    const select = screen.getByLabelText('Student', { selector: 'select' });
    expect(Array.from((select as HTMLSelectElement).options).map((o) => o.value)).toEqual([
      '',
      'id-2',
    ]);
    fireEvent.change(select, { target: { value: 'id-2' } });
    expect(onValueChange).toHaveBeenCalledWith('id-2');
    expect(screen.getByTestId('s-selected-label')).toHaveTextContent('ADM-2 · Ravi');
  });

  it('shows the empty message and submits an empty value when no options exist', () => {
    const { container } = render(
      <EntitySearchSelect
        id="s"
        name="studentId"
        label="Student"
        options={[]}
        emptyMessage="Nothing here"
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('Nothing here');
    expect(container.querySelector<HTMLInputElement>('input[name="studentId"]')?.value).toBe('');
  });

  it('combobox mode selects an option and stores its id in the hidden input', () => {
    const { container } = render(
      <EntitySearchSelect
        id="c"
        name="studentId"
        label="Student"
        options={options}
        presentation="combobox"
      />,
    );
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'asha' } });
    fireEvent.click(screen.getByRole('option', { name: 'ADM-1 · Asha' }));
    expect(container.querySelector<HTMLInputElement>('input[name="studentId"]')?.value).toBe(
      'id-1',
    );
  });
});

describe('EntitySearchSelect remote search (PRC-M083)', () => {
  it('finds entries beyond the seeded page via the directory search route', async () => {
    const fetchMock = vi.fn(
      async (_url: string) =>
        new Response(JSON.stringify({ data: [{ id: 'id-101', label: 'ADM-101 · Zoya' }] }), {
          status: 200,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const onOptionSelected = vi.fn();
    render(
      <EntitySearchSelect
        id="r"
        name="studentId"
        label="Student"
        options={options}
        remoteSearch="student"
        totalAvailable={101}
        onOptionSelected={onOptionSelected}
      />,
    );
    expect(screen.getByText(/Showing 2 of 101/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Student search'), { target: { value: 'zoya' } });
    const select = screen.getByLabelText('Student', { selector: 'select' }) as HTMLSelectElement;
    await vi.waitFor(() =>
      expect(Array.from(select.options).map((o) => o.value)).toContain('id-101'),
    );
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      '/api/directory/search?kind=student&q=zoya',
    );
    fireEvent.change(select, { target: { value: 'id-101' } });
    expect(onOptionSelected).toHaveBeenCalledWith({ id: 'id-101', label: 'ADM-101 · Zoya' });
    vi.unstubAllGlobals();
  });
});
