'use client';

import React, { useState, useMemo, useCallback } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  flexRender,
  type SortingState as TanStackSortingState,
  type ColumnFiltersState,
  type PaginationState as TanStackPaginationState,
  type ColumnDef,
} from '@tanstack/react-table';
import type { DataGridProps, DataGridExportOptions } from './types';

/**
 * DataGrid component with sorting, filtering, pagination, and Excel export.
 * Built on TanStack Table. Meets WCAG 2.1 Level AA accessibility standards.
 *
 * @example
 * ```tsx
 * <DataGrid
 *   data={students}
 *   columns={[{ id: 'name', header: 'Name', accessorKey: 'name' }]}
 *   enableSorting
 *   enablePagination
 *   ariaLabel="Student records"
 * />
 * ```
 */
export function DataGrid<TData>({
  data,
  columns,
  enableSorting = true,
  enableFiltering = false,
  enablePagination = true,
  pageSizeOptions = [10, 25, 50, 100],
  defaultPageSize = 10,
  enableExport = false,
  exportOptions = {},
  onSortingChange,
  onFilterChange,
  onPaginationChange,
  onExport,
  totalRows,
  loading = false,
  ariaLabel,
  className = '',
}: DataGridProps<TData>) {
  const [sorting, setSorting] = useState<TanStackSortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [pagination, setPagination] = useState<TanStackPaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  });

  const tanstackColumns: ColumnDef<TData, unknown>[] = useMemo(
    () =>
      columns.map((col) => {
        const colDef: ColumnDef<TData, unknown> = {
          id: col.id,
          header: col.header,
          accessorKey: col.accessorKey,
          accessorFn: col.accessorFn,
          enableSorting: col.enableSorting ?? enableSorting,
          enableColumnFilter: col.enableFiltering ?? enableFiltering,
        };
        if (col.cell) {
          colDef.cell = (info: { getValue: () => unknown; row: { original: TData } }) => col.cell!(info);
        }
        return colDef;
      }),
    [columns, enableSorting, enableFiltering]
  );

  const handleSortingChange = useCallback(
    (updater: TanStackSortingState | ((prev: TanStackSortingState) => TanStackSortingState)) => {
      setSorting((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        onSortingChange?.(next.map((s) => ({ id: s.id, desc: s.desc })));
        return next;
      });
    },
    [onSortingChange]
  );

  const handleFilterChange = useCallback(
    (updater: ColumnFiltersState | ((prev: ColumnFiltersState) => ColumnFiltersState)) => {
      setColumnFilters((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        onFilterChange?.(next.map((f) => ({ id: f.id, value: String(f.value) })));
        return next;
      });
    },
    [onFilterChange]
  );

  const handlePaginationChange = useCallback(
    (updater: TanStackPaginationState | ((prev: TanStackPaginationState) => TanStackPaginationState)) => {
      setPagination((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        onPaginationChange?.({ pageIndex: next.pageIndex, pageSize: next.pageSize });
        return next;
      });
    },
    [onPaginationChange]
  );

  const table = useReactTable({
    data,
    columns: tanstackColumns,
    state: {
      sorting,
      columnFilters,
      pagination,
    },
    onSortingChange: handleSortingChange,
    onColumnFiltersChange: handleFilterChange,
    onPaginationChange: handlePaginationChange,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: enableSorting ? getSortedRowModel() : undefined,
    getFilteredRowModel: enableFiltering ? getFilteredRowModel() : undefined,
    getPaginationRowModel: enablePagination ? getPaginationRowModel() : undefined,
    manualPagination: totalRows !== undefined,
    pageCount: totalRows !== undefined ? Math.ceil(totalRows / pagination.pageSize) : undefined,
  });

  const handleExport = useCallback(() => {
    if (onExport) {
      onExport(data, {
        filename: exportOptions.filename ?? 'export',
        sheetName: exportOptions.sheetName ?? 'Sheet1',
        includeHeaders: exportOptions.includeHeaders ?? true,
      });
    }
  }, [data, exportOptions, onExport]);

  const getSortAriaLabel = (columnId: string, isSorted: false | 'asc' | 'desc') => {
    if (!isSorted) return `Sort by ${columnId}`;
    return isSorted === 'asc'
      ? `Sorted ascending. Click to sort descending.`
      : `Sorted descending. Click to clear sort.`;
  };

  return (
    <div className={`proctira-data-grid ${className}`} role="region" aria-label={ariaLabel}>
      {/* Toolbar */}
      {(enableExport || enableFiltering) && (
        <div className="proctira-data-grid__toolbar" role="toolbar" aria-label="Data grid controls">
          {enableFiltering && (
            <div className="proctira-data-grid__filters">
              {table.getAllColumns().filter((col) => col.getCanFilter()).map((column) => (
                <div key={column.id} className="proctira-data-grid__filter-field">
                  <label htmlFor={`filter-${column.id}`} className="proctira-data-grid__filter-label">
                    {String(column.columnDef.header)}
                  </label>
                  <input
                    id={`filter-${column.id}`}
                    type="text"
                    value={(column.getFilterValue() as string) ?? ''}
                    onChange={(e) => column.setFilterValue(e.target.value || undefined)}
                    placeholder={`Filter ${String(column.columnDef.header)}...`}
                    className="proctira-data-grid__filter-input"
                    aria-label={`Filter by ${String(column.columnDef.header)}`}
                  />
                </div>
              ))}
            </div>
          )}
          {enableExport && (
            <button
              type="button"
              onClick={handleExport}
              className="proctira-data-grid__export-btn"
              aria-label="Export data to Excel"
            >
              Export to Excel
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="proctira-data-grid__table-container" role="presentation">
        <table
          className="proctira-data-grid__table"
          aria-label={ariaLabel}
          aria-busy={loading}
          aria-rowcount={totalRows ?? data.length}
        >
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) => {
                  const isSorted = header.column.getIsSorted();
                  const canSort = header.column.getCanSort();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={
                        isSorted === 'asc'
                          ? 'ascending'
                          : isSorted === 'desc'
                            ? 'descending'
                            : 'none'
                      }
                      className="proctira-data-grid__th"
                    >
                      {canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className="proctira-data-grid__sort-btn"
                          aria-label={getSortAriaLabel(
                            String(header.column.columnDef.header),
                            isSorted
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          <span className="proctira-data-grid__sort-indicator" aria-hidden="true">
                            {isSorted === 'asc' ? ' ▲' : isSorted === 'desc' ? ' ▼' : ' ⇅'}
                          </span>
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="proctira-data-grid__loading"
                  aria-live="polite"
                >
                  Loading data...
                </td>
              </tr>
            ) : table.getRowModel().rows.length === 0 ? (
              <tr>
                <td
                  colSpan={columns.length}
                  className="proctira-data-grid__empty"
                  aria-live="polite"
                >
                  No data available
                </td>
              </tr>
            ) : (
              table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="proctira-data-grid__td">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {enablePagination && (
        <nav
          className="proctira-data-grid__pagination"
          aria-label="Table pagination"
          role="navigation"
        >
          <div className="proctira-data-grid__pagination-info" aria-live="polite">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
            {totalRows !== undefined && ` (${totalRows} total rows)`}
          </div>
          <div className="proctira-data-grid__pagination-controls">
            <button
              type="button"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
              aria-label="Go to first page"
              className="proctira-data-grid__page-btn"
            >
              ⟨⟨
            </button>
            <button
              type="button"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              aria-label="Go to previous page"
              className="proctira-data-grid__page-btn"
            >
              ⟨
            </button>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              aria-label="Go to next page"
              className="proctira-data-grid__page-btn"
            >
              ⟩
            </button>
            <button
              type="button"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
              aria-label="Go to last page"
              className="proctira-data-grid__page-btn"
            >
              ⟩⟩
            </button>
          </div>
          <div className="proctira-data-grid__page-size">
            <label htmlFor="page-size-select">Rows per page:</label>
            <select
              id="page-size-select"
              value={pagination.pageSize}
              onChange={(e) => table.setPageSize(Number(e.target.value))}
              aria-label="Select number of rows per page"
              className="proctira-data-grid__page-size-select"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>
        </nav>
      )}
    </div>
  );
}
