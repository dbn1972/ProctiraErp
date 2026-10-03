/**
 * @vitest-environment jsdom
 *
 * PRC-M063: EntitySearchSelect distinguishes load failure / loading from an
 * empty directory, blocks empty required submissions, and supports the ARIA
 * combobox keyboard pattern.
 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import { EntitySearchSelect } from './entity-search-select';

const options = [
  { id: 's-1', label: 'Asha Rao' },
  { id: 's-2', label: 'Arjun Mehta' },
  { id: 's-3', label: 'Bina Das' },
];

describe('EntitySearchSelect (PRC-M063)', () => {
  it('renders an alert (not the empty message) when the directory failed to load', () => {
    render(
      <EntitySearchSelect
        id="student"
        name="studentId"
        label="Student"
        options={[]}
        error="Could not load students."
        required
      />,
    );
    expect(screen.getByRole('alert').textContent).toBe('Could not load students.');
    expect(screen.queryByText(/No directory entries loaded/)).toBeNull();
  });

  it('shows a loading status distinct from the empty message', () => {
    render(<EntitySearchSelect id="s" name="sid" label="Student" options={[]} loading />);
    expect(screen.getByRole('status').textContent).toBe('Loading directory…');
  });

  it('blocks submission of a required field when no option can be chosen', () => {
    const onSubmit = vi.fn((e: React.FormEvent) => e.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <EntitySearchSelect id="s" name="sid" label="Student" options={[]} required />
        <button type="submit">Save</button>
      </form>,
    );
    const select = screen.getByLabelText('Student') as HTMLSelectElement;
    expect(select.required).toBe(true);
    expect(select.checkValidity()).toBe(false);
  });

  it('supports ArrowDown / Enter / Escape in combobox mode', () => {
    const onValueChange = vi.fn();
    const { container } = render(
      <EntitySearchSelect
        id="s"
        name="sid"
        label="Student"
        options={options}
        presentation="combobox"
        onValueChange={onValueChange}
      />,
    );
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'a' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input.getAttribute('aria-activedescendant')).toBe('s-option-1');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenLastCalledWith('s-2');
    expect((input as HTMLInputElement).value).toBe('Arjun Mehta');
    expect(
      (container.querySelector('input[type="hidden"][name="sid"]') as HTMLInputElement).value,
    ).toBe('s-2');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.change(input, { target: { value: 'b' } });
    expect(screen.getByRole('listbox')).toBeTruthy();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
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
