import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import { DataTableCard, type DataTableCardColumn } from './DataTableCard';

interface Row {
  id: string;
  state: string;
  schools: number;
}

const columns: ReadonlyArray<DataTableCardColumn<Row>> = [
  { id: 'state', header: 'State', cell: (r) => r.state },
  { id: 'schools', header: 'Schools', cell: (r) => r.schools.toLocaleString() },
];

const rows: ReadonlyArray<Row> = [
  { id: '1', state: 'Tamil Nadu', schools: 58_400 },
  { id: '2', state: 'Maharashtra', schools: 102_300 },
];

describe('<DataTableCard />', () => {
  it('renders headers and one body row per data row', () => {
    render(
      <DataTableCard
        title="State breakdown"
        description="Top performing states"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        data-testid="card"
      />,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveAttribute('data-state', 'ready');
    expect(screen.getByText('State')).toBeInTheDocument();
    expect(screen.getByText('Schools')).toBeInTheDocument();
    expect(screen.getByText('Tamil Nadu')).toBeInTheDocument();
    expect(screen.getByText('Maharashtra')).toBeInTheDocument();
  });

  it('renders skeleton rows matching the column count when loading', () => {
    render(
      <DataTableCard
        title="State breakdown"
        columns={columns}
        rows={[]}
        rowKey={() => '0'}
        loading
        loadingRowCount={3}
        data-testid="card"
      />,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveAttribute('data-state', 'loading');
    expect(card).toHaveAttribute('aria-busy', 'true');

    const skeletonRows = screen.getAllByTestId('data-table-card-skeleton-row');
    expect(skeletonRows).toHaveLength(3);
    skeletonRows.forEach((row) => {
      expect(within(row).getAllByRole('cell')).toHaveLength(columns.length);
    });
  });

  it('renders the empty-state cell spanning all columns when rows is empty', () => {
    render(
      <DataTableCard
        title="State breakdown"
        columns={columns}
        rows={[]}
        rowKey={() => '0'}
        emptyMessage="Nothing to see"
      />,
    );

    const empty = screen.getByTestId('data-table-card-empty');
    expect(empty.textContent).toBe('Nothing to see');
    expect(empty.getAttribute('colspan')).toBe(String(columns.length));
  });

  it('renders an inline error message with role="alert" when error is set', () => {
    render(
      <DataTableCard
        title="State breakdown"
        columns={columns}
        rows={[]}
        rowKey={() => '0'}
        error={new Error('boom')}
        data-testid="card"
      />,
    );

    const card = screen.getByTestId('card');
    expect(card).toHaveAttribute('data-state', 'error');
    expect(card).toHaveAttribute('role', 'alert');
    expect(screen.getByTestId('data-table-card-error')).toBeInTheDocument();
  });

  it('invokes onRowClick when a row is activated', () => {
    const onRowClick = vi.fn();
    render(
      <DataTableCard
        title="State breakdown"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        onRowClick={onRowClick}
      />,
    );

    fireEvent.click(screen.getByText('Tamil Nadu'));
    expect(onRowClick).toHaveBeenCalledWith(rows[0]);
  });
});
