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
