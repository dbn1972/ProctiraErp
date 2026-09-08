/**
 * AuditViewer — Filterable audit trail list page (Task 60A.10).
 *
 * Displays a paginated table of audit entries with filters for:
 *   - Entity type (dropdown)
 *   - User (text search)
 *   - Date range (from/to date inputs)
 *   - Operation (CREATE / UPDATE / DELETE)
 *
 * Clicking a row navigates to the AuditDetail view showing before/after
 * values for that entry.
 *
 * Wired to `GET /api/v1/audit/entries` via `browserGatewayFetch`.
 *
 * Validates: Requirements 21.1, 21.2, 21.3, 21.4
 */

import { useCallback, useEffect, useReducer } from 'react';
import { useNavigate } from 'react-router-dom';

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@proctira/ui/components';

import {
  type AuditEntriesFilter,
  type AuditEntry,
  type AuditOperation,
  type AuditPaginationMeta,
  listAuditEntries,
  listAuditEntityTypes,
} from '@/lib/api/audit';

// ─── State ───────────────────────────────────────────────────────────────

interface State {
  loading: boolean;
  error: string | null;
  entries: AuditEntry[];
  meta: AuditPaginationMeta;
  entityTypes: string[];
  entityTypesLoading: boolean;
  filters: AuditEntriesFilter;
}

const initialState: State = {
  loading: true,
  error: null,
  entries: [],
  meta: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
  entityTypes: [],
  entityTypesLoading: true,
  filters: { page: 1, pageSize: 20 },
};

type Action =
  | { type: 'FETCH_START' }
  | { type: 'FETCH_OK'; entries: AuditEntry[]; meta: AuditPaginationMeta }
  | { type: 'FETCH_FAIL'; message: string }
  | { type: 'ENTITY_TYPES_OK'; entityTypes: string[] }
  | { type: 'SET_FILTER'; filter: Partial<AuditEntriesFilter> }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'RESET_FILTERS' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'FETCH_START':
      return { ...state, loading: true, error: null };
    case 'FETCH_OK':
      return {
        ...state,
        loading: false,
        entries: action.entries,
        meta: action.meta,
      };
    case 'FETCH_FAIL':
      return { ...state, loading: false, error: action.message };
    case 'ENTITY_TYPES_OK':
      return { ...state, entityTypesLoading: false, entityTypes: action.entityTypes };
    case 'SET_FILTER':
      return {
        ...state,
        filters: { ...state.filters, ...action.filter, page: 1 },
      };
    case 'SET_PAGE':
      return { ...state, filters: { ...state.filters, page: action.page } };
    case 'RESET_FILTERS':
      return { ...state, filters: { page: 1, pageSize: 20 } };
    default:
      return state;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

const OPERATION_OPTIONS: { value: AuditOperation | ''; label: string }[] = [
  { value: '', label: 'All operations' },
  { value: 'CREATE', label: 'Create' },
  { value: 'UPDATE', label: 'Update' },
  { value: 'DELETE', label: 'Delete' },
];

function operationBadgeVariant(
  op: AuditOperation,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (op) {
    case 'CREATE':
      return 'default';
    case 'UPDATE':
      return 'secondary';
    case 'DELETE':
      return 'destructive';
    default:
      return 'outline';
  }
}

// ─── Component ───────────────────────────────────────────────────────────

