import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DataGrid } from './DataGrid';
import type { DataGridColumn } from './types';

interface TestRow {
  id: number;
  name: string;
  email: string;
  age: number;
}

const testData: TestRow[] = [
  { id: 1, name: 'Alice', email: 'alice@example.com', age: 30 },
  { id: 2, name: 'Bob', email: 'bob@example.com', age: 25 },
  { id: 3, name: 'Charlie', email: 'charlie@example.com', age: 35 },
  { id: 4, name: 'Diana', email: 'diana@example.com', age: 28 },
  { id: 5, name: 'Eve', email: 'eve@example.com', age: 22 },
];

const testColumns: DataGridColumn<TestRow>[] = [
  { id: 'name', header: 'Name', accessorKey: 'name' },
  { id: 'email', header: 'Email', accessorKey: 'email' },
  { id: 'age', header: 'Age', accessorKey: 'age' },
];

describe('DataGrid', () => {
  it('renders table with data', () => {
    render(
      <DataGrid data={testData} columns={testColumns} ariaLabel="Test grid" />
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('alice@example.com')).toBeInTheDocument();
  });

  it('renders column headers', () => {
    render(
      <DataGrid data={testData} columns={testColumns} ariaLabel="Test grid" />
    );

    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('shows empty state when no data', () => {
    render(
      <DataGrid data={[]} columns={testColumns} ariaLabel="Test grid" />
    );

    expect(screen.getByText('No data available')).toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(
      <DataGrid data={[]} columns={testColumns} loading ariaLabel="Test grid" />
    );

    expect(screen.getByText('Loading data...')).toBeInTheDocument();
  });

  it('supports sorting via column header click', () => {
    const onSortingChange = vi.fn();
    render(
      <DataGrid
        data={testData}
        columns={testColumns}
        enableSorting
        onSortingChange={onSortingChange}
        ariaLabel="Test grid"
      />
    );

    const sortButton = screen.getByRole('button', { name: /sort by name/i });
    fireEvent.click(sortButton);

    expect(onSortingChange).toHaveBeenCalledWith([{ id: 'name', desc: false }]);
  });

  it('renders pagination controls when enabled', () => {
    render(
      <DataGrid
        data={testData}
        columns={testColumns}
        enablePagination
        defaultPageSize={2}
        ariaLabel="Test grid"
      />
    );

    expect(screen.getByRole('navigation', { name: /table pagination/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Go to next page')).toBeInTheDocument();
    expect(screen.getByLabelText('Go to previous page')).toBeInTheDocument();
  });

  it('renders export button when enabled', () => {
    const onExport = vi.fn();
    render(
      <DataGrid
        data={testData}
        columns={testColumns}
        enableExport
        onExport={onExport}
        ariaLabel="Test grid"
      />
    );

    const exportBtn = screen.getByRole('button', { name: /export data to excel/i });
    expect(exportBtn).toBeInTheDocument();

    fireEvent.click(exportBtn);
    expect(onExport).toHaveBeenCalledWith(testData, expect.objectContaining({
      filename: 'export',
      includeHeaders: true,
    }));
  });

  it('renders filter inputs when filtering is enabled', () => {
    render(
      <DataGrid
        data={testData}
        columns={testColumns.map((c) => ({ ...c, enableFiltering: true }))}
        enableFiltering
        ariaLabel="Test grid"
      />
    );

    expect(screen.getByLabelText(/filter by name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/filter by email/i)).toBeInTheDocument();
  });

  it('has proper WCAG accessibility attributes', () => {
    render(
      <DataGrid data={testData} columns={testColumns} ariaLabel="Student records" />
    );

    expect(screen.getByRole('region', { name: 'Student records' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Student records' })).toBeInTheDocument();

    // Column headers have scope="col"
    const headers = screen.getAllByRole('columnheader');
    headers.forEach((header) => {
      expect(header).toHaveAttribute('scope', 'col');
    });
  });

  it('provides aria-sort on sorted columns', () => {
    render(
      <DataGrid
        data={testData}
        columns={testColumns}
        enableSorting
        ariaLabel="Test grid"
      />
    );

    // Initially no sort
    const headers = screen.getAllByRole('columnheader');
    headers.forEach((header) => {
      expect(header).toHaveAttribute('aria-sort', 'none');
    });

    // Click to sort
    const sortButton = screen.getByRole('button', { name: /sort by name/i });
    fireEvent.click(sortButton);

    const nameHeader = screen.getAllByRole('columnheader')[0];
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('supports page size selection', () => {
    render(
      <DataGrid
        data={testData}
        columns={testColumns}
        enablePagination
        pageSizeOptions={[2, 5, 10]}
        defaultPageSize={2}
        ariaLabel="Test grid"
      />
    );

    const select = screen.getByLabelText(/select number of rows per page/i);
    expect(select).toBeInTheDocument();
    expect(select).toHaveValue('2');
  });
});
