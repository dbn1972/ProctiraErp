/**
 * WorkflowInbox — lists the active user's pending workflow approvals.
 *
 * Wired to the workflow-service API (Task 60A.1):
 *   - GET /api/v1/workflows/instances (filtered by status=ACTIVE)
 *
 * Provides filters by:
 *   - Entity type (student_transfer, staff_leave, scholarship_application, etc.)
 *   - Priority (high, normal, low)
 *   - Assigned date range
 *   - SLA status (on_track, at_risk, overdue)
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6
 */
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { browserGatewayFetch, BrowserGatewayError } from '@/lib/api/browser-gateway';

/* ------------------------------------------------------------------ Types */

type SlaStatus = 'on_track' | 'at_risk' | 'overdue';
type Priority = 'high' | 'normal' | 'low';

interface WorkflowInboxItem {
  id: string;
  workflowDefinitionId: string;
  entityType: string;
  entityId: string;
  currentStateId: string;
  status: string;
  metadata: Record<string, unknown> | null;
  approvals: Array<{
    stateId: string;
    actorId: string;
    action: string;
    timestamp: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

interface InboxListResponse {
  data: WorkflowInboxItem[];
  meta: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

interface InboxFilters {
  entityType: string;
  priority: Priority | '';
  slaStatus: SlaStatus | '';
  page: number;
  pageSize: number;
}

/* ------------------------------------------------------------------ Helpers */

const ENTITY_TYPE_OPTIONS = [
  { value: '', label: 'All Types' },
  { value: 'student_transfer', label: 'Student Transfer' },
  { value: 'staff_leave', label: 'Staff Leave' },
  { value: 'scholarship_application', label: 'Scholarship Application' },
  { value: 'disciplinary_case', label: 'Disciplinary Case' },
  { value: 'counselling_case', label: 'Counselling Case' },
  { value: 'complaint', label: 'Complaint' },
];

const PRIORITY_OPTIONS = [
  { value: '', label: 'All Priorities' },
  { value: 'high', label: 'High' },
  { value: 'normal', label: 'Normal' },
  { value: 'low', label: 'Low' },
];

const SLA_STATUS_OPTIONS = [
  { value: '', label: 'All SLA' },
  { value: 'on_track', label: 'On Track' },
  { value: 'at_risk', label: 'At Risk' },
  { value: 'overdue', label: 'Overdue' },
];

/**
 * Derives SLA status from the item's creation date and metadata.
 * In production this would come from the backend; here we derive it
 * from the elapsed time since creation as a heuristic.
 */
function deriveSlaStatus(item: WorkflowInboxItem): SlaStatus {
  const createdAt = new Date(item.createdAt).getTime();
  const now = Date.now();
  const hoursElapsed = (now - createdAt) / (1000 * 60 * 60);

  // Use metadata-defined SLA if available
  const slaDurationHours = item.metadata?.slaDurationHours as number | undefined;
  const threshold = slaDurationHours ?? 48;

  if (hoursElapsed > threshold) return 'overdue';
  if (hoursElapsed > threshold * 0.75) return 'at_risk';
  return 'on_track';
}

/**
 * Derives priority from item metadata.
 */
function derivePriority(item: WorkflowInboxItem): Priority {
  const priority = item.metadata?.priority as string | undefined;
  if (priority === 'high' || priority === 'normal' || priority === 'low') {
    return priority;
  }
  return 'normal';
}

function formatEntityType(entityType: string): string {
  return entityType
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function getSlaStatusBadgeClass(status: SlaStatus): string {
  switch (status) {
    case 'on_track':
      return 'bg-green-100 text-green-800';
    case 'at_risk':
      return 'bg-yellow-100 text-yellow-800';
    case 'overdue':
      return 'bg-red-100 text-red-800';
  }
}

function getPriorityBadgeClass(priority: Priority): string {
  switch (priority) {
    case 'high':
      return 'bg-red-100 text-red-800';
    case 'normal':
      return 'bg-blue-100 text-blue-800';
    case 'low':
      return 'bg-gray-100 text-gray-800';
  }
}

/* ------------------------------------------------------------------ Component */

export default function WorkflowInbox() {
  const [items, setItems] = useState<WorkflowInboxItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [filters, setFilters] = useState<InboxFilters>({
    entityType: '',
    priority: '',
    slaStatus: '',
    page: 1,
    pageSize: 20,
  });

  const fetchInbox = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('status', 'ACTIVE');
      params.set('page', String(filters.page));
      params.set('pageSize', String(filters.pageSize));
      if (filters.entityType) {
        params.set('entityType', filters.entityType);
      }

      const result = await browserGatewayFetch<InboxListResponse>(
        `/workflows/instances?${params.toString()}`,
      );
      setItems(result.data);
      setTotalPages(result.meta.totalPages);
      setTotal(result.meta.total);
    } catch (err) {
      if (err instanceof BrowserGatewayError) {
        setError(err.message);
      } else {
        setError('Failed to load workflow inbox');
      }
    } finally {
      setIsLoading(false);
    }
  }, [filters.entityType, filters.page, filters.pageSize]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // Client-side filtering for priority and SLA (backend doesn't support these filters directly)
  const filteredItems = useMemo(() => {
    let result = items;

    if (filters.priority) {
      result = result.filter((item) => derivePriority(item) === filters.priority);
    }

    if (filters.slaStatus) {
      result = result.filter((item) => deriveSlaStatus(item) === filters.slaStatus);
    }

    return result;
  }, [items, filters.priority, filters.slaStatus]);

  const handleFilterChange = (key: keyof InboxFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      // Reset page when filters change
      ...(key !== 'page' ? { page: 1 } : {}),
    }));
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Workflow Inbox</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {total} pending approval{total !== 1 ? 's' : ''}
          </p>
        </div>
        <button
          onClick={fetchInbox}
          disabled={isLoading}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
          aria-label="Refresh inbox"
        >
          {isLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3" role="group" aria-label="Inbox filters">
        <select
          value={filters.entityType}
          onChange={(e) => handleFilterChange('entityType', e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by entity type"
        >
          {ENTITY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.priority}
          onChange={(e) => handleFilterChange('priority', e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by priority"
        >
          {PRIORITY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={filters.slaStatus}
          onChange={(e) => handleFilterChange('slaStatus', e.target.value)}
          className="rounded-md border border-input bg-background px-3 py-2 text-sm"
          aria-label="Filter by SLA status"
        >
          {SLA_STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Error */}
      {error && (
        <div
          className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive"
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {isLoading && (
        <div className="space-y-3" data-testid="inbox-loading">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && filteredItems.length === 0 && !error && (
        <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
          No pending workflow items match your filters.
        </div>
      )}

      {/* Inbox list */}
      {!isLoading && filteredItems.length > 0 && (
        <div className="rounded-md border">
          <table className="w-full text-sm" data-testid="workflow-inbox-table">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Entity</th>
                <th className="px-4 py-3 text-left font-medium">Type</th>
                <th className="px-4 py-3 text-left font-medium">Current State</th>
                <th className="px-4 py-3 text-center font-medium">Priority</th>
                <th className="px-4 py-3 text-center font-medium">SLA</th>
                <th className="px-4 py-3 text-left font-medium">Assigned</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const slaStatus = deriveSlaStatus(item);
                const priority = derivePriority(item);
                return (
                  <tr key={item.id} className="border-b hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">
                      {(item.metadata?.entityLabel as string) || item.entityId}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatEntityType(item.entityType)}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                        {item.currentStateId}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getPriorityBadgeClass(priority)}`}
                      >
                        {priority.charAt(0).toUpperCase() + priority.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getSlaStatusBadgeClass(slaStatus)}`}
                      >
                        {slaStatus === 'on_track'
                          ? 'On Track'
                          : slaStatus === 'at_risk'
                            ? 'At Risk'
                            : 'Overdue'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(item.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/app/workflows/${item.id}`}
                        className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                      >
                        Review
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between" aria-label="Pagination">
          <p className="text-sm text-muted-foreground">
            Page {filters.page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleFilterChange('page', String(filters.page - 1))}
              disabled={filters.page <= 1}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Previous
            </button>
            <button
              onClick={() => handleFilterChange('page', String(filters.page + 1))}
              disabled={filters.page >= totalPages}
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm font-medium hover:bg-accent disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