export default function AuditViewer(): JSX.Element {
  const [state, dispatch] = useReducer(reducer, initialState);
  const navigate = useNavigate();

  // Load entity types for filter dropdown
  useEffect(() => {
    let cancelled = false;
    listAuditEntityTypes()
      .then((types) => {
        if (!cancelled) dispatch({ type: 'ENTITY_TYPES_OK', entityTypes: types });
      })
      .catch(() => {
        if (!cancelled) dispatch({ type: 'ENTITY_TYPES_OK', entityTypes: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch entries when filters change
  const fetchEntries = useCallback(async (filters: AuditEntriesFilter) => {
    dispatch({ type: 'FETCH_START' });
    try {
      const result = await listAuditEntries(filters);
      dispatch({ type: 'FETCH_OK', entries: result.data, meta: result.meta });
    } catch (err: unknown) {
      dispatch({
        type: 'FETCH_FAIL',
        message: err instanceof Error ? err.message : 'Failed to load audit entries',
      });
    }
  }, []);

  useEffect(() => {
    void fetchEntries(state.filters);
  }, [state.filters, fetchEntries]);

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Audit Trail</h1>
        <p className="text-muted-foreground mt-1">
          View and filter all changes made across the platform. Click an entry to see the full
          before/after diff.
        </p>
      </header>

      {/* ── Filters ──────────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {/* Entity type */}
            <div className="space-y-1">
              <Label htmlFor="filter-entity-type">Entity type</Label>
              <Select
                value={state.filters.entityType ?? ''}
                onValueChange={(value) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { entityType: value || undefined },
                  })
                }
              >
                <SelectTrigger id="filter-entity-type" data-testid="filter-entity-type">
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">All types</SelectItem>
                  {state.entityTypes.map((type) => (
                    <SelectItem key={type} value={type}>
                      {type}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Operation */}
            <div className="space-y-1">
              <Label htmlFor="filter-operation">Operation</Label>
              <Select
                value={state.filters.operation ?? ''}
                onValueChange={(value) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { operation: (value as AuditOperation) || undefined },
                  })
                }
              >
                <SelectTrigger id="filter-operation" data-testid="filter-operation">
                  <SelectValue placeholder="All operations" />
                </SelectTrigger>
                <SelectContent>
                  {OPERATION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* User search */}
            <div className="space-y-1">
              <Label htmlFor="filter-user">User</Label>
              <Input
                id="filter-user"
                placeholder="Search by user name"
                value={state.filters.userId ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { userId: e.target.value || undefined },
                  })
                }
                data-testid="filter-user"
              />
            </div>

            {/* Date from */}
            <div className="space-y-1">
              <Label htmlFor="filter-date-from">From</Label>
              <Input
                id="filter-date-from"
                type="date"
                value={state.filters.dateFrom ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { dateFrom: e.target.value || undefined },
                  })
                }
                data-testid="filter-date-from"
              />
            </div>

            {/* Date to */}
            <div className="space-y-1">
              <Label htmlFor="filter-date-to">To</Label>
              <Input
                id="filter-date-to"
                type="date"
                value={state.filters.dateTo ?? ''}
                onChange={(e) =>
                  dispatch({
                    type: 'SET_FILTER',
                    filter: { dateTo: e.target.value || undefined },
                  })
                }
                data-testid="filter-date-to"
              />
            </div>
          </div>

          <div className="mt-4 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => dispatch({ type: 'RESET_FILTERS' })}
              data-testid="reset-filters"
            >
              Reset filters
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* ── Error state ──────────────────────────────────────────── */}
      {state.error && (
        <Alert variant="destructive" data-testid="audit-error">
          <AlertTitle>Error loading audit entries</AlertTitle>
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      {/* ── Loading state ────────────────────────────────────────── */}
      {state.loading && (
        <div role="status" aria-label="Loading audit entries" className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {/* ── Entries table ────────────────────────────────────────── */}
      {!state.loading && !state.error && (
        <>
          {state.entries.length === 0 ? (
            <Alert data-testid="no-entries">
              <AlertDescription>No audit entries match the current filters.</AlertDescription>
            </Alert>
          ) : (
            <div className="border rounded overflow-x-auto">
              <Table data-testid="audit-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Timestamp</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Operation</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Changes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {state.entries.map((entry) => (
                    <TableRow
                      key={entry.id}
                      className="cursor-pointer hover:bg-accent/40"
                      onClick={() => navigate(entry.id)}
                      data-testid={`audit-row-${entry.id}`}
                    >
                      <TableCell className="whitespace-nowrap">
                        <time dateTime={entry.timestamp}>
                          {new Date(entry.timestamp).toLocaleString()}
                        </time>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{entry.entityType}</span>
                        <span className="text-muted-foreground text-xs ml-1">
                          ({entry.entityId.slice(0, 8)}…)
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={operationBadgeVariant(entry.operation)}>
                          {entry.operation}
                        </Badge>
                      </TableCell>
                      <TableCell>{entry.userDisplayName}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {entry.changes.length} field(s)
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {/* ── Pagination ─────────────────────────────────────────── */}
          {state.meta.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2" data-testid="audit-pagination">
              <span className="text-sm text-muted-foreground">
                Page {state.meta.page} of {state.meta.totalPages} ({state.meta.totalItems} entries)
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.meta.page <= 1}
                  onClick={() => dispatch({ type: 'SET_PAGE', page: state.meta.page - 1 })}
                  data-testid="prev-page"
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={state.meta.page >= state.meta.totalPages}
                  onClick={() => dispatch({ type: 'SET_PAGE', page: state.meta.page + 1 })}
                  data-testid="next-page"
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
