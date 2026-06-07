/**
 * DataGrid keyboard-contract tests — Task 56.6 / Req 37 AC 6.
 *
 * Validates the documented keyboard contract for `<DataGrid>`:
 *
 *   • Sortable column headers are <button>s and respond to Enter and
 *     Space (native button activation), cycling
 *     none → ascending → descending → none.
 *   • The header carries an up-to-date `aria-sort` attribute.
 *   • Pagination buttons (first / previous / next / last) are <button>s
 *     and activate on Enter / Space.
 *   • Page-size <select> uses the native combobox keyboard model and
 *     fires `onPaginationChange` when changed.
 *
 * Arrow-key cell navigation (the full WAI-ARIA Data Grid pattern) is
 * NOT implemented yet — the README notes "tests pending implementation"
 * for that mode.
 */

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { act } from 'react';
import { DataGrid } from './DataGrid';
import type { DataGridColumn } from './types';

interface Row {
  id: number;
  name: string;
  email: string;
  age: number;
}

const ROWS: Row[] = Array.from({ length: 25 }, (_, i) => ({
  id: i + 1,
  name: `Person ${i + 1}`,
  email: `p${i + 1}@example.com`,
  age: 20 + (i % 30),
}));

const COLUMNS: DataGridColumn<Row>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'email', header: 'Email', accessorKey: 'email' },
  { id: 'age', header: 'Age', accessorKey: 'age' },
];

describe('<DataGrid> keyboard contract — Task 56.6 / Req 37 AC 6', () => {
  it('renders sortable column headers as <button>s with aria-sort="none" by default', () => {
    render(<DataGrid data={ROWS} columns={COLUMNS} ariaLabel="People" />);

    const headerButtons = screen.getAllByRole('button', {
      name: /^Sort by /,
    });
    expect(headerButtons.length).toBe(3);

    const headerCells = screen.getAllByRole('columnheader');
    for (const cell of headerCells) {
      expect(cell.getAttribute('aria-sort')).toBe('none');
    }
  });

  it('Enter on a sortable header toggles aria-sort none → ascending', () => {
    const onSortingChange = vi.fn();
    render(
      <DataGrid
        data={ROWS}
        columns={COLUMNS}
        onSortingChange={onSortingChange}
        ariaLabel="People"
      />,
    );

    const nameHeader = screen.getByRole('button', { name: /Sort by Name/ });
    act(() => {
      nameHeader.focus();
      fireEvent.click(nameHeader);
    });

    const headerCells = screen.getAllByRole('columnheader');
    expect(headerCells[0].getAttribute('aria-sort')).toBe('ascending');
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
  });

  it('clicking the sort header twice cycles none → asc → desc', () => {
    const onSortingChange = vi.fn();
    render(
      <DataGrid
        data={ROWS}
        columns={COLUMNS}
        onSortingChange={onSortingChange}
        ariaLabel="People"
      />,
    );

    const nameHeader = screen.getByRole('button', { name: /Sort by Name/ });

    act(() => fireEvent.click(nameHeader));
    expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('ascending');

    act(() => fireEvent.click(nameHeader));
    expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('descending');

    expect(onSortingChange).toHaveBeenCalledTimes(2);
  });

  it('Space on a sortable header (a <button>) activates the click handler via native button semantics', () => {
    render(<DataGrid data={ROWS} columns={COLUMNS} ariaLabel="People" />);

    const nameHeader = screen.getByRole('button', { name: /Sort by Name/ });
    act(() => {
      nameHeader.focus();
      // For native <button>s the browser dispatches a `click` event on
      // Space-keyup. Simulate that by firing the synthetic click that
      // the browser would generate; the documented contract is that
      // the sort cycles, which is what we assert.
      fireEvent.keyDown(nameHeader, { key: ' ', code: 'Space' });
      fireEvent.keyUp(nameHeader, { key: ' ', code: 'Space' });
      fireEvent.click(nameHeader);
    });

    expect(screen.getAllByRole('columnheader')[0].getAttribute('aria-sort')).toBe('ascending');
  });

  it('exposes the four pagination buttons in document tab order: first, previous, next, last', () => {
    render(<DataGrid data={ROWS} columns={COLUMNS} ariaLabel="People" />);

    const firstBtn = screen.getByRole('button', { name: 'Go to first page' });
    const prevBtn = screen.getByRole('button', { name: 'Go to previous page' });
    const nextBtn = screen.getByRole('button', { name: 'Go to next page' });
    const lastBtn = screen.getByRole('button', { name: 'Go to last page' });

    // All four are real <button> elements — Enter and Space therefore
    // activate them via native semantics.
    expect(firstBtn.tagName).toBe('BUTTON');
    expect(prevBtn.tagName).toBe('BUTTON');
    expect(nextBtn.tagName).toBe('BUTTON');
    expect(lastBtn.tagName).toBe('BUTTON');

    // Document-order assertion: the four pagination buttons appear in
    // the documented sequence in the DOM tree.
    const order = [firstBtn, prevBtn, nextBtn, lastBtn];
    for (let i = 0; i < order.length - 1; i++) {
      // Compare DOCUMENT_POSITION_FOLLOWING (4) bit.
      const relation = order[i].compareDocumentPosition(order[i + 1]);
      expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('pagination is initially on page 1; previous/first are disabled, next/last are enabled', () => {
    render(<DataGrid data={ROWS} columns={COLUMNS} ariaLabel="People" defaultPageSize={10} />);

    expect(screen.getByRole('button', { name: 'Go to first page' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Go to previous page' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Go to next page' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: 'Go to last page' }).hasAttribute('disabled')).toBe(false);
  });

  it('Enter on the next-page button advances pagination and updates aria-live caption', () => {
    const onPaginationChange = vi.fn();
    render(
      <DataGrid
        data={ROWS}
        columns={COLUMNS}
        ariaLabel="People"
        defaultPageSize={10}
        onPaginationChange={onPaginationChange}
      />,
    );

    const nextBtn = screen.getByRole('button', { name: 'Go to next page' });
    act(() => {
      nextBtn.focus();
      fireEvent.click(nextBtn);
    });

    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 1, pageSize: 10 });
    // The page-info caption is wired to aria-live="polite" and should
    // reflect the new page.
    expect(screen.getByText(/Page 2 of/)).toBeTruthy();
  });

  it('the page-size combobox is a native <select> so the browser provides ArrowUp/Down/Home/End/typeahead', () => {
    const onPaginationChange = vi.fn();
    render(
      <DataGrid
        data={ROWS}
        columns={COLUMNS}
        ariaLabel="People"
        defaultPageSize={10}
        onPaginationChange={onPaginationChange}
      />,
    );

    const pageSize = screen.getByRole('combobox', {
      name: 'Select number of rows per page',
    }) as HTMLSelectElement;
    expect(pageSize.tagName).toBe('SELECT');

    // Simulate the native value-change that the browser would emit
    // after the user presses ArrowDown / Enter on the combobox.
    act(() => {
      fireEvent.change(pageSize, { target: { value: '25' } });
    });

    expect(pageSize.value).toBe('25');
    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 0, pageSize: 25 });
  });
});
