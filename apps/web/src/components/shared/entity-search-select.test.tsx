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
