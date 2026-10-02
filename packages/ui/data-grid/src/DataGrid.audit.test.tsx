import { render, screen, fireEvent } from '@testing-library/react';
import { StrictMode } from 'react';
import { describe, it, expect, vi } from 'vitest';

import { DataGrid } from './DataGrid';
import type { DataGridColumn } from './types';

interface Row {
  id: number;
  name: string;
}

const data: Row[] = [
  { id: 1, name: 'Charlie' },
  { id: 2, name: 'Alice' },
  { id: 3, name: 'Bob' },
];

const columns: DataGridColumn<Row>[] = [{ id: 'name', header: 'Name', accessorKey: 'name' }];

describe('DataGrid callbacks under StrictMode (PRC-L511)', () => {
  it('fires onSortingChange exactly once per sort click', () => {
    const onSortingChange = vi.fn();
    render(
      <StrictMode>
        <DataGrid data={data} columns={columns} onSortingChange={onSortingChange} ariaLabel="G" />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name/ }));
    expect(onSortingChange).toHaveBeenCalledTimes(1);
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
  });

  it('fires onPaginationChange and onFilterChange exactly once per interaction', () => {
    const onPaginationChange = vi.fn();
    const onFilterChange = vi.fn();
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `P${i}` }));
    render(
      <StrictMode>
        <DataGrid
          data={many}
          columns={columns}
          enableFiltering
          onPaginationChange={onPaginationChange}
          onFilterChange={onFilterChange}
          ariaLabel="G"
        />
      </StrictMode>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Go to next page' }));
    expect(onPaginationChange).toHaveBeenCalledTimes(1);
    expect(onPaginationChange).toHaveBeenCalledWith({ pageIndex: 1, pageSize: 10 });
    fireEvent.change(screen.getByLabelText('Filter by Name'), { target: { value: 'P1' } });
    expect(onFilterChange).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalledWith([{ id: 'name', value: 'P1' }]);
  });
});

describe('DataGrid error state (PRC-L510)', () => {
  it('renders an alert with retry instead of the empty message', () => {
    const onRetry = vi.fn();
    render(
      <DataGrid
        data={[]}
        columns={columns}
        error={new Error('network')}
        onRetry={onRetry}
        ariaLabel="G"
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Could not load data.');
    expect(screen.queryByText('No data available')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('keeps the empty message for genuinely empty results', () => {
    render(<DataGrid data={[]} columns={columns} ariaLabel="G" />);
    expect(screen.getByText('No data available')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('DataGrid server mode and export scope (PRC-L512)', () => {
  const names = () =>
    screen
      .getAllByRole('row')
      .slice(1)
      .map((r) => r.textContent);

  it('with totalRows, a header click does not reorder the local page', () => {
    const onSortingChange = vi.fn();
    render(
      <DataGrid
        data={data}
        columns={columns}
        totalRows={30}
        onSortingChange={onSortingChange}
        ariaLabel="G"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Sort by Name/ }));
    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
    expect(names()).toEqual(['Charlie', 'Alice', 'Bob']);
  });

  it('exports only filtered rows in client mode', () => {
    const onExport = vi.fn();
    render(
      <DataGrid
        data={data}
        columns={columns}
        enableFiltering
        enableExport
        onExport={onExport}
        ariaLabel="G"
      />,
    );
    fireEvent.change(screen.getByLabelText('Filter by Name'), { target: { value: 'li' } });
    fireEvent.click(screen.getByRole('button', { name: /export data to excel/i }));
    const exported = onExport.mock.calls[0]![0] as Row[];
    expect(exported.map((r) => r.name).sort()).toEqual(['Alice', 'Charlie']);
  });

  it('exports all filtered rows across pages, not just the visible page', () => {
    const onExport = vi.fn();
    const many = Array.from({ length: 25 }, (_, i) => ({ id: i, name: `P${i}` }));
    render(
      <DataGrid data={many} columns={columns} enableExport onExport={onExport} ariaLabel="G" />,
    );
    fireEvent.click(screen.getByRole('button', { name: /export data to excel/i }));
    expect((onExport.mock.calls[0]![0] as Row[]).length).toBe(25);
  });
});

describe('DataGrid ids and sort labels (PRC-L513)', () => {
  it('two grids on one page have unique ids and labels resolve within each grid', () => {
    const { container } = render(
      <>
        <DataGrid data={data} columns={columns} enableFiltering ariaLabel="First" />
        <DataGrid data={data} columns={columns} enableFiltering ariaLabel="Second" />
      </>,
    );
    const ids = Array.from(container.querySelectorAll('[id]')).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const grid of screen.getAllByRole('region')) {
      grid.querySelectorAll('label[for]').forEach((label) => {
        const target = document.getElementById(label.getAttribute('for')!);
        expect(target).not.toBeNull();
        expect(grid.contains(target)).toBe(true);
      });
    }
    expect(screen.getAllByLabelText('Rows per page:')).toHaveLength(2);
  });

  it('keeps the column name in the sort label once sorted', () => {
    render(<DataGrid data={data} columns={columns} ariaLabel="G" />);
    const btn = screen.getByRole('button', { name: /Sort by Name/ });
    fireEvent.click(btn);
    expect(btn).toHaveAccessibleName('Name, sorted ascending. Click to sort descending.');
    fireEvent.click(btn);
    expect(btn).toHaveAccessibleName('Name, sorted descending. Click to clear sort.');
  });

  it('makes the overflow container keyboard-focusable with a name', () => {
    render(<DataGrid data={data} columns={columns} ariaLabel="Students" />);
    const scroller = screen.getByRole('group', { name: 'Students (scrollable)' });
    expect(scroller).toHaveAttribute('tabindex', '0');
  });
});
