export interface SortingState {
  id: string;
  desc: boolean;
}

export interface FilterState {
  id: string;
  value: string;
}

export interface PaginationState {
  pageIndex: number;
  pageSize: number;
}

export interface DataGridExportOptions {
  filename?: string;
  sheetName?: string;
  includeHeaders?: boolean;
}

export interface DataGridColumn<TData> {
  id: string;
  header: string;
  accessorKey?: keyof TData & string;
  accessorFn?: (row: TData) => unknown;
  enableSorting?: boolean;
  enableFiltering?: boolean;
  cell?: (info: { getValue: () => unknown; row: { original: TData } }) => React.ReactNode;
}

export interface DataGridProps<TData> {
  /** Data array to display in the grid */
  data: TData[];
  /** Column definitions */
  columns: DataGridColumn<TData>[];
  /** Enable sorting on columns */
  enableSorting?: boolean;
  /** Enable column filtering */
  enableFiltering?: boolean;
  /** Enable pagination */
  enablePagination?: boolean;
  /** Page size options */
  pageSizeOptions?: number[];
  /** Default page size */
  defaultPageSize?: number;
  /** Enable Excel export */
  enableExport?: boolean;
  /** Export options */
  exportOptions?: DataGridExportOptions;
  /** Callback when sorting changes */
  onSortingChange?: (sorting: SortingState[]) => void;
  /** Callback when filtering changes */
  onFilterChange?: (filters: FilterState[]) => void;
  /** Callback when pagination changes */
  onPaginationChange?: (pagination: PaginationState) => void;
  /**
   * Callback for export action. Client mode receives all filtered/sorted
   * rows; server mode (`totalRows` set) receives only the loaded page, so
   * delegate to a server export that applies the current sort/filter state.
   */
  onExport?: (data: TData[], options: DataGridExportOptions) => void;
  /**
   * Total row count for server-side mode. When set, pagination, sorting and
   * filtering are manual: the grid emits state changes and renders `data`
   * as given.
   */
  totalRows?: number;
  /** Loading state */
  loading?: boolean;
  /**
   * Fetch/load error. When set (and not loading) the body renders a
   * `role="alert"` row instead of the empty-state message.
   */
  error?: unknown;
  /** Message shown for `error`. Defaults to `"Could not load data."` */
  errorMessage?: string;
  /** When provided with `error`, renders a Retry button in the alert row. */
  onRetry?: () => void;
  /** Accessible label for the data grid */
  ariaLabel: string;
  /** Additional CSS class name */
  className?: string;
}
